"use client";

import {
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Target,
  Eye,
  Cpu,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  ShieldAlert,
  BarChart2,
} from "lucide-react";
import { format } from "date-fns";
import ConfidenceRing from "./ConfidenceRing";
import Sparkline from "./Sparkline";
import NewsWarning from "./NewsWarning";
import type { Signal } from "@/lib/signal-types";
import { pairDecimals } from "@/lib/signal-types";

type Props = {
  signal: Signal;
  isCharted: boolean;
  isRefreshing: boolean;
  now: Date;
  sparklineData?: number[];
  positionSize?: { lots: string; pips: number; risk: number };
  onSelect: () => void;
};

function relativeTime(from: Date, now: Date): string {
  const s = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function StatusBadge({ status }: { status: Signal["status"] }) {
  if (status === "ACTIVE") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/15 text-blue-300 border border-blue-500/25 uppercase tracking-wide">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
        Active
      </span>
    );
  }
  if (status === "PENDING") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/25 uppercase tracking-wide">
        <Clock size={9} />
        Pending
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-600/20 text-slate-500 border border-slate-600/25 uppercase tracking-wide">
      <Eye size={9} />
      Watch
    </span>
  );
}

export default function SignalCard({
  signal,
  isCharted,
  isRefreshing,
  now,
  sparklineData,
  positionSize,
  onSelect,
}: Props) {
  const ts = new Date(signal.timestamp);
  const decimals = pairDecimals(signal.pair);
  const isBuy = signal.type === "BUY";

  const cardBorder = isCharted
    ? "border-blue-500/40 shadow-[0_0_0_1px_rgba(59,130,246,0.15),0_4px_24px_rgba(59,130,246,0.08)]"
    : signal.status === "ACTIVE"
    ? "border-white/[0.08] hover:border-white/[0.12]"
    : "border-white/[0.05] hover:border-white/[0.08]";

  return (
    <div
      onClick={onSelect}
      className={`relative bg-[#0d1526] border rounded-xl cursor-pointer transition-all duration-200
        ${cardBorder}
        ${signal.isStale ? "opacity-60" : ""}
        ${isRefreshing ? "opacity-95" : ""}`}
    >
      {/* Colored top accent by status */}
      <div className={`h-0.5 rounded-t-xl ${
        signal.status === "ACTIVE" ? "bg-gradient-to-r from-blue-500 to-indigo-500" :
        signal.status === "PENDING" ? "bg-gradient-to-r from-amber-500/60 to-amber-500/20" :
        "bg-white/[0.04]"
      }`} />

      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Direction icon */}
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
              isBuy ? "bg-emerald-500/10" : "bg-rose-500/10"
            }`}>
              {isBuy
                ? <ArrowUpRight size={16} className="text-emerald-400" />
                : <ArrowDownRight size={16} className="text-rose-400" />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-black text-white tracking-tight">{signal.pair}</span>
                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded tracking-wider uppercase ${
                  isBuy ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"
                }`}>
                  {signal.type}
                </span>
                {typeof signal.changePercent === "number" && (
                  <span className={`text-[10px] font-mono font-semibold ${
                    signal.changePercent >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}>
                    {signal.changePercent >= 0 ? "+" : ""}{signal.changePercent.toFixed(2)}%
                  </span>
                )}
                {signal.isStale && (
                  <span className="text-[9px] px-1 py-0.5 rounded font-bold bg-amber-500/15 text-amber-400 border border-amber-500/25 uppercase">
                    Stale
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] text-slate-500">{signal.timeframe}</span>
                <span className="text-slate-700">·</span>
                <span className="text-[10px] text-slate-500">{signal.session}</span>
              </div>
            </div>
          </div>

          {/* Right: status + confidence */}
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <StatusBadge status={signal.status} />
            <ConfidenceRing value={signal.aiConfidence} size={40} stroke={3} label="CONF" />
          </div>
        </div>

        {/* News warning */}
        {signal.newsBlocked && signal.nextEvent && (
          <div className="mb-3">
            <NewsWarning event={signal.nextEvent} />
          </div>
        )}

        {/* Price levels */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-white/[0.03] rounded-lg p-2.5 border border-white/[0.04]">
            <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-1">Entry</div>
            <div className="text-sm font-mono font-bold text-white">{signal.price}</div>
            {typeof signal.dayHigh === "number" && typeof signal.dayLow === "number" && (
              <div className="text-[9px] text-slate-600 mt-0.5 font-mono leading-tight">
                {signal.dayLow.toFixed(decimals)}–{signal.dayHigh.toFixed(decimals)}
              </div>
            )}
          </div>
          <div className="bg-rose-500/[0.04] rounded-lg p-2.5 border border-rose-500/15">
            <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-1">Stop</div>
            <div className="text-sm font-mono font-bold text-rose-400">{signal.sl}</div>
            {signal.atr != null && (
              <div className="text-[9px] text-slate-600 mt-0.5 font-mono">
                ATR {signal.atr.toFixed(decimals === 2 ? 2 : 5)}
              </div>
            )}
          </div>
          <div className="bg-emerald-500/[0.04] rounded-lg p-2.5 border border-emerald-500/15">
            <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-1">Target</div>
            <div className="text-sm font-mono font-bold text-emerald-400">{signal.tp}</div>
            <div className="text-[9px] text-emerald-500/70 mt-0.5 font-mono">{signal.rr}</div>
          </div>
        </div>

        {/* Sparkline + position */}
        <div className="flex items-center gap-3 mb-3 bg-white/[0.02] rounded-lg px-3 py-2 border border-white/[0.04]">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <BarChart2 size={12} className="text-slate-600 shrink-0" />
            <Sparkline data={sparklineData ?? []} width={80} height={24} />
            <span className="text-[9px] text-slate-600 uppercase tracking-wider shrink-0">1h</span>
          </div>
          {positionSize ? (
            <div className="text-right shrink-0">
              <div className="text-xs font-mono font-bold text-white">{positionSize.lots} lots</div>
              <div className="text-[9px] font-mono text-slate-500">
                {positionSize.pips.toFixed(0)}pip · ${positionSize.risk.toFixed(0)}
              </div>
            </div>
          ) : (
            <div className="text-right shrink-0">
              <div className="text-[9px] text-slate-600">Set equity</div>
              <div className="text-[9px] text-slate-600">for sizing</div>
            </div>
          )}
        </div>

        {/* Confluence chips */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          <Chip
            icon={signal.trend === "Bullish" ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
            label={`${signal.trend} 4H`}
            tone={signal.trend === "Bullish" ? "good" : "bad"}
          />
          <Chip
            icon={signal.trendAligned ? <ShieldCheck size={9} /> : <ShieldAlert size={9} />}
            label={signal.trendAligned ? "D↔4H" : "TF split"}
            tone={signal.trendAligned ? "good" : "warn"}
          />
          <Chip
            icon={signal.rejectionConfirmed ? <ShieldCheck size={9} /> : <Clock size={9} />}
            label={signal.rejectionConfirmed ? "Rejection ✓" : "No rejection"}
            tone={signal.rejectionConfirmed ? "good" : "neutral"}
          />
          {signal.newsBlocked && (
            <Chip icon={<ShieldAlert size={9} />} label="News risk" tone="warn" />
          )}
        </div>

        {/* AOI context */}
        <div className="flex items-center gap-1.5 text-[10px] text-slate-600 mb-3">
          <Target size={11} className="text-slate-700 shrink-0" />
          <span className="truncate">{signal.aoi}</span>
        </div>

        {/* AI commentary */}
        <div className="bg-purple-500/[0.04] border border-purple-500/10 rounded-lg p-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <Cpu size={11} className="text-purple-500" />
              <span className="text-[9px] text-purple-400 font-semibold uppercase tracking-wider">Desk</span>
            </div>
            <span className="text-[9px] text-slate-600 font-mono">
              {format(ts, "HH:mm")} · {relativeTime(ts, now)}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">{signal.aiInterpretation}</p>
        </div>

        {/* Charting indicator */}
        {isCharted && (
          <div className="mt-2.5 text-center text-[9px] text-blue-400/60 uppercase tracking-wider font-semibold">
            Charting this pair
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({
  icon, label, tone,
}: {
  icon: React.ReactNode;
  label: string;
  tone: "good" | "bad" | "warn" | "neutral";
}) {
  const cls = {
    good: "bg-emerald-500/8 text-emerald-400 border-emerald-500/20",
    bad: "bg-rose-500/8 text-rose-400 border-rose-500/20",
    warn: "bg-amber-500/8 text-amber-400 border-amber-500/20",
    neutral: "bg-white/[0.04] text-slate-500 border-white/[0.06]",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-semibold ${cls}`}>
      {icon}{label}
    </span>
  );
}
