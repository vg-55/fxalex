"use client";

import { useEffect, useMemo, useState } from "react";
import { TrendingUp, TrendingDown, Award, Clock, Flame, Activity, Target, Radio } from "lucide-react";

type RangeKey = "7d" | "30d" | "90d" | "all";

type EquityPoint = {
  closedAt: string;
  pair: string;
  result: "TP" | "SL";
  rR: number;
  cumR: number;
  ddR: number;
};

type PerformanceData = {
  range: RangeKey;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalR: number;
  avgR: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  profitFactor: number | null;
  bestTrade: number;
  worstTrade: number;
  avgHoldMinutes: number;
  maxDrawdownR: number;
  currentDrawdownR: number;
  pairStats: Array<{
    pair: string;
    trades: number;
    winRate: number;
    totalR: number;
    bestR: number;
    worstR: number;
  }>;
  equityCurve: EquityPoint[];
  dayOfWeek: Array<{ day: number; trades: number; winRate: number; totalR: number }>;
  recent: Array<{
    id: string;
    pair: string;
    type: "BUY" | "SELL";
    result: "TP" | "SL";
    rPnl: number;
    entry: number;
    sl: number;
    tp: number;
    lotSize: number | null;
    enteredAt: string;
    closedAt: string;
    holdMinutes: number;
  }>;
  streak: { type: "W" | "L" | null; count: number };
  recentResults: ("W" | "L")[];
  openTrades: Array<{
    pair: string;
    type: "BUY" | "SELL";
    entry: number;
    sl: number;
    tp: number;
    currentPrice: number;
    priceAge: number | null;
    floatingR: number;
    progressToTp: number;
    progressToSl: number;
    aiConfidence: number;
    timeframe: string;
    enteredAt: string;
  }>;
  openFloatingR: number;
};

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "90d", label: "90D" },
  { key: "all", label: "All" },
];

export default function PerformancePage() {
  const [range, setRange] = useState<RangeKey>("30d");
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [pairFilter, setPairFilter] = useState<string>("");
  const [dirFilter, setDirFilter] = useState<"" | "BUY" | "SELL">("");
  const [resultFilter, setResultFilter] = useState<"" | "TP" | "SL">("");

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch(`/api/performance?range=${range}`, { cache: "no-store" })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((d: PerformanceData) => {
          if (!cancelled) setData(d);
        })
        .catch((e) => {
          if (!cancelled) setErr((e as Error).message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    setLoading(true);
    setErr(null);
    load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [range]);

  const filteredRecent = useMemo(() => {
    if (!data) return [];
    return data.recent.filter(
      (o) =>
        (!pairFilter || o.pair === pairFilter) &&
        (!dirFilter || o.type === dirFilter) &&
        (!resultFilter || o.result === resultFilter)
    );
  }, [data, pairFilter, dirFilter, resultFilter]);

  const allPairs = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.recent.map((r) => r.pair))).sort();
  }, [data]);

  if (loading && !data) return <PerformanceSkeleton />;

  if (err || !data) {
    return (
      <div className="p-8 max-w-[1200px] mx-auto">
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 text-rose-200">
          Failed to load performance data: {err ?? "unknown"}
        </div>
      </div>
    );
  }

  const empty = data.totalTrades === 0;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1200px] mx-auto">
      <header className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">Performance</h1>
          <p className="text-sm text-slate-400 mt-1">
            Closed-trade ledger and equity curve · auto-refresh 30s
          </p>
        </div>
        <div className="flex items-center gap-1 bg-[#0c1424] border border-[#243049] rounded-lg p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${
                range === r.key
                  ? "bg-blue-500/20 text-blue-300"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>

      {/* Live open trades — always shown above closed-trade analytics */}
      <OpenTradesSection trades={data.openTrades} floatingR={data.openFloatingR} />

      {empty ? (
        <div className="bg-[#111a2e] border border-[#243049] rounded-2xl p-8 text-center">
          <Clock size={32} className="text-slate-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-1">No closed trades in this range</h2>
          <p className="text-sm text-slate-400">
            Outcomes appear here once ACTIVE signals reach their TP or SL.
          </p>
        </div>
      ) : (
        <>
          {/* Live open trades */}
          <OpenTradesSection trades={data.openTrades} floatingR={data.openFloatingR} />

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <SummaryCard
              label="Win Rate"
              value={`${(data.winRate * 100).toFixed(0)}%`}
              sub={`${data.wins}W / ${data.losses}L`}
              icon={<Award size={14} />}
              tone={data.winRate >= 0.5 ? "good" : "bad"}
            />
            <SummaryCard
              label="Total R"
              value={`${data.totalR >= 0 ? "+" : ""}${data.totalR.toFixed(2)}R`}
              sub={`${data.totalTrades} trades`}
              icon={data.totalR >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              tone={data.totalR >= 0 ? "good" : "bad"}
            />
            <SummaryCard
              label="Profit Factor"
              value={data.profitFactor == null ? "—" : data.profitFactor.toFixed(2)}
              sub={`Expectancy ${data.expectancy >= 0 ? "+" : ""}${data.expectancy.toFixed(2)}R`}
              icon={<Flame size={14} />}
              tone={data.profitFactor != null && data.profitFactor >= 1.5 ? "good" : "neutral"}
            />
            <SummaryCard
              label="Max DD"
              value={`-${data.maxDrawdownR.toFixed(2)}R`}
              sub={`Now -${data.currentDrawdownR.toFixed(2)}R · hold ${formatHold(data.avgHoldMinutes)}`}
              icon={<Activity size={14} />}
              tone={data.currentDrawdownR > data.maxDrawdownR * 0.8 ? "bad" : "neutral"}
            />
          </div>

          {/* Secondary stats row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <MiniStat label="Avg Win" value={`+${data.avgWin.toFixed(2)}R`} good />
            <MiniStat label="Avg Loss" value={`-${data.avgLoss.toFixed(2)}R`} bad />
            <MiniStat label="Best" value={`+${data.bestTrade.toFixed(2)}R`} good />
            <MiniStat label="Worst" value={`${data.worstTrade.toFixed(2)}R`} bad />
          </div>

          {/* Streak + last 20 results */}
          <div className="bg-[#111a2e] border border-[#243049] rounded-2xl p-5 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Target size={14} /> Streak
              </h2>
              <span
                className={`text-sm font-bold ${
                  data.streak.type === "W"
                    ? "text-emerald-400"
                    : data.streak.type === "L"
                    ? "text-rose-400"
                    : "text-slate-400"
                }`}
              >
                {data.streak.count > 0 ? `${data.streak.count}${data.streak.type}` : "—"}
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {data.recentResults.length === 0 && (
                <span className="text-xs text-slate-500">No recent results.</span>
              )}
              {data.recentResults.map((r, i) => (
                <span
                  key={i}
                  title={r === "W" ? "Win" : "Loss"}
                  className={`w-5 h-5 inline-flex items-center justify-center text-[10px] font-bold rounded ${
                    r === "W" ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"
                  }`}
                >
                  {r}
                </span>
              ))}
            </div>
          </div>

          {/* Equity curve */}
          <div className="bg-[#111a2e] border border-[#243049] rounded-2xl p-5 mb-6">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">
              Equity Curve (R-multiple)
            </h2>
            <EquityCurveChart data={data.equityCurve} />
          </div>

          {/* Day-of-week */}
          <div className="bg-[#111a2e] border border-[#243049] rounded-2xl p-5 mb-6">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">
              By Day of Week (UTC)
            </h2>
            <DayOfWeekTable rows={data.dayOfWeek} />
          </div>

          {/* Per-pair */}
          <div className="bg-[#111a2e] border border-[#243049] rounded-2xl p-5 mb-6">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">
              Per-pair Breakdown
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-slate-500 text-left border-b border-[#243049]">
                    <th className="py-2">Pair</th>
                    <th className="py-2 text-right">Trades</th>
                    <th className="py-2 text-right">Win Rate</th>
                    <th className="py-2 text-right">Total R</th>
                    <th className="py-2 text-right">Best</th>
                    <th className="py-2 text-right">Worst</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pairStats.map((p) => (
                    <tr key={p.pair} className="border-b border-[#243049]/50 last:border-b-0">
                      <td className="py-2.5 font-semibold">{p.pair}</td>
                      <td className="py-2.5 text-right font-mono">{p.trades}</td>
                      <td className="py-2.5 text-right font-mono">
                        {(p.winRate * 100).toFixed(0)}%
                      </td>
                      <td
                        className={`py-2.5 text-right font-mono font-bold ${
                          p.totalR >= 0 ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {p.totalR >= 0 ? "+" : ""}
                        {p.totalR.toFixed(2)}
                      </td>
                      <td className="py-2.5 text-right font-mono text-emerald-400">
                        +{p.bestR.toFixed(2)}
                      </td>
                      <td className="py-2.5 text-right font-mono text-rose-400">
                        {p.worstR.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent trades + filters */}
          <div className="bg-[#111a2e] border border-[#243049] rounded-2xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                Recent Outcomes
              </h2>
              <div className="flex items-center gap-2">
                <select
                  value={pairFilter}
                  onChange={(e) => setPairFilter(e.target.value)}
                  className="bg-[#0c1424] border border-[#243049] rounded-md text-xs px-2 py-1 text-slate-300"
                >
                  <option value="">All pairs</option>
                  {allPairs.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <select
                  value={dirFilter}
                  onChange={(e) => setDirFilter(e.target.value as "" | "BUY" | "SELL")}
                  className="bg-[#0c1424] border border-[#243049] rounded-md text-xs px-2 py-1 text-slate-300"
                >
                  <option value="">Any dir</option>
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
                <select
                  value={resultFilter}
                  onChange={(e) => setResultFilter(e.target.value as "" | "TP" | "SL")}
                  className="bg-[#0c1424] border border-[#243049] rounded-md text-xs px-2 py-1 text-slate-300"
                >
                  <option value="">Any result</option>
                  <option value="TP">TP</option>
                  <option value="SL">SL</option>
                </select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-slate-500 text-left border-b border-[#243049]">
                    <th className="py-2">Pair</th>
                    <th className="py-2">Dir</th>
                    <th className="py-2">Result</th>
                    <th className="py-2 text-right">R</th>
                    <th className="py-2 text-right">Lots</th>
                    <th className="py-2 text-right">Hold</th>
                    <th className="py-2 text-right">Closed</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecent.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-xs text-slate-500">
                        No outcomes match the current filters.
                      </td>
                    </tr>
                  )}
                  {filteredRecent.map((o) => (
                    <tr key={o.id} className="border-b border-[#243049]/50 last:border-b-0">
                      <td className="py-2 font-semibold">{o.pair}</td>
                      <td className="py-2">
                        <span
                          aria-label={o.type === "BUY" ? "Long" : "Short"}
                          className={`text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded ${
                            o.type === "BUY"
                              ? "bg-emerald-500/15 text-emerald-300"
                              : "bg-rose-500/15 text-rose-300"
                          }`}
                        >
                          {o.type}
                        </span>
                      </td>
                      <td className="py-2">
                        <span
                          aria-label={o.result === "TP" ? "Take profit" : "Stop loss"}
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            o.result === "TP"
                              ? "bg-emerald-500/15 text-emerald-300"
                              : "bg-rose-500/15 text-rose-300"
                          }`}
                        >
                          {o.result}
                        </span>
                      </td>
                      <td
                        className={`py-2 text-right font-mono font-bold ${
                          o.rPnl >= 0 ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {o.rPnl >= 0 ? "+" : ""}
                        {o.rPnl.toFixed(2)}
                      </td>
                      <td className="py-2 text-right font-mono text-slate-300">
                        {o.lotSize ? o.lotSize.toFixed(2) : "—"}
                      </td>
                      <td className="py-2 text-right font-mono text-slate-400">
                        {formatHold(o.holdMinutes)}
                      </td>
                      <td className="py-2 text-right font-mono text-slate-500 text-xs">
                        {new Date(o.closedAt).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------
function OpenTradesSection({
  trades,
  floatingR,
}: {
  trades: PerformanceData["openTrades"];
  floatingR: number;
}) {
  if (trades.length === 0) {
    return (
      <div className="bg-[#0c1424] border border-[#243049] rounded-2xl p-4 mb-6 flex items-center gap-2 text-xs text-slate-400">
        <Radio size={12} className="text-slate-500" />
        No live ACTIVE trades. Pending signals will move here when triggered.
      </div>
    );
  }
  return (
    <div className="bg-[#0e1628] border border-blue-500/20 rounded-2xl p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
          <Radio size={14} className="text-blue-400 animate-pulse" />
          Live Open Trades · {trades.length}
        </h2>
        <span
          className={`text-sm font-mono font-bold ${
            floatingR >= 0 ? "text-emerald-400" : "text-rose-400"
          }`}
        >
          Floating {floatingR >= 0 ? "+" : ""}
          {floatingR.toFixed(2)}R
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {trades.map((t) => (
          <OpenTradeCard key={t.pair} trade={t} />
        ))}
      </div>
    </div>
  );
}

function OpenTradeCard({ trade }: { trade: PerformanceData["openTrades"][number] }) {
  const decimals = trade.pair.includes("JPY") ? 3 : 5;
  const isWinning = trade.floatingR >= 0;
  // Build a single horizontal bar: SL ←—— entry ——→ TP, with a marker at current price.
  const isBuy = trade.type === "BUY";
  const lo = isBuy ? trade.sl : trade.tp;
  const hi = isBuy ? trade.tp : trade.sl;
  const span = hi - lo || 1;
  const pct = Math.max(0, Math.min(1, (trade.currentPrice - lo) / span));
  const entryPct = Math.max(0, Math.min(1, (trade.entry - lo) / span));
  const stale = trade.priceAge !== null && trade.priceAge > 2 * 60_000;

  return (
    <div className="bg-[#0c1424] border border-[#243049] rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-bold text-white">{trade.pair}</span>
          <span
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
              isBuy ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"
            }`}
          >
            {trade.type}
          </span>
          <span className="text-[10px] text-slate-500 font-mono">{trade.timeframe}</span>
          {stale && (
            <span className="text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-1">
              stale
            </span>
          )}
        </div>
        <span
          className={`font-mono font-bold text-sm ${
            isWinning ? "text-emerald-400" : "text-rose-400"
          }`}
        >
          {isWinning ? "+" : ""}
          {trade.floatingR.toFixed(2)}R
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-2 font-mono text-[11px] text-center">
        <div>
          <div className="text-rose-400/70 text-[9px] uppercase">SL</div>
          <div className="text-rose-300">{trade.sl.toFixed(decimals)}</div>
        </div>
        <div>
          <div className="text-slate-500 text-[9px] uppercase">Entry / Now</div>
          <div className="text-slate-200">
            {trade.entry.toFixed(decimals)}{" "}
            <span className="text-slate-500">→</span>{" "}
            <span className={isWinning ? "text-emerald-300" : "text-rose-300"}>
              {trade.currentPrice.toFixed(decimals)}
            </span>
          </div>
        </div>
        <div>
          <div className="text-emerald-400/70 text-[9px] uppercase">TP</div>
          <div className="text-emerald-300">{trade.tp.toFixed(decimals)}</div>
        </div>
      </div>

      {/* Progress bar from SL → TP */}
      <div className="relative h-2 bg-[#1a2540] rounded overflow-hidden">
        {/* loss zone */}
        <div
          className="absolute top-0 bottom-0 left-0 bg-rose-500/15"
          style={{ width: `${entryPct * 100}%` }}
        />
        {/* profit zone */}
        <div
          className="absolute top-0 bottom-0 bg-emerald-500/15"
          style={{ left: `${entryPct * 100}%`, width: `${(1 - entryPct) * 100}%` }}
        />
        {/* entry tick */}
        <div
          className="absolute top-0 bottom-0 w-px bg-slate-400/60"
          style={{ left: `${entryPct * 100}%` }}
        />
        {/* current price marker */}
        <div
          className={`absolute top-0 bottom-0 w-1 rounded-sm ${
            isWinning ? "bg-emerald-400" : "bg-rose-400"
          }`}
          style={{ left: `calc(${pct * 100}% - 2px)` }}
        />
      </div>

      <div className="flex items-center justify-between mt-2 text-[10px] text-slate-500">
        <span>AI {trade.aiConfidence}%</span>
        <span>since {formatRelative(trade.enteredAt)}</span>
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function SummaryCard({
  label,
  value,
  sub,
  icon,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  tone: "good" | "bad" | "neutral";
}) {
  const color =
    tone === "good" ? "text-emerald-400" : tone === "bad" ? "text-rose-400" : "text-slate-200";
  return (
    <div className="bg-[#111a2e] border border-[#243049] rounded-xl p-4">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500 mb-2">
        {icon}
        {label}
      </div>
      <div className={`text-2xl font-black font-mono ${color}`}>{value}</div>
      <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>
    </div>
  );
}

function MiniStat({ label, value, good, bad }: { label: string; value: string; good?: boolean; bad?: boolean }) {
  return (
    <div className="bg-[#0c1424] border border-[#243049] rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div
        className={`text-lg font-mono font-bold ${
          good ? "text-emerald-400" : bad ? "text-rose-400" : "text-slate-200"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function DayOfWeekTable({
  rows,
}: {
  rows: PerformanceData["dayOfWeek"];
}) {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  // Re-order Mon → Sun (FX market) and drop Sat/Sun if zero trades.
  const order = [1, 2, 3, 4, 5, 6, 0];
  const sorted = order.map((i) => ({ ...rows[i], name: names[i] }));
  const visible = sorted.filter((r) => r.trades > 0);
  if (visible.length === 0) {
    return <div className="text-xs text-slate-500">No data.</div>;
  }
  const maxAbs = Math.max(...visible.map((r) => Math.abs(r.totalR)), 1);
  return (
    <div className="space-y-1.5">
      {visible.map((r) => {
        const pct = (Math.abs(r.totalR) / maxAbs) * 100;
        const positive = r.totalR >= 0;
        return (
          <div key={r.name} className="flex items-center gap-3 text-xs">
            <div className="w-10 text-slate-400">{r.name}</div>
            <div className="w-12 text-right text-slate-500 font-mono">{r.trades}</div>
            <div className="w-12 text-right text-slate-400 font-mono">
              {(r.winRate * 100).toFixed(0)}%
            </div>
            <div className="flex-1 h-2 bg-[#0c1424] rounded relative overflow-hidden">
              <div
                className={`absolute top-0 bottom-0 ${
                  positive ? "left-1/2 bg-emerald-500/60" : "right-1/2 bg-rose-500/60"
                }`}
                style={{ width: `${pct / 2}%` }}
              />
              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-600" />
            </div>
            <div
              className={`w-16 text-right font-mono font-bold ${
                positive ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {positive ? "+" : ""}
              {r.totalR.toFixed(2)}R
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EquityCurveChart({ data }: { data: EquityPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  if (data.length < 2) {
    return (
      <div className="h-48 flex items-center justify-center text-slate-600 text-sm">
        Not enough trades to plot.
      </div>
    );
  }

  const w = 800;
  const h = 240;
  const pad = { t: 12, r: 16, b: 28, l: 48 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const rs = data.map((d) => d.cumR);
  const min = Math.min(0, ...rs);
  const max = Math.max(0, ...rs);
  const range = max - min || 1;
  const stepX = innerW / Math.max(1, data.length - 1);

  const xAt = (i: number) => pad.l + i * stepX;
  const yAt = (v: number) => pad.t + (1 - (v - min) / range) * innerH;

  const points = data.map((d, i) => `${xAt(i).toFixed(1)},${yAt(d.cumR).toFixed(1)}`).join(" ");
  const zeroY = yAt(0);
  const last = data[data.length - 1].cumR;
  const color = last >= 0 ? "#10b981" : "#ef4444";

  // Drawdown shading: line of running peak, area between peak and equity = DD.
  let peak = data[0].cumR;
  const peakLine = data
    .map((d, i) => {
      peak = Math.max(peak, d.cumR);
      return `${xAt(i).toFixed(1)},${yAt(peak).toFixed(1)}`;
    })
    .join(" ");
  // Closed polygon: peak line forward, equity line back.
  let peak2 = data[0].cumR;
  const ddArea = [
    ...data.map((d, i) => {
      peak2 = Math.max(peak2, d.cumR);
      return `${xAt(i).toFixed(1)},${yAt(peak2).toFixed(1)}`;
    }),
    ...[...data].reverse().map((d, i) => {
      const idx = data.length - 1 - i;
      return `${xAt(idx).toFixed(1)},${yAt(d.cumR).toFixed(1)}`;
    }),
  ].join(" ");

  // X-axis ticks: ~5 evenly-spaced labels with date.
  const tickCount = Math.min(5, data.length);
  const xTicks = Array.from({ length: tickCount }, (_, k) => {
    const idx = Math.round((k * (data.length - 1)) / Math.max(1, tickCount - 1));
    return idx;
  });

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * w;
    const idx = Math.round((px - pad.l) / stepX);
    if (idx < 0 || idx >= data.length) {
      setHover(null);
      return;
    }
    setHover(idx);
  };

  const hovered = hover !== null ? data[hover] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-auto"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* zero / max / min axis labels */}
        <line x1={pad.l} x2={w - pad.r} y1={zeroY} y2={zeroY} stroke="#2f3d5b" strokeDasharray="3 3" />
        <text x={pad.l - 8} y={zeroY + 3} textAnchor="end" fontSize="10" fill="#64748b">0</text>
        <text x={pad.l - 8} y={pad.t + 10} textAnchor="end" fontSize="10" fill="#64748b">{max.toFixed(1)}</text>
        <text x={pad.l - 8} y={h - pad.b - 2} textAnchor="end" fontSize="10" fill="#64748b">{min.toFixed(1)}</text>

        {/* x ticks */}
        {xTicks.map((i) => (
          <g key={i}>
            <line x1={xAt(i)} x2={xAt(i)} y1={h - pad.b} y2={h - pad.b + 4} stroke="#2f3d5b" />
            <text x={xAt(i)} y={h - pad.b + 16} textAnchor="middle" fontSize="10" fill="#64748b">
              {fmtDate(data[i].closedAt)}
            </text>
          </g>
        ))}

        {/* drawdown shading */}
        <polygon points={ddArea} fill="#ef4444" fillOpacity={0.08} />
        <polyline points={peakLine} fill="none" stroke="#475569" strokeDasharray="2 3" strokeWidth={1} />

        {/* equity area + line */}
        <polyline
          points={`${pad.l},${zeroY} ${points} ${w - pad.r},${zeroY}`}
          fill={color}
          fillOpacity={0.14}
          stroke="none"
        />
        <polyline points={points} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />

        {/* hover marker */}
        {hover !== null && hovered && (
          <>
            <line
              x1={xAt(hover)}
              x2={xAt(hover)}
              y1={pad.t}
              y2={h - pad.b}
              stroke="#94a3b8"
              strokeOpacity={0.4}
            />
            <circle cx={xAt(hover)} cy={yAt(hovered.cumR)} r={3.5} fill={color} stroke="#0c1424" strokeWidth={1.5} />
          </>
        )}
      </svg>

      {hovered && (
        <div className="absolute top-2 right-2 bg-[#0c1424] border border-[#243049] rounded-md px-3 py-2 text-xs font-mono pointer-events-none">
          <div className="text-slate-400 text-[10px]">{fmtDate(hovered.closedAt)}</div>
          <div className="text-white font-bold">
            {hovered.cumR >= 0 ? "+" : ""}
            {hovered.cumR.toFixed(2)}R
          </div>
          <div className="text-slate-400">
            {hovered.pair} ·{" "}
            <span className={hovered.result === "TP" ? "text-emerald-400" : "text-rose-400"}>
              {hovered.result}
            </span>{" "}
            <span className={hovered.rR >= 0 ? "text-emerald-400" : "text-rose-400"}>
              {hovered.rR >= 0 ? "+" : ""}
              {hovered.rR.toFixed(2)}R
            </span>
          </div>
          {hovered.ddR > 0 && (
            <div className="text-rose-400/70 text-[10px]">DD -{hovered.ddR.toFixed(2)}R</div>
          )}
        </div>
      )}
    </div>
  );
}

function PerformanceSkeleton() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1200px] mx-auto">
      <div className="h-8 w-64 bg-white/5 rounded mb-6 skeleton-shimmer" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 bg-[#111a2e] border border-[#243049] rounded-xl skeleton-shimmer"
          />
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-14 bg-[#0c1424] border border-[#243049] rounded-lg skeleton-shimmer"
          />
        ))}
      </div>
      <div className="h-64 bg-[#111a2e] border border-[#243049] rounded-2xl skeleton-shimmer mb-6" />
      <div className="h-48 bg-[#111a2e] border border-[#243049] rounded-2xl skeleton-shimmer" />
    </div>
  );
}

function formatHold(mins: number): string {
  if (!Number.isFinite(mins) || mins <= 0) return "—";
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}h${m > 0 ? ` ${m}m` : ""}`;
}
