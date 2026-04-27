"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Award, Clock, Flame } from "lucide-react";

type PerformanceData = {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalR: number;
  avgR: number;
  profitFactor: number | null;
  avgHoldMinutes: number;
  pairStats: Array<{ pair: string; trades: number; winRate: number; totalR: number }>;
  equityCurve: Array<{ closedAt: string; pair: string; result: string; cumR: number }>;
  recent: Array<{
    id: string;
    pair: string;
    type: string;
    result: string;
    rPnl: number;
    entry: number;
    sl: number;
    tp: number;
    lotSize?: number;
    enteredAt: string;
    closedAt: string;
    holdMinutes: number;
  }>;
  streak: { type: "W" | "L" | null; count: number };
};

export default function PerformancePage() {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/performance", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: PerformanceData) => setData(d))
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-8 max-w-[1200px] mx-auto">
        <div className="h-8 w-64 bg-white/5 rounded mb-6 skeleton-shimmer" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-[#111a2e] border border-[#243049] rounded-xl skeleton-shimmer" />
          ))}
        </div>
        <div className="h-64 bg-[#111a2e] border border-[#243049] rounded-xl skeleton-shimmer" />
      </div>
    );
  }

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
      <header className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">Performance</h1>
        <p className="text-sm text-slate-400 mt-1">Closed-trade ledger and equity curve</p>
      </header>

      {empty ? (
        <div className="bg-[#111a2e] border border-[#243049] rounded-2xl p-8 text-center">
          <Clock size={32} className="text-slate-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-1">No closed trades yet</h2>
          <p className="text-sm text-slate-400">
            Once ACTIVE signals hit their TP or SL, outcomes will be recorded here.
          </p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <SummaryCard
              label="Win Rate"
              value={`${(data.winRate * 100).toFixed(0)}%`}
              sub={`${data.wins}W / ${data.losses}L`}
              icon={<Award size={14} />}
              tone={data.winRate >= 0.5 ? "good" : "bad"}
            />
            <SummaryCard
              label="Total R"
              value={`${data.totalR >= 0 ? "+" : ""}${data.totalR.toFixed(1)}R`}
              sub={`${data.totalTrades} trades`}
              icon={data.totalR >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              tone={data.totalR >= 0 ? "good" : "bad"}
            />
            <SummaryCard
              label="Profit Factor"
              value={data.profitFactor == null ? "—" : data.profitFactor.toFixed(2)}
              sub={`Avg ${data.avgR >= 0 ? "+" : ""}${data.avgR.toFixed(2)}R/trade`}
              icon={<Flame size={14} />}
              tone={data.profitFactor != null && data.profitFactor >= 1.5 ? "good" : "neutral"}
            />
            <SummaryCard
              label="Streak"
              value={data.streak.count > 0 ? `${data.streak.count}${data.streak.type}` : "—"}
              sub={`avg hold ${formatHold(data.avgHoldMinutes)}`}
              icon={<Flame size={14} />}
              tone={data.streak.type === "W" ? "good" : data.streak.type === "L" ? "bad" : "neutral"}
            />
          </div>

          {/* Equity curve */}
          <div className="bg-[#111a2e] border border-[#243049] rounded-2xl p-5 mb-6">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">
              Equity Curve (R-multiple)
            </h2>
            <EquityCurveChart data={data.equityCurve} />
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
                  </tr>
                </thead>
                <tbody>
                  {data.pairStats.map((p) => (
                    <tr key={p.pair} className="border-b border-[#243049]/50 last:border-b-0">
                      <td className="py-2.5 font-semibold">{p.pair}</td>
                      <td className="py-2.5 text-right font-mono">{p.trades}</td>
                      <td className="py-2.5 text-right font-mono">{(p.winRate * 100).toFixed(0)}%</td>
                      <td
                        className={`py-2.5 text-right font-mono font-bold ${
                          p.totalR >= 0 ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {p.totalR >= 0 ? "+" : ""}
                        {p.totalR.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent trades */}
          <div className="bg-[#111a2e] border border-[#243049] rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">
              Recent Outcomes
            </h2>
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
                  {data.recent.map((o) => (
                    <tr key={o.id} className="border-b border-[#243049]/50 last:border-b-0">
                      <td className="py-2 font-semibold">{o.pair}</td>
                      <td className="py-2">
                        <span
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
                        {o.rPnl.toFixed(1)}
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

function EquityCurveChart({ data }: { data: PerformanceData["equityCurve"] }) {
  if (data.length < 2) {
    return <div className="h-48 flex items-center justify-center text-slate-600 text-sm">Not enough trades to plot.</div>;
  }
  const w = 800;
  const h = 220;
  const pad = { t: 12, r: 12, b: 24, l: 40 };
  const rs = data.map((d) => d.cumR);
  const min = Math.min(0, ...rs);
  const max = Math.max(0, ...rs);
  const range = max - min || 1;
  const stepX = (w - pad.l - pad.r) / (data.length - 1);
  const points = data
    .map((d, i) => {
      const x = pad.l + i * stepX;
      const y = pad.t + (1 - (d.cumR - min) / range) * (h - pad.t - pad.b);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const zeroY = pad.t + (1 - (0 - min) / range) * (h - pad.t - pad.b);
  const last = data[data.length - 1].cumR;
  const color = last >= 0 ? "#10b981" : "#ef4444";

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto">
      {/* zero line */}
      <line x1={pad.l} x2={w - pad.r} y1={zeroY} y2={zeroY} stroke="#2f3d5b" strokeDasharray="3 3" />
      <text x={pad.l - 6} y={zeroY + 3} textAnchor="end" fontSize="10" fill="#64748b">0</text>
      <text x={pad.l - 6} y={pad.t + 10} textAnchor="end" fontSize="10" fill="#64748b">{max.toFixed(1)}</text>
      <text x={pad.l - 6} y={h - pad.b - 2} textAnchor="end" fontSize="10" fill="#64748b">{min.toFixed(1)}</text>
      <polyline
        points={`${pad.l},${zeroY} ${points} ${w - pad.r},${zeroY}`}
        fill={color}
        fillOpacity={0.14}
        stroke="none"
      />
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
    </svg>
  );
}

function formatHold(mins: number): string {
  if (!Number.isFinite(mins) || mins <= 0) return "—";
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}h${m > 0 ? ` ${m}m` : ""}`;
}
