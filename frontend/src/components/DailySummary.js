import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ChevronLeft, ChevronRight, RotateCcw, Calendar,
  AlertTriangle
} from 'lucide-react';
import { tradesApi, kpisApi, diaryApi, dailySummaryApi } from '../api';
import { PageHeader, PanelHead } from './ui';
import { DayCurve, DayMeasures, Coaching, DayTrades } from '../v3/ReviewParts';
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
        <div className="v3-band"><div className="v3-empty">Loading…</div></div>
      ) : (
        <>
          <div className="v3-hero" style={{ paddingTop: 8 }}>
            <div className="v3-sec-head" style={{ marginBottom: 6 }}>
              <div>
                <h2 className="v3-h">The session</h2>
                <p className="v3-h-sub">
                  Running P&amp;L from the open to the close, with every trade marked where you entered it
                </p>
              </div>
            </div>
            <DayCurve trades={trades} onPick={(t) => onOpenDetail && onOpenDetail(t, trades)} />
          </div>
          <DayMeasures kpis={kpis} trades={trades} summary={summary} allTime={allTimeKpisRef.current} />
        </>
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
      <div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Coaching first: you read the review, then the trades it is about */}
          <section className="card">
            <Coaching summary={summary} loading={summaryLoading} onRegenerate={handleRegenerate} />
          </section>

          {/* The trades */}
          <section className="card panel-flush">
            <div style={{ padding: '18px 0 12px' }}>
              <PanelHead title="Trade by trade" sub="Hover a grade for the reason. Click a row to open the trade." />
            </div>
            <DayTrades
              trades={trades}
              gradeMap={tradeGradeMap}
              loading={loading || summaryLoading}
              onOpen={onOpenDetail}
            />
          </section>

          {/* Trade Timeline */}

          {/* R-Multiple Chart */}
          {!loading && <RMultipleChart trades={trades} />}

        </div>

        {/* ── Right column ── */}
      </div>

    </div>
  );
}
