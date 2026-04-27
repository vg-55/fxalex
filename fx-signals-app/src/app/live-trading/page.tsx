"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Briefcase,
  Plus,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Trash2,
  Wallet,
  Activity,
  ShieldCheck,
  Target,
  Layers,
  Power,
  PowerOff,
  Beaker,
  Zap,
  X,
  Save,
  Eye,
  EyeOff,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Public types (mirror /api/live/accounts payload)
// ---------------------------------------------------------------------------
type Mode = "OFF" | "SHADOW" | "LIVE";
type Strategy = "ALEX" | "FABIO" | "COMBINED";

type Account = {
  id: string;
  label: string;
  broker: string | null;
  server: string;
  login: string;
  metaapiAccountId: string | null;
  metaapiRegion: string;
  metaapiState: string | null;
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
  margin: number | null;
  marginLevel: number | null;
  currency: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type OrderRow = {
  id: string;
  status: string;
  signalSource: string;
  signalType: string;
  symbol: string;
  side: string;
  requestedLot: number;
  filledLot: number | null;
  entry: number;
  sl: number;
  tp: number;
  pnl: number | null;
  rejectionReason: string | null;
  createdAt: string;
  closedAt: string | null;
};

type AuditRow = {
  id: number;
  level: string;
  event: string;
  detail: unknown;
  at: string;
};

type Tab = "overview" | "risk" | "strategy" | "orders" | "audit";

type CtraderAccount = {
  id: string;
  label: string;
  ctidTraderAccountId: string;
  traderLogin: string | null;
  brokerName: string | null;
  isLive: boolean;
  tokenExpiresAt: string;
  mode: Mode;
  strategies: Strategy[];
  balance: number | null;
  equity: number | null;
  currency: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  enabled: boolean;
  createdAt: string;
};

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
  symbolOverrides: Record<string, string> | null;
  riskPctPerTrade: number;
  maxConcurrent: number;
  maxDailyLossPct: number;
  maxLot: number;
  minRR: number;
  balance: number | null;
  equity: number | null;
  marginLevel: number | null;
  openPositions: number | null;
  botVersion: string | null;
  lastPolledAt: string | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  enabled: boolean;
  isStale: boolean;
  isPolling: boolean;
  createdAt: string;
  updatedAt: string;
};

const STRATEGY_META: Record<Strategy, { label: string; icon: React.ReactNode; tone: string }> = {
  ALEX: { label: "Alex G", icon: <Target size={14} />, tone: "blue" },
  FABIO: { label: "Fabio", icon: <Layers size={14} />, tone: "purple" },
  COMBINED: { label: "Combined", icon: <ShieldCheck size={14} />, tone: "emerald" },
};

const REGIONS = ["new-york", "london", "singapore"];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function LiveTradingPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [ctraderAccounts, setCtraderAccounts] = useState<CtraderAccount[]>([]);
  const [ctraderConfigured, setCtraderConfigured] = useState(true);
  const [bridgeAccounts, setBridgeAccounts] = useState<BridgeAccount[]>([]);
  const [showAddBridge, setShowAddBridge] = useState(false);
  const [mintedToken, setMintedToken] = useState<{ token: string; account: BridgeAccount } | null>(null);
  const [configured, setConfigured] = useState<{ crypto: boolean; metaapi: boolean }>({
    crypto: true,
    metaapi: true,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/live/accounts", { cache: "no-store" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        accounts: Account[];
        configured: { crypto: boolean; metaapi: boolean };
      };
      setAccounts(json.accounts);
      setConfigured(json.configured);
      // Auto-select first account; also clear selection if it points at a row
      // that no longer exists (deletion) so the right pane stays in sync.
      setSelectedId((cur) => {
        if (cur && json.accounts.some((a) => a.id === cur)) return cur;
        return json.accounts[0]?.id ?? null;
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load error");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCtrader = useCallback(async () => {
    try {
      const res = await fetch("/api/ctrader/accounts", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as {
        accounts: CtraderAccount[];
        configured: { crypto: boolean; ctrader: boolean };
      };
      setCtraderAccounts(json.accounts);
      setCtraderConfigured(json.configured.ctrader);
    } catch {
      // Non-fatal — cTrader panel is optional.
    }
  }, []);

  const loadBridge = useCallback(async () => {
    try {
      const res = await fetch("/api/bridge/accounts", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { accounts: BridgeAccount[] };
      setBridgeAccounts(json.accounts);
    } catch {
      // Non-fatal.
    }
  }, []);

  useEffect(() => {
    load();
    loadCtrader();
    loadBridge();
    const id = setInterval(() => {
      load();
      loadCtrader();
      loadBridge();
    }, 30_000);
    return () => clearInterval(id);
  }, [load, loadCtrader, loadBridge]);

  const selected = accounts.find((a) => a.id === selectedId) ?? null;
  const liveCount = accounts.filter((a) => a.mode === "LIVE").length;

  return (
    <div className="flex h-full min-h-screen flex-col">
      {/* Hero */}
      <div className="sticky top-0 z-20 bg-gradient-to-b from-[#080e1a] to-[#080e1a]/90 backdrop-blur-md border-b border-white/[0.06]">
        <div className="px-4 sm:px-6 pt-4 pb-4 flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-rose-600 flex items-center justify-center shadow-[0_0_24px_rgba(244,63,94,0.25)]">
              <Briefcase size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-white tracking-tight">Live Trading</h1>
              <div className="text-[10px] text-slate-500 font-mono">
                MT5 · {accounts.length} account{accounts.length === 1 ? "" : "s"}
                {liveCount > 0 && (
                  <span className="ml-1.5 text-rose-300">· {liveCount} LIVE</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {liveCount > 0 && <PauseAllButton accounts={accounts} onDone={load} />}
            <button
              onClick={() => {
                window.location.href = "/api/ctrader/auth/start";
              }}
              disabled={!ctraderConfigured}
              title={ctraderConfigured ? "Connect cTrader account via OAuth" : "CTRADER_CLIENT_ID not configured"}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Zap size={13} />
              Connect cTrader
            </button>
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/15 text-blue-300 border border-blue-500/30 hover:bg-blue-500/25 text-xs font-semibold"
            >
              <Plus size={13} />
              Add MT5
            </button>
            <button
              onClick={() => setShowAddBridge(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 text-xs font-semibold"
              title="Self-hosted bot bridge (cBot or MT5 EA on your VPS)"
            >
              <Plus size={13} />
              Add Bridge
            </button>
          </div>
        </div>
      </div>

      {/* Config warnings */}
      {(!configured.crypto || !configured.metaapi) && (
        <div className="mx-4 sm:mx-6 mt-4 bg-amber-500/8 border border-amber-500/30 rounded-xl p-3">
          <div className="flex items-center gap-2 text-amber-300 text-xs font-semibold mb-1">
            <AlertCircle size={14} /> Setup required
          </div>
          <ul className="text-[11px] text-amber-200/70 space-y-0.5 list-disc ml-5">
            {!configured.crypto && (
              <li>
                <code className="text-amber-300">MT5_ENCRYPTION_KEY</code> not set — generate one
                with{" "}
                <code className="text-amber-300">
                  node -e &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;base64&apos;))&quot;
                </code>
              </li>
            )}
            {!configured.metaapi && (
              <li>
                <code className="text-amber-300">METAAPI_TOKEN</code> not set — sign up at{" "}
                <a className="underline" href="https://app.metaapi.cloud/token" target="_blank" rel="noreferrer">
                  app.metaapi.cloud/token
                </a>
              </li>
            )}
          </ul>
        </div>
      )}

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

      <CtraderToast />

      {/* Body */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[320px,1fr] gap-4 p-4 sm:p-6 min-h-0">
        {/* Account list */}
        <div className="space-y-2">
          {loading && accounts.length === 0 ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-24 rounded-xl bg-white/[0.02] border border-white/[0.04] animate-pulse"
              />
            ))
          ) : accounts.length === 0 ? (
            <EmptyState onAdd={() => setShowAdd(true)} />
          ) : (
            accounts.map((a) => (
              <AccountListItem
                key={a.id}
                account={a}
                active={a.id === selectedId}
                onSelect={() => setSelectedId(a.id)}
              />
            ))
          )}

          <CtraderPanel accounts={ctraderAccounts} onChange={loadCtrader} />
          <BridgePanel
            accounts={bridgeAccounts}
            onChange={loadBridge}
            onAdd={() => setShowAddBridge(true)}
          />
        </div>

        {/* Detail panel */}
        <div className="min-w-0">
          {selected ? (
            <DetailPanel account={selected} tab={tab} setTab={setTab} onChange={load} />
          ) : (
            !loading && accounts.length === 0 ? null : (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.01] p-12 text-center text-slate-600 text-sm">
                Select an account
              </div>
            )
          )}
        </div>
      </div>

      {showAdd && (
        <AddAccountModal
          onClose={() => setShowAdd(false)}
          onCreated={(a) => {
            setShowAdd(false);
            setSelectedId(a.id);
            load();
          }}
        />
      )}
      {showAddBridge && (
        <AddBridgeModal
          onClose={() => setShowAddBridge(false)}
          onCreated={(account, token) => {
            setShowAddBridge(false);
            setMintedToken({ account, token });
            loadBridge();
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
// Empty state
// ---------------------------------------------------------------------------
function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.01] p-8 text-center">
      <Wallet size={32} className="mx-auto text-slate-600 mb-3" />
      <div className="text-sm font-semibold text-slate-300 mb-1">No MT5 accounts yet</div>
      <div className="text-xs text-slate-600 mb-4">
        Connect a broker account to start running strategies live.
      </div>
      <button
        onClick={onAdd}
        className="text-xs px-3 py-1.5 rounded-lg bg-blue-500/15 text-blue-300 border border-blue-500/30 hover:bg-blue-500/25"
      >
        + Add your first account
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account list item
// ---------------------------------------------------------------------------
function AccountListItem({
  account,
  active,
  onSelect,
}: {
  account: Account;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-xl border p-3 transition-all ${
        active
          ? "border-blue-500/40 bg-blue-500/[0.06] shadow-[0_0_24px_rgba(59,130,246,0.12)]"
          : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="text-sm font-bold text-white truncate">{account.label}</div>
          <div className="text-[10px] text-slate-500 font-mono truncate">
            {account.broker ?? account.server} · #{account.login}
          </div>
        </div>
        <ModeBadge mode={account.mode} />
      </div>
      <div className="flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-1.5">
          {account.strategies.map((s) => (
            <StrategyChip key={s} strategy={s} />
          ))}
        </div>
        <div className="font-mono text-slate-400">
          {account.equity != null
            ? `${account.equity.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${account.currency ?? ""}`
            : "—"}
        </div>
      </div>
      {account.lastError && (
        <div className="mt-1.5 text-[9px] text-rose-400 flex items-center gap-1 truncate">
          <AlertCircle size={9} /> {account.lastError}
        </div>
      )}
    </button>
  );
}

function ModeBadge({ mode }: { mode: Mode }) {
  const styles: Record<Mode, string> = {
    OFF: "bg-slate-500/15 text-slate-400 border-slate-500/25",
    SHADOW: "bg-amber-500/10 text-amber-300 border-amber-500/25",
    LIVE: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.25)]",
  };
  return (
    <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${styles[mode]} inline-flex items-center gap-1`}>
      {mode === "LIVE" && <span className="w-1 h-1 rounded-full bg-emerald-300 animate-pulse" />}
      {mode}
    </span>
  );
}

function StrategyChip({ strategy }: { strategy: Strategy }) {
  const meta = STRATEGY_META[strategy];
  const tones: Record<string, string> = {
    blue: "bg-blue-500/10 text-blue-300 border-blue-500/25",
    purple: "bg-purple-500/10 text-purple-300 border-purple-500/25",
    emerald: "bg-emerald-500/10 text-emerald-300 border-emerald-500/25",
  };
  return (
    <span
      className={`text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border ${tones[meta.tone]} inline-flex items-center gap-1`}
    >
      {meta.icon}
      {meta.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------
function DetailPanel({
  account,
  tab,
  setTab,
  onChange,
}: {
  account: Account;
  tab: Tab;
  setTab: (t: Tab) => void;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const sync = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/live/accounts/${account.id}/sync`, { method: "POST" });
      const j = (await res.json()) as { error?: string };
      setActionMessage(j.error ? `Sync warning: ${j.error}` : "Synced");
      onChange();
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : "sync error");
    } finally {
      setBusy(false);
    }
  }, [account.id, onChange]);

  const remove = useCallback(async () => {
    if (!confirm(`Delete account "${account.label}"? This removes it from MetaApi too.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/live/accounts/${account.id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      onChange();
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : "delete error");
    } finally {
      setBusy(false);
    }
  }, [account.id, account.label, onChange]);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.01] flex flex-col min-h-[400px]">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/[0.06]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-white truncate">{account.label}</h2>
            <ModeBadge mode={account.mode} />
            {account.metaapiState && (
              <span className="text-[9px] font-mono text-slate-500">
                · {account.metaapiState}
              </span>
            )}
          </div>
          <div className="text-[10px] text-slate-500 font-mono truncate">
            {account.broker ?? account.server} · #{account.login} · {account.metaapiRegion}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={sync}
            disabled={busy}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] text-slate-300 hover:text-white hover:bg-white/5 border border-white/[0.06] disabled:opacity-50"
            title="Force sync from broker"
          >
            <RefreshCw size={11} className={busy ? "animate-spin" : ""} />
            sync
          </button>
          <button
            onClick={remove}
            disabled={busy}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] text-rose-300 hover:bg-rose-500/15 border border-rose-500/20 disabled:opacity-50"
            title="Delete account"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-2 pt-2 border-b border-white/[0.04] overflow-x-auto">
        {(["overview", "strategy", "risk", "orders", "audit"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-t-lg text-[11px] font-semibold capitalize transition-all whitespace-nowrap ${
              tab === t
                ? "text-white bg-white/[0.05] border-x border-t border-white/[0.06]"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {actionMessage && (
        <div className="mx-4 mt-3 text-[11px] px-3 py-2 rounded-md bg-blue-500/10 text-blue-200 border border-blue-500/20">
          {actionMessage}
        </div>
      )}

      <div className="flex-1 p-4 min-w-0">
        {tab === "overview" && <OverviewTab account={account} />}
        {tab === "strategy" && <StrategyTab account={account} onChange={onChange} />}
        {tab === "risk" && <RiskTab account={account} onChange={onChange} />}
        {tab === "orders" && <OrdersTab accountId={account.id} />}
        {tab === "audit" && <AuditTab accountId={account.id} />}
      </div>
    </div>
  );
}

function PauseAllButton({ accounts, onDone }: { accounts: Account[]; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        if (!confirm("Set every LIVE account to OFF? This stops all order routing.")) return;
        setBusy(true);
        try {
          await Promise.all(
            accounts
              .filter((a) => a.mode === "LIVE")
              .map((a) =>
                fetch(`/api/live/accounts/${a.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ mode: "OFF" }),
                })
              )
          );
          onDone();
        } finally {
          setBusy(false);
        }
      }}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50"
    >
      <PowerOff size={12} />
      Pause all
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
function OverviewTab({ account }: { account: Account }) {
  const lastSynced = account.lastSyncedAt ? new Date(account.lastSyncedAt) : null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Stat label="Balance" value={fmtMoney(account.balance, account.currency)} />
      <Stat label="Equity" value={fmtMoney(account.equity, account.currency)} accent="emerald" />
      <Stat label="Margin" value={fmtMoney(account.margin, account.currency)} />
      <Stat label="Margin level" value={account.marginLevel != null ? `${account.marginLevel.toFixed(0)}%` : "—"} />
      <div className="col-span-2 sm:col-span-4 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2 font-semibold">
          Connection
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
          <KV label="MetaApi state" value={account.metaapiState ?? "—"} />
          <KV label="Region" value={account.metaapiRegion} />
          <KV label="Last synced" value={lastSynced ? lastSynced.toLocaleString() : "never"} />
          <KV
            label="Status"
            value={account.lastError ? `error: ${account.lastError.slice(0, 40)}…` : "ok"}
            tone={account.lastError ? "rose" : "emerald"}
          />
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "emerald";
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
        {label}
      </div>
      <div
        className={`text-lg font-bold font-mono mt-0.5 ${
          accent === "emerald" ? "text-emerald-300" : "text-white"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function KV({ label, value, tone }: { label: string; value: string; tone?: "rose" | "emerald" }) {
  const colour =
    tone === "rose"
      ? "text-rose-300"
      : tone === "emerald"
      ? "text-emerald-300"
      : "text-slate-200";
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-slate-600 font-semibold">
        {label}
      </div>
      <div className={`font-mono ${colour} truncate`}>{value}</div>
    </div>
  );
}

function fmtMoney(n: number | null | undefined, currency: string | null | undefined): string {
  if (n == null) return "—";
  const c = currency ?? "USD";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${c}`;
}

// ---------- Strategy tab ----------
function StrategyTab({ account, onChange }: { account: Account; onChange: () => void }) {
  const [strategies, setStrategies] = useState<Strategy[]>(account.strategies);
  const [mode, setMode] = useState<Mode>(account.mode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = useMemo(
    () =>
      JSON.stringify([...strategies].sort()) !== JSON.stringify([...account.strategies].sort()) ||
      mode !== account.mode,
    [strategies, mode, account]
  );

  const toggle = (s: Strategy) =>
    setStrategies((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const save = async () => {
    // Only confirm when the user is *transitioning* into LIVE — re-saving an
    // already-LIVE account (e.g. tweaking strategies) shouldn't nag.
    if (mode === "LIVE" && account.mode !== "LIVE") {
      const ok = confirm(
        `Set ${account.label} to LIVE mode? Real orders will be routed to ${account.broker ?? account.server} when signals fire.\n\nMake sure you've tested in SHADOW first.`
      );
      if (!ok) return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/live/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategies, mode }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "save error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
          Strategies to execute
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {(["COMBINED", "ALEX", "FABIO"] as Strategy[]).map((s) => (
            <StrategyToggle
              key={s}
              strategy={s}
              active={strategies.includes(s)}
              onToggle={() => toggle(s)}
            />
          ))}
        </div>
        <div className="text-[10px] text-slate-600 mt-2">
          Tip: use <span className="text-emerald-400">Combined</span> only for the highest-conviction
          setups (both engines agree).
        </div>
      </div>

      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
          Execution mode
        </div>
        <div className="grid grid-cols-3 gap-2">
          <ModeToggle
            mode="OFF"
            active={mode === "OFF"}
            onClick={() => setMode("OFF")}
            icon={<PowerOff size={14} />}
            sub="Nothing routed"
          />
          <ModeToggle
            mode="SHADOW"
            active={mode === "SHADOW"}
            onClick={() => setMode("SHADOW")}
            icon={<Beaker size={14} />}
            sub="Logged, not sent"
          />
          <ModeToggle
            mode="LIVE"
            active={mode === "LIVE"}
            onClick={() => setMode("LIVE")}
            icon={<Power size={14} />}
            sub="Real orders"
          />
        </div>
      </div>

      {error && (
        <div className="text-[11px] px-3 py-2 rounded-md bg-rose-500/10 text-rose-200 border border-rose-500/20">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.04]">
        {dirty && <span className="text-[10px] text-amber-400">unsaved changes</span>}
        <button
          disabled={!dirty || saving || strategies.length === 0}
          onClick={save}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/15 text-blue-300 border border-blue-500/30 hover:bg-blue-500/25 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Save size={12} />
          Save
        </button>
      </div>
    </div>
  );
}

function StrategyToggle({
  strategy,
  active,
  onToggle,
}: {
  strategy: Strategy;
  active: boolean;
  onToggle: () => void;
}) {
  const meta = STRATEGY_META[strategy];
  const tones: Record<string, { on: string; off: string }> = {
    blue: {
      on: "border-blue-500/50 bg-blue-500/[0.08] text-blue-200 shadow-[0_0_24px_rgba(59,130,246,0.15)]",
      off: "border-white/[0.06] text-slate-500 hover:border-blue-500/20 hover:text-blue-300",
    },
    purple: {
      on: "border-purple-500/50 bg-purple-500/[0.08] text-purple-200 shadow-[0_0_24px_rgba(168,85,247,0.15)]",
      off: "border-white/[0.06] text-slate-500 hover:border-purple-500/20 hover:text-purple-300",
    },
    emerald: {
      on: "border-emerald-500/50 bg-emerald-500/[0.08] text-emerald-200 shadow-[0_0_24px_rgba(16,185,129,0.15)]",
      off: "border-white/[0.06] text-slate-500 hover:border-emerald-500/20 hover:text-emerald-300",
    },
  };
  return (
    <button
      onClick={onToggle}
      className={`text-left rounded-lg border p-3 transition-all ${tones[meta.tone][active ? "on" : "off"]}`}
    >
      <div className="flex items-center gap-2 mb-1">
        {meta.icon}
        <span className="text-xs font-bold">{meta.label}</span>
        {active && <CheckCircle2 size={11} className="ml-auto" />}
      </div>
      <div className="text-[10px] opacity-70">
        {strategy === "ALEX" && "AOI · Set & Forget"}
        {strategy === "FABIO" && "Order flow · 40-Range"}
        {strategy === "COMBINED" && "Both engines agree"}
      </div>
    </button>
  );
}

function ModeToggle({
  mode,
  active,
  onClick,
  icon,
  sub,
}: {
  mode: Mode;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  sub: string;
}) {
  const tones: Record<Mode, { on: string; off: string }> = {
    OFF: {
      on: "border-slate-500/50 bg-slate-500/[0.08] text-slate-200",
      off: "border-white/[0.06] text-slate-500 hover:text-slate-300",
    },
    SHADOW: {
      on: "border-amber-500/50 bg-amber-500/[0.08] text-amber-200 shadow-[0_0_24px_rgba(245,158,11,0.15)]",
      off: "border-white/[0.06] text-slate-500 hover:text-amber-300 hover:border-amber-500/20",
    },
    LIVE: {
      on: "border-emerald-500/50 bg-emerald-500/[0.08] text-emerald-200 shadow-[0_0_24px_rgba(16,185,129,0.2)]",
      off: "border-white/[0.06] text-slate-500 hover:text-emerald-300 hover:border-emerald-500/20",
    },
  };
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-lg border p-3 transition-all ${tones[mode][active ? "on" : "off"]}`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-xs font-bold uppercase">{mode}</span>
      </div>
      <div className="text-[10px] opacity-70">{sub}</div>
    </button>
  );
}

// ---------- Risk tab ----------
function RiskTab({ account, onChange }: { account: Account; onChange: () => void }) {
  const [risk, setRisk] = useState(account.riskPctPerTrade);
  const [maxConcurrent, setMaxConcurrent] = useState(account.maxConcurrent);
  const [maxDailyLoss, setMaxDailyLoss] = useState(account.maxDailyLossPct);
  const [maxLot, setMaxLot] = useState(account.maxLot);
  const [minRR, setMinRR] = useState(account.minRR);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dirty =
    risk !== account.riskPctPerTrade ||
    maxConcurrent !== account.maxConcurrent ||
    maxDailyLoss !== account.maxDailyLossPct ||
    maxLot !== account.maxLot ||
    minRR !== account.minRR;

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/live/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          riskPctPerTrade: risk,
          maxConcurrent,
          maxDailyLossPct: maxDailyLoss,
          maxLot,
          minRR,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <NumberInput
        label="Risk per trade"
        suffix="%"
        value={risk}
        min={0.1}
        max={5}
        step={0.1}
        onChange={setRisk}
        hint="Capital risked per signal. 0.5% recommended."
      />
      <NumberInput
        label="Max concurrent positions"
        value={maxConcurrent}
        min={1}
        max={20}
        step={1}
        onChange={(v) => setMaxConcurrent(Math.floor(v))}
        hint="Hard cap on open positions for this account."
      />
      <NumberInput
        label="Max daily loss"
        suffix="%"
        value={maxDailyLoss}
        min={0.5}
        max={20}
        step={0.5}
        onChange={setMaxDailyLoss}
        hint="Routing pauses for the rest of the day at this drawdown."
      />
      <NumberInput
        label="Max lot size"
        value={maxLot}
        min={0.01}
        max={50}
        step={0.01}
        onChange={setMaxLot}
        hint="Cap on a single fill, even if risk model wants more."
      />
      <NumberInput
        label="Minimum R:R"
        value={minRR}
        min={0.5}
        max={5}
        step={0.1}
        onChange={setMinRR}
        hint="Skip signals below this reward:risk ratio."
      />

      {err && (
        <div className="text-[11px] px-3 py-2 rounded-md bg-rose-500/10 text-rose-200 border border-rose-500/20">
          {err}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.04]">
        {dirty && <span className="text-[10px] text-amber-400">unsaved changes</span>}
        <button
          disabled={!dirty || saving}
          onClick={save}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/15 text-blue-300 border border-blue-500/30 hover:bg-blue-500/25 text-xs font-semibold disabled:opacity-40"
        >
          <Save size={12} />
          Save
        </button>
      </div>
    </div>
  );
}

function NumberInput({
  label,
  suffix,
  value,
  min,
  max,
  step,
  onChange,
  hint,
}: {
  label: string;
  suffix?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[11px] font-semibold text-slate-300">{label}</label>
        <div className="text-xs font-mono text-blue-300">
          {value.toLocaleString(undefined, { maximumFractionDigits: 4 })}
          {suffix && <span className="text-slate-500 ml-0.5">{suffix}</span>}
        </div>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-blue-500"
      />
      {hint && <div className="text-[10px] text-slate-600 mt-1">{hint}</div>}
    </div>
  );
}

// ---------- Orders tab ----------
function OrdersTab({ accountId }: { accountId: string }) {
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/live/accounts/${accountId}/orders?limit=100`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { orders: OrderRow[] }) => {
        if (alive) setOrders(j.orders);
      })
      .catch(() => alive && setOrders([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [accountId]);

  if (loading) return <div className="text-xs text-slate-600">Loading…</div>;
  if (!orders || orders.length === 0)
    return (
      <div className="rounded-lg border border-dashed border-white/10 p-8 text-center text-xs text-slate-600">
        No orders yet. They&apos;ll appear here once Phase 2 (order routing) goes live and signals fire.
      </div>
    );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-slate-500 text-left">
            <th className="py-1.5 px-2 font-semibold">When</th>
            <th className="py-1.5 px-2 font-semibold">Pair</th>
            <th className="py-1.5 px-2 font-semibold">Source</th>
            <th className="py-1.5 px-2 font-semibold">Side</th>
            <th className="py-1.5 px-2 font-semibold text-right">Lot</th>
            <th className="py-1.5 px-2 font-semibold text-right">Entry</th>
            <th className="py-1.5 px-2 font-semibold text-right">SL</th>
            <th className="py-1.5 px-2 font-semibold text-right">TP</th>
            <th className="py-1.5 px-2 font-semibold">Status</th>
            <th className="py-1.5 px-2 font-semibold text-right">PnL</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {orders.map((o) => (
            <tr key={o.id} className="border-t border-white/[0.04]">
              <td className="py-1.5 px-2 text-slate-500">
                {new Date(o.createdAt).toLocaleTimeString()}
              </td>
              <td className="py-1.5 px-2 text-white">{o.symbol}</td>
              <td className="py-1.5 px-2 text-slate-400">{o.signalSource}</td>
              <td
                className={`py-1.5 px-2 font-bold ${
                  o.side === "BUY" ? "text-emerald-300" : "text-rose-300"
                }`}
              >
                {o.side}
              </td>
              <td className="py-1.5 px-2 text-right text-slate-300">
                {o.filledLot ?? o.requestedLot}
              </td>
              <td className="py-1.5 px-2 text-right text-slate-300">{o.entry}</td>
              <td className="py-1.5 px-2 text-right text-rose-200">{o.sl}</td>
              <td className="py-1.5 px-2 text-right text-emerald-200">{o.tp}</td>
              <td className="py-1.5 px-2">
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-white/5 text-slate-300 border-white/10">
                  {o.status}
                </span>
              </td>
              <td
                className={`py-1.5 px-2 text-right ${
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
  );
}

// ---------- Audit tab ----------
function AuditTab({ accountId }: { accountId: string }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/live/accounts/${accountId}/audit?limit=200`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { audit: AuditRow[] }) => {
        if (alive) setRows(j.audit);
      })
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [accountId]);

  if (!rows) return <div className="text-xs text-slate-600">Loading…</div>;
  if (rows.length === 0)
    return <div className="text-xs text-slate-600">No audit entries.</div>;

  const tone = (level: string) =>
    level === "error"
      ? "text-rose-300"
      : level === "warn"
      ? "text-amber-300"
      : "text-slate-300";
  return (
    <div className="space-y-1.5 font-mono">
      {rows.map((r) => (
        <div key={r.id} className="text-[10px] flex items-start gap-2 border-l-2 border-white/[0.06] pl-2">
          <span className="text-slate-600 shrink-0 w-32">{new Date(r.at).toLocaleString()}</span>
          <span className={`uppercase font-bold w-12 shrink-0 ${tone(r.level)}`}>{r.level}</span>
          <span className="text-slate-200 w-40 shrink-0">{r.event}</span>
          <span className="text-slate-500 truncate">
            {r.detail ? JSON.stringify(r.detail) : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add account modal
// ---------------------------------------------------------------------------
function AddAccountModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (a: Account) => void;
}) {
  const [label, setLabel] = useState("");
  const [server, setServer] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [region, setRegion] = useState("new-york");
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/live/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, server, login, password, region }),
      });
      const j = (await res.json()) as { account?: Account; error?: string };
      if (!res.ok || !j.account) throw new Error(j.error ?? `HTTP ${res.status}`);
      onCreated(j.account);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "create error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-xl bg-[#0a1120] border border-white/[0.08] shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <Briefcase size={14} className="text-blue-400" />
            <h2 className="text-sm font-bold text-white">Connect MT5 account</h2>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-white">
            <X size={16} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <Field label="Label">
            <input
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="ICMarkets demo"
              className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500/40"
            />
          </Field>
          <Field label="MT5 server" hint="E.g. ICMarketsSC-Demo, FTMO-Server, RoboForex-ECN.">
            <input
              required
              value={server}
              onChange={(e) => setServer(e.target.value)}
              placeholder="ICMarketsSC-Demo"
              className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md px-2.5 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-blue-500/40"
            />
          </Field>
          <Field label="Login (account number)">
            <input
              required
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="123456"
              className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md px-2.5 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-blue-500/40"
            />
          </Field>
          <Field
            label="Password"
            hint="Master or investor password. Encrypted at rest, sent only to MetaApi."
          >
            <div className="relative">
              <input
                required
                type={showPwd ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md px-2.5 py-1.5 pr-9 text-sm text-white font-mono focus:outline-none focus:border-blue-500/40"
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
              >
                {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </Field>
          <Field label="Region">
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500/40"
            >
              {REGIONS.map((r) => (
                <option key={r} value={r} className="bg-[#0a1120]">
                  {r}
                </option>
              ))}
            </select>
          </Field>
          {err && (
            <div className="text-[11px] px-3 py-2 rounded-md bg-rose-500/10 text-rose-200 border border-rose-500/20">
              {err}
            </div>
          )}
          <div className="text-[10px] text-slate-500 flex items-start gap-1.5">
            <Zap size={10} className="text-amber-400 mt-0.5 shrink-0" />
            New accounts default to <span className="text-amber-300 font-semibold">OFF</span> mode —
            no orders are routed until you flip them in the Strategy tab.
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 p-3 border-t border-white/[0.06] bg-white/[0.01]">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/15 text-blue-300 border border-blue-500/30 hover:bg-blue-500/25 text-xs font-semibold disabled:opacity-40"
          >
            {busy ? (
              <>
                <RefreshCw size={12} className="animate-spin" />
                Connecting…
              </>
            ) : (
              <>
                <Activity size={12} />
                Connect
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-slate-300 mb-1 block">{label}</label>
      {children}
      {hint && <div className="text-[10px] text-slate-600 mt-1">{hint}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// cTrader panel — read-only Phase 1 view of OAuth-linked Spotware accounts.
// Order placement requires a long-lived protobuf TCP client (Phase 2), so we
// just list the connected trader accounts + let the user disconnect them.
// ---------------------------------------------------------------------------
function CtraderPanel({
  accounts,
  onChange,
}: {
  accounts: CtraderAccount[];
  onChange: () => void;
}) {
  if (accounts.length === 0) return null;
  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center gap-2 px-1">
        <Zap size={12} className="text-emerald-400" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          cTrader · {accounts.length}
        </span>
      </div>
      {accounts.map((a) => (
        <CtraderListItem key={a.id} account={a} onChange={onChange} />
      ))}
    </div>
  );
}

function CtraderListItem({
  account,
  onChange,
}: {
  account: CtraderAccount;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const expired = new Date(account.tokenExpiresAt).getTime() < Date.now();

  async function disconnect() {
    if (!confirm(`Disconnect ${account.label}? You can reconnect any time.`)) return;
    setBusy(true);
    try {
      await fetch(`/api/ctrader/accounts/${account.id}`, { method: "DELETE" });
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    setBusy(true);
    setSyncResult(null);
    try {
      const res = await fetch(`/api/ctrader/accounts/${account.id}/sync`, { method: "POST" });
      const j = (await res.json()) as {
        ok?: boolean;
        tokenRotated?: boolean;
        tradingAccountsVisible?: number;
        stillAuthorised?: boolean;
        error?: string;
      };
      if (!res.ok || !j.ok) {
        setSyncResult(`✗ ${j.error ?? "sync failed"}`);
      } else {
        setSyncResult(
          `✓ Spotware OK · ${j.tradingAccountsVisible} acct${j.tradingAccountsVisible === 1 ? "" : "s"} visible${j.tokenRotated ? " · token refreshed" : ""}`
        );
      }
      onChange();
    } catch (e) {
      setSyncResult(`✗ ${e instanceof Error ? e.message : "network error"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.03] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-white truncate">{account.label}</div>
          <div className="text-[10px] text-slate-500 font-mono truncate">
            {account.brokerName ?? "cTrader"} · #{account.traderLogin ?? account.ctidTraderAccountId}
            {account.isLive ? " · LIVE" : " · DEMO"}
          </div>
          {expired && (
            <div className="text-[10px] text-amber-400 mt-1">
              Token expired — reconnect via &ldquo;Connect cTrader&rdquo;
            </div>
          )}
          {account.lastError && (
            <div className="text-[10px] text-rose-400 mt-1 line-clamp-2">{account.lastError}</div>
          )}
          {syncResult && (
            <div
              className={`text-[10px] mt-1 ${syncResult.startsWith("✓") ? "text-emerald-400" : "text-rose-400"}`}
            >
              {syncResult}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <button
            onClick={sync}
            disabled={busy}
            className="text-[10px] px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/20 disabled:opacity-50"
            title="Verify OAuth tokens against Spotware"
          >
            <RefreshCw size={11} className={busy ? "animate-spin" : ""} />
          </button>
          <button
            onClick={disconnect}
            disabled={busy}
            className="text-[10px] px-2 py-1 rounded-md bg-rose-500/10 text-rose-300 border border-rose-500/20 hover:bg-rose-500/20 disabled:opacity-50"
            title="Remove this connection"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}

// Reads ?connected=ctrader / ?ctrader_error=... after the OAuth callback and
// shows a transient banner. Strips the params from the URL after rendering so
// the banner doesn't reappear on refresh.
function CtraderToast() {
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const ok = sp.get("connected");
    const err = sp.get("ctrader_error");
    if (ok === "ctrader") {
      setMsg({ kind: "ok", text: "cTrader account connected." });
    } else if (err) {
      setMsg({ kind: "err", text: `cTrader: ${err}` });
    } else {
      return;
    }
    sp.delete("connected");
    sp.delete("ctrader_error");
    const qs = sp.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    const t = setTimeout(() => setMsg(null), 8000);
    return () => clearTimeout(t);
  }, []);

  if (!msg) return null;
  const tone =
    msg.kind === "ok"
      ? "bg-emerald-500/8 border-emerald-500/30 text-emerald-300"
      : "bg-rose-500/8 border-rose-500/30 text-rose-300";
  return (
    <div className={`mx-4 sm:mx-6 mt-4 rounded-xl border p-3 flex items-center gap-3 ${tone}`}>
      {msg.kind === "ok" ? (
        <CheckCircle2 size={15} className="shrink-0" />
      ) : (
        <AlertCircle size={15} className="shrink-0" />
      )}
      <p className="text-xs flex-1">{msg.text}</p>
      <button
        onClick={() => setMsg(null)}
        className="text-xs px-2 py-0.5 rounded-md hover:bg-white/5"
      >
        <X size={12} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bridge (self-hosted cBot / MT5 EA) panel
// ---------------------------------------------------------------------------
function BridgePanel({
  accounts,
  onChange,
  onAdd,
}: {
  accounts: BridgeAccount[];
  onChange: () => void;
  onAdd: () => void;
}) {
  if (accounts.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-dashed border-amber-500/20 bg-amber-500/[0.02] p-3">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-amber-300/80 mb-1.5">
          <Activity size={12} /> Bridge bots
        </div>
        <div className="text-[11px] text-slate-400 leading-relaxed mb-2">
          Self-hosted cBot or MT5 EA running on your own VPS. Polls this app
          over HTTPS — no broker billing, no Trial gate.
        </div>
        <button
          onClick={onAdd}
          className="text-[10px] px-2 py-1 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/25 hover:bg-amber-500/25 inline-flex items-center gap-1"
        >
          <Plus size={10} /> Mint a bridge token
        </button>
      </div>
    );
  }
  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center gap-2 px-1">
        <Activity size={12} className="text-amber-400" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Bridge bots · {accounts.length}
        </span>
      </div>
      {accounts.map((a) => (
        <BridgeListItem key={a.id} account={a} onChange={onChange} />
      ))}
    </div>
  );
}

function BridgeListItem({
  account,
  onChange,
}: {
  account: BridgeAccount;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [openMode, setOpenMode] = useState(false);

  async function setMode(mode: Mode) {
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
      setOpenMode(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete bridge "${account.label}"? Pending orders will be cancelled.`)) return;
    setBusy(true);
    try {
      await fetch(`/api/bridge/accounts/${account.id}`, { method: "DELETE" });
      onChange();
    } finally {
      setBusy(false);
    }
  }

  const dot =
    account.isStale
      ? "bg-rose-500"
      : account.isPolling
        ? "bg-emerald-400"
        : "bg-amber-400";
  const modeTone =
    account.mode === "LIVE"
      ? "bg-rose-500/20 text-rose-300 border-rose-500/30"
      : account.mode === "SHADOW"
        ? "bg-blue-500/15 text-blue-300 border-blue-500/30"
        : "bg-slate-500/15 text-slate-400 border-slate-500/30";
  const providerTone =
    account.provider === "ctrader"
      ? "bg-emerald-500/15 text-emerald-300"
      : "bg-blue-500/15 text-blue-300";

  return (
    <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.03] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
            <div className="text-xs font-semibold text-white truncate">{account.label}</div>
            <span className={`text-[9px] px-1.5 py-0.5 rounded ${providerTone} font-mono uppercase`}>
              {account.provider}
            </span>
          </div>
          <div className="text-[10px] text-slate-500 font-mono truncate mt-0.5">
            {account.brokerName ?? "—"}
            {account.accountLogin ? ` · #${account.accountLogin}` : ""}
            {account.botVersion ? ` · v${account.botVersion}` : ""}
          </div>
          {account.balance != null && (
            <div className="text-[10px] text-slate-400 mt-0.5">
              {account.balance.toFixed(2)} {account.currency ?? ""}
              {account.equity != null && account.equity !== account.balance && (
                <span className="text-slate-500"> · eq {account.equity.toFixed(2)}</span>
              )}
              {account.openPositions != null && account.openPositions > 0 && (
                <span className="text-amber-300"> · {account.openPositions} open</span>
              )}
            </div>
          )}
          {account.isStale && (
            <div className="text-[10px] text-rose-400 mt-1">
              No heartbeat &gt;5min — fan-out paused
            </div>
          )}
          {account.lastError && (
            <div className="text-[10px] text-rose-400 mt-1 line-clamp-2">{account.lastError}</div>
          )}
        </div>
        <div className="flex flex-col gap-1 shrink-0 items-end">
          <button
            onClick={() => setOpenMode((v) => !v)}
            disabled={busy}
            className={`text-[9px] px-2 py-1 rounded-md border font-semibold ${modeTone} hover:brightness-125 disabled:opacity-50`}
            title="Change trading mode"
          >
            {account.mode}
          </button>
          {openMode && (
            <div className="flex flex-col gap-1">
              {(["OFF", "SHADOW", "LIVE"] as Mode[])
                .filter((m) => m !== account.mode)
                .map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className="text-[9px] px-2 py-0.5 rounded-md bg-white/[0.04] text-slate-300 border border-white/10 hover:bg-white/[0.08]"
                  >
                    → {m}
                  </button>
                ))}
            </div>
          )}
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
    </div>
  );
}

function AddBridgeModal({
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
        }),
      });
      const j = (await res.json()) as { account?: BridgeAccount; token?: string; error?: string };
      if (!res.ok || !j.account || !j.token) throw new Error(j.error ?? `HTTP ${res.status}`);
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
        className="bg-[#0c1322] border border-white/10 rounded-2xl p-5 w-full max-w-md shadow-2xl"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-white">Add bridge bot</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Label
            </span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
              maxLength={64}
              placeholder="e.g. IC Markets MT5 (VPS)"
              className="mt-1 w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
            />
          </label>

          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Provider
            </span>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as "ctrader" | "mt5")}
              className="mt-1 w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="mt5">MT5 — Expert Advisor</option>
              <option value="ctrader">cTrader — cBot</option>
            </select>
          </label>

          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Broker (optional)
            </span>
            <input
              type="text"
              value={brokerName}
              onChange={(e) => setBrokerName(e.target.value)}
              maxLength={64}
              placeholder="IC Markets"
              className="mt-1 w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
            />
          </label>

          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Account # (optional)
            </span>
            <input
              type="text"
              value={accountLogin}
              onChange={(e) => setAccountLogin(e.target.value)}
              maxLength={32}
              placeholder="123456"
              className="mt-1 w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
            />
          </label>

          <div className="text-[11px] text-slate-400 bg-white/[0.02] rounded-lg p-2.5 leading-relaxed">
            On submit a unique <span className="font-mono text-amber-300">bearer token</span> is
            minted. Paste it into the bot&apos;s config — it&apos;s shown only once. Default mode
            is <span className="font-mono text-slate-300">OFF</span>; flip to{" "}
            <span className="font-mono text-rose-300">LIVE</span> when ready.
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
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/20 text-amber-200 border border-amber-500/30 hover:bg-amber-500/30 disabled:opacity-50"
          >
            {busy ? "Minting…" : "Mint token"}
          </button>
        </div>
      </form>
    </div>
  );
}

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
      // Clipboard API unavailable (insecure context).
    }
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0c1322] border border-amber-500/30 rounded-2xl p-5 w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <ShieldCheck size={15} className="text-amber-300" />
            Save this token now
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X size={16} />
          </button>
        </div>

        <div className="text-[12px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 mb-3 leading-relaxed">
          This bearer token is shown <strong>only once</strong>. We store only a SHA-256
          hash. If you lose it, rotate via the API; no recovery possible.
        </div>

        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
          Bridge: {account.label} ({account.provider})
        </div>

        <div className="flex items-stretch gap-2">
          <code className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 font-mono text-[11px] text-amber-200 break-all">
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
            className="px-3 rounded-lg bg-amber-500/20 text-amber-200 border border-amber-500/30 hover:bg-amber-500/30 text-xs font-semibold"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <div className="text-[11px] text-slate-400 mt-3 leading-relaxed">
          Paste this into your bot&apos;s configuration alongside the API base URL
          (typically your Vercel deployment). The bot will then call{" "}
          <code className="text-slate-300">/api/bridge/poll</code> every 10s.
        </div>

        <div className="flex justify-end mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/20 text-amber-200 border border-amber-500/30 hover:bg-amber-500/30 inline-flex items-center gap-1"
          >
            <Save size={12} />
            I saved it
          </button>
        </div>
      </div>
    </div>
  );
}
