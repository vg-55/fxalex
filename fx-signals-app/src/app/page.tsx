"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { AlertTriangle, Maximize2, LineChart, RefreshCw } from "lucide-react";
import TradingViewWidget from "@/components/TradingViewWidget";
import SignalCard from "@/components/SignalCard";
import { useLiveStatus } from "@/lib/live-status";
import { useAccount } from "@/lib/account-context";
import { computeSize } from "@/lib/sizing-client";
import { rowToSignal, type Signal, type StreamSignalRow } from "@/lib/signal-types";

type PriceTickRow = { pair: string; price: number };

function SkeletonCard() {
  return (
    <div className="bg-[#111a2e] border border-[#243049] rounded-2xl p-6 skeleton-shimmer">
      <div className="h-6 w-32 rounded bg-white/5 mb-4" />
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="h-16 rounded bg-white/5" />
        <div className="h-16 rounded bg-white/5" />
        <div className="h-16 rounded bg-white/5" />
      </div>
      <div className="h-14 rounded bg-white/5" />
    </div>
  );
}

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
      pulseTimer = setTimeout(() => setIsRefreshing(false), 500);
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
      const sz = computeSize({
        pair: s.pair,
        equity: settings.equity,
        riskPct: settings.riskPerTradePct,
        entry: parseFloat(s.price),
        sl: parseFloat(s.sl),
      });
      out[s.pair] = { lots: sz.displayLots, pips: sz.pipsRisked, risk: sz.riskDollars };
    }
    return out;
  }, [signals, settings]);

  const relativeTime = (from: Date): string => {
    const seconds = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));
    if (seconds < 5) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto flex flex-col xl:flex-row gap-6 lg:gap-8">
      <div className="flex-1 min-w-0 xl:max-w-[780px]">
        <header className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-white mb-1.5 tracking-tight">
              Live Trading Signals
            </h1>
            <p className="text-sm text-slate-400">
              Set &amp; Forget methodology · 4H AOI · 50 EMA · 1:2+ R:R
            </p>
          </div>
          <div className="flex gap-3">
            <Stat label="Active" value={activeCount} tone="active" />
            <Stat label="Pending" value={pendingCount} tone="pending" />
            {settings && (
              <Stat label="Equity" value={`$${settings.equity.toLocaleString()}`} tone="neutral" />
            )}
          </div>
        </header>

        <div className="mb-5 flex items-center justify-between text-xs text-slate-400 bg-[#111a2e]/70 border border-[#243049] rounded-lg px-3 sm:px-4 py-2">
          <div className="flex items-center gap-3">
            <RefreshCw
              size={13}
              className={isRefreshing ? "animate-spin text-blue-400" : "text-slate-500"}
            />
            <span>
              {lastUpdated ? `Last scan ${relativeTime(lastUpdated)}` : "Waiting for first scan…"}
            </span>
          </div>
          <span className="font-mono text-slate-500">
            {activeProvider ? `live · ${activeProvider}` : "live"}
          </span>
        </div>

        {error && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 mb-5 flex items-start gap-3 anim-fade-in-up">
            <AlertTriangle className="text-rose-400 shrink-0 mt-0.5" size={16} />
            <div className="flex-1">
              <p className="text-rose-200 text-sm">{error}</p>
            </div>
            <button
              onClick={() => location.reload()}
              className="px-2.5 py-1 rounded-md text-xs font-medium bg-rose-500/20 text-rose-200 border border-rose-500/30 hover:bg-rose-500/30 transition"
            >
              Reload
            </button>
          </div>
        )}

        <div className="space-y-4">
          {isLoading && signals.length === 0 ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : (
            signals.map((signal) => (
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

      <div className="xl:w-[500px] 2xl:w-[600px] shrink-0 xl:sticky xl:top-6 xl:h-[calc(100vh-3rem)] bg-[#111a2e] border border-[#243049] rounded-2xl overflow-hidden flex-col hidden lg:flex">
        <div className="p-3.5 border-b border-[#243049] bg-[#0a1020] flex justify-between items-center">
          <h2 className="text-white font-bold flex items-center gap-2 text-sm">
            <LineChart size={16} className="text-blue-400" />
            Live Charting
          </h2>
          <div className="text-[11px] text-slate-400 font-mono">{activeChartSymbol}</div>
        </div>
        <div className="flex-1 bg-[#111a2e] relative min-h-[400px]">
          <TradingViewWidget symbol={activeChartSymbol} />
          <div className="absolute top-3 left-3 pointer-events-none bg-[#0a1020]/90 backdrop-blur border border-[#243049] rounded-md p-2.5 text-[10px] text-slate-300 shadow-xl max-w-[180px]">
            <strong className="text-white block mb-1 flex items-center gap-1">
              <Maximize2 size={10} /> Checklist
            </strong>
            <ul className="space-y-0.5 text-slate-400">
              <li>&#10003; AOI pullback</li>
              <li>&#10003; 50 EMA confluence</li>
              <li>&#10003; Rejection candle</li>
              <li>&#10003; 1:2+ R:R</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: "active" | "pending" | "neutral";
}) {
  const toneCls =
    tone === "active"
      ? "text-blue-300 border-blue-500/30 bg-blue-500/5"
      : tone === "pending"
      ? "text-amber-300 border-amber-500/30 bg-amber-500/5"
      : "text-slate-200 border-[#243049] bg-[#111a2e]";
  return (
    <div className={`border rounded-lg px-3 py-2 text-center min-w-[88px] ${toneCls}`}>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">{label}</div>
      <div className="text-lg font-bold font-mono">{value}</div>
    </div>
  );
}
