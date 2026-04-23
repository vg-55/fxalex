"use client";

import {
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Target,
  Eye,
  Maximize2,
  Cpu,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import { format } from "date-fns";
import ConfidenceRing from "./ConfidenceRing";
import Sparkline from "./Sparkline";
import NewsWarning from "./NewsWarning";
import type { Signal } from "@/lib/signal-types";

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
  const seconds = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
}

function StatusBadge({ status }: { status: Signal["status"] }) {
  if (status === "ACTIVE") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/40 anim-status-pulse">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400" /> ACTIVE
      </span>
    );
  }
  if (status === "PENDING") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/40">
        <Clock size={12} /> PENDING
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-600/20 text-slate-400 border border-slate-600/40">
      <Eye size={12} /> WATCHING
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
  const decimals = signal.pair === "XAUUSD" ? 2 : 4;

  return (
    <div
      onClick={onSelect}
      className={`relative bg-[#111a2e] border rounded-2xl p-5 sm:p-6 transition-all cursor-pointer anim-fade-in-up
        ${isCharted ? "border-blue-500/70 shadow-[0_0_0_1px_rgba(59,130,246,.25)]" : "border-[#243049] hover:border-[#2f3d5b]"}
        ${signal.isStale ? "stale-overlay" : ""}
        ${isRefreshing ? "opacity-[0.98]" : ""}`}
    >
      {/* Header */}
      <div className="flex justify-between items-start mb-5">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <div
            className={`p-2.5 rounded-xl ${
              signal.type === "BUY"
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-rose-500/10 text-rose-400"
            }`}
          >
            {signal.type === "BUY" ? <ArrowUpRight size={22} /> : <ArrowDownRight size={22} />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                {signal.pair}
              </h2>
              {typeof signal.changePercent === "number" && (
                <span
                  className={`text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded ${
                    signal.changePercent >= 0
                      ? "text-emerald-300 bg-emerald-500/10"
                      : "text-rose-300 bg-rose-500/10"
                  }`}
                >
                  {signal.changePercent >= 0 ? "+" : ""}
                  {signal.changePercent.toFixed(2)}%
                </span>
              )}
              {isCharted && (
                <span className="bg-blue-600/80 text-white text-[10px] px-1.5 py-0.5 rounded font-semibold flex items-center gap-1">
                  <Maximize2 size={10} /> Charting
                </span>
              )}
              {signal.isStale && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/40">
                  STALE
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider ${
                  signal.type === "BUY"
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "bg-rose-500/15 text-rose-300"
                }`}
              >
                {signal.type}
              </span>
              <span className="text-slate-600">•</span>
              <span>{signal.timeframe}</span>
              <span className="text-slate-600">•</span>
              <span>{signal.session}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <StatusBadge status={signal.status} />
          <ConfidenceRing value={signal.aiConfidence} size={50} stroke={4} label="CONF" />
        </div>
      </div>

      {/* News warning */}
      {signal.newsBlocked && signal.nextEvent && (
        <div className="mb-4">
          <NewsWarning event={signal.nextEvent} />
        </div>
      )}

      {/* Price row */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-[#0a1020] rounded-lg p-3 border border-[#243049]">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Entry</div>
          <div className="text-lg font-mono font-bold text-white">{signal.price}</div>
          {typeof signal.dayHigh === "number" && typeof signal.dayLow === "number" && (
            <div className="text-[9px] text-slate-500 mt-1 font-mono">
              L {signal.dayLow.toFixed(decimals)} · H {signal.dayHigh.toFixed(decimals)}
            </div>
          )}
        </div>
        <div className="bg-[#0a1020] rounded-lg p-3 border border-rose-500/20">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Stop</div>
          <div className="text-lg font-mono font-bold text-rose-400">{signal.sl}</div>
          {signal.atr != null && (
            <div className="text-[9px] text-slate-500 mt-1 font-mono">
              ATR {signal.atr.toFixed(decimals === 2 ? 2 : 5)}
            </div>
          )}
        </div>
        <div className="bg-[#0a1020] rounded-lg p-3 border border-emerald-500/20">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
            Target ({signal.rr})
          </div>
          <div className="text-lg font-mono font-bold text-emerald-400">{signal.tp}</div>
        </div>
      </div>

      {/* Sparkline + sizing */}
      <div className="flex items-center justify-between gap-4 mb-4 bg-[#0a1020]/60 border border-[#243049] rounded-lg p-3">
        <div className="flex items-center gap-3 min-w-0">
          <Sparkline data={sparklineData ?? []} width={120} height={32} />
          <div className="text-[10px] text-slate-500 uppercase tracking-wider">1h</div>
        </div>
        {positionSize && (
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Position</div>
            <div className="text-sm font-mono font-bold text-white">
              {positionSize.lots} lots
            </div>
            <div className="text-[10px] text-slate-500 font-mono">
              {positionSize.pips.toFixed(0)} pips · ${positionSize.risk.toFixed(0)}
            </div>
          </div>
        )}
      </div>

      {/* Confluence chips */}
      <div className="flex flex-wrap gap-2 mb-4 text-[10px]">
        <Chip
          icon={signal.trend === "Bullish" ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
          label={`${signal.trend} 4H`}
          tone={signal.trend === "Bullish" ? "good" : "bad"}
        />
        <Chip
          icon={signal.trendAligned ? <ShieldCheck size={10} /> : <ShieldAlert size={10} />}
          label={signal.trendAligned ? "D ↔ 4H aligned" : "TF misaligned"}
          tone={signal.trendAligned ? "good" : "warn"}
        />
        <Chip
          icon={signal.rejectionConfirmed ? <ShieldCheck size={10} /> : <Clock size={10} />}
          label={signal.rejectionConfirmed ? "Rejection ✓" : "Awaiting rejection"}
          tone={signal.rejectionConfirmed ? "good" : "neutral"}
        />
        {signal.newsBlocked && <Chip icon={<ShieldAlert size={10} />} label="News" tone="warn" />}
      </div>

      {/* Context */}
      <div className="flex items-center gap-2 text-xs text-slate-300 bg-[#0a1020]/50 rounded-lg px-3 py-2 mb-4">
        <Target size={14} className="text-slate-500 shrink-0" />
        <span className="text-slate-500">Context:</span>
        <span className="font-medium truncate">{signal.aoi}</span>
      </div>

      {/* AI commentary */}
      <div className="bg-[#0a1020]/70 border border-purple-500/20 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Cpu size={14} className="text-purple-400" />
            <span className="text-purple-300 font-semibold text-xs uppercase tracking-wider">
              Desk Commentary
            </span>
          </div>
          <span className="text-[10px] text-slate-500 font-mono">
            {format(ts, "HH:mm")} · {relativeTime(ts, now)}
          </span>
        </div>
        <p className="text-slate-300 text-sm leading-relaxed">{signal.aiInterpretation}</p>
      </div>
    </div>
  );
}

function Chip({
  icon,
  label,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  tone: "good" | "bad" | "warn" | "neutral";
}) {
  const styles = {
    good: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    bad: "bg-rose-500/10 text-rose-300 border-rose-500/30",
    warn: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    neutral: "bg-slate-500/10 text-slate-300 border-slate-600/30",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-medium ${styles}`}>
      {icon}
      {label}
    </span>
  );
}
