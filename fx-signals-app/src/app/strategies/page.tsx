"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  RefreshCw,
  ShieldCheck,
  Target,
  Activity,
  Layers,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Compass,
  Zap,
} from "lucide-react";
import TradingViewWidget from "@/components/TradingViewWidget";

// ---------------------------------------------------------------------------
// Mirrors of /api/strategies payload
// ---------------------------------------------------------------------------
type Lane = "alex" | "fabio" | "combined";

type AlexRow = {
  source: "alex";
  pair: string;
  tvSymbol: string;
  type: "BUY" | "SELL";
  status: "ACTIVE" | "PENDING" | "WATCHING";
  price: string;
  sl: string;
  tp: string;
  rr: string;
  aoi: string;
  aiConfidence: number;
  proximity: number;
  emaConfluence: number;
  rejection: number;
  trendAligned: boolean;
  newsBlocked: boolean;
  isStale: boolean;
  aiInterpretation: string;
  enteredAt: string | null;
  locked: boolean;
};

type FabioRow = {
  source: "fabio";
  pair: string;
  tvSymbol: string;
  type: "BUY" | "SELL" | "NEUTRAL";
  status: "ACTIVE" | "PENDING" | "WATCHING";
  model: string;
  price: string;
  entry: string | null;
  sl: string | null;
  tp: string | null;
  vah: string;
  poc: string;
  val: string;
  marketState: "BALANCE" | "EXPANSION";
  isInsideValueArea: boolean;
  tickDelta: number;
  ibHigh: string | null;
  ibLow: string | null;
  aiConfidence: number;
  reasoning: string;
  aiInterpretation: string | null;
  degraded: boolean;
};

type CombinedRow = {
  source: "combined";
  pair: string;
  tvSymbol: string;
  type: "BUY" | "SELL";
  alexStatus: "ACTIVE" | "PENDING" | "WATCHING";
  fabioModel: string;
  marketState: "BALANCE" | "EXPANSION";
  entry: string;
  sl: string;
  tp: string;
  rr: string;
  alexConfidence: number;
  fabioConfidence: number;
  combinedConfidence: number;
  reasoning: string;
};

type Payload = {
  alex: AlexRow[];
  fabio: FabioRow[];
  combined: CombinedRow[];
  fetchedAt: string;
  activeProvider: string | null;
};

const LANE_META: Record<
  Lane,
  { label: string; sub: string; tone: string; icon: React.ReactNode }
> = {
  combined: {
    label: "Combined",
    sub: "Both engines agree",
    tone: "emerald",
    icon: <ShieldCheck size={14} />,
  },
  alex: {
    label: "Alex G",
    sub: "AOI · Set & Forget",
    tone: "blue",
    icon: <Target size={14} />,
  },
  fabio: {
    label: "Fabio",
    sub: "Order Flow · 40-Range",
    tone: "purple",
    icon: <Layers size={14} />,
  },
};

export default function StrategiesPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRefreshing(true);
      const res = await fetch("/api/strategies", { cache: "no-store" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as Payload;
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  // Default chart: top combined → top alex active → first fabio.
  useEffect(() => {
    if (!data || chartSymbol) return;
    const fav =
      data.combined[0]?.tvSymbol ??
      data.alex.find((a) => a.status === "ACTIVE")?.tvSymbol ??
      data.alex[0]?.tvSymbol ??
      data.fabio[0]?.tvSymbol ??
      "OANDA:XAUUSD";
    setChartSymbol(fav);
  }, [data, chartSymbol]);

  const counts = useMemo(() => {
    if (!data) return { alex: 0, fabio: 0, combined: 0 };
    return {
      alex: data.alex.filter((s) => s.status !== "WATCHING").length,
      fabio: data.fabio.filter((s) => s.status !== "WATCHING").length,
      combined: data.combined.length,
    };
  }, [data]);

  return (
    <div className="flex h-full min-h-screen">
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Hero header */}
        <div className="sticky top-0 z-20 bg-gradient-to-b from-[#080e1a] to-[#080e1a]/90 backdrop-blur-md border-b border-white/[0.06]">
          <div className="px-4 sm:px-6 pt-4 pb-4">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 via-blue-500 to-purple-500 flex items-center justify-center shrink-0 shadow-[0_0_24px_rgba(99,102,241,0.3)]">
                  <Sparkles size={18} className="text-white" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-base font-bold text-white tracking-tight">
                    Strategy Lanes
                  </h1>
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        error ? "bg-rose-400" : "bg-emerald-400 animate-pulse"
                      }`}
                    />
                    {error
                      ? "disconnected"
                      : data?.fetchedAt
                      ? `synced · ${new Date(data.fetchedAt).toLocaleTimeString()}`
                      : "connecting…"}
                    {data?.activeProvider && (
                      <span className="text-slate-600">· {data.activeProvider}</span>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={load}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] text-slate-400 hover:text-white hover:bg-white/5 transition"
                title="Refresh"
              >
                <RefreshCw
                  size={12}
                  className={refreshing ? "animate-spin text-blue-400" : ""}
                />
                refresh
              </button>
            </div>

            {/* Lane summary tiles */}
            <div className="grid grid-cols-3 gap-2">
              <LaneSummary
                lane="combined"
                count={counts.combined}
                hint="Highest conviction"
              />
              <LaneSummary lane="alex" count={counts.alex} hint="AOI engine" />
              <LaneSummary
                lane="fabio"
                count={counts.fabio}
                hint="Order flow"
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="mx-4 sm:mx-6 mt-4 bg-rose-500/8 border border-rose-500/20 rounded-xl p-3 flex items-center gap-3">
            <AlertCircle className="text-rose-400 shrink-0" size={15} />
            <p className="text-rose-300 text-xs flex-1">{error}</p>
            <button
              onClick={load}
              className="text-xs px-2.5 py-1 rounded-md bg-rose-500/15 text-rose-300 border border-rose-500/25 hover:bg-rose-500/20 transition"
            >
              Retry
            </button>
          </div>
        )}

        {/* Three-lane grid */}
        <div className="flex-1 p-4 sm:p-6">
          {loading && !data ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {(["combined", "alex", "fabio"] as Lane[]).map((l) => (
                <LaneSkeleton key={l} lane={l} />
              ))}
            </div>
          ) : data ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <LaneColumn lane="combined" rows={data.combined}>
                {data.combined.length === 0 ? (
                  <EmptyLane
                    icon={<ShieldCheck size={20} className="text-emerald-400/60" />}
                    title="No double-confirmed setups"
                    sub="Waiting for both engines to agree on a direction"
                  />
                ) : (
                  data.combined.map((r) => (
                    <CombinedCard
                      key={r.pair}
                      row={r}
                      isCharted={chartSymbol === r.tvSymbol}
                      onSelect={() => setChartSymbol(r.tvSymbol)}
                    />
                  ))
                )}
              </LaneColumn>

              <LaneColumn lane="alex" rows={data.alex}>
                {data.alex.length === 0 ? (
                  <EmptyLane
                    icon={<Target size={20} className="text-blue-400/60" />}
                    title="No Alex G setups"
                    sub="The AOI scanner has no live pairs"
                  />
                ) : (
                  data.alex.map((r) => (
                    <AlexCard
                      key={r.pair}
                      row={r}
                      isCharted={chartSymbol === r.tvSymbol}
                      onSelect={() => setChartSymbol(r.tvSymbol)}
                    />
                  ))
                )}
              </LaneColumn>

              <LaneColumn lane="fabio" rows={data.fabio}>
                {data.fabio.length === 0 ? (
                  <EmptyLane
                    icon={<Layers size={20} className="text-purple-400/60" />}
                    title="No Fabio analyses"
                    sub="Insufficient tick history — try again in a few minutes"
                  />
                ) : (
                  data.fabio.map((r) => (
                    <FabioCard
                      key={r.pair}
                      row={r}
                      isCharted={chartSymbol === r.tvSymbol}
                      onSelect={() => setChartSymbol(r.tvSymbol)}
                    />
                  ))
                )}
              </LaneColumn>
            </div>
          ) : null}
        </div>
      </div>

      {/* Chart panel — desktop only */}
      <div className="hidden xl:flex w-[480px] 2xl:w-[560px] shrink-0 flex-col border-l border-white/[0.06] sticky top-0 h-screen">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-[#0a1120]">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-semibold text-slate-300">Live Chart</span>
          </div>
          <span className="text-xs font-mono text-slate-500">{chartSymbol}</span>
        </div>
        <div className="flex-1 relative">
          {chartSymbol && <TradingViewWidget symbol={chartSymbol} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lane summary tile (in hero header)
// ---------------------------------------------------------------------------
function LaneSummary({
  lane,
  count,
  hint,
}: {
  lane: Lane;
  count: number;
  hint: string;
}) {
  const meta = LANE_META[lane];
  const tones: Record<string, { ring: string; icon: string; value: string; glow: string }> = {
    emerald: {
      ring: count > 0 ? "border-emerald-500/40 shadow-[0_0_24px_rgba(16,185,129,0.18)]" : "border-white/[0.06]",
      icon: count > 0 ? "text-emerald-300" : "text-slate-500",
      value: count > 0 ? "text-emerald-300" : "text-slate-300",
      glow: count > 0 ? "bg-emerald-500/10" : "bg-white/[0.02]",
    },
    blue: {
      ring: count > 0 ? "border-blue-500/40 shadow-[0_0_24px_rgba(59,130,246,0.15)]" : "border-white/[0.06]",
      icon: count > 0 ? "text-blue-300" : "text-slate-500",
      value: count > 0 ? "text-blue-300" : "text-slate-300",
      glow: count > 0 ? "bg-blue-500/10" : "bg-white/[0.02]",
    },
    purple: {
      ring: count > 0 ? "border-purple-500/40 shadow-[0_0_24px_rgba(168,85,247,0.15)]" : "border-white/[0.06]",
      icon: count > 0 ? "text-purple-300" : "text-slate-500",
      value: count > 0 ? "text-purple-300" : "text-slate-300",
      glow: count > 0 ? "bg-purple-500/10" : "bg-white/[0.02]",
    },
  };
  const t = tones[meta.tone];
  return (
    <div className={`rounded-xl border ${t.ring} ${t.glow} p-3 transition-all`}>
      <div className="flex items-center justify-between mb-1">
        <div className={`flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold ${t.icon}`}>
          {meta.icon}
          {meta.label}
        </div>
        {count > 0 && <span className={`w-1.5 h-1.5 rounded-full bg-current animate-pulse ${t.icon}`} />}
      </div>
      <div className={`text-2xl font-bold font-mono ${t.value}`}>{count}</div>
      <div className="text-[9px] text-slate-600 mt-0.5">{hint}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lane column wrapper
// ---------------------------------------------------------------------------
function LaneColumn({
  lane,
  rows,
  children,
}: {
  lane: Lane;
  rows: { pair: string }[];
  children: React.ReactNode;
}) {
  const meta = LANE_META[lane];
  const headerTone: Record<string, string> = {
    emerald: "text-emerald-300 border-emerald-500/30 bg-emerald-500/[0.04]",
    blue: "text-blue-300 border-blue-500/30 bg-blue-500/[0.04]",
    purple: "text-purple-300 border-purple-500/30 bg-purple-500/[0.04]",
  };
  return (
    <div className="flex flex-col min-w-0">
      <div
        className={`flex items-center justify-between px-3 py-2 rounded-t-xl border ${headerTone[meta.tone]} backdrop-blur-sm`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {meta.icon}
          <span className="text-xs font-bold uppercase tracking-wider truncate">
            {meta.label}
          </span>
          <span className="text-[10px] text-slate-500 font-normal normal-case truncate">
            {meta.sub}
          </span>
        </div>
        <span className="text-[10px] font-mono text-slate-500">{rows.length}</span>
      </div>
      <div className="flex-1 space-y-2 p-2 rounded-b-xl border-x border-b border-white/[0.04] bg-white/[0.01] min-h-[200px]">
        {children}
      </div>
    </div>
  );
}

function LaneSkeleton({ lane }: { lane: Lane }) {
  const meta = LANE_META[lane];
  return (
    <div className="flex flex-col">
      <div className="px-3 py-2 rounded-t-xl border border-white/[0.06] bg-white/[0.02] flex items-center gap-2">
        {meta.icon}
        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
          {meta.label}
        </span>
      </div>
      <div className="space-y-2 p-2 rounded-b-xl border-x border-b border-white/[0.04] bg-white/[0.01]">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-28 rounded-lg bg-white/[0.02] border border-white/[0.04] animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}

function EmptyLane({
  icon,
  title,
  sub,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="mb-2">{icon}</div>
      <div className="text-xs font-semibold text-slate-400 mb-1">{title}</div>
      <div className="text-[10px] text-slate-600">{sub}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------
function StatusPill({ status }: { status: "ACTIVE" | "PENDING" | "WATCHING" }) {
  const styles = {
    ACTIVE: "bg-blue-500/15 text-blue-300 border-blue-500/30",
    PENDING: "bg-amber-500/10 text-amber-300 border-amber-500/25",
    WATCHING: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  }[status];
  return (
    <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${styles}`}>
      {status}
    </span>
  );
}

function DirPill({ type }: { type: "BUY" | "SELL" | "NEUTRAL" }) {
  const styles =
    type === "BUY"
      ? "bg-emerald-500/20 text-emerald-200"
      : type === "SELL"
      ? "bg-rose-500/20 text-rose-200"
      : "bg-slate-500/15 text-slate-400";
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${styles}`}>
      {type}
    </span>
  );
}

function Levels({
  entry,
  sl,
  tp,
}: {
  entry: string | null;
  sl: string | null;
  tp: string | null;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-white/[0.04]">
      <Lvl label="Entry" value={entry} tone="slate" />
      <Lvl label="SL" value={sl} tone="rose" />
      <Lvl label="TP" value={tp} tone="emerald" />
    </div>
  );
}

function Lvl({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | null;
  tone: "slate" | "rose" | "emerald";
}) {
  const colour = {
    slate: "text-slate-200",
    rose: "text-rose-300",
    emerald: "text-emerald-300",
  }[tone];
  return (
    <div className="text-center">
      <div className="text-[8px] uppercase tracking-wider text-slate-600 font-semibold">
        {label}
      </div>
      <div className={`text-[11px] font-mono font-semibold mt-0.5 ${value ? colour : "text-slate-700"}`}>
        {value ?? "—"}
      </div>
    </div>
  );
}

function CardShell({
  tone,
  isCharted,
  onClick,
  children,
}: {
  tone: "emerald" | "blue" | "purple";
  isCharted: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const tones = {
    emerald: isCharted
      ? "border-emerald-500/50 bg-emerald-500/[0.06] shadow-[0_0_24px_rgba(16,185,129,0.12)]"
      : "border-emerald-500/20 bg-[#091a14]/60 hover:border-emerald-500/40 hover:bg-emerald-500/[0.04]",
    blue: isCharted
      ? "border-blue-500/50 bg-blue-500/[0.06] shadow-[0_0_24px_rgba(59,130,246,0.12)]"
      : "border-blue-500/15 bg-white/[0.02] hover:border-blue-500/30 hover:bg-blue-500/[0.03]",
    purple: isCharted
      ? "border-purple-500/50 bg-purple-500/[0.06] shadow-[0_0_24px_rgba(168,85,247,0.12)]"
      : "border-purple-500/15 bg-white/[0.02] hover:border-purple-500/30 hover:bg-purple-500/[0.03]",
  }[tone];
  return (
    <button
      onClick={onClick}
      className={`group w-full text-left rounded-lg border p-3 transition-all ${tones}`}
    >
      {children}
    </button>
  );
}

function CombinedCard({
  row,
  isCharted,
  onSelect,
}: {
  row: CombinedRow;
  isCharted: boolean;
  onSelect: () => void;
}) {
  return (
    <CardShell tone="emerald" isCharted={isCharted} onClick={onSelect}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-bold text-white">{row.pair}</span>
          <DirPill type={row.type} />
          <StatusPill status={row.alexStatus} />
        </div>
        <span className="text-[10px] font-mono text-emerald-300/80">
          {row.combinedConfidence}%
        </span>
      </div>
      <div className="space-y-1 mb-2">
        <ConfRow icon engineLabel="Alex G" pct={row.alexConfidence} text="AOI engine" />
        <ConfRow
          icon
          engineLabel="Fabio"
          pct={row.fabioConfidence}
          text={`${row.fabioModel.replace(/_/g, " ").toLowerCase()} · ${row.marketState.toLowerCase()}`}
        />
      </div>
      <Levels entry={row.entry} sl={row.sl} tp={row.tp} />
      <div className="text-[9px] text-slate-500 mt-2 truncate">{row.reasoning}</div>
      <div className="text-[9px] font-mono text-slate-600 mt-1">R:R {row.rr}</div>
    </CardShell>
  );
}

function ConfRow({
  icon,
  engineLabel,
  pct,
  text,
}: {
  icon?: boolean;
  engineLabel: string;
  pct: number;
  text: string;
}) {
  return (
    <div className="flex items-center gap-2 text-[10px]">
      {icon && <CheckCircle2 size={10} className="text-emerald-400 shrink-0" />}
      <span className="text-slate-400 w-12 shrink-0">{engineLabel}</span>
      <div className="flex-1 h-1 rounded-full bg-white/[0.04] overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-emerald-500/60 to-emerald-300/60"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span className="text-slate-500 font-mono shrink-0">{pct}%</span>
      <span className="text-slate-600 truncate hidden sm:inline">{text}</span>
    </div>
  );
}

function AlexCard({
  row,
  isCharted,
  onSelect,
}: {
  row: AlexRow;
  isCharted: boolean;
  onSelect: () => void;
}) {
  return (
    <CardShell tone="blue" isCharted={isCharted} onClick={onSelect}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-bold text-white">{row.pair}</span>
          <DirPill type={row.type} />
          <StatusPill status={row.status} />
          {row.locked && <Zap size={10} className="text-amber-400" />}
        </div>
        <span className="text-[10px] font-mono text-blue-300/80">
          {row.aiConfidence}%
        </span>
      </div>
      <div className="text-[10px] text-slate-500 mb-1.5 flex items-center gap-1.5">
        <Compass size={10} />
        <span className="truncate">{row.aoi}</span>
      </div>
      <div className="grid grid-cols-3 gap-1 mb-2">
        <FactorChip label="Prox" value={row.proximity} max={25} tone="blue" />
        <FactorChip label="EMA" value={row.emaConfluence} max={20} tone="emerald" />
        <FactorChip label="Rej" value={row.rejection} max={15} tone="amber" />
      </div>
      <Levels entry={row.price} sl={row.sl} tp={row.tp} />
      <div className="flex items-center justify-between mt-2 text-[9px] text-slate-600">
        <span>R:R {row.rr}</span>
        <div className="flex items-center gap-1.5">
          {row.newsBlocked && (
            <span className="text-amber-400 flex items-center gap-0.5">
              <AlertCircle size={9} /> news
            </span>
          )}
          {row.isStale && <span className="text-rose-400">stale</span>}
        </div>
      </div>
    </CardShell>
  );
}

function FactorChip({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: "blue" | "emerald" | "amber";
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const colour = {
    blue: "from-blue-500/60 to-blue-400/40",
    emerald: "from-emerald-500/60 to-emerald-400/40",
    amber: "from-amber-500/60 to-amber-400/40",
  }[tone];
  return (
    <div className="rounded-md bg-white/[0.02] p-1.5">
      <div className="flex items-center justify-between text-[8px] uppercase tracking-wider text-slate-600 mb-0.5">
        <span>{label}</span>
        <span className="font-mono text-slate-500">{Math.round(value)}</span>
      </div>
      <div className="h-1 rounded-full bg-white/[0.04] overflow-hidden">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${colour}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function FabioCard({
  row,
  isCharted,
  onSelect,
}: {
  row: FabioRow;
  isCharted: boolean;
  onSelect: () => void;
}) {
  return (
    <CardShell tone="purple" isCharted={isCharted} onClick={onSelect}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-bold text-white">{row.pair}</span>
          <DirPill type={row.type} />
          <StatusPill status={row.status} />
        </div>
        <span className="text-[10px] font-mono text-purple-300/80">
          {row.aiConfidence}%
        </span>
      </div>

      <div className="text-[10px] text-slate-500 mb-1.5 flex items-center gap-1.5">
        <Activity size={10} />
        <span className="truncate">
          {row.model === "NONE" ? "Awaiting setup" : row.model.replace(/_/g, " ").toLowerCase()}
          {row.degraded && <span className="text-amber-400 ml-1">· degraded</span>}
        </span>
      </div>

      {/* Value Area strip */}
      <div className="rounded-md bg-white/[0.02] p-1.5 mb-2">
        <div className="flex items-center justify-between text-[8px] uppercase tracking-wider text-slate-600 mb-1">
          <span>Value Area</span>
          <span
            className={`font-mono ${
              row.marketState === "BALANCE" ? "text-purple-300" : "text-amber-300"
            }`}
          >
            {row.marketState}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1 text-[10px] font-mono">
          <div className="text-center">
            <div className="text-[8px] text-slate-600">VAH</div>
            <div className="text-purple-200">{row.vah}</div>
          </div>
          <div className="text-center">
            <div className="text-[8px] text-slate-600">POC</div>
            <div className="text-purple-100 font-bold">{row.poc}</div>
          </div>
          <div className="text-center">
            <div className="text-[8px] text-slate-600">VAL</div>
            <div className="text-purple-200">{row.val}</div>
          </div>
        </div>
        <div className="text-[9px] text-slate-500 text-center mt-1">
          @ <span className="text-slate-300 font-mono">{row.price}</span>
          {row.isInsideValueArea ? " · inside VA" : " · outside VA"}
        </div>
      </div>

      <Levels entry={row.entry} sl={row.sl} tp={row.tp} />

      <div className="flex items-center justify-between mt-2 text-[9px] text-slate-600">
        <span>
          tickΔ{" "}
          <span
            className={
              row.tickDelta > 0
                ? "text-emerald-400"
                : row.tickDelta < 0
                ? "text-rose-400"
                : ""
            }
          >
            {row.tickDelta > 0 ? "+" : ""}
            {row.tickDelta}
          </span>
        </span>
        {row.ibHigh && row.ibLow && (
          <span className="font-mono">
            IB {row.ibLow}–{row.ibHigh}
          </span>
        )}
      </div>
    </CardShell>
  );
}
