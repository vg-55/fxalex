import type { BridgeAccountRow, BridgeOrderRow } from "@/db/schema";

export type BridgeProvider = "ctrader" | "mt5";
export type BridgeMode = "OFF" | "SHADOW" | "LIVE";
export type BridgeStrategy = "ALEX" | "FABIO" | "COMBINED";
export type BridgeOrderStatus =
  | "QUEUED"
  | "SENT"
  | "FILLED"
  | "REJECTED"
  | "CLOSED"
  | "CANCELLED";

const ALLOWED_PROVIDERS = new Set<BridgeProvider>(["ctrader", "mt5"]);
const ALLOWED_MODES = new Set<BridgeMode>(["OFF", "SHADOW", "LIVE"]);
const ALLOWED_STRATEGIES = new Set<BridgeStrategy>(["ALEX", "FABIO", "COMBINED"]);

export type BridgeAccountPublic = {
  id: string;
  label: string;
  provider: BridgeProvider;
  accountLogin: string | null;
  brokerName: string | null;
  currency: string | null;
  mode: BridgeMode;
  strategies: BridgeStrategy[];
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
  // Live-staleness derived fields the UI uses for the green/red dot.
  isStale: boolean; // no heartbeat for >5min
  isPolling: boolean; // poll within last 30s
  createdAt: string;
  updatedAt: string;
};

const STALE_HEARTBEAT_MS = 5 * 60_000; // 5 minutes
const POLL_FRESH_MS = 30_000; // 30s window counts as "actively polling"

export function isHeartbeatStale(row: Pick<BridgeAccountRow, "lastHeartbeatAt">): boolean {
  if (!row.lastHeartbeatAt) return true;
  return Date.now() - row.lastHeartbeatAt.getTime() > STALE_HEARTBEAT_MS;
}

function asProvider(v: unknown): BridgeProvider {
  return typeof v === "string" && ALLOWED_PROVIDERS.has(v as BridgeProvider)
    ? (v as BridgeProvider)
    : "mt5";
}
function asMode(v: unknown): BridgeMode {
  return typeof v === "string" && ALLOWED_MODES.has(v as BridgeMode)
    ? (v as BridgeMode)
    : "OFF";
}
function asStrategies(v: unknown): BridgeStrategy[] {
  if (!Array.isArray(v)) return ["COMBINED"];
  return v.filter((x): x is BridgeStrategy =>
    typeof x === "string" && ALLOWED_STRATEGIES.has(x as BridgeStrategy)
  );
}
function asStringArrayOrNull(v: unknown): string[] | null {
  if (v == null) return null;
  if (!Array.isArray(v)) return null;
  return v.filter((x): x is string => typeof x === "string" && x.length <= 32);
}
function asStringMapOrNull(v: unknown): Record<string, string> | null {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string" && k.length <= 32 && val.length <= 32) {
      out[k] = val;
    }
  }
  return Object.keys(out).length ? out : null;
}

export function toPublic(row: BridgeAccountRow): BridgeAccountPublic {
  const stale = isHeartbeatStale(row);
  const polling =
    !!row.lastPolledAt && Date.now() - row.lastPolledAt.getTime() <= POLL_FRESH_MS;
  return {
    id: row.id,
    label: row.label,
    provider: asProvider(row.provider),
    accountLogin: row.accountLogin,
    brokerName: row.brokerName,
    currency: row.currency,
    mode: asMode(row.mode),
    strategies: asStrategies(row.strategies),
    symbols: asStringArrayOrNull(row.symbols),
    symbolOverrides: asStringMapOrNull(row.symbolOverrides),
    riskPctPerTrade: row.riskPctPerTrade,
    maxConcurrent: row.maxConcurrent,
    maxDailyLossPct: row.maxDailyLossPct,
    maxLot: row.maxLot,
    minRR: row.minRR,
    balance: row.balance,
    equity: row.equity,
    marginLevel: row.marginLevel,
    openPositions: row.openPositions,
    botVersion: row.botVersion,
    lastPolledAt: row.lastPolledAt?.toISOString() ?? null,
    lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
    lastError: row.lastError,
    enabled: row.enabled,
    isStale: stale,
    isPolling: polling,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Validators for create/patch payloads.
// ---------------------------------------------------------------------------

export type CreatePayload = {
  label: string;
  provider: BridgeProvider;
  accountLogin?: string | null;
  brokerName?: string | null;
  strategies?: BridgeStrategy[];
  symbols?: string[] | null;
  riskPctPerTrade?: number;
  maxConcurrent?: number;
  maxDailyLossPct?: number;
  maxLot?: number;
  minRR?: number;
};

export function validateCreate(body: unknown): { ok: true; data: CreatePayload } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "body must be object" };
  const b = body as Record<string, unknown>;
  if (typeof b.label !== "string" || !b.label.trim()) return { ok: false, error: "label required" };
  if (typeof b.provider !== "string" || !ALLOWED_PROVIDERS.has(b.provider as BridgeProvider))
    return { ok: false, error: "provider must be 'ctrader' or 'mt5'" };
  return {
    ok: true,
    data: {
      label: b.label.trim().slice(0, 64),
      provider: b.provider as BridgeProvider,
      accountLogin:
        typeof b.accountLogin === "string" && b.accountLogin.trim()
          ? b.accountLogin.trim().slice(0, 32)
          : null,
      brokerName:
        typeof b.brokerName === "string" && b.brokerName.trim()
          ? b.brokerName.trim().slice(0, 64)
          : null,
      strategies: asStrategies(b.strategies),
      symbols: asStringArrayOrNull(b.symbols),
      riskPctPerTrade:
        typeof b.riskPctPerTrade === "number" && b.riskPctPerTrade > 0 && b.riskPctPerTrade <= 5
          ? b.riskPctPerTrade
          : undefined,
      maxConcurrent:
        typeof b.maxConcurrent === "number" && b.maxConcurrent >= 1 && b.maxConcurrent <= 20
          ? Math.floor(b.maxConcurrent)
          : undefined,
      maxDailyLossPct:
        typeof b.maxDailyLossPct === "number" && b.maxDailyLossPct > 0 && b.maxDailyLossPct <= 50
          ? b.maxDailyLossPct
          : undefined,
      maxLot:
        typeof b.maxLot === "number" && b.maxLot > 0 && b.maxLot <= 100 ? b.maxLot : undefined,
      minRR:
        typeof b.minRR === "number" && b.minRR >= 0.5 && b.minRR <= 10 ? b.minRR : undefined,
    },
  };
}

/**
 * Build a partial update record for PATCH. Only fields present in `body` and
 * passing validation are included; unknown / invalid keys are ignored
 * silently rather than rejected so the bot's heartbeat path never 400s.
 */
export function buildPatch(body: Record<string, unknown>): Record<string, unknown> {
  const u: Record<string, unknown> = {};
  if (typeof body.label === "string" && body.label.trim()) u.label = body.label.trim().slice(0, 64);
  if (typeof body.mode === "string" && ALLOWED_MODES.has(body.mode as BridgeMode))
    u.mode = body.mode;
  if (Array.isArray(body.strategies)) u.strategies = asStrategies(body.strategies);
  if (body.symbols === null) u.symbols = null;
  else if (Array.isArray(body.symbols)) u.symbols = asStringArrayOrNull(body.symbols) ?? [];
  if (body.symbolOverrides === null) u.symbolOverrides = null;
  else if (body.symbolOverrides && typeof body.symbolOverrides === "object")
    u.symbolOverrides = asStringMapOrNull(body.symbolOverrides);
  if (typeof body.riskPctPerTrade === "number" && body.riskPctPerTrade > 0 && body.riskPctPerTrade <= 5)
    u.riskPctPerTrade = body.riskPctPerTrade;
  if (typeof body.maxConcurrent === "number" && body.maxConcurrent >= 1 && body.maxConcurrent <= 20)
    u.maxConcurrent = Math.floor(body.maxConcurrent);
  if (typeof body.maxDailyLossPct === "number" && body.maxDailyLossPct > 0 && body.maxDailyLossPct <= 50)
    u.maxDailyLossPct = body.maxDailyLossPct;
  if (typeof body.maxLot === "number" && body.maxLot > 0 && body.maxLot <= 100)
    u.maxLot = body.maxLot;
  if (typeof body.minRR === "number" && body.minRR >= 0.5 && body.minRR <= 10)
    u.minRR = body.minRR;
  if (typeof body.enabled === "boolean") u.enabled = body.enabled;
  return u;
}

// ---------------------------------------------------------------------------
// Order projections (what the bot sees on /poll).
// ---------------------------------------------------------------------------

export type BridgeOrderForBot = {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  lot: number;
  entry: number;
  sl: number;
  tp: number;
  signalSource: string | null;
};

/**
 * Translate a row into the shape the bot expects, applying any per-account
 * symbol overrides (e.g. cTrader "GOLD" → MT5 "XAUUSD.a").
 */
export function orderForBot(
  row: BridgeOrderRow,
  overrides: Record<string, string> | null
): BridgeOrderForBot {
  const symbol = overrides && overrides[row.symbol] ? overrides[row.symbol] : row.symbol;
  return {
    id: row.id,
    symbol,
    side: row.side === "SELL" ? "SELL" : "BUY",
    lot: row.requestedLot,
    entry: row.entry,
    sl: row.sl,
    tp: row.tp,
    signalSource: row.signalSource,
  };
}
