import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ChevronLeft, ChevronRight, RotateCcw, Calendar,
  TrendingUp, TrendingDown, CheckCircle, XCircle, Target, Brain,
  BookOpen, AlertTriangle, ChevronDown, ChevronUp
} from 'lucide-react';
import { tradesApi, kpisApi, diaryApi, dailySummaryApi, weeklySummaryApi } from '../api';
import { PageHeader, KpiStrip, KpiCell, PanelHead } from './ui';
import {
  BarChart, Bar, XAxis, YAxis, ReferenceLine,
  Tooltip, ResponsiveContainer, Cell
} from 'recharts';

// ── date helpers ──────────────────────────────────────────────────────────────
function prevTradingDay(iso) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}
function nextTradingDay(iso) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}
function formatDateLabel(iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}
function fmt$(v) {
  const n = Number(v || 0);
  return (n >= 0 ? '+$' : '-$') + Math.abs(n).toFixed(2);
}

// ── discipline score (client-side) ────────────────────────────────────────────
function computeDiscipline(trades) {
  let score = 100;
  const notes = [];
  for (const t of trades) {
    if (t.mistakes) { score -= 15; notes.push({ label: `${t.ticker}: mistakes noted`, delta: -15 }); }
    const emo = (t.emotional_state || '').toLowerCase();
    if (['revenge', 'frustrated', 'anxious'].some(e => emo.includes(e))) {
      score -= 10;
      notes.push({ label: `${t.ticker}: negative emotional state`, delta: -10 });
    }
    if (!t.stop_loss) { score -= 10; notes.push({ label: `${t.ticker}: no stop loss`, delta: -10 }); }
    if (!t.strategy) { score -= 5; notes.push({ label: `${t.ticker}: no strategy tagged`, delta: -5 }); }
    if (t.r_multiple > 1) { score += 5; notes.push({ label: `${t.ticker}: R > 1`, delta: +5 }); }
  }
  return { score: Math.max(0, Math.min(100, score)), notes };
}
function disciplineLabel(s) {
  if (s >= 85) return { text: 'Excellent', color: 'var(--green)' };
  if (s >= 70) return { text: 'Good', color: 'var(--blue)' };
  if (s >= 50) return { text: 'Needs Work', color: 'var(--orange)' };
  return { text: 'Review Day', color: 'var(--red)' };
}

// ── grade color ───────────────────────────────────────────────────────────────
function gradeColor(g) {
  if (!g) return 'var(--text-muted)';
  if (g.startsWith('A')) return 'var(--green)';
  if (g.startsWith('B')) return 'var(--blue)';
  if (g.startsWith('C')) return 'var(--orange)';
  return 'var(--red)';
}

function GradeBadge({ grade }) {
  return (
    <span
      title={grade ? `Grade ${grade}` : 'Not graded'}
      style={{
        minWidth: 28, height: 28, borderRadius: 'var(--radius-md)', padding: '0 6px',
        border: `1px solid ${gradeColor(grade)}`, color: gradeColor(grade),
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 700, flexShrink: 0,
      }}
    >{grade?.[0] || '?'}</span>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────────────
function Sk({ w = '100%', h = 16, style = {} }) {
  return <div className="skeleton" style={{ width: w, height: h, borderRadius: 4, ...style }} />;
}

// ── Timeline bar ─────────────────────────────────────────────────────────────
const MARKET_OPEN = 9 * 60 + 30; // 9:30 in minutes
const MARKET_CLOSE = 16 * 60;    // 16:00
const MARKET_MINS = MARKET_CLOSE - MARKET_OPEN;

function parseTimeMins(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function TradeTimeline({ trades }) {
  const tradesWithTime = trades.filter(t => {
    const execs = t.executions || [];
    return execs.some(e => e.time);
  });
  if (!tradesWithTime.length) return null;

  return (
    <section className="card">
      <PanelHead title="Trade Timeline" sub="When each trade was open, 9:30 to 16:00" />
      <div style={{ position: 'relative', height: 64, background: 'var(--surface-inset)', borderRadius: 'var(--radius-md)', overflow: 'visible' }}>
        {/* Hour ticks */}
        {[10, 11, 12, 13, 14, 15].map(h => {
          const mins = h * 60 - MARKET_OPEN;
          const pct = (mins / MARKET_MINS) * 100;
          return (
            <div key={h} style={{
              position: 'absolute', left: `${pct}%`, top: 0, bottom: 0,
              borderLeft: '1px dashed var(--divider)', opacity: 0.7,
            }}>
              <span style={{ position: 'absolute', bottom: -20, fontSize: 12, color: 'var(--text-secondary)', transform: 'translateX(-50%)' }}>
                {h > 12 ? `${h - 12}pm` : `${h}am`}
              </span>
            </div>
          );
        })}
        {/* Trade bars */}
        {tradesWithTime.map(t => {
          const execs = t.executions || [];
          const times = execs.map(e => parseTimeMins(e.time)).filter(Boolean);
          if (!times.length) return null;
          const first = Math.min(...times);
          const last = Math.max(...times);
          const leftMin = Math.max(first - MARKET_OPEN, 0);
          const widthMin = Math.max(last - first, 5); // min 5 min width
          const leftPct = (leftMin / MARKET_MINS) * 100;
          const widthPct = (widthMin / MARKET_MINS) * 100;
          const pnl = Number(t.net_pnl || 0);
          const color = pnl >= 0 ? 'var(--green)' : 'var(--red)';
          return (
            <div
              key={t.trade_group}
              title={`${t.ticker} ${fmt$(pnl)}`}
              style={{
                position: 'absolute',
                left: `${leftPct}%`,
                width: `${widthPct}%`,
                top: 12, bottom: 12,
                background: color,
                opacity: 0.85,
                borderRadius: 'var(--radius-sm)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11.5, fontWeight: 700, color: 'var(--surface-page)',
                overflow: 'hidden',
                cursor: 'default',
              }}
            >
              {widthPct > 3 ? t.ticker : ''}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24, fontSize: 12, color: 'var(--text-secondary)' }}>
        <span>9:30am</span><span>4:00pm</span>
      </div>
    </section>
  );
}

// ── R-Multiple chart ──────────────────────────────────────────────────────────
function RMultipleChart({ trades }) {
  const data = trades.filter(t => t.r_multiple != null).map(t => ({
    name: t.ticker,
    r: Number(t.r_multiple),
  }));
  if (!data.length) return null;
  return (
    <section className="card">
      <PanelHead title="R-Multiple by Trade" />
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
          <ReferenceLine y={0} stroke="var(--divider)" />
          <Tooltip
            cursor={{ fill: 'var(--accent-soft)' }}
            contentStyle={{ background: 'var(--surface-panel)', border: '1px solid var(--divider)', borderRadius: 6, fontSize: 13, color: 'var(--text-primary)' }}
            formatter={(v) => [`${v.toFixed(2)}R`, 'R-Multiple']}
          />
          <Bar dataKey="r" radius={[4, 4, 0, 0]}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.r >= 0 ? 'var(--green)' : 'var(--red)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}

// ── Discipline Score card ─────────────────────────────────────────────────────
function DisciplineCard({ trades }) {
  const { score, notes } = computeDiscipline(trades);
  const { text, color } = disciplineLabel(score);
  return (
    <section className="card">
      <PanelHead title="Discipline Score" sub="Scored from mistakes, emotion, stops and strategy tags" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 16 }}>
        <div className="num" style={{ fontSize: 48, fontWeight: 600, color, lineHeight: 1, fontFamily: 'var(--font-display)' }}>{score}</div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, color }}>{text}</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>out of 100</div>
        </div>
      </div>
      <div style={{
        height: 6, borderRadius: 3, background: 'var(--surface-inset)',
        marginBottom: 16, overflow: 'hidden',
      }}>
        <div style={{
          // Scaled rather than resized: animating width thrashes layout.
          height: '100%', width: '100%', borderRadius: 4,
          background: color,
          transform: `scaleX(${Math.max(0, Math.min(100, score)) / 100})`,
          transformOrigin: 'left',
          transition: 'transform 0.6s ease',
        }} />
      </div>
      {notes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {notes.map((n, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span className={`num ${n.delta > 0 ? 'pos' : 'neg'}`} style={{ fontWeight: 600, minWidth: 32 }}>
                {n.delta > 0 ? '+' : ''}{n.delta}
              </span>
              <span style={{ color: 'var(--text-muted)' }}>{n.label}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Historical Comparison ─────────────────────────────────────────────────────
function HistoricalComparison({ kpis, allTimeKpis }) {
  if (!kpis || !allTimeKpis) return null;
  const items = [
    {
      label: 'Win Rate',
      day: kpis.win_rate,
      all: allTimeKpis.win_rate,
      fmt: v => `${Number(v || 0).toFixed(1)}%`,
      delta: (d, a) => `${(d - a) >= 0 ? '+' : ''}${(d - a).toFixed(1)}pp`,
    },
    {
      label: 'Profit Factor',
      day: kpis.profit_factor,
      all: allTimeKpis.profit_factor,
      fmt: v => v == null ? '∞' : Number(v).toFixed(2),
      delta: (d, a) => d == null || a == null ? '' : `${(d - a) >= 0 ? '+' : ''}${(d - a).toFixed(2)}x`,
    },
    {
      label: 'Avg Win',
      day: kpis.avg_win,
      all: allTimeKpis.avg_win,
      fmt: v => `$${Number(v || 0).toFixed(0)}`,
      delta: (d, a) => `${(d - a) >= 0 ? '+' : ''}$${Math.abs(d - a).toFixed(0)}`,
    },
    {
      label: 'Net P&L',
      day: kpis.total_net_pnl,
      all: null,
      fmt: v => (v >= 0 ? '+$' : '-$') + Math.abs(Number(v || 0)).toFixed(2),
      delta: null,
    },
  ];
  return (
    <div className="card" role="group" aria-label="Today versus all-time averages" style={{
      display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center',
      padding: '12px 20px',
      marginBottom: 20,
    }}>
      <span className="eyebrow" style={{ marginRight: 4 }}>Vs all-time</span>
      {items.map(it => {
        const diff = it.all != null ? (Number(it.day || 0) - Number(it.all || 0)) : null;
        const pos = diff >= 0;
        return (
          <div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 140px' }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{it.label}:</span>
            <span className="num" style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{it.fmt(it.day)}</span>
            {diff != null && (
              <span style={{
                fontSize: 12.5, fontWeight: 600,
                color: pos ? 'var(--result-pos)' : 'var(--result-neg)',
                display: 'flex', alignItems: 'center', gap: 2,
              }}>
                {pos ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {it.delta(Number(it.day || 0), Number(it.all || 0))} vs avg
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── AI Summary panel ──────────────────────────────────────────────────────────
function AISummaryPanel({ summary, loading }) {
  if (loading) {
    return (
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }} aria-busy="true">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Brain size={16} color="var(--purple)" />
          <h2 className="section-title" style={{ fontSize: 17 }}>AI Summary</h2>
        </div>
        <Sk h={14} />
        <Sk h={14} w="85%" />
        <Sk h={14} w="70%" />
        <Sk h={14} style={{ marginTop: 8 }} />
        <Sk h={14} w="90%" />
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 8 }} role="status">Analyzing your trades...</div>
      </section>
    );
  }
  if (!summary) {
    return (
      <section className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Brain size={16} color="var(--purple)" />
          <h2 className="section-title" style={{ fontSize: 17 }}>AI Summary</h2>
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>No trades to summarize for this day.</div>
      </section>
    );
  }

  const tradeGradeMap = {};
  (summary.trade_grades || []).forEach(g => { tradeGradeMap[g.trade_group] = g; });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Overall grade + narrative */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <Brain size={16} color="var(--purple)" />
          <h2 className="section-title" style={{ fontSize: 17 }}>AI Coaching Report</h2>
          <div style={{
            marginLeft: 'auto',
            fontSize: 22, fontWeight: 700,
            color: gradeColor(summary.overall_grade),
            background: 'var(--surface-inset)', borderRadius: 'var(--radius-md)',
            padding: '2px 12px', lineHeight: 1.4,
          }} aria-label={`Overall grade ${summary.overall_grade || 'unknown'}`}>
            {summary.overall_grade || '?'}
          </div>
        </div>
        <p style={{ fontSize: 15, lineHeight: 1.65, color: 'var(--text-primary)', marginBottom: 12 }}>{summary.narrative}</p>
        {summary.mental_game && (
          <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary)', fontStyle: 'italic' }}>{summary.mental_game}</p>
        )}
      </div>

      {/* Strengths */}
      {summary.strengths?.length > 0 && (
        <div className="card">
          <h3 className="section-title" style={{ fontSize: 16, color: 'var(--result-pos)', marginBottom: 10 }}>
            Strengths
          </h3>
          {summary.strengths.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, fontSize: 14.5, lineHeight: 1.5 }}>
              <CheckCircle size={14} color="var(--result-pos)" style={{ flexShrink: 0, marginTop: 3 }} aria-hidden="true" />
              <span>{s}</span>
            </div>
          ))}
        </div>
      )}

      {/* Mistakes */}
      <div className="card">
        <h3 className="section-title" style={{ fontSize: 16, color: 'var(--result-neg)', marginBottom: 10 }}>
          Mistakes
        </h3>
        {(summary.mistakes?.length > 0) ? summary.mistakes.map((m, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, fontSize: 14.5, lineHeight: 1.5 }}>
            <XCircle size={14} color="var(--result-neg)" style={{ flexShrink: 0, marginTop: 3 }} aria-hidden="true" />
            <span>{m}</span>
          </div>
        )) : (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No mistakes flagged.</div>
        )}
      </div>

      {/* Coaching / Tomorrow's Focus */}
      {summary.coaching?.length > 0 && (
        <div className="card">
          <h3 className="section-title" style={{ fontSize: 16, color: 'var(--caution)', marginBottom: 10 }}>
            Tomorrow's Focus
          </h3>
          {summary.coaching.map((c, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, fontSize: 14.5, lineHeight: 1.5 }}>
              <Target size={14} color="var(--caution)" style={{ flexShrink: 0, marginTop: 3 }} aria-hidden="true" />
              <span>{c}</span>
            </div>
          ))}
        </div>
      )}

      {/* Patterns */}
      {summary.patterns?.length > 0 && (
        <div className="card">
          <h3 className="section-title" style={{ fontSize: 16, color: 'var(--text-primary)', marginBottom: 10 }}>
            Patterns
          </h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {summary.patterns.map((p, i) => (
              <span key={i} className="chip accent" style={{ fontSize: 12.5, whiteSpace: 'normal' }}>{p}</span>
            ))}
          </div>
        </div>
      )}

      {/* Trade Grades */}
      {summary.trade_grades?.length > 0 && (
        <div className="card">
          <h3 className="section-title" style={{ fontSize: 16, color: 'var(--text-primary)', marginBottom: 10 }}>
            Trade Grades
          </h3>
          {summary.trade_grades.map((tg, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
              <span className="chip" style={{ color: 'var(--text-primary)', flexShrink: 0 }}>{tg.ticker}</span>
              <GradeBadge grade={tg.grade} />
              <span style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{tg.one_line}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DailySummary({ accountId, date, onDateChange, onOpenDetail }) {
  const [trades, setTrades] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [diary, setDiary] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [cbDismissed, setCbDismissed] = useState(false);
  const [weeklySummary, setWeeklySummary] = useState(null);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [weeklyOpen, setWeeklyOpen] = useState(false);
  const allTimeKpisRef = useRef(null);

  const today = new Date().toISOString().split('T')[0];

  const fetchAllTimeKpis = useCallback(async () => {
    if (allTimeKpisRef.current) return;
    try {
      const params = {};
      if (accountId != null) params.account_id = accountId;
      const res = await kpisApi.get(params);
      allTimeKpisRef.current = res.data;
    } catch (e) {
      console.error('Failed to load all-time kpis', e);
    }
  }, [accountId]);

  const fetchDay = useCallback(async (d) => {
    setLoading(true);
    setSummaryLoading(true);
    setSummary(null);
    setCbDismissed(false);
    setWeeklySummary(null);
    setWeeklyOpen(false);
    try {
      const params = { date_from: d, date_to: d };
      if (accountId != null) params.account_id = accountId;

      const [tradesRes, kpisRes, diaryRes] = await Promise.all([
        tradesApi.list(params),
        kpisApi.get(params),
        diaryApi.list(accountId != null ? { account_id: accountId } : {}),
      ]);

      // Merge trade_analysis fields if present
      const rawTrades = tradesRes.data || [];
      setTrades(rawTrades);
      setKpis(kpisRes.data || null);

      const diaryEntries = diaryRes.data || [];
      const dayDiary = diaryEntries.find(e => e.entry_date === d) || null;
      setDiary(dayDiary);
    } catch (e) {
      console.error('Failed to load day data', e);
    } finally {
      setLoading(false);
    }

    // Fetch AI summary separately (can be slow)
    try {
      const sumParams = { date: d };
      if (accountId != null) sumParams.account_id = accountId;
      const sumRes = await dailySummaryApi.get(sumParams);
      setSummary(sumRes.data);
    } catch (e) {
      console.error('Failed to load summary', e);
    } finally {
      setSummaryLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    fetchAllTimeKpis();
  }, [fetchAllTimeKpis]);

  useEffect(() => {
    fetchDay(date);
  }, [date, fetchDay]);

  const handleRegenerate = async () => {
    setRegenerating(true);
    setSummaryLoading(true);
    setSummary(null);
    try {
      const params = { date, force: true };
      if (accountId != null) params.account_id = accountId;
      const res = await dailySummaryApi.get(params);
      setSummary(res.data);
    } catch (e) {
      console.error('Regenerate failed', e);
    } finally {
      setRegenerating(false);
      setSummaryLoading(false);
    }
  };

  const handleGenerateWeekly = async (force = false) => {
    setWeeklyLoading(true);
    setWeeklyOpen(true);
    try {
      const params = { date, force };
      if (accountId != null) params.account_id = accountId;
      const res = await weeklySummaryApi.get(params);
      setWeeklySummary(res.data);
    } catch (e) {
      console.error('Weekly summary failed', e);
    } finally {
      setWeeklyLoading(false);
    }
  };

  // Consecutive losing trades from end of today's list
  const consecutiveLosses = (() => {
    let count = 0;
    for (let i = trades.length - 1; i >= 0; i--) {
      if ((trades[i].net_pnl || 0) < 0) count++;
      else break;
    }
    return count;
  })();

  // Build grade map for trades table
  const tradeGradeMap = {};
  if (summary?.trade_grades) {
    summary.trade_grades.forEach(g => { tradeGradeMap[g.trade_group] = g; });
  }

  return (
    <div>
      {/* ── Header ── */}
      <PageHeader
        title={formatDateLabel(date)}
        subtitle="Day Review. Read the session while the decisions are fresh."
        actions={<>
          <button type="button" className="btn btn-secondary" onClick={() => onDateChange(prevTradingDay(date))} aria-label="Previous trading day">
            <ChevronLeft size={16} /> Previous
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => onDateChange(nextTradingDay(date))} aria-label="Next trading day">
            Next <ChevronRight size={16} />
          </button>
          {date !== today && (
            <button type="button" className="btn btn-ghost" onClick={() => onDateChange(today)}>
              <Calendar size={15} aria-hidden="true" /> Today
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleRegenerate}
            disabled={regenerating || loading}
          >
            <RotateCcw size={14} style={{ animation: regenerating ? 'spin 1s linear infinite' : 'none' }} aria-hidden="true" />
            {regenerating ? 'Regenerating...' : 'Regenerate AI'}
          </button>
        </>}
      />

      {/* ── KPI Strip ── */}
      {loading ? (
        <div className="skeleton" style={{ height: 110, borderRadius: 8, marginBottom: 20 }} />
      ) : kpis ? (
        <KpiStrip label="Day metrics">
          <KpiCell label="Net P&L" value={<span className="num">{(Number(kpis.total_net_pnl || 0) >= 0 ? '+$' : '-$') + Math.abs(Number(kpis.total_net_pnl || 0)).toFixed(2)}</span>} tone={Number(kpis.total_net_pnl || 0) >= 0 ? 'pos' : 'neg'} />
          <KpiCell label="Total Trades" value={<span className="num">{kpis.total_trades || 0}</span>} />
          <KpiCell label="Win Rate" value={<span className="num">{`${Number(kpis.win_rate || 0).toFixed(1)}%`}</span>} tone={Number(kpis.win_rate || 0) >= 50 ? 'pos' : 'neg'} />
          <KpiCell label="Profit Factor" value={<span className="num">{kpis.profit_factor == null ? '∞' : Number(kpis.profit_factor).toFixed(2)}</span>} tone={kpis.profit_factor == null || Number(kpis.profit_factor) >= 1 ? 'pos' : 'neg'} />
          <KpiCell label="Avg Win vs Loss" value={<span className="num">{`$${Number(kpis.avg_win || 0).toFixed(0)} / $${Math.abs(Number(kpis.avg_loss || 0)).toFixed(0)}`}</span>} />
        </KpiStrip>
      ) : null}

      {/* ── Historical Comparison ── */}
      {!loading && kpis && allTimeKpisRef.current && (
        <HistoricalComparison kpis={kpis} allTimeKpis={allTimeKpisRef.current} />
      )}

      {/* ── Circuit Breaker Banner ── */}
      {!loading && !cbDismissed && consecutiveLosses >= 3 && (
        <div className="notice caution" role="alert" style={{ alignItems: 'center', marginBottom: 20 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0 }} aria-hidden="true" />
          <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>
            {consecutiveLosses} losses in a row. Consider stepping back and reviewing before the next trade.
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCbDismissed(true)} aria-label="Dismiss loss-streak alert" style={{ color: 'inherit' }}>
            Dismiss
          </button>
        </div>
      )}

      {/* ── Main 2-column grid ── */}
      <div className="day-grid">
        {/* ── Left column ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Trades Table */}
          <section className="card panel-flush">
            <div style={{ padding: '18px 24px 12px' }}>
              <PanelHead title="The trades" sub="Open a trade to review it" />
            </div>
            {loading ? (
              <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[1,2,3].map(i => <Sk key={i} h={40} />)}
              </div>
            ) : trades.length === 0 ? (
              <div className="empty">No trades on this day.</div>
            ) : (
              <div className="table-container">
              <table>
                <thead>
                  <tr>
                    {['Ticker', 'Side', 'Strategy', 'R', 'P&L', 'Grade'].map(h => (
                      <th key={h} className={h === 'R' || h === 'P&L' ? 'num' : undefined} style={{ paddingLeft: h === 'Ticker' ? 24 : undefined }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trades.map(t => {
                    const pnl = Number(t.net_pnl || 0);
                    const grade = tradeGradeMap[t.trade_group];
                    return (
                      <tr
                        key={t.id}
                        className="row-link"
                        tabIndex={0}
                        onClick={() => onOpenDetail && onOpenDetail(t, trades)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDetail && onOpenDetail(t, trades); } }}
                        aria-label={`Open ${t.ticker} trade`}
                      >
                        <td style={{ paddingLeft: 24 }}>
                          <div style={{ fontWeight: 600 }}>{t.ticker}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t.instrument_type}</div>
                        </td>
                        <td className="text-muted">{t.side === 'LONG' ? 'Long' : t.side === 'SHORT' ? 'Short' : t.side}</td>
                        <td className="text-muted">{t.strategy || '—'}</td>
                        <td className={`num ${t.r_multiple != null ? (t.r_multiple >= 0 ? 'pos' : 'neg') : 'text-muted'}`}>
                          {t.r_multiple != null ? `${t.r_multiple > 0 ? '+' : ''}${Number(t.r_multiple).toFixed(2)}R` : '—'}
                        </td>
                        <td className={`num ${pnl >= 0 ? 'pos' : 'neg'}`} style={{ fontWeight: 600 }}>
                          {pnl >= 0 ? '+' : '-'}${Math.abs(pnl).toFixed(2)}
                        </td>
                        <td>
                          {summaryLoading ? (
                            <Sk w={28} h={28} style={{ borderRadius: 6 }} />
                          ) : grade ? (
                            <GradeBadge grade={grade.grade} />
                          ) : (
                            <span className="text-muted" style={{ fontSize: 13 }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            )}
          </section>

          {/* Trade Timeline */}
          {!loading && <TradeTimeline trades={trades} />}

          {/* R-Multiple Chart */}
          {!loading && <RMultipleChart trades={trades} />}

          {/* Discipline Score */}
          {!loading && trades.length > 0 && <DisciplineCard trades={trades} />}
        </div>

        {/* ── Right column ── */}
        <div className="day-aside">
          <AISummaryPanel summary={summary} loading={summaryLoading} />

          {/* Diary card */}
          {!loading && (
            <section className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <BookOpen size={16} color="var(--text-secondary)" aria-hidden="true" />
                <h2 className="section-title" style={{ fontSize: 17 }}>Diary</h2>
              </div>
              {diary ? (() => {
                let parsed = null;
                try { parsed = JSON.parse(diary.ai_analysis || '{}'); } catch {}
                return (
                  <div>
                    {parsed?.overall_summary && (
                      <p style={{ fontSize: 14.5, lineHeight: 1.6, color: 'var(--text-primary)', marginBottom: 10 }}>{parsed.overall_summary}</p>
                    )}
                    {parsed?.patterns_identified?.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {parsed.patterns_identified.map((p, i) => (
                          <span key={i} className="chip" style={{ whiteSpace: 'normal' }}>{p}</span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })() : (
                <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                  No diary for this day. Upload on the Import page.
                </div>
              )}
            </section>
          )}
          {/* Weekly Summary card */}
          <section className="card">
            <button
              type="button"
              onClick={() => weeklyOpen ? setWeeklyOpen(false) : handleGenerateWeekly(false)}
              aria-expanded={weeklyOpen}
              style={{
                width: '100%', background: 'none', border: 'none',
                display: 'flex', alignItems: 'center', gap: 8, padding: 0, color: 'var(--text-primary)',
              }}
            >
              <Brain size={16} color="var(--accent-line)" aria-hidden="true" />
              <span className="section-title" style={{ fontSize: 17, flex: 1, textAlign: 'left' }}>
                Weekly Summary
              </span>
              {weeklyOpen ? <ChevronUp size={16} color="var(--text-secondary)" /> : <ChevronDown size={16} color="var(--text-secondary)" />}
            </button>
            {weeklyOpen && (
              <div style={{ marginTop: 14 }}>
                {weeklyLoading ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div className="skeleton" style={{ height: 12 }} />
                    <div className="skeleton" style={{ height: 12, width: '85%' }} />
                    <div className="skeleton" style={{ height: 12, width: '70%' }} />
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Analyzing the week...</div>
                  </div>
                ) : weeklySummary?.error ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{weeklySummary.error}</div>
                ) : weeklySummary ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text)', margin: 0 }}>{weeklySummary.week_narrative}</p>
                    {weeklySummary.anchor_mistake && (
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--red)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Anchor Mistake</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{weeklySummary.anchor_mistake}</div>
                      </div>
                    )}
                    {weeklySummary.weekly_edge && (
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Weekly Edge</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{weeklySummary.weekly_edge}</div>
                      </div>
                    )}
                    {weeklySummary.next_week_rule && (
                      <div className="notice accent" style={{ display: 'block' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--purple)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Rule for Next Week</div>
                        <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{weeklySummary.next_week_rule}</div>
                      </div>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleGenerateWeekly(true)}
                      style={{ alignSelf: 'flex-start' }}
                    >
                      <RotateCcw size={12} aria-hidden="true" /> Regenerate
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </section>
        </div>
      </div>

    </div>
  );
}
