"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { AlertTriangle, RefreshCw, Activity, Radar, Target, Zap, Compass, ShieldCheck, CheckCircle2 } from "lucide-react";
import TradingViewWidget from "@/components/TradingViewWidget";
import SignalCard from "@/components/SignalCard";
import { useLiveStatus } from "@/lib/live-status";
import { useAccount } from "@/lib/account-context";
import { computeSize } from "@/lib/sizing-client";
import { rowToSignal, type Signal, type StreamSignalRow } from "@/lib/signal-types";

type PriceTickRow = { pair: string; price: number };

type ConfluenceRow = {
  pair: string;
  tvSymbol: string;
  alex: "BUY" | "SELL";
  alexStatus: "ACTIVE" | "PENDING" | "WATCHING";
  fabio: "BUY" | "SELL" | "NEUTRAL" | null;
  fabioModel: string | null;
  agree: boolean;
  entry: string;
  sl: string;
  tp: string;
  aiConfidence: number;
};

function SkeletonCard() {
  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 animate-pulse">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-white/5" />
        <div className="flex-1">
          <div className="h-4 w-20 rounded bg-white/5 mb-1.5" />
          <div className="h-3 w-28 rounded bg-white/[0.03]" />
        </div>
        <div className="h-6 w-16 rounded-full bg-white/5" />
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="h-12 rounded-lg bg-white/[0.03]" />
        <div className="h-12 rounded-lg bg-white/[0.03]" />
        <div className="h-12 rounded-lg bg-white/[0.03]" />
      </div>
      <div className="h-10 rounded-lg bg-white/[0.03]" />
    </div>
  );
}

type FilterTab = "all" | "active" | "pending";

export default function Home() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [sparklines, setSparklines] = useState<Record<string, number[]>>({});
  const [activeChartSymbol, setActiveChartSymbol] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [confluence, setConfluence] = useState<ConfluenceRow[]>([]);
  const [confluenceLoading, setConfluenceLoading] = useState(false);
  const { setStatus } = useLiveStatus();
  const { settings } = useAccount();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setStatus("loading");
  }, [setStatus]);

  // SSE wiring (re-runnable via `streamEpoch` for soft retry).
  const [streamEpoch, setStreamEpoch] = useState(0);
  useEffect(() => {
    mountedRef.current = true;
    const es = new EventSource("/api/stream");
    let pulseTimer: ReturnType<typeof setTimeout> | null = null;
    const pulse = () => {
      setIsRefreshing(true);
      if (pulseTimer) clearTimeout(pulseTimer);
      pulseTimer = setTimeout(() => setIsRefreshing(false), 600);
    };

    es.addEventListener("signals", (ev) => {
      const msg = JSON.parse((ev as MessageEvent).data) as {
        signals: StreamSignalRow[];
        state: { lastOkAt: string | null; activeProvider: string | null } | null;
      };
      if (!mountedRef.current) return;
      setSignals(msg.signals.map(rowToSignal));
      if (msg.state?.lastOkAt) {
        const ts = new Date(msg.state.lastOkAt);
        setLastUpdated(ts);
        setStatus("ok", { lastUpdated: ts, error: null });
      }
      setActiveProvider(msg.state?.activeProvider ?? null);
      setError(null);
      setIsLoading(false);
      pulse();
    });

    es.addEventListener("error", () => {
      if (!mountedRef.current) return;
      setError("Live stream disconnected — retrying…");
      setStatus("error", { error: "stream disconnected" });
    });

    return () => {
      mountedRef.current = false;
      if (pulseTimer) clearTimeout(pulseTimer);
      es.close();
    };
  }, [setStatus, streamEpoch]);

  const loadSparklines = useCallback(async () => {
    try {
      const res = await fetch("/api/price-ticks?limit=60", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { byPair: Record<string, PriceTickRow[]> };
      const map: Record<string, number[]> = {};
      for (const [pair, ticks] of Object.entries(data.byPair)) {
        map[pair] = ticks.map((t) => t.price).reverse();
      }
      if (mountedRef.current) setSparklines(map);
    } catch {}
  }, []);

  useEffect(() => {
    loadSparklines();
    const id = setInterval(loadSparklines, 30_000);
    return () => clearInterval(id);
  }, [loadSparklines]);

  // Double-confirmation: pairs where Alex G + Fabio agree on direction.
  const loadConfluence = useCallback(async () => {
    try {
      setConfluenceLoading(true);
      const res = await fetch("/api/confluence", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { confirmed: ConfluenceRow[] };
      if (mountedRef.current) setConfluence(data.confirmed ?? []);
    } catch {
      /* swallow */
    } finally {
      if (mountedRef.current) setConfluenceLoading(false);
    }
  }, []);

  // Recompute confluence whenever the active/pending set changes (debounced via deps).
  const liveSetKey = useMemo(
    () =>
      signals
        .filter((s) => s.status === "ACTIVE" || s.status === "PENDING")
        .map((s) => `${s.pair}:${s.type}:${s.status}`)
        .sort()
        .join("|"),
    [signals]
  );
  useEffect(() => {
    if (!liveSetKey) {
      setConfluence([]);
      return;
    }
    loadConfluence();
    const id = setInterval(loadConfluence, 90_000);
    return () => clearInterval(id);
  }, [liveSetKey, loadConfluence]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const activeCount = signals.filter((s) => s.status === "ACTIVE").length;
  const pendingCount = signals.filter((s) => s.status === "PENDING").length;
  const watchingCount = signals.filter((s) => s.status === "WATCHING").length;

  // Best "nearest setup" — highest proximity factor among non-active rows.
  const nearestSetups = useMemo(() => {
    return [...signals]
      .filter((s) => s.status !== "ACTIVE")
      .sort((a, b) => (b.factors.proximity ?? 0) - (a.factors.proximity ?? 0))
      .slice(0, 3);
  }, [signals]);

  const sizing = useMemo(() => {
    if (!settings) return {};
    const out: Record<string, { lots: string; pips: number; risk: number }> = {};
    for (const s of signals) {
      try {
        const sz = computeSize({
          pair: s.pair,
          equity: settings.equity,
          riskPct: settings.riskPerTradePct,
          entry: parseFloat(s.price),
          sl: parseFloat(s.sl),
        });
        out[s.pair] = { lots: sz.displayLots, pips: sz.pipsRisked, risk: sz.riskDollars };
      } catch {}
    }
    return out;
  }, [signals, settings]);

  const relativeTime = (from: Date): string => {
    const s = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));
    if (s < 5) return "just now";
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    return `${Math.floor(m / 60)}h ago`;
  };

  const filteredSignals = useMemo(() => {
    if (filter === "active") return signals.filter((s) => s.status === "ACTIVE");
    if (filter === "pending") return signals.filter((s) => s.status === "PENDING");
    return signals;
  }, [signals, filter]);

  const sortedSignals = useMemo(() => {
    return [...filteredSignals].sort((a, b) => {
      const order = { ACTIVE: 0, PENDING: 1, WATCHING: 2 };
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return b.aiConfidence - a.aiConfidence;
    });
  }, [filteredSignals]);

  // Default chart symbol: top-confidence ACTIVE → top-confidence anything → XAUUSD.
  useEffect(() => {
    if (activeChartSymbol) return;
    if (sortedSignals.length === 0) return;
    const target =
      sortedSignals.find((s) => s.status === "ACTIVE")?.tvSymbol ??
      sortedSignals[0]?.tvSymbol ??
      "OANDA:XAUUSD";
    setActiveChartSymbol(target);
  }, [sortedSignals, activeChartSymbol]);

  return (
    <div className="flex h-full min-h-screen">
      {/* Signals panel */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* ── Hero header ─────────────────────────────────────────────────── */}
        <div className="sticky top-0 z-20 bg-gradient-to-b from-[#080e1a] to-[#080e1a]/90 backdrop-blur-md border-b border-white/[0.06]">
          <div className="px-4 sm:px-6 pt-4 pb-3">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-[0_0_20px_rgba(59,130,246,0.25)]">
                  <Radar size={18} className="text-white" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-base font-bold text-white tracking-tight">Signal Desk</h1>
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono">
                    <span className={`w-1.5 h-1.5 rounded-full ${error ? "bg-rose-400" : "bg-emerald-400 animate-pulse"}`} />
                    {error ? "disconnected" : lastUpdated ? `synced · ${relativeTime(lastUpdated)}` : "connecting…"}
                    {activeProvider && <span className="text-slate-600">· {activeProvider}</span>}
                  </div>
                </div>
              </div>
              <RefreshCw
                size={13}
                className={isRefreshing ? "animate-spin text-blue-400 shrink-0" : "text-slate-700 shrink-0"}
              />
            </div>

            {/* KPI strip */}
            <div className="grid grid-cols-3 gap-2">
              <KpiTile
                icon={<Zap size={12} />}
                label="Active"
                value={activeCount}
                tone="blue"
                accent={activeCount > 0}
              />
              <KpiTile
                icon={<Target size={12} />}
                label="Pending"
                value={pendingCount}
                tone="amber"
                accent={pendingCount > 0}
              />
              <KpiTile
                icon={<Compass size={12} />}
                label="Watching"
                value={watchingCount}
                tone="slate"
              />
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-1 px-4 sm:px-6 pb-2.5 overflow-x-auto">
            {((["all", "active", "pending"] as FilterTab[])).map((tab) => {
              const count = tab === "all" ? signals.length : tab === "active" ? activeCount : pendingCount;
              const isActive = filter === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setFilter(tab)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold capitalize transition-all whitespace-nowrap ${
                    isActive
                      ? "bg-white/[0.08] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                      : "text-slate-500 hover:text-slate-300 hover:bg-white/[0.03]"
                  }`}
                >
                  {tab}
                  <span className={`ml-1.5 text-[10px] font-mono ${isActive ? "text-slate-400" : "text-slate-600"}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 sm:mx-6 mt-4 bg-rose-500/8 border border-rose-500/20 rounded-xl p-3 flex items-center gap-3">
            <AlertTriangle className="text-rose-400 shrink-0" size={15} />
            <p className="text-rose-300 text-xs flex-1">{error}</p>
            <button
              onClick={() => {
                setError(null);
                setStreamEpoch((n) => n + 1);
              }}
              className="text-xs px-2.5 py-1 rounded-md bg-rose-500/15 text-rose-300 border border-rose-500/25 hover:bg-rose-500/20 transition"
            >
              Retry
            </button>
          </div>
        )}

        {/* Signal grid */}
        <div className="flex-1 p-4 sm:p-6">
          {/* Double-confirmation banner — Alex G + Fabio aligned */}
          {confluence.length > 0 && (
            <DoubleConfirmationBanner
              rows={confluence}
              loading={confluenceLoading}
              onSelect={(sym) => setActiveChartSymbol(sym)}
            />
          )}
          {/* Nearest-to-AOI hint when no ACTIVE/PENDING setups exist */}
          {!isLoading && activeCount === 0 && pendingCount === 0 && nearestSetups.length > 0 && (
            <NearestSetupsHint setups={nearestSetups} onSelect={(sym) => setActiveChartSymbol(sym)} />
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2 gap-3">
            {isLoading && signals.length === 0 ? (
              Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
            ) : sortedSignals.length === 0 ? (
              <div className="col-span-full flex flex-col items-center justify-center py-20 text-center">
                <Activity size={32} className="text-slate-700 mb-3" />
                <p className="text-slate-500 text-sm">No signals match this filter</p>
              </div>
            ) : (
              sortedSignals.map((signal) => {
                const series = sparklines[signal.pair];
                const liveTick = series && series.length ? series[series.length - 1] : undefined;
                return (
                  <SignalCard
                    key={signal.id}
                    signal={signal}
                    isCharted={activeChartSymbol === signal.tvSymbol}
                    isRefreshing={isRefreshing}
                    now={now}
                    sparklineData={series}
                    currentPrice={liveTick}
                    positionSize={sizing[signal.pair]}
                    onSelect={() => setActiveChartSymbol(signal.tvSymbol)}
                  />
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Chart panel — desktop only */}
      <div className="hidden xl:flex w-[480px] 2xl:w-[560px] shrink-0 flex-col border-l border-white/[0.06] sticky top-0 h-screen">
        {/* Chart header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-[#0a1120]">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-semibold text-slate-300">Live Chart</span>
          </div>
          <span className="text-xs font-mono text-slate-500">{activeChartSymbol}</span>
        </div>
        {/* Chart */}
        <div className="flex-1 relative">
          {activeChartSymbol && <TradingViewWidget symbol={activeChartSymbol} />}
        </div>
        {/* Checklist overlay */}
        <div className="px-4 py-3 border-t border-white/[0.06] bg-[#0a1120]">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Entry Checklist</div>
          <div className="grid grid-cols-2 gap-1">
            {["AOI pullback", "50 EMA confluence", "Rejection candle", "1:2+ R:R"].map((item) => (
              <div key={item} className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <span className="w-1 h-1 rounded-full bg-emerald-500/70" />
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header KPI tiles
// ---------------------------------------------------------------------------
function KpiTile({
  icon,
  label,
  value,
  tone,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "blue" | "amber" | "slate";
  accent?: boolean;
}) {
  const palette = {
    blue: {
      ring: accent ? "border-blue-500/40 shadow-[0_0_24px_rgba(59,130,246,0.15)]" : "border-white/[0.06]",
      icon: accent ? "text-blue-300" : "text-slate-500",
      value: accent ? "text-blue-300" : "text-slate-300",
      glow: accent ? "bg-blue-500/10" : "bg-white/[0.02]",
    },
    amber: {
      ring: accent ? "border-amber-500/40 shadow-[0_0_24px_rgba(245,158,11,0.12)]" : "border-white/[0.06]",
      icon: accent ? "text-amber-300" : "text-slate-500",
      value: accent ? "text-amber-300" : "text-slate-300",
      glow: accent ? "bg-amber-500/10" : "bg-white/[0.02]",
    },
    slate: {
      ring: "border-white/[0.06]",
      icon: "text-slate-500",
      value: "text-slate-300",
      glow: "bg-white/[0.02]",
    },
  }[tone];
  return (
    <div className={`rounded-xl border ${palette.ring} ${palette.glow} px-3 py-2 transition-all`}>
      <div className="flex items-center justify-between">
        <div className={`text-[9px] uppercase tracking-wider font-semibold flex items-center gap-1 ${palette.icon}`}>
          {icon}
          {label}
        </div>
        {accent && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
      </div>
      <div className={`text-2xl font-bold font-mono mt-0.5 ${palette.value}`}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state — show the closest pairs to their AOIs
// ---------------------------------------------------------------------------
function NearestSetupsHint({
  setups,
  onSelect,
}: {
  setups: Signal[];
  onSelect: (tvSymbol: string) => void;
}) {
  return (
    <div className="mb-4 bg-gradient-to-br from-blue-500/[0.04] to-indigo-500/[0.02] border border-blue-500/15 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Compass size={14} className="text-blue-400" />
        <span className="text-[11px] font-semibold text-blue-300 uppercase tracking-wider">
          Closest to triggering
        </span>
        <span className="text-[10px] text-slate-500 ml-auto">No live trades — these are watching</span>
      </div>
      <div className="space-y-1.5">
        {setups.map((s) => {
          const px = parseFloat(s.price);
          const proximity = s.factors.proximity ?? 0;
          const pct = Math.min(100, Math.max(0, (proximity / 25) * 100));
          return (
            <button
              key={s.id}
              onClick={() => onSelect(s.tvSymbol)}
              className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.04] transition text-left group"
            >
              <span className="text-xs font-bold text-white w-16 shrink-0">{s.pair}</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                s.type === "BUY" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"
              }`}>
                {s.type}
              </span>
              <div className="flex-1 min-w-0">
                <div className="h-1 rounded-full bg-white/[0.04] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-500/60 to-indigo-400/60 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="text-[9px] text-slate-600 mt-0.5 truncate">{s.aoi}</div>
              </div>
              <span className="text-[10px] font-mono text-slate-500 shrink-0">
                @ {px.toFixed(s.pair.includes("JPY") || s.pair === "XAUUSD" ? 2 : 4)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Double-confirmation banner — pairs where Alex G AOI engine and Fabio
// Order-Flow engine agree on direction. These are the highest-conviction
// setups on the desk.
// ---------------------------------------------------------------------------
function DoubleConfirmationBanner({
  rows,
  loading,
  onSelect,
}: {
  rows: ConfluenceRow[];
  loading: boolean;
  onSelect: (tvSymbol: string) => void;
}) {
  return (
    <div className="mb-4 relative overflow-hidden rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/[0.08] via-emerald-500/[0.03] to-transparent shadow-[0_0_40px_rgba(16,185,129,0.08)]">
      {/* shimmer accent */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/60 to-transparent" />
      <div className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
            <ShieldCheck size={14} className="text-emerald-300" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-emerald-200 uppercase tracking-wider">
                Double Confirmation
              </span>
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">
                {rows.length} CONFIRMED
              </span>
              {loading && (
                <RefreshCw size={10} className="text-emerald-400/60 animate-spin" />
              )}
            </div>
            <div className="text-[10px] text-emerald-300/60 mt-0.5">
              Alex G AOI · Fabio Order Flow · same direction
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {rows.map((r) => (
            <button
              key={r.pair}
              onClick={() => onSelect(r.tvSymbol)}
              className="group relative text-left rounded-lg border border-emerald-500/20 bg-[#091a14]/60 hover:bg-emerald-500/[0.06] hover:border-emerald-500/40 transition-all p-3"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-bold text-white">{r.pair}</span>
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      r.alex === "BUY"
                        ? "bg-emerald-500/20 text-emerald-200"
                        : "bg-rose-500/20 text-rose-200"
                    }`}
                  >
                    {r.alex}
                  </span>
                  <span
                    className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                      r.alexStatus === "ACTIVE"
                        ? "bg-blue-500/15 text-blue-300 border-blue-500/30"
                        : "bg-amber-500/10 text-amber-300 border-amber-500/25"
                    }`}
                  >
                    {r.alexStatus}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-slate-500 shrink-0">
                  {Math.round(r.aiConfidence * 100)}%
                </span>
              </div>

              {/* Alex + Fabio confirmation rows */}
              <div className="space-y-1 mb-2">
                <div className="flex items-center gap-2 text-[10px]">
                  <CheckCircle2 size={10} className="text-emerald-400 shrink-0" />
                  <span className="text-slate-400">Alex G</span>
                  <span className="text-slate-600">→</span>
                  <span className="text-emerald-300 font-semibold">{r.alex}</span>
                  <span className="text-slate-600 ml-auto font-mono">AOI engine</span>
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                  <CheckCircle2 size={10} className="text-emerald-400 shrink-0" />
                  <span className="text-slate-400">Fabio</span>
                  <span className="text-slate-600">→</span>
                  <span className="text-emerald-300 font-semibold">{r.fabio ?? "—"}</span>
                  {r.fabioModel && r.fabioModel !== "NONE" && (
                    <span className="text-slate-600 ml-auto font-mono truncate">
                      {r.fabioModel.replace(/_/g, " ").toLowerCase()}
                    </span>
                  )}
                </div>
              </div>

              {/* Levels */}
              <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-emerald-500/10">
                <Level label="Entry" value={r.entry} tone="slate" />
                <Level label="SL" value={r.sl} tone="rose" />
                <Level label="TP" value={r.tp} tone="emerald" />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Level({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
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
      <div className={`text-[11px] font-mono font-semibold mt-0.5 ${colour}`}>{value}</div>
    </div>
  );
}
