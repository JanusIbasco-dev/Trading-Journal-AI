import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ComposedChart, Area, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { kpisApi, calendarApi, tradesApi, edgeReportApi, goalsApi } from '../api';
import DateRangePicker from './DateRangePicker';
import CalendarGrid from './CalendarGrid';
import {
  PageHeader, PanelHead, KpiStrip, KpiCell, GoalMeter, DeltaLine, MoneyValue, signedMoney, toneOf,
} from './ui';

const fmt$ = (v) => `$${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtDate = (d) => {
  if (!d) return '';
  const [, m, day] = d.split('-');
  return `${m}/${day}`;
};
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtLong = (d) => {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${MONTHS_SHORT[Number(m) - 1]} ${Number(day)}, ${y}`;
};

const AXIS_TICK = { fill: 'var(--text-secondary)', fontSize: 11 };

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="card" style={{ padding: '8px 12px', fontSize: 13 }}>
      <div style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} className={`num ${toneOf(p.value) || ''}`}>
          {p.name}: {Number(p.value) < 0 ? '-' : ''}{fmt$(Math.abs(p.value))}
        </div>
      ))}
    </div>
  );
};

// ── Mini Calendar widget ───────────────────────────────────────────────────────

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const fmtPnlMini = (v) => {
  const n = Number(v || 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1000) {
    const k = abs / 1000;
    return `${sign}$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1).replace(/\.?0+$/, '')}K`;
  }
  return `${sign}$${abs % 1 === 0 ? abs.toFixed(0) : abs.toFixed(0)}`;
};

function MiniCalendar({ accountId, onDayClick }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [dayData, setDayData] = useState({});

  useEffect(() => {
    const params = { year, month };
    if (accountId != null) params.account_id = accountId;
    calendarApi.get(params).then(r => {
      const map = {};
      for (const d of r.data) map[d.date] = d;
      setDayData(map);
    }).catch(() => {});
  }, [year, month, accountId]);

  const prevMonth = () => { if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1); };

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDay = (new Date(year, month - 1, 1).getDay() + 6) % 7; // Mon=0

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const allWeeks = [];
  for (let i = 0; i < cells.length; i += 7) allWeeks.push(cells.slice(i, i + 7));
  const weeks = allWeeks.filter(w => w.slice(0, 5).some(d => d !== null));

  const allDays = Object.values(dayData);
  const monthPnl = allDays.reduce((s, d) => s + d.net_pnl, 0);
  const tradingDayCount = allDays.length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h2 className="section-title" style={{ fontSize: 21 }}>{MONTHS[month - 1]}</h2>
          <span className="text-muted num" style={{ fontSize: 16 }}>{year}</span>
          <div style={{ display: 'flex', gap: 4, alignSelf: 'center', marginLeft: 6 }}>
            <button type="button" className="cal-nav" onClick={prevMonth} aria-label="Previous month">
              <ChevronLeft size={16} />
            </button>
            <button type="button" className="cal-nav" onClick={nextMonth} aria-label="Next month">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
          <span style={{ fontSize: 14 }}>
            <span className="text-muted">Month </span>
            <strong className={`num ${toneOf(monthPnl) || ''}`} style={{ fontSize: 17 }}>
              {monthPnl > 0 ? '+' : ''}{fmtPnlMini(monthPnl)}
            </strong>
          </span>
          <span className="text-muted" style={{ fontSize: 14 }}>
            <span className="num" style={{ color: 'var(--text-primary)' }}>{tradingDayCount}</span> days
          </span>
        </div>
      </div>

      <CalendarGrid weeks={weeks} dayData={dayData} year={year} month={month} onDayClick={onDayClick} size="mini" />
    </div>
  );
}

// ── Goals Panel ───────────────────────────────────────────────────────────────

const GOAL_FIELDS = [
  { key: 'win_rate',         label: 'Trade Win %',     suffix: '%',  step: 1,   min: 0, max: 100 },
  { key: 'profit_factor',    label: 'Profit Factor',   suffix: '',   step: 0.1, min: 0 },
  { key: 'day_win_rate',     label: 'Day Win %',       suffix: '%',  step: 1,   min: 0, max: 100 },
  { key: 'expectancy',       label: 'Expectancy ($)',  prefix: '$',  suffix: '', step: 5, min: 0 },
  { key: 'avg_win_loss_ratio', label: 'Avg W/L Ratio', suffix: '',  step: 0.1, min: 0 },
];

function GoalsPanel({ draft, onChange, onSave, onCancel, accountLabel, saving, error }) {
  return (
    <section className="card" style={{ marginBottom: 20, boxShadow: 'inset 0 0 0 1px var(--accent-line-soft), var(--shadow-card)' }} aria-labelledby="goals-title">
      <div className="panel-head" style={{ marginBottom: 14 }}>
        <div>
          <h2 id="goals-title" className="section-title">Goals</h2>
          <div className="section-sub">Applies to {accountLabel}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
      {error && (
        <div className="notice neg" role="alert" style={{ marginBottom: 14 }}>
          Could not save goals: {error}. Your edits are still here, try again.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        {GOAL_FIELDS.map(f => (
          <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span className="field-label" style={{ marginBottom: 0 }}>{f.label}</span>
            <input
              type="number"
              step={f.step}
              min={f.min}
              max={f.max}
              value={draft?.[f.key] ?? ''}
              onChange={e => onChange({ ...draft, [f.key]: Number(e.target.value) })}
              style={{ width: '100%' }}
            />
          </label>
        ))}
      </div>
    </section>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────────

function getPrevPeriod(dateFrom, dateTo) {
  if (!dateFrom || !dateTo) return null;
  const f = new Date(dateFrom + 'T00:00:00');
  const t = new Date(dateTo + 'T00:00:00');
  const days = Math.round((t - f) / 86400000) + 1;
  const prevTo = new Date(f); prevTo.setDate(f.getDate() - 1);
  const prevFrom = new Date(prevTo); prevFrom.setDate(prevTo.getDate() - days + 1);
  const s = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { dateFrom: s(prevFrom), dateTo: s(prevTo) };
}

function openActivate(handler) {
  return {
    tabIndex: 0,
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } },
  };
}

export default function Dashboard({ accountId, accounts = [], selectedAccountId, onDayClick, onOpenDetail, onViewAllTrades }) {
  const [kpis, setKpis] = useState(null);
  const [prevKpis, setPrevKpis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [openPositions, setOpenPositions] = useState([]);
  const [recentTrades, setRecentTrades] = useState([]);
  const [closingPos, setClosingPos] = useState(null);
  const [closePrice, setClosePrice] = useState('');
  const [closeDate, setCloseDate] = useState('');
  const [closeTime, setCloseTime] = useState('16:00');
  const [closeCommission, setCloseCommission] = useState('0');
  const [closeError, setCloseError] = useState(null);
  const [closeSubmitting, setCloseSubmitting] = useState(false);
  const [edgeReport, setEdgeReport] = useState(null);
  const [goals, setGoals] = useState(null);
  const [showGoals, setShowGoals] = useState(false);
  const [goalsDraft, setGoalsDraft] = useState(null);
  const [goalsSaving, setGoalsSaving] = useState(false);
  const [goalsError, setGoalsError] = useState(null);
  // Bumped after a write so every panel refetches; also drives Retry.
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey(k => k + 1), []);
  // Each effect run takes a ticket; a response that is not the newest is dropped,
  // so a slow reply cannot overwrite a newer account or date selection.
  const kpiRun = useRef(0);
  const positionsRun = useRef(0);

  useEffect(() => {
    const run = ++kpiRun.current;
    const current = () => run === kpiRun.current;
    setLoading(true);
    setError(null);
    const params = {};
    if (accountId != null) params.account_id = accountId;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;

    kpisApi.get(params)
      .then(r => { if (current()) { setKpis(r.data); setLoading(false); } })
      .catch(e => { if (current()) { setError(e.message); setLoading(false); } });

    edgeReportApi.get(params)
      .then(r => { if (current()) setEdgeReport(r.data); })
      .catch(() => { if (current()) setEdgeReport(null); });

    const prev = getPrevPeriod(dateFrom, dateTo);
    if (prev) {
      const pp = { ...params, date_from: prev.dateFrom, date_to: prev.dateTo };
      kpisApi.get(pp)
        .then(r => { if (current()) setPrevKpis(r.data); })
        .catch(() => { if (current()) setPrevKpis(null); });
    } else {
      setPrevKpis(null);
    }
  }, [accountId, dateFrom, dateTo, reloadKey]);

  useEffect(() => {
    const params = {};
    if (accountId != null) params.account_id = accountId;
    goalsApi.get(params).then(r => setGoals(r.data)).catch(() => {});
  }, [accountId]);

  const openCloseModal = (pos) => {
    const execs = pos.executions || [];
    const side = (pos.side || 'LONG').toUpperCase();
    const entryAction = side === 'LONG' ? 'BOT' : 'SOLD';
    const exitAction  = side === 'LONG' ? 'SOLD' : 'BOT';
    const entryQty = execs.filter(e => e.action === entryAction).reduce((s, e) => s + (e.qty || 0), 0);
    const exitQty  = execs.filter(e => e.action === exitAction).reduce((s, e) => s + (e.qty || 0), 0);
    // Default to today, never a hard-coded date, and never before the last fill.
    const lastFill = execs.map(e => e.date).filter(Boolean).sort().pop();
    const today = new Date();
    const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    setClosingPos({
      id: pos.id, ticker: pos.ticker, side, openQty: entryQty - exitQty, exitAction,
      lastFillDate: lastFill || pos.date,
    });
    setClosePrice('');
    setCloseDate(lastFill && lastFill > localToday ? lastFill : localToday);
    setCloseTime('16:00');
    setCloseCommission('0');
    setCloseError(null);
  };

  const handleClosePosition = async () => {
    if (!closingPos || !closePrice || !closeDate) return;
    const price = parseFloat(closePrice);
    const commission = closeCommission === '' ? 0 : parseFloat(closeCommission);
    if (!(price > 0)) { setCloseError('Enter an exit price above 0.'); return; }
    if (Number.isNaN(commission) || commission < 0) { setCloseError('Fees cannot be negative.'); return; }
    if (closingPos.lastFillDate && closeDate < closingPos.lastFillDate) {
      setCloseError(`The exit cannot be earlier than the last fill on ${closingPos.lastFillDate}.`);
      return;
    }
    setCloseSubmitting(true);
    setCloseError(null);
    try {
      await tradesApi.addExecution(closingPos.id, {
        action: closingPos.exitAction,
        qty: closingPos.openQty,
        price,
        date: closeDate,
        time: `${(closeTime || '16:00').slice(0, 5)}:00`,
        commission,
      });
      setClosingPos(null);
      // The exit changes P&L, the calendar and recent trades, so refetch them all.
      reload();
    } catch (e) {
      setCloseError(e.response?.data?.detail || e.message);
    } finally {
      setCloseSubmitting(false);
    }
  };

  const handleSaveGoals = () => {
    const payload = { ...goalsDraft };
    if (accountId != null) payload.account_id = accountId;
    setGoalsSaving(true);
    setGoalsError(null);
    goalsApi.put(payload)
      .then(r => { setGoals(r.data); setShowGoals(false); })
      .catch(e => setGoalsError(e.response?.data?.detail || e.message))
      .finally(() => setGoalsSaving(false));
  };

  useEffect(() => {
    const run = ++positionsRun.current;
    const current = () => run === positionsRun.current;
    const params = { open_only: true };
    if (accountId != null) params.account_id = accountId;
    tradesApi.list(params)
      .then(r => { if (current()) setOpenPositions(r.data); })
      .catch(() => { if (current()) setOpenPositions([]); });

    const recentParams = { limit: 5 };
    if (accountId != null) recentParams.account_id = accountId;
    tradesApi.list(recentParams)
      .then(r => { if (current()) setRecentTrades(r.data); })
      .catch(() => { if (current()) setRecentTrades([]); });
  }, [accountId, reloadKey]);

  const accountLabel = (() => {
    const a = accounts.find(x => x.id === selectedAccountId);
    return a ? a.name : 'All Accounts';
  })();



  const {
    total_net_pnl, total_gross_pnl, total_commissions,
    win_rate, profit_factor, total_trades,
    winning_trades, losing_trades,
    avg_win, avg_loss,
    day_win_rate, trading_days, positive_days,
    daily_pnl = [], by_strategy = [],
    expectancy = 0,
    exit_efficiency, avg_mae_win, avg_mae_loss, excursion_n,
  } = kpis || {};

  // Derived exactly as the former per-metric cards did.
  const winColor = win_rate >= 50 ? 'pos' : 'neg';
  const dayWinColor = day_win_rate >= 50 ? 'pos' : 'neg';
  const negativeDays = (trading_days ?? 0) - (positive_days ?? 0);
  const pfTone = profit_factor >= 1.5 ? 'pos' : profit_factor >= 1 ? undefined : 'neg';
  const awin = Math.abs(avg_win || 0);
  const aloss = Math.abs(avg_loss || 0);
  const ratio = aloss > 0 ? (awin / aloss).toFixed(2) : '∞';
  const currRatio = aloss > 0 ? awin / aloss : null;
  const prevRatio = prevKpis && Math.abs(prevKpis.avg_loss || 0) > 0
    ? Math.abs(prevKpis.avg_win || 0) / Math.abs(prevKpis.avg_loss) : null;
  const eff = exit_efficiency == null ? null : Number(exit_efficiency);
  const effTone = eff == null ? undefined : eff >= 50 ? 'pos' : eff >= 35 ? 'caution' : 'neg';

  const span = daily_pnl.length
    ? `${fmtLong(daily_pnl[0].date)} to ${fmtLong(daily_pnl[daily_pnl.length - 1].date)}`
    : null;

  const todBarTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const v = payload[0]?.value || 0;
    return (
      <div className="card" style={{ padding: '8px 12px', fontSize: 13 }}>
        <div style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>{label}</div>
        <div className={`num ${toneOf(v) || ''}`} style={{ fontWeight: 600 }}>{v < 0 ? '-' : ''}{fmt$(Math.abs(v))}</div>
        <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{payload[0]?.payload?.trade_count || 0} trades</div>
      </div>
    );
  };

  if (error) return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={accountLabel}
        actions={<DateRangePicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChange={({ dateFrom: f, dateTo: t }) => { setDateFrom(f); setDateTo(t); }}
        />}
      />
      <div className="notice neg" role="alert" style={{ alignItems: 'center' }}>
        <span style={{ flex: 1 }}>Could not load the dashboard: {error}. No trades were changed.</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={reload}>Retry</button>
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={<>{accountLabel}{span ? <> · {span}</> : null}</>}
        actions={<>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => { setGoalsDraft({ ...goals }); setShowGoals(v => !v); }}
            aria-pressed={showGoals}
            aria-expanded={showGoals}
          >
            Edit goals
          </button>
          <DateRangePicker
            dateFrom={dateFrom}
            dateTo={dateTo}
            onChange={({ dateFrom: f, dateTo: t }) => { setDateFrom(f); setDateTo(t); }}
          />
        </>}
      />

      {showGoals && (
        <GoalsPanel
          saving={goalsSaving}
          error={goalsError}
          draft={goalsDraft}
          onChange={setGoalsDraft}
          onSave={handleSaveGoals}
          onCancel={() => setShowGoals(false)}
          accountLabel={accountLabel}
        />
      )}

      {loading ? (
        <>
          <div className="skeleton" style={{ height: 150, marginBottom: 20, borderRadius: 8 }} />
          <div className="skeleton" style={{ height: 320, marginBottom: 20, borderRadius: 8 }} />
          <div className="skeleton" style={{ height: 260, borderRadius: 8 }} />
        </>
      ) : (
        <>
          {/* KPI strip: all seven metrics, one surface */}
          <KpiStrip label="Key metrics">
            <KpiCell
              label="Net P&L"
              value={<MoneyValue value={total_net_pnl} />}
              tone={Number(total_net_pnl || 0) >= 0 ? 'pos' : 'neg'}
              foot={<>
                <span className="num">{total_trades != null ? Number(total_trades).toLocaleString('en-US') : '-'}</span> trades
                <br />
                Gross <span className="num">{total_gross_pnl != null ? `${Number(total_gross_pnl) < 0 ? '-' : ''}${fmt$(Math.abs(total_gross_pnl))}` : '-'}</span>
                <br />
                Comm <span className="num neg">{total_commissions != null ? `-${fmt$(Math.abs(total_commissions))}` : '-'}</span>
              </>}
            >
              <DeltaLine curr={total_net_pnl} prev={prevKpis?.total_net_pnl} type="currency" />
            </KpiCell>

            <KpiCell
              label="Trade Win %"
              value={<span className="num">{Number(win_rate || 0).toFixed(1)}%</span>}
              tone={winColor}
              foot={<><span className="num pos">{winning_trades}W</span> / <span className="num neg">{losing_trades}L</span></>}
            >
              <DeltaLine curr={win_rate} prev={prevKpis?.win_rate} type="percent" />
              <GoalMeter value={win_rate} goal={goals?.win_rate} label={goals?.win_rate != null ? `${goals.win_rate}%` : undefined} />
            </KpiCell>

            <KpiCell
              label="Profit Factor"
              value={<span className={`num ${pfTone ? '' : 'text-purple'}`}>{Number(profit_factor || 0).toFixed(2)}</span>}
              tone={pfTone}
              foot="Gross wins / gross losses"
            >
              <DeltaLine curr={profit_factor} prev={prevKpis?.profit_factor} type="number" />
              <GoalMeter value={profit_factor} goal={goals?.profit_factor} label={goals?.profit_factor != null ? `${goals.profit_factor}` : undefined} />
            </KpiCell>

            <KpiCell
              label="Day Win %"
              value={<span className="num">{Number(day_win_rate || 0).toFixed(1)}%</span>}
              tone={dayWinColor}
              foot={<><span className="num pos">{positive_days ?? 0}W</span> / <span className="num neg">{negativeDays}L</span> days</>}
            >
              <DeltaLine curr={day_win_rate} prev={prevKpis?.day_win_rate} type="percent" />
              <GoalMeter value={day_win_rate} goal={goals?.day_win_rate} label={goals?.day_win_rate != null ? `${goals.day_win_rate}%` : undefined} />
            </KpiCell>

            <KpiCell
              label="Avg Win / Loss"
              value={<span className="num">{ratio}</span>}
              foot={<><span className="num pos">+{fmt$(awin)}</span> / <span className="num neg">-{fmt$(aloss)}</span></>}
            >
              <DeltaLine curr={currRatio} prev={prevRatio} type="number" />
              <GoalMeter value={currRatio} goal={goals?.avg_win_loss_ratio} label={goals?.avg_win_loss_ratio != null ? `${goals.avg_win_loss_ratio}` : undefined} />
            </KpiCell>

            <KpiCell
              label="Exit Efficiency"
              title="Of the move available while you were in the trade, how much you actually booked. Winners only."
              value={<span className="num">{eff == null ? '-' : `${eff.toFixed(0)}%`}</span>}
              tone={effTone}
              foot={<span title="Average MAE, the worst unrealised loss reached. Winners vs losers: the wider the gap, the better a tight stop separates them.">
                MAE winners <span className="num">{avg_mae_win == null ? '-' : `${Number(avg_mae_win).toFixed(2)}%`}</span>
                <br />
                MAE losers <span className="num">{avg_mae_loss == null ? '-' : `${Number(avg_mae_loss).toFixed(2)}%`}</span>
                {excursion_n != null && <><br /><span className="num">{excursion_n}</span> trades</>}
              </span>}
            >
              <DeltaLine curr={eff} prev={prevKpis?.exit_efficiency == null ? null : Number(prevKpis.exit_efficiency)} type="number" />
              <GoalMeter value={eff} goal={goals?.exit_efficiency} label={goals?.exit_efficiency != null ? `${goals.exit_efficiency}%` : undefined} />
            </KpiCell>

            <KpiCell
              label="Expectancy"
              value={<span className="num">{signedMoney(expectancy)}</span>}
              tone={Number(expectancy || 0) >= 0 ? 'pos' : 'neg'}
              foot="Average per trade"
            >
              <DeltaLine curr={expectancy} prev={prevKpis?.expectancy} type="currency" />
              <GoalMeter value={expectancy} goal={goals?.expectancy} label={goals?.expectancy != null ? `$${goals.expectancy}` : undefined} />
            </KpiCell>
          </KpiStrip>

          {/* Row 1: equity + daily sessions */}
          <div className="grid-2-1" style={{ marginBottom: 20 }}>
            <section className="card">
              <PanelHead title="Cumulative P&L" sub="Net of commissions" />
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={daily_pnl} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent-line)" stopOpacity={0.22} />
                      <stop offset="95%" stopColor="var(--accent-line)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--divider-soft)" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={fmtDate} tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis tickFormatter={fmt$} tick={AXIS_TICK} width={68} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'var(--divider)' }} />
                  <Area type="monotone" dataKey="cumulative" name="Cumulative P&L"
                    stroke="var(--accent-line)" fill="url(#pnlGrad)" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </section>

            <section className="card">
              <PanelHead title="Daily P&L" sub="The sessions behind the curve" />
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={daily_pnl} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--divider-soft)" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={fmtDate} tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis tickFormatter={fmt$} tick={AXIS_TICK} width={60} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--accent-soft)' }} />
                  <ReferenceLine y={0} stroke="var(--divider)" />
                  <Bar dataKey="net_pnl" name="Daily P&L">
                    {daily_pnl.map((entry, i) => (
                      <Cell key={i} fill={entry.net_pnl >= 0 ? 'var(--result-pos)' : 'var(--result-neg)'} />
                    ))}
                  </Bar>
                </ComposedChart>
              </ResponsiveContainer>
            </section>
          </div>

          {/* Row 2: calendar + recent trades / open positions */}
          <div className="grid-2-1" style={{ marginBottom: 20, alignItems: 'start' }}>
            <section className="card" aria-label="Calendar">
              <MiniCalendar accountId={accountId} onDayClick={onDayClick} />
            </section>

            <div className="stack">
              <section className="card">
                <PanelHead
                  title="Recent Trades"
                  right={
                    <button type="button" className="btn-link" onClick={() => onViewAllTrades && onViewAllTrades()}>
                      View all
                    </button>
                  }
                />
                {recentTrades.length === 0 ? (
                  <div className="empty" style={{ textAlign: 'left', padding: 0 }}>No trades yet.</div>
                ) : (
                  <div className="scroll-x" style={{ margin: '0 -12px' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Ticker</th>
                          <th>Side</th>
                          <th>Date</th>
                          <th className="num">P&L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentTrades.map((t, i) => {
                          const pnl = t.net_pnl ?? 0;
                          const side = (t.side || '').toUpperCase();
                          const open = () => onOpenDetail && onOpenDetail(t);
                          return (
                            <tr key={i} className="row-link" onClick={open} {...openActivate(open)} aria-label={`Open ${t.ticker} trade on ${t.date}`}>
                              <td style={{ fontWeight: 600 }}>{t.ticker}</td>
                              <td className="text-muted">{side === 'LONG' ? 'Long' : side === 'SHORT' ? 'Short' : side}</td>
                              <td className="text-muted num">{t.date}</td>
                              <td className={`num ${toneOf(pnl) || 'text-muted'}`} style={{ fontWeight: 600 }}>
                                {pnl === 0 ? '-' : (pnl > 0 ? '+' : '-') + '$' + Math.abs(pnl).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="card">
                <PanelHead
                  title="Open Positions"
                  right={<span className={`chip ${openPositions.length > 0 ? 'caution' : ''}`}>
                    {openPositions.length} position{openPositions.length !== 1 ? 's' : ''}
                  </span>}
                />
                {openPositions.length === 0 ? (
                  <div className="empty" style={{ textAlign: 'left', padding: 0 }}>No open positions.</div>
                ) : (
                  <>
                    <div className="scroll-x" style={{ margin: '0 -12px' }}>
                      <table>
                        <thead>
                          <tr>
                            <th>Ticker</th>
                            <th>Side</th>
                            <th>Opened</th>
                            <th className="num">Remaining</th>
                            <th className="num">Avg Entry</th>
                            <th><span className="sr-only">Actions</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          {openPositions.map((pos, i) => {
                            const execs = pos.executions || [];
                            const side = (pos.side || 'LONG').toUpperCase();
                            const entryAction = side === 'LONG' ? 'BOT' : 'SOLD';
                            const exitAction = side === 'LONG' ? 'SOLD' : 'BOT';
                            const entryFills = execs.filter(e => e.action === entryAction);
                            const totalQty = entryFills.reduce((s, e) => s + (e.qty || 0), 0);
                            const exitQty = execs.filter(e => e.action === exitAction).reduce((s, e) => s + (e.qty || 0), 0);
                            const remainingQty = totalQty - exitQty;
                            const avgEntry = totalQty > 0
                              ? entryFills.reduce((s, e) => s + (e.qty || 0) * (e.price || 0), 0) / totalQty
                              : 0;
                            const openDate = execs.length > 0 ? (execs[0].date || pos.date) : pos.date;
                            const open = () => onOpenDetail && onOpenDetail(pos);
                            return (
                              <tr key={i} className="row-link" onClick={open} {...openActivate(open)} aria-label={`Open ${pos.ticker} position`}>
                                <td style={{ fontWeight: 600 }}>{pos.ticker}</td>
                                <td className="text-muted">{side === 'LONG' ? 'Long' : 'Short'}</td>
                                <td className="text-muted num">{openDate}</td>
                                <td className="num">
                                  {remainingQty}
                                  {exitQty > 0 && <span className="text-muted" style={{ fontSize: 12.5 }}> of {totalQty}</span>}
                                </td>
                                <td className="num">
                                  ${avgEntry.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td className="num">
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    title="Close position"
                                    onClick={e => { e.stopPropagation(); openCloseModal(pos); }}
                                    onKeyDown={e => e.stopPropagation()}
                                  >
                                    Close
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {closingPos && (
                      <div className="notice" style={{ marginTop: 14, display: 'block' }} role="group" aria-label={`Close ${closingPos.ticker}`}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                          <span style={{ fontWeight: 600, fontSize: 14 }}>
                            Record exit: {closingPos.ticker} {closingPos.side} ({closingPos.openQty} remaining)
                          </span>
                          <button type="button" className="btn btn-ghost btn-icon" onClick={() => setClosingPos(null)} aria-label="Cancel closing position">
                            <X size={14} />
                          </button>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                          <div>
                            <label className="field-label" htmlFor="close-date">Exit Date</label>
                            <input
                              id="close-date"
                              type="date"
                              value={closeDate}
                              onChange={e => setCloseDate(e.target.value)}
                              style={{ width: 150 }}
                            />
                          </div>
                          <div>
                            <label className="field-label" htmlFor="close-time">Exit Time</label>
                            <input
                              id="close-time"
                              type="time"
                              value={closeTime}
                              onChange={e => setCloseTime(e.target.value)}
                              style={{ width: 120 }}
                            />
                          </div>
                          <div>
                            <label className="field-label" htmlFor="close-price">Exit Price</label>
                            <input
                              id="close-price"
                              type="number"
                              step="0.01"
                              placeholder="0.00"
                              value={closePrice}
                              onChange={e => setClosePrice(e.target.value)}
                              style={{ width: 120 }}
                              onKeyDown={e => e.key === 'Enter' && handleClosePosition()}
                            />
                          </div>
                          <div>
                            <label className="field-label" htmlFor="close-comm">Fees</label>
                            <input
                              id="close-comm"
                              type="number"
                              step="0.01"
                              min="0"
                              value={closeCommission}
                              onChange={e => setCloseCommission(e.target.value)}
                              style={{ width: 100 }}
                              onKeyDown={e => e.key === 'Enter' && handleClosePosition()}
                            />
                          </div>
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={handleClosePosition}
                            disabled={closeSubmitting || !closePrice || !closeDate}
                          >
                            {closeSubmitting ? 'Saving...' : 'Record exit'}
                          </button>
                        </div>
                        <div className="text-muted" style={{ fontSize: 12.5, marginTop: 8 }}>
                          Journal only. This records the exit on the trade, it does not place an order.
                        </div>
                        {closeError && (
                          <div className="notice neg" role="alert" style={{ marginTop: 10 }}>{closeError}</div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </section>
            </div>
          </div>

          {/* Row 3: breakdowns (kept on the dashboard, below the primary section) */}
          <div className="grid-3">
            <section className="card">
              <PanelHead title="By Strategy" />
              {by_strategy.length === 0 ? (
                <div className="empty" style={{ textAlign: 'left', padding: 0 }}>No strategy data yet. Upload a diary to get started.</div>
              ) : (
                <div style={{ overflowY: 'auto', maxHeight: 260, margin: '0 -12px' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Strategy</th>
                        <th className="num">P&L</th>
                        <th className="num">Win%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {by_strategy.map((s, i) => (
                        <tr key={i}>
                          <td>{s.strategy}</td>
                          <td className={`num ${s.net_pnl >= 0 ? 'pos' : 'neg'}`}>
                            {s.net_pnl < 0 ? '-' : '+'}{fmt$(Math.abs(s.net_pnl))}
                          </td>
                          <td className="num text-muted">{s.win_rate}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="card">
              <PanelHead title="Time-of-Day P&L" sub="By entry time" />
              {!edgeReport ? (
                <div className="empty" style={{ textAlign: 'left', padding: 0 }}>Loading...</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={edgeReport.time_of_day || []} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
                    <CartesianGrid stroke="var(--divider-soft)" vertical={false} />
                    <XAxis dataKey="bucket" tick={{ ...AXIS_TICK, fontSize: 10 }} interval={1} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={fmt$} tick={{ ...AXIS_TICK, fontSize: 10 }} axisLine={false} tickLine={false} width={56} />
                    <Tooltip content={todBarTooltip} cursor={{ fill: 'var(--accent-soft)' }} />
                    <ReferenceLine y={0} stroke="var(--divider)" />
                    <Bar dataKey="net_pnl" radius={[3, 3, 0, 0]}>
                      {(edgeReport.time_of_day || []).map((entry, i) => (
                        <Cell key={i} fill={entry.net_pnl >= 0 ? 'var(--result-pos)' : 'var(--result-neg)'} />
                      ))}
                    </Bar>
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </section>

            <section className="card">
              <PanelHead title="Day-of-Week P&L" />
              {!edgeReport ? (
                <div className="empty" style={{ textAlign: 'left', padding: 0 }}>Loading...</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={edgeReport.day_of_week || []} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
                    <CartesianGrid stroke="var(--divider-soft)" vertical={false} />
                    <XAxis dataKey="day" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={fmt$} tick={{ ...AXIS_TICK, fontSize: 10 }} axisLine={false} tickLine={false} width={56} />
                    <Tooltip content={todBarTooltip} cursor={{ fill: 'var(--accent-soft)' }} />
                    <ReferenceLine y={0} stroke="var(--divider)" />
                    <Bar dataKey="net_pnl" radius={[3, 3, 0, 0]}>
                      {(edgeReport.day_of_week || []).map((entry, i) => (
                        <Cell key={i} fill={entry.net_pnl >= 0 ? 'var(--result-pos)' : 'var(--result-neg)'} />
                      ))}
                    </Bar>
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
