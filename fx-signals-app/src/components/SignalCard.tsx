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
  ShieldAlert,
  BarChart2,
  Zap,
  Sparkles,
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

// ── Factor bar component ──────────────────────────────────────────────────────
function FactorBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string; // tailwind bg class
}) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="w-[58px] text-[9px] text-slate-500 uppercase tracking-wide shrink-0 text-right leading-none">
        {label}
      </div>
      <div className="flex-1 h-1 bg-white/[0.05] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="w-6 text-[9px] font-mono text-slate-500 shrink-0">{value}</div>
    </div>
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
  const f = signal.factors;

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
      {/* Status accent bar */}
      <div className={`h-0.5 rounded-t-xl ${
        signal.status === "ACTIVE" ? "bg-gradient-to-r from-blue-500 to-indigo-500" :
        signal.status === "PENDING" ? "bg-gradient-to-r from-amber-500/60 to-amber-500/20" :
        "bg-white/[0.04]"
      }`} />

      <div className="p-4">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
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

        {/* ── Price levels ─────────────────────────────────────────────────── */}
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

        {/* ── Sparkline + sizing ───────────────────────────────────────────── */}
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
            <div className="text-right shrink-0 text-[9px] text-slate-600 leading-snug">
              Set equity<br />for sizing
            </div>
          )}
        </div>

        {/* ── Confidence factor breakdown ──────────────────────────────────── */}
        <div className="bg-white/[0.02] border border-white/[0.05] rounded-lg p-3 mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] text-slate-600 uppercase tracking-wider font-semibold">
              Score breakdown
            </span>
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-mono font-bold text-white">{signal.aiConfidence}</span>
              <span className="text-[9px] text-slate-600">/100</span>
              {f.aiBoost > 0 && (
                <span className="inline-flex items-center gap-0.5 ml-1 px-1 py-0.5 rounded text-[8px] font-bold bg-purple-500/15 text-purple-400 border border-purple-500/20">
                  <Sparkles size={7} />+{f.aiBoost} AI
                </span>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <FactorBar label="Proximity" value={f.proximity}     max={25} color={f.proximity >= 20 ? "bg-emerald-500" : f.proximity >= 10 ? "bg-amber-500" : "bg-slate-600"} />
            <FactorBar label="EMA"       value={f.emaConfluence} max={20} color={f.emaConfluence >= 16 ? "bg-emerald-500" : f.emaConfluence >= 8 ? "bg-amber-500" : "bg-rose-500"} />
            <FactorBar label="Rejection" value={f.rejection}     max={20} color={f.rejection >= 15 ? "bg-emerald-500" : f.rejection > 0 ? "bg-amber-500" : "bg-slate-700"} />
            <FactorBar label="Momentum"  value={f.momentum}      max={15} color={f.momentum >= 10 ? "bg-emerald-500" : f.momentum >= 5 ? "bg-amber-500" : "bg-slate-600"} />
            <FactorBar label="Session"   value={f.sessionQuality} max={10} color={f.sessionQuality >= 8 ? "bg-emerald-500" : f.sessionQuality >= 5 ? "bg-amber-500" : "bg-slate-600"} />
            <FactorBar label="R:R"       value={f.rrQuality}     max={10} color={f.rrQuality >= 8 ? "bg-emerald-500" : f.rrQuality >= 4 ? "bg-amber-500" : "bg-rose-500"} />
          </div>
        </div>

        {/* ── Context chips ────────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          <Chip
            icon={signal.trend === "Bullish" ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
            label={`${signal.trend} 4H`}
            tone={signal.trend === "Bullish" ? "good" : "bad"}
          />
          <Chip
            icon={signal.trendAligned ? <Zap size={9} /> : <ShieldAlert size={9} />}
            label={signal.trendAligned ? "D↔4H aligned" : "TF split"}
            tone={signal.trendAligned ? "good" : "warn"}
          />
          {signal.newsBlocked && (
            <Chip icon={<ShieldAlert size={9} />} label="News risk" tone="warn" />
          )}
        </div>

        {/* ── AOI ─────────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-1.5 text-[10px] text-slate-600 mb-3">
          <Target size={11} className="text-slate-700 shrink-0" />
          <span className="truncate">{signal.aoi}</span>
        </div>

        {/* ── AI Desk commentary ───────────────────────────────────────────── */}
        <div className="bg-purple-500/[0.04] border border-purple-500/10 rounded-lg p-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <Cpu size={11} className="text-purple-500" />
              <span className="text-[9px] text-purple-400 font-semibold uppercase tracking-wider">
                AI Desk
              </span>
              {f.aiBoost > 0 && (
                <span className="text-[8px] text-purple-500/60">· scored +{f.aiBoost}</span>
              )}
            </div>
            <span className="text-[9px] text-slate-600 font-mono">
              {format(ts, "HH:mm")} · {relativeTime(ts, now)}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">{signal.aiInterpretation}</p>
        </div>

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
