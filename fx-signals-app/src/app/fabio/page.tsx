"use client";

import { useEffect, useState } from "react";
import { type FabioAnalysis } from "@/lib/fabio";
import { Activity, Target, Shield, ArrowUpRight, ArrowDownRight, RefreshCw, AlertTriangle } from "lucide-react";
import { clsx } from "clsx";

function FabioCard({ pair }: { pair: string }) {
  const [analysis, setAnalysis] = useState<FabioAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/fabio?pair=${pair}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to fetch data");
      }
      const data = await res.json();
      setAnalysis(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000); // refresh every minute
    return () => clearInterval(interval);
  }, [pair]);

  const decimals = pair.includes("JPY") ? 3 : 5;
  const fmt = (n: number | null | undefined) =>
    n === null || n === undefined ? "—" : n.toFixed(decimals);

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 flex flex-col h-full relative overflow-hidden">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold text-white tracking-tight">{pair}</h2>
          {analysis && (
            <span
              className={clsx(
                "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-md tracking-wide",
                analysis.marketState === "EXPANSION"
                  ? "bg-purple-500/20 text-purple-300"
                  : "bg-zinc-800 text-zinc-400"
              )}
            >
              {analysis.marketState}
            </span>
          )}
          {analysis?.degraded && (
            <span
              title="Range size dropped below 40 ticks due to low volatility (weekend / dead pair)."
              className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 flex items-center gap-1"
            >
              <AlertTriangle className="w-3 h-3" />
              {analysis.appliedRangeTicks}r
            </span>
          )}
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="text-zinc-500 hover:text-white transition-colors"
        >
          <RefreshCw className={clsx("w-4 h-4", loading && "animate-spin")} />
        </button>
      </div>

      {loading && !analysis && (
        <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 space-y-4 py-8">
          <RefreshCw className="w-8 h-8 animate-spin text-zinc-700" />
          <p className="text-sm">Analyzing order flow...</p>
        </div>
      )}

      {error && !loading && !analysis && (
        <div className="flex-1 flex items-center justify-center text-center">
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-sm">
            {error}
          </div>
        </div>
      )}

      {analysis && (
        <div className="flex flex-col flex-1">
          <div className="flex justify-between items-end mb-4">
            <div className="text-3xl font-mono font-bold">
              {analysis.currentPrice.toFixed(decimals)}
            </div>
            <div className={clsx(
              "px-3 py-1 rounded-md font-bold text-xs tracking-wide flex items-center gap-1",
              analysis.signal === "BUY" ? "bg-green-500/20 text-green-400" :
              analysis.signal === "SELL" ? "bg-red-500/20 text-red-400" :
              "bg-zinc-800 text-zinc-400"
            )}>
              {analysis.signal === "BUY" && <ArrowUpRight className="w-3 h-3" />}
              {analysis.signal === "SELL" && <ArrowDownRight className="w-3 h-3" />}
              {analysis.signal}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-4 font-mono text-xs text-center border-y border-zinc-800 py-3">
            <div>
              <div className="text-zinc-500 mb-1">VAH</div>
              <div className={clsx(analysis.currentPrice > analysis.vah ? "text-green-400 font-bold" : "text-zinc-300")}>
                {fmt(analysis.vah)}
              </div>
            </div>
            <div className="border-x border-zinc-800">
              <div className="text-blue-500 mb-1">POC</div>
              <div className="text-white font-bold">{fmt(analysis.poc)}</div>
            </div>
            <div>
              <div className="text-zinc-500 mb-1">VAL</div>
              <div className={clsx(analysis.currentPrice < analysis.val ? "text-red-400 font-bold" : "text-zinc-300")}>
                {fmt(analysis.val)}
              </div>
            </div>
          </div>

          <div
            title="Spot FX has no centralised tape — this is a magnitude-weighted up/down tick proxy, NOT real CVD."
            className="flex justify-between items-center bg-zinc-950 p-2 rounded border border-zinc-800 mb-3"
          >
            <span className="text-xs text-zinc-500 uppercase">Tick-Δ <span className="text-zinc-600 normal-case">(proxy)</span></span>
            <span
              className={clsx(
                "font-mono font-bold text-sm",
                analysis.tickDelta > 0
                  ? "text-green-400"
                  : analysis.tickDelta < 0
                  ? "text-red-400"
                  : "text-zinc-400"
              )}
            >
              {analysis.tickDelta > 0 ? "+" : ""}
              {analysis.tickDelta}
            </span>
          </div>

          {(analysis.ibHigh !== null || analysis.lvns.length > 0) && (
            <div className="grid grid-cols-2 gap-2 mb-3 text-[11px] font-mono">
              <div className="bg-zinc-950 rounded border border-zinc-800 p-2">
                <div className="text-[10px] text-zinc-500 uppercase mb-1">NY IB H/L</div>
                <div className="flex justify-between">
                  <span className="text-zinc-300">{fmt(analysis.ibHigh)}</span>
                  <span className="text-zinc-500">/</span>
                  <span className="text-zinc-300">{fmt(analysis.ibLow)}</span>
                </div>
              </div>
              <div className="bg-zinc-950 rounded border border-zinc-800 p-2">
                <div className="text-[10px] text-zinc-500 uppercase mb-1">LVNs</div>
                <div className="text-zinc-300 truncate">
                  {analysis.lvns.length > 0
                    ? analysis.lvns.slice(0, 2).map((l) => fmt(l.priceLevel)).join(" · ")
                    : "—"}
                </div>
              </div>
            </div>
          )}

          {analysis.aiInterpretation ? (
            <div className="bg-blue-900/10 border border-blue-500/20 rounded-lg p-3 flex-1 flex flex-col">
              <div className="flex justify-between items-center mb-2">
                <h4 className="text-[10px] font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1">
                  <Activity className="w-3 h-3" /> AI Desk
                  {analysis.signalModel !== "NONE" && (
                    <span className="ml-1 text-zinc-500 normal-case font-mono">· {analysis.signalModel.replace(/_/g, " ").toLowerCase()}</span>
                  )}
                </h4>
                {analysis.aiConfidenceScore !== undefined && (
                  <span className={clsx(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded-md",
                    analysis.aiConfidenceScore >= 80 ? "bg-green-500/20 text-green-400" :
                    analysis.aiConfidenceScore >= 50 ? "bg-yellow-500/20 text-yellow-400" :
                    "bg-red-500/20 text-red-400"
                  )}>
                    {analysis.aiConfidenceScore}/100
                  </span>
                )}
              </div>
              <p className="text-zinc-300 text-xs leading-relaxed line-clamp-4 hover:line-clamp-none transition-all">
                {analysis.aiInterpretation}
              </p>
            </div>
          ) : (
            <p className="text-zinc-400 text-sm leading-relaxed border-l-2 border-zinc-700 pl-3 flex-1">
              {analysis.reasoning}
            </p>
          )}

          {(analysis.signal === "BUY" || analysis.signal === "SELL") && (
            <div className="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-zinc-800/50">
              <div className="bg-zinc-800/50 rounded p-2">
                <div className="text-[10px] text-zinc-500 flex items-center gap-1"><Target className="w-3 h-3"/> Target</div>
                <div className="font-mono text-sm text-blue-400">{fmt(analysis.targetPrice)}</div>
              </div>
              <div className="bg-zinc-800/50 rounded p-2">
                <div className="text-[10px] text-zinc-500 flex items-center gap-1"><Shield className="w-3 h-3"/> Micro Stop</div>
                <div className="font-mono text-sm text-red-400">{fmt(analysis.stopLoss)}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function FabioPage() {
  const pairs = ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "USDCAD", "AUDUSD"];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="mb-4">
        <h1 className="text-3xl font-bold tracking-tight">Fabio's 40-Range System</h1>
        <p className="text-zinc-400 mt-1">Live Order Flow & Auction Market Theory</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {pairs.map(pair => (
          <FabioCard key={pair} pair={pair} />
        ))}
      </div>
    </div>
  );
}