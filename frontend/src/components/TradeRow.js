import { useState } from 'react';
import { tradesApi } from '../api';
import { Edit2, Trash2, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import TradingChart from './TradingChart';

const signed$ = (v) => {
  if (v == null) return '-';
  const n = Number(v);
  return (n > 0 ? '+' : n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

function ConfidenceDot({ level }) {
  return (
    <span
      className={`confidence-dot confidence-${level || 'unmatched'}`}
      title={`Match confidence: ${level || 'unmatched'}`}
    />
  );
}

// Tag categories map onto the semantic palette: mistakes read as negative,
// execution as positive, emotion as caution, the rest stay neutral or accent.
const TAG_CLASS = {
  strategy: 'accent', setup: '', execution: 'pos',
  mistake: 'neg', emotion: 'caution', outcome: 'accent', source: '',
};

export default function TradeRow({ trade, openTime, onEdit, onDeleted, onOpenDetail, customSetups = [], onCustomSetupsChanged }) {
  const [expanded, setExpanded] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [tags, setTags] = useState([]);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const pnl = trade.net_pnl ?? 0;
  const pnlTone = pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : '';

  const loadAnalysis = async () => {
    if (analysis !== null || loadingAnalysis) return;
    setLoadingAnalysis(true);
    try {
      const res = await tradesApi.getAnalysis(trade.trade_group);
      setAnalysis(res.data.analysis || {});
      setTags(res.data.tags || []);
    } catch (e) {
      setAnalysis({});
    } finally {
      setLoadingAnalysis(false);
    }
  };

  const handleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) loadAnalysis();
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await tradesApi.delete(trade.id);
      onDeleted(trade.id);
    } catch (e) {
      alert('Delete failed: ' + e.message);
      setDeleting(false);
    }
  };

  // Playbook setup tag: set by hand from the dropdown below.
  const ADD_NEW = '__add_new__';

  /** Setup cell: shows the badge, click to tag. Stock trades only. */
  function SetupEditor({ trade }) {
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [local, setLocal] = useState({
      setup: trade.setup, grade: trade.setup_grade,
      notes: trade.setup_notes, source: trade.setup_source,
    });

    if (trade.instrument_type && trade.instrument_type !== 'STOCK') {
      return <span className="text-faint" style={{ fontSize: 13 }} title="Setups are tagged on stock trades only">—</span>;
    }

    const save = async (value) => {
      if (value === ADD_NEW) {
        const name = window.prompt(
          'Name your setup, e.g. "Bookmap absorption read".\n\n'
          + 'It gets added to the dropdown for every trade.');
        if (!name || !name.trim()) { setEditing(false); return; }
        setSaving(true);
        try {
          await tradesApi.createCustomSetup({ name: name.trim() });
          if (onCustomSetupsChanged) await onCustomSetupsChanged();
          value = name.trim();
        } catch (e) {
          alert('Could not add setup: ' + (e?.response?.data?.detail || e.message));
          setSaving(false); setEditing(false); return;
        }
      }
      setSaving(true);
      try {
        const { data } = await tradesApi.setSetup(trade.id, value === '' ? null : value);
        setLocal({
          setup: data.setup,
          grade: data.setup_grade !== undefined ? data.setup_grade : local.grade,
          notes: null,
          source: data.setup_source,
        });
        setEditing(false);
      } catch (e) {
        alert('Could not save setup: ' + (e?.response?.data?.detail || e.message));
      } finally {
        setSaving(false);
      }
    };

    if (editing) {
      return (
        <select
          autoFocus
          disabled={saving}
          aria-label={`Setup for ${trade.ticker} on ${trade.date}`}
          defaultValue={local.setup === 'NONE' ? 'NONE' : (local.setup || '')}
          onChange={e => save(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={e => { if (e.key === 'Escape') setEditing(false); }}
          style={{ fontSize: 13, padding: '4px 8px', minHeight: 32, maxWidth: 260, borderColor: 'var(--accent-line)' }}
        >
          <option value="">(clear tag)</option>
          {customSetups.length > 0 && (
            <optgroup label="Playbook">
              {customSetups.map(cs => (
                <option key={cs.id} value={cs.name}>
                  {cs.name}{cs.side ? ` (${cs.side.toLowerCase()})` : ''}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Other">
            <option value="NONE">No setup</option>
            <option value={ADD_NEW}>+ Add a new setup…</option>
          </optgroup>
        </select>
      );
    }

    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Click to set the setup manually"
        aria-label={`Setup: ${local.setup || trade.strategy || 'none'}. Change setup`}
        style={{ background: 'none', border: 0, padding: '2px 0', display: 'inline-flex', alignItems: 'center', gap: 6, textAlign: 'left' }}
      >
        <SetupBadge
          setup={local.setup}
          grade={local.grade}
          notes={local.notes}
          strategy={trade.strategy}
          source={local.source}
        />
        {local.source === 'manual' && (
          <span
            title="Manually tagged"
            className="text-faint"
            style={{ fontSize: 11 }}
          >
            ✎
          </span>
        )}
      </button>
    );
  }
  /** MFE / MAE / exit efficiency — how much of the move was there, and how much was taken. */
  function Excursion({ trade }) {
    const { mfe_pct: mfe, mae_pct: mae, exit_efficiency: eff } = trade;
    if (mfe == null && mae == null) {
      return <span className="text-faint" style={{ fontSize: 13 }}>—</span>;
    }
    // Green when most of the available move was captured, red when little was.
    const effCls = eff == null ? 'text-muted'
      : eff >= 60 ? 'pos' : eff >= 35 ? 'caution' : 'neg';
    const title = [
      `MFE  ${mfe >= 0 ? '+' : ''}${Number(mfe).toFixed(2)}%  — best unrealised gain while open (the opportunity)`,
      `MAE  ${Number(mae).toFixed(2)}%  — worst unrealised loss while open (the heat taken)`,
      eff != null ? `Exit efficiency ${Number(eff).toFixed(0)}% — share of the available move you captured` : null,
    ].filter(Boolean).join('\n');
    return (
      <span title={title} className="num" style={{ display: 'inline-flex', gap: 6, alignItems: 'baseline', fontSize: 13 }}>
        <span className="pos">{mfe >= 0 ? '+' : ''}{Number(mfe).toFixed(1)}%</span>
        <span className="text-faint">/</span>
        <span className="neg">{Number(mae).toFixed(1)}%</span>
        {eff != null && (
          <span className={effCls} style={{ fontWeight: 700 }}>{Number(eff).toFixed(0)}%</span>
        )}
      </span>
    );
  }

  // Grade colours: A-range reads positive, C/D caution, F neutral. Meaning is unchanged.
  const GRADE_CLASS = {
    'A++': 'pos', 'A+': 'pos', A: 'pos', B: 'pos',
    C: 'caution', D: 'caution', F: 'text-faint',
  };
  const GRADE_MEANING = {
    'A++': 'textbook execution',
    'A+': 'excellent execution',
    A: 'good execution, one minor slip',
    B: 'solid, minor execution warnings',
    C: 'one clear rule broken',
    D: 'multiple rules broken',
    F: 'no qualifying setup',
  };

  function SetupBadge({ setup, grade, notes, strategy, source }) {
    // No auto-classified setup: fall back to the manually tagged strategy.
    if (!setup || setup === 'NONE') {
      return strategy
        ? <span className="text-muted" style={{ fontSize: 14 }}>{strategy}</span>
        : <span className="text-faint" style={{ fontSize: 13 }}>—</span>;
    }
    let violations = [];
    try {
      const parsed = typeof notes === 'string' ? JSON.parse(notes) : notes;
      violations = parsed?.violations || [];
    } catch { /* notes may be absent or malformed; badge still renders */ }
    const highs = violations.filter(v => v.severity === 'high').length;
    // Graded setups read as a chip; an ungraded one is just the name.
    const gradeCls = GRADE_CLASS[grade] || 'text-muted';
    const title = [
      setup + '  (playbook setup)',
      grade ? `Grade ${grade}${GRADE_MEANING[grade] ? ` — ${GRADE_MEANING[grade]}` : ''}` : null,
      strategy ? `Tagged strategy: ${strategy}` : null,
      violations.length ? '' : null,
      ...violations.map(v => `${v.severity === 'high' ? '✕' : '!'} ${v.msg}`),
    ].filter(x => x !== null).join('\n');
    return (
      <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 14 }}>
        <span style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{setup}</span>
        {grade && (
          <span className={`chip ${gradeCls === 'pos' ? 'pos' : gradeCls === 'caution' ? 'caution' : ''}`} style={{ fontSize: 11.5, padding: '1px 6px' }}>
            {grade}
          </span>
        )}
        {highs > 0 && (
          <span className="neg" style={{ fontSize: 12, fontWeight: 700 }} title={title}>
            ✕{highs}
          </span>
        )}
      </span>
    );
  }

  const side = (trade.side || '').toUpperCase();

  return (
    <>
      <tr
        className={`row-link${expanded ? ' row-selected' : ''}`}
        onClick={handleExpand}
        tabIndex={0}
        aria-expanded={expanded}
        onKeyDown={e => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleExpand(); }
        }}
      >
        <td>
          <div className="num">{trade.date}</div>
          {openTime && <div className="num text-muted" style={{ fontSize: 13 }}>{openTime.slice(0, 5)}</div>}
        </td>
        <td>
          <span style={{ fontWeight: 600 }}>{trade.ticker}</span>
        </td>
        <td>
          <span className={`badge badge-${trade.instrument_type?.toLowerCase()}`}>
            {trade.instrument_type}
          </span>
        </td>
        <td className="text-muted">
          {side === 'LONG' ? 'Long' : side === 'SHORT' ? 'Short' : trade.side}
        </td>
        <td className={`num ${pnlTone}`} style={{ fontWeight: 600 }}>{signed$(pnl)}</td>
        <td onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
          <SetupEditor trade={trade} />
        </td>
        <td><Excursion trade={trade} /></td>
        <td className={`num ${trade.r_multiple > 0 ? 'pos' : trade.r_multiple < 0 ? 'neg' : 'text-muted'}`}>
          {trade.r_multiple != null ? `${trade.r_multiple > 0 ? '+' : ''}${Number(trade.r_multiple).toFixed(2)}R` : '—'}
        </td>
        <td style={{ textAlign: 'right' }}>
          <span className="text-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {trade.match_confidence && <ConfidenceDot level={trade.match_confidence} />}
            {expanded ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
          </span>
        </td>
      </tr>

      {expanded && (
        <tr className="row-expanded">
          <td colSpan={9} style={{ background: 'var(--surface-inset)', padding: 0 }}>
            <div style={{ padding: '20px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 24 }}>

              {/* Left: AI Analysis */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                  <h3 className="section-title" style={{ fontSize: 16 }}>Trade Analysis</h3>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {onOpenDetail && (
                      <button type="button" className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); onOpenDetail(trade); }}>
                        <ExternalLink size={13} /> Details
                      </button>
                    )}
                    <button type="button" className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); onEdit(trade); }}>
                      <Edit2 size={13} /> Edit
                    </button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}>
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                </div>

                {confirmDelete && (
                  <div className="notice neg" role="alertdialog" aria-label="Confirm delete" style={{ display: 'block', marginBottom: 12, color: 'var(--text-primary)' }}>
                    <div style={{ marginBottom: 8 }}>Delete this trade? This cannot be undone.</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className="btn btn-danger btn-sm" onClick={handleDelete} disabled={deleting}>
                        {deleting ? 'Deleting...' : 'Confirm Delete'}
                      </button>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
                    </div>
                  </div>
                )}

                {loadingAnalysis && <div className="spinner" />}

                {analysis && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {analysis.match_confidence && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                        <ConfidenceDot level={analysis.match_confidence} />
                        <span className="text-muted">Match:</span>
                        <span>{analysis.match_confidence}</span>
                        {analysis.match_notes && <span className="text-muted">· {analysis.match_notes}</span>}
                      </div>
                    )}

                    {[
                      ['Strategy', analysis.strategy],
                      ['Entry Reason', analysis.entry_reason],
                      ['Exit Reason', analysis.exit_reason],
                      ['Stop Loss', analysis.stop_loss ? `$${analysis.stop_loss}` : null],
                      ['Risk/Trade', analysis.risk_per_trade ? `$${analysis.risk_per_trade}` : null],
                      ['R:R Planned', analysis.risk_reward ? `1:${analysis.risk_reward}` : null],
                      ['R Multiple', analysis.r_multiple != null ? `${Number(analysis.r_multiple).toFixed(2)}R` : null],
                      ['Emotional State', analysis.emotional_state],
                      ['Mistakes', analysis.mistakes],
                    ].filter(([, v]) => v).map(([label, val]) => (
                      <div key={label} style={{ display: 'flex', gap: 12, fontSize: 14.5 }}>
                        <span className="text-muted" style={{ minWidth: 120 }}>{label}</span>
                        <span className={label === 'Mistakes' ? 'neg' : ''}>{val}</span>
                      </div>
                    ))}

                    {analysis.ai_feedback && (
                      <div className="notice accent" style={{ marginTop: 4 }}>
                        {analysis.ai_feedback}
                      </div>
                    )}

                    {tags.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                        {tags.map((tag, i) => (
                          <span key={i} className={`chip ${TAG_CLASS[tag.tag_type] || ''}`} title={tag.tag_type}>
                            {tag.tag_value}
                          </span>
                        ))}
                      </div>
                    )}

                    {!analysis.strategy && tags.length === 0 && !analysis.ai_feedback && (
                      <div className="text-muted" style={{ fontSize: 14.5 }}>
                        No analysis yet. Upload a diary screenshot on the Import page to get AI insights for this trade.
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Right: Price chart */}
              <div style={{ minWidth: 0 }}>
                <TradingChart
                  ticker={trade.ticker}
                  date={trade.date}
                  timeframe="5Min"
                  executions={trade.executions || []}
                  side={trade.side}
                  height={260}
                />
                {trade.instrument_type === 'OPTION' && (
                  <div className="text-muted" style={{ fontSize: 13, marginTop: 6 }}>
                    Showing underlying {trade.ticker} chart
                    {trade.option_expiry && ` | ${trade.option_type} ${trade.option_strike} exp ${trade.option_expiry}`}
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

