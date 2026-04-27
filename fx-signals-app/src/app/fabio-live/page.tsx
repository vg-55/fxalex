"use client";

// Fabio-only live execution lane.
//
// Mirrors the bridge slice of /live-trading but filtered to bridge accounts
// that have FABIO in their `strategies` array. Adding a bridge here pre-pins
// it to ["FABIO"] so the dedicated Fabio fan-out (lib/bridge/fanout.ts ›
// fanOutFabioSignalToBridges) routes Triple-A / LVN-absorption / IB-breakout
// signals to it — and only those.

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Layers,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { type FabioAnalysis } from "@/lib/fabio";

type Mode = "OFF" | "SHADOW" | "LIVE";
type Strategy = "ALEX" | "FABIO" | "COMBINED";

type BridgeAccount = {
  id: string;
  label: string;
  provider: "ctrader" | "mt5";
  accountLogin: string | null;
  brokerName: string | null;
  currency: string | null;
  mode: Mode;
  strategies: Strategy[];
  symbols: string[] | null;
  riskPctPerTrade: number;
  maxConcurrent: number;
  maxDailyLossPct: number;
  maxLot: number;
  minRR: number;
  balance: number | null;
  equity: number | null;
  openPositions: number | null;
  botVersion: string | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  isStale: boolean;
  isPolling: boolean;
  createdAt: string;
};

type OrderRow = {
  id: string;
  status: string;
  symbol: string;
  side: string;
  requestedLot: number;
  filledLot: number | null;
  entry: number;
  sl: number;
  tp: number;
  fillPrice: number | null;
  pnl: number | null;
  rejectionReason: string | null;
  createdAt: string;
  filledAt: string | null;
  closedAt: string | null;
};

const FABIO_PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD"] as const;

// ---------------------------------------------------------------------------

export default function FabioLivePage() {
  const [accounts, setAccounts] = useState<BridgeAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [mintedToken, setMintedToken] = useState<{
    token: string;
    account: BridgeAccount;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/bridge/accounts", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { accounts: BridgeAccount[] };
      // Filter to bridges that subscribe to FABIO (the only signal source the
      // Fabio fan-out queues to). COMBINED-only accounts live on /live-trading.
      const fabioAccounts = json.accounts.filter((a) =>
        a.strategies.includes("FABIO")
      );
      setAccounts(fabioAccounts);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const liveCount = accounts.filter((a) => a.mode === "LIVE").length;

  return (
    <div className="flex h-full min-h-screen flex-col">
      {/* Hero */}
      <div className="sticky top-0 z-20 bg-gradient-to-b from-[#080e1a] to-[#080e1a]/90 backdrop-blur-md border-b border-white/[0.06]">
        <div className="px-4 sm:px-6 pt-4 pb-4 flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-fuchsia-600 flex items-center justify-center shadow-[0_0_24px_rgba(168,85,247,0.3)]">
              <Layers size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-white tracking-tight">
                Fabio Live
              </h1>
              <div className="text-[10px] text-slate-500 font-mono">
                Order-flow lane · {accounts.length} bridge
                {accounts.length === 1 ? "" : "s"}
                {liveCount > 0 && (
                  <span className="ml-1.5 text-purple-300">
                    · {liveCount} LIVE
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/15 text-purple-300 border border-purple-500/30 hover:bg-purple-500/25 text-xs font-semibold"
          >
            <Plus size={13} />
            Add Fabio Bridge
          </button>
        </div>
      </div>

      <div className="px-4 sm:px-6 pt-4 text-[11px] text-slate-400 leading-relaxed bg-purple-500/[0.03] border-y border-purple-500/[0.08] py-3">
        <span className="text-purple-300 font-semibold">
          Fabio-only execution lane.
        </span>{" "}
        Bridges added here run the Triple-A 80% rule, LVN absorption squeeze
        and NY Initial-Balance breakout models. The Alex G AOI engine is
        excluded — those signals route through{" "}
        <a className="underline hover:text-white" href="/live-trading">
          /live-trading
        </a>{" "}
        instead.
      </div>

      {error && (
        <div className="mx-4 sm:mx-6 mt-4 bg-rose-500/8 border border-rose-500/20 rounded-xl p-3 flex items-center gap-3">
          <AlertCircle className="text-rose-400 shrink-0" size={15} />
          <p className="text-rose-300 text-xs flex-1">{error}</p>
          <button
            onClick={load}
            className="text-xs px-2.5 py-1 rounded-md bg-rose-500/15 text-rose-300 border border-rose-500/25 hover:bg-rose-500/20"
          >
            Retry
          </button>
        </div>
      )}

      <div className="flex-1 grid grid-cols-1 xl:grid-cols-[1fr,420px] gap-4 p-4 sm:p-6 min-h-0">
        {/* Left: bridges + orders */}
        <div className="space-y-3 min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-1">
            Bridges
          </div>
          {loading && accounts.length === 0 ? (
            Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="h-32 rounded-xl bg-white/[0.02] border border-white/[0.04] animate-pulse"
              />
            ))
          ) : accounts.length === 0 ? (
            <EmptyState onAdd={() => setShowAdd(true)} />
          ) : (
            accounts.map((a) => (
              <FabioBridgeCard
                key={a.id}
                account={a}
                onChange={load}
              />
            ))
          )}
        </div>

        {/* Right: live Fabio analysis snapshot */}
        <div className="space-y-3 min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-1">
            Live Fabio signals
          </div>
          <div className="grid grid-cols-1 gap-3">
            {FABIO_PAIRS.map((p) => (
              <FabioMiniCard key={p} pair={p} />
            ))}
          </div>
        </div>
      </div>

      {showAdd && (
        <AddFabioBridgeModal
          onClose={() => setShowAdd(false)}
          onCreated={(account, token) => {
            setShowAdd(false);
            setMintedToken({ account, token });
            load();
          }}
        />
      )}
      {mintedToken && (
        <BridgeTokenModal
          account={mintedToken.account}
          token={mintedToken.token}
          onClose={() => setMintedToken(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-purple-500/20 bg-purple-500/[0.02] p-8 text-center">
      <Layers size={32} className="mx-auto text-purple-400/60 mb-3" />
      <div className="text-sm font-semibold text-slate-300 mb-1">
        No Fabio bridge yet
      </div>
      <div className="text-xs text-slate-500 mb-4 max-w-sm mx-auto leading-relaxed">
        Add a bridge to route Fabio order-flow signals to your cBot or MT5 EA.
        It&apos;ll be locked to the Fabio strategy — Alex G signals stay on
        /live-trading.
      </div>
      <button
        onClick={onAdd}
        className="text-xs px-3 py-1.5 rounded-lg bg-purple-500/15 text-purple-300 border border-purple-500/30 hover:bg-purple-500/25 inline-flex items-center gap-1.5"
      >
        <Plus size={12} />
        Add your first Fabio bridge
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function FabioBridgeCard({
  account,
  onChange,
}: {
  account: BridgeAccount;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [showOrders, setShowOrders] = useState(false);

  const loadOrders = useCallback(async () => {
    try {
      const res = await fetch(`/api/bridge/accounts/${account.id}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const j = (await res.json()) as { recentOrders: OrderRow[] };
      setOrders(j.recentOrders);
    } catch {
      // non-fatal
    }
  }, [account.id]);

  useEffect(() => {
    if (showOrders && orders === null) loadOrders();
  }, [showOrders, orders, loadOrders]);

  async function setMode(mode: Mode) {
    if (mode === "LIVE" && account.mode !== "LIVE") {
      const ok = confirm(
        `Set "${account.label}" to LIVE? Fabio order-flow signals will route real orders to ${account.brokerName ?? account.provider}.`
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      await fetch(`/api/bridge/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (
      !confirm(
        `Delete bridge "${account.label}"? Pending Fabio orders will be cancelled.`
      )
    )
      return;
    setBusy(true);
    try {
      await fetch(`/api/bridge/accounts/${account.id}`, { method: "DELETE" });
      onChange();
    } finally {
      setBusy(false);
    }
  }

  const dot = account.isStale
    ? "bg-rose-500"
    : account.isPolling
    ? "bg-emerald-400 animate-pulse"
    : "bg-amber-400";

  return (
    <div className="rounded-xl border border-purple-500/15 bg-purple-500/[0.02] overflow-hidden">
      {/* Header */}
      <div className="p-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
            <div className="text-sm font-bold text-white truncate">
              {account.label}
            </div>
            <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300">
              {account.provider}
            </span>
            <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-200 border border-purple-500/25">
              FABIO
            </span>
          </div>
          <div className="text-[10px] text-slate-500 font-mono truncate mt-1">
            {account.brokerName ?? "—"}
            {account.accountLogin ? ` · #${account.accountLogin}` : ""}
            {account.botVersion ? ` · v${account.botVersion}` : ""}
          </div>
          {account.balance != null && (
            <div className="text-[10px] text-slate-400 mt-1">
              {account.balance.toFixed(2)} {account.currency ?? ""}
              {account.equity != null && account.equity !== account.balance && (
                <span className="text-slate-500">
                  {" "}
                  · eq {account.equity.toFixed(2)}
                </span>
              )}
              {account.openPositions != null &&
                account.openPositions > 0 && (
                  <span className="text-purple-300">
                    {" "}
                    · {account.openPositions} open
                  </span>
                )}
            </div>
          )}
          {account.isStale && (
            <div className="text-[10px] text-rose-400 mt-1">
              No heartbeat &gt;5min — fan-out paused
            </div>
          )}
          {account.lastError && (
            <div className="text-[10px] text-rose-400 mt-1 line-clamp-2">
              {account.lastError}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5 items-end shrink-0">
          <div className="flex gap-1">
            {(["OFF", "SHADOW", "LIVE"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                disabled={busy || account.mode === m}
                className={`text-[9px] font-bold px-2 py-1 rounded border transition ${
                  account.mode === m
                    ? m === "LIVE"
                      ? "bg-emerald-500/20 text-emerald-200 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.25)]"
                      : m === "SHADOW"
                      ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                      : "bg-slate-500/15 text-slate-400 border-slate-500/30"
                    : "bg-white/[0.03] text-slate-500 border-white/10 hover:text-white"
                } disabled:opacity-100 disabled:cursor-default`}
              >
                {m}
              </button>
            ))}
          </div>
          <button
            onClick={remove}
            disabled={busy}
            className="text-[10px] px-2 py-1 rounded-md bg-rose-500/10 text-rose-300 border border-rose-500/20 hover:bg-rose-500/20 disabled:opacity-50"
            title="Delete bridge"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {/* Risk row */}
      <div className="px-3 pb-3 grid grid-cols-4 gap-2 text-[10px]">
        <Mini label="Risk/trade" value={`${account.riskPctPerTrade}%`} />
        <Mini label="Max conc." value={String(account.maxConcurrent)} />
        <Mini label="Daily loss" value={`${account.maxDailyLossPct}%`} />
        <Mini label="Min R:R" value={account.minRR.toFixed(1)} />
      </div>

      {/* Orders toggle */}
      <button
        onClick={() => setShowOrders((v) => !v)}
        className="w-full px-3 py-1.5 text-[10px] uppercase tracking-wider font-semibold text-slate-500 hover:text-slate-300 border-t border-white/[0.04] flex items-center justify-between"
      >
        <span>Fabio orders</span>
        <span className="text-slate-600 font-mono">
          {showOrders ? "− hide" : "+ show"}
        </span>
      </button>
      {showOrders && (
        <div className="border-t border-white/[0.04] p-3 bg-black/20">
          <FabioOrdersTable orders={orders} onRefresh={loadOrders} />
        </div>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/[0.04] bg-white/[0.02] px-2 py-1.5">
      <div className="text-[8px] uppercase tracking-wider text-slate-600 font-semibold">
        {label}
      </div>
      <div className="font-mono text-slate-200 text-[11px]">{value}</div>
    </div>
  );
}

function FabioOrdersTable({
  orders,
  onRefresh,
}: {
  orders: OrderRow[] | null;
  onRefresh: () => void;
}) {
  if (orders === null) return <div className="text-[10px] text-slate-600">Loading…</div>;
  if (orders.length === 0)
    return (
      <div className="text-[11px] text-slate-600 text-center py-3">
        No Fabio orders queued yet. They appear here as soon as a Triple-A,
        LVN absorption or IB-breakout signal fires.
      </div>
    );

  // Recent orders endpoint isn't filtered by source; we show all bridge
  // orders here since this account is FABIO-only their source will be FABIO.
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] text-slate-600 font-mono">
          {orders.length} recent
        </div>
        <button
          onClick={onRefresh}
          className="text-[10px] text-slate-500 hover:text-white inline-flex items-center gap-1"
        >
          <RefreshCw size={10} /> refresh
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] font-mono">
          <thead>
            <tr className="text-slate-500 text-left">
              <th className="py-1 pr-2 font-semibold">When</th>
              <th className="py-1 pr-2 font-semibold">Pair</th>
              <th className="py-1 pr-2 font-semibold">Side</th>
              <th className="py-1 pr-2 font-semibold text-right">Lot</th>
              <th className="py-1 pr-2 font-semibold text-right">Entry</th>
              <th className="py-1 pr-2 font-semibold text-right">SL</th>
              <th className="py-1 pr-2 font-semibold text-right">TP</th>
              <th className="py-1 pr-2 font-semibold">Status</th>
              <th className="py-1 pr-2 font-semibold text-right">P&L</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-t border-white/[0.04]">
                <td className="py-1 pr-2 text-slate-500">
                  {new Date(o.createdAt).toLocaleTimeString()}
                </td>
                <td className="py-1 pr-2 text-white">{o.symbol}</td>
                <td
                  className={`py-1 pr-2 font-bold ${
                    o.side === "BUY" ? "text-emerald-300" : "text-rose-300"
                  }`}
                >
                  {o.side}
                </td>
                <td className="py-1 pr-2 text-right text-slate-300">
                  {o.filledLot ?? o.requestedLot}
                </td>
                <td className="py-1 pr-2 text-right text-slate-300">
                  {o.entry}
                </td>
                <td className="py-1 pr-2 text-right text-rose-200">{o.sl}</td>
                <td className="py-1 pr-2 text-right text-emerald-200">
                  {o.tp}
                </td>
                <td className="py-1 pr-2">
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-white/5 text-slate-300 border-white/10">
                    {o.status}
                  </span>
                </td>
                <td
                  className={`py-1 pr-2 text-right ${
                    o.pnl == null
                      ? "text-slate-600"
                      : o.pnl >= 0
                      ? "text-emerald-300"
                      : "text-rose-300"
                  }`}
                >
                  {o.pnl == null ? "—" : o.pnl.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live Fabio per-pair miniature (just signal/model + entry zone).
// ---------------------------------------------------------------------------
function FabioMiniCard({ pair }: { pair: string }) {
  const [a, setA] = useState<FabioAnalysis | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const fetchOnce = async () => {
      try {
        const res = await fetch(`/api/fabio?pair=${pair}`, { cache: "no-store" });
        if (!res.ok) {
          if (alive) setA(null);
          return;
        }
        const j = (await res.json()) as FabioAnalysis;
        if (alive) setA(j);
      } catch {
        if (alive) setA(null);
      } finally {
        if (alive) setLoading(false);
      }
    };
    fetchOnce();
    const id = setInterval(fetchOnce, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pair]);

  const decimals = pair.includes("JPY") ? 3 : pair === "XAUUSD" ? 2 : 5;
  const fmt = (n: number | null | undefined) =>
    n == null ? "—" : n.toFixed(decimals);

  const sigTone =
    a?.signal === "BUY"
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
      : a?.signal === "SELL"
      ? "bg-rose-500/15 text-rose-300 border-rose-500/30"
      : "bg-slate-500/10 text-slate-500 border-slate-500/20";

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-sm font-bold text-white">{pair}</div>
        <span
          className={`text-[9px] font-bold px-1.5 py-0.5 rounded border inline-flex items-center gap-1 ${sigTone}`}
        >
          {a?.signal === "BUY" && <ArrowUpRight size={10} />}
          {a?.signal === "SELL" && <ArrowDownRight size={10} />}
          {a?.signal ?? (loading ? "…" : "—")}
        </span>
      </div>
      {a && a.signal !== "NEUTRAL" ? (
        <>
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[10px] text-purple-300 font-mono">
              {a.signalModel.replace(/_/g, " ")}
            </div>
            {(() => {
              if (
                a.entryPrice == null ||
                a.stopLoss == null ||
                a.targetPrice == null
              )
                return null;
              const stop = Math.abs(a.entryPrice - a.stopLoss);
              const reward = Math.abs(a.targetPrice - a.entryPrice);
              const rr = stop > 0 ? reward / stop : 0;
              const dirOk =
                a.signal === "BUY"
                  ? a.targetPrice > a.entryPrice && a.stopLoss < a.entryPrice
                  : a.targetPrice < a.entryPrice && a.stopLoss > a.entryPrice;
              const tone = !dirOk
                ? "bg-rose-500/15 text-rose-300 border-rose-500/30"
                : rr >= 1.5
                ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                : "bg-amber-500/15 text-amber-300 border-amber-500/30";
              const label = !dirOk ? "BAD GEOM" : `RR ${rr.toFixed(2)}`;
              return (
                <span
                  className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${tone}`}
                  title={
                    !dirOk
                      ? "TP/SL on wrong side of entry — fan-out will reject."
                      : rr < 1.5
                      ? "Below typical bridge minRR (1.5) — fan-out will skip."
                      : "Will queue if all gates pass."
                  }
                >
                  {label}
                </span>
              );
            })()}
          </div>
          <div className="grid grid-cols-3 gap-2 text-[10px] font-mono">
            <KV label="Entry" value={fmt(a.entryPrice)} tone="white" />
            <KV label="SL" value={fmt(a.stopLoss)} tone="rose" />
            <KV label="TP" value={fmt(a.targetPrice)} tone="emerald" />
          </div>
        </>
      ) : (
        <div className="text-[10px] text-slate-600 leading-relaxed">
          {a?.reasoning ?? (loading ? "Analysing…" : "No tick data")}
        </div>
      )}
      {a && (
        <div className="mt-2 pt-2 border-t border-white/[0.04] flex items-center justify-between text-[9px] font-mono text-slate-600">
          <span>{a.marketState}</span>
          <span>POC {fmt(a.poc)}</span>
          <span>VA {fmt(a.val)}–{fmt(a.vah)}</span>
        </div>
      )}
    </div>
  );
}

function KV({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "white" | "rose" | "emerald";
}) {
  const colour =
    tone === "rose"
      ? "text-rose-200"
      : tone === "emerald"
      ? "text-emerald-200"
      : "text-white";
  return (
    <div>
      <div className="text-[8px] uppercase tracking-wider text-slate-600 font-semibold">
        {label}
      </div>
      <div className={colour}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add-bridge modal — same schema as /live-trading but pins strategies=["FABIO"]
// so the new bridge ends up on this lane only.
// ---------------------------------------------------------------------------
function AddFabioBridgeModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (a: BridgeAccount, token: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [provider, setProvider] = useState<"ctrader" | "mt5">("mt5");
  const [accountLogin, setAccountLogin] = useState("");
  const [brokerName, setBrokerName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/bridge/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: label.trim(),
          provider,
          accountLogin: accountLogin.trim() || null,
          brokerName: brokerName.trim() || null,
          strategies: ["FABIO"],
        }),
      });
      const j = (await res.json()) as {
        account?: BridgeAccount;
        token?: string;
        error?: string;
      };
      if (!res.ok || !j.account || !j.token)
        throw new Error(j.error ?? `HTTP ${res.status}`);
      onCreated(j.account, j.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="bg-[#0c1322] border border-purple-500/30 rounded-2xl p-5 w-full max-w-md shadow-2xl"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Layers size={14} className="text-purple-300" />
            Add Fabio bridge
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <Field label="Label">
            <input
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={64}
              placeholder="e.g. IC Markets cBot · Fabio"
              className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
            />
          </Field>

          <Field label="Provider">
            <select
              value={provider}
              onChange={(e) =>
                setProvider(e.target.value as "ctrader" | "mt5")
              }
              className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="mt5">MT5 — Expert Advisor</option>
              <option value="ctrader">cTrader — cBot</option>
            </select>
          </Field>

          <Field label="Broker (optional)">
            <input
              value={brokerName}
              onChange={(e) => setBrokerName(e.target.value)}
              maxLength={64}
              placeholder="IC Markets"
              className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
            />
          </Field>

          <Field label="Account # (optional)">
            <input
              value={accountLogin}
              onChange={(e) => setAccountLogin(e.target.value)}
              maxLength={32}
              placeholder="123456"
              className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
            />
          </Field>

          <div className="text-[11px] text-purple-200/80 bg-purple-500/[0.06] rounded-lg p-2.5 leading-relaxed border border-purple-500/15">
            <span className="font-semibold text-purple-200">
              Strategy lock:
            </span>{" "}
            this bridge is pinned to{" "}
            <span className="font-mono">FABIO</span>. It will only receive
            Triple-A / LVN absorption / IB-breakout orders. Default mode is{" "}
            <span className="font-mono">OFF</span> until you flip it.
          </div>

          {error && (
            <div className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !label.trim()}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-500/20 text-purple-200 border border-purple-500/30 hover:bg-purple-500/30 disabled:opacity-50"
          >
            {busy ? "Minting…" : "Mint Fabio token"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

// ---------------------------------------------------------------------------

function BridgeTokenModal({
  account,
  token,
  onClose,
}: {
  account: BridgeAccount;
  token: string;
  onClose: () => void;
}) {
  const [reveal, setReveal] = useState(true);
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0c1322] border border-purple-500/30 rounded-2xl p-5 w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <ShieldCheck size={15} className="text-purple-300" />
            Save this token now
          </h2>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300"
          >
            <X size={16} />
          </button>
        </div>

        <div className="text-[12px] text-purple-200 bg-purple-500/10 border border-purple-500/30 rounded-lg p-2.5 mb-3 leading-relaxed">
          Bearer token shown <strong>only once</strong>. Only a SHA-256 hash
          is stored. Lose it → rotate via the API.
        </div>

        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
          Bridge: {account.label} ({account.provider}) · FABIO
        </div>

        <div className="flex items-stretch gap-2">
          <code className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 font-mono text-[11px] text-purple-200 break-all">
            {reveal ? token : "•".repeat(Math.min(token.length, 48))}
          </code>
          <button
            onClick={() => setReveal((v) => !v)}
            title={reveal ? "Hide" : "Show"}
            className="px-2 rounded-lg bg-white/[0.03] border border-white/10 text-slate-400 hover:text-white"
          >
            {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button
            onClick={copy}
            className="px-3 rounded-lg bg-purple-500/20 text-purple-200 border border-purple-500/30 hover:bg-purple-500/30 text-xs font-semibold inline-flex items-center gap-1.5"
          >
            {copied ? (
              <>
                <CheckCircle2 size={12} /> Copied
              </>
            ) : (
              "Copy"
            )}
          </button>
        </div>

        <div className="text-[11px] text-slate-400 mt-3 leading-relaxed">
          Paste this into your bot&apos;s configuration alongside the API base
          URL. The bot will then call{" "}
          <code className="text-slate-300">/api/bridge/poll</code> every 10s
          and receive Fabio orders only.
        </div>

        <div className="flex justify-end mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-500/20 text-purple-200 border border-purple-500/30 hover:bg-purple-500/30 inline-flex items-center gap-1"
          >
            <Save size={12} />
            I saved it
          </button>
        </div>
      </div>
    </div>
  );
}
