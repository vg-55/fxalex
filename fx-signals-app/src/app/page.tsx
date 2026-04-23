"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { AlertTriangle, RefreshCw, Activity, TrendingUp, TrendingDown } from "lucide-react";
import TradingViewWidget from "@/components/TradingViewWidget";
import SignalCard from "@/components/SignalCard";
import { useLiveStatus } from "@/lib/live-status";
import { useAccount } from "@/lib/account-context";
import { computeSize } from "@/lib/sizing-client";
import { rowToSignal, type Signal, type StreamSignalRow } from "@/lib/signal-types";

type PriceTickRow = { pair: string; price: number };

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
  const [activeChartSymbol, setActiveChartSymbol] = useState("OANDA:XAUUSD");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");
  const { setStatus } = useLiveStatus();
  const { settings } = useAccount();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setStatus("loading");
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
  }, [setStatus]);

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

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const activeCount = signals.filter((s) => s.status === "ACTIVE").length;
  const pendingCount = signals.filter((s) => s.status === "PENDING").length;

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

  return (
    <div className="flex h-full min-h-screen">
      {/* Signals panel */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Page header */}
        <div className="sticky top-0 z-20 bg-[#080e1a]/90 backdrop-blur-md border-b border-white/[0.06] px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h1 className="text-sm font-bold text-white">Live Signals</h1>
              {/* Stats pills */}
              <div className="hidden sm:flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                  {activeCount} Active
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold">
                  {pendingCount} Pending
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <RefreshCw
                size={11}
                className={isRefreshing ? "animate-spin text-blue-400" : "text-slate-600"}
              />
              <span className="hidden sm:inline">
                {lastUpdated ? relativeTime(lastUpdated) : "waiting…"}
              </span>
              {activeProvider && (
                <span className="hidden sm:inline font-mono text-slate-600">· {activeProvider}</span>
              )}
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-1 mt-2.5">
            {(["all", "active", "pending"] as FilterTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setFilter(tab)}
                className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition-colors ${
                  filter === tab
                    ? "bg-white/[0.08] text-white"
                    : "text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]"
                }`}
              >
                {tab === "all" ? `All (${signals.length})` : tab === "active" ? `Active (${activeCount})` : `Pending (${pendingCount})`}
              </button>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 sm:mx-6 mt-4 bg-rose-500/8 border border-rose-500/20 rounded-xl p-3 flex items-center gap-3">
            <AlertTriangle className="text-rose-400 shrink-0" size={15} />
            <p className="text-rose-300 text-xs flex-1">{error}</p>
            <button
              onClick={() => location.reload()}
              className="text-xs px-2.5 py-1 rounded-md bg-rose-500/15 text-rose-300 border border-rose-500/25 hover:bg-rose-500/20 transition"
            >
              Reload
            </button>
          </div>
        )}

        {/* Signal grid */}
        <div className="flex-1 p-4 sm:p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2 gap-3">
            {isLoading && signals.length === 0 ? (
              Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
            ) : sortedSignals.length === 0 ? (
              <div className="col-span-full flex flex-col items-center justify-center py-20 text-center">
                <Activity size={32} className="text-slate-700 mb-3" />
                <p className="text-slate-500 text-sm">No signals match this filter</p>
              </div>
            ) : (
              sortedSignals.map((signal) => (
                <SignalCard
                  key={signal.id}
                  signal={signal}
                  isCharted={activeChartSymbol === signal.tvSymbol}
                  isRefreshing={isRefreshing}
                  now={now}
                  sparklineData={sparklines[signal.pair]}
                  positionSize={sizing[signal.pair]}
                  onSelect={() => setActiveChartSymbol(signal.tvSymbol)}
                />
              ))
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
          <TradingViewWidget symbol={activeChartSymbol} />
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
