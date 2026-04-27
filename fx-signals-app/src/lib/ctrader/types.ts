import type { CtraderAccountRow } from "@/db/schema";

export type CtraderAccountPublic = {
  id: string;
  label: string;
  ctidTraderAccountId: string;
  traderLogin: string | null;
  brokerName: string | null;
  isLive: boolean;
  scope: string | null;
  tokenExpiresAt: string;
  mode: "OFF" | "SHADOW" | "LIVE";
  strategies: ("ALEX" | "FABIO" | "COMBINED")[];
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
  // never expose tokens
};

const ALLOWED_STRATS = new Set(["ALEX", "FABIO", "COMBINED"]);

function asStrategies(v: unknown): ("ALEX" | "FABIO" | "COMBINED")[] {
  if (!Array.isArray(v)) return ["COMBINED"];
  return v.filter((x): x is "ALEX" | "FABIO" | "COMBINED" =>
    typeof x === "string" && ALLOWED_STRATS.has(x)
  );
}

function asSymbols(v: unknown): string[] | null {
  if (v == null) return null;
  if (!Array.isArray(v)) return null;
  return v.filter((x): x is string => typeof x === "string" && x.length <= 16);
}

export function toPublic(row: CtraderAccountRow): CtraderAccountPublic {
  return {
    id: row.id,
    label: row.label,
    ctidTraderAccountId: row.ctidTraderAccountId,
    traderLogin: row.traderLogin,
    brokerName: row.brokerName,
    isLive: row.isLive,
    scope: row.scope,
    tokenExpiresAt: row.tokenExpiresAt.toISOString(),
    mode: (row.mode as CtraderAccountPublic["mode"]) ?? "OFF",
    strategies: asStrategies(row.strategies),
    symbols: asSymbols(row.symbols),
    riskPctPerTrade: row.riskPctPerTrade,
    maxConcurrent: row.maxConcurrent,
    maxDailyLossPct: row.maxDailyLossPct,
    maxLot: row.maxLot,
    minRR: row.minRR,
    balance: row.balance,
    equity: row.equity,
    margin: row.margin,
    marginLevel: row.marginLevel,
    currency: row.currency,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastError: row.lastError,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
