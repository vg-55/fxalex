import type { Mt5AccountRow } from "@/db/schema";

// Public-safe view of an MT5 account (no secrets).
export type Mt5AccountPublic = {
  id: string;
  label: string;
  broker: string | null;
  server: string;
  login: string;
  metaapiAccountId: string | null;
  metaapiRegion: string;
  metaapiState: string | null;
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
  // never include passwordEnc
  passwordSet: true;
};

const ALLOWED_STRATS = new Set(["ALEX", "FABIO", "COMBINED"]);
const ALLOWED_MODES = new Set(["OFF", "SHADOW", "LIVE"]);

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

export function toPublic(row: Mt5AccountRow): Mt5AccountPublic {
  return {
    id: row.id,
    label: row.label,
    broker: row.broker,
    server: row.server,
    login: row.login,
    metaapiAccountId: row.metaapiAccountId,
    metaapiRegion: row.metaapiRegion,
    metaapiState: row.metaapiState,
    mode: (row.mode as Mt5AccountPublic["mode"]) ?? "OFF",
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
    passwordSet: true,
  };
}

// ---------------------------------------------------------------------------
// Validation helpers used by API routes
// ---------------------------------------------------------------------------
type CreateBody = {
  label: string;
  broker?: string;
  server: string;
  login: string;
  password: string;
  region?: string;
  strategies?: string[];
  symbols?: string[] | null;
  riskPctPerTrade?: number;
  maxConcurrent?: number;
  maxDailyLossPct?: number;
  maxLot?: number;
  minRR?: number;
  mode?: string;
};

export function validateCreate(input: unknown): {
  ok: true;
  value: CreateBody;
} | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "body must be an object" };
  const b = input as Record<string, unknown>;
  const label = typeof b.label === "string" ? b.label.trim() : "";
  const server = typeof b.server === "string" ? b.server.trim() : "";
  const login = typeof b.login === "string" ? b.login.trim() : "";
  const password = typeof b.password === "string" ? b.password : "";
  if (!label) return { ok: false, error: "label is required" };
  if (!server) return { ok: false, error: "server is required" };
  if (!login) return { ok: false, error: "login is required" };
  if (!password) return { ok: false, error: "password is required" };
  const value: CreateBody = { label, server, login, password };
  if (typeof b.broker === "string") value.broker = b.broker;
  if (typeof b.region === "string") value.region = b.region;
  const strategies = asStrategies(b.strategies);
  if (strategies.length > 0) value.strategies = strategies;
  if (b.symbols === null || Array.isArray(b.symbols)) value.symbols = asSymbols(b.symbols);
  if (typeof b.riskPctPerTrade === "number" && b.riskPctPerTrade > 0 && b.riskPctPerTrade <= 5)
    value.riskPctPerTrade = b.riskPctPerTrade;
  if (typeof b.maxConcurrent === "number" && b.maxConcurrent >= 1 && b.maxConcurrent <= 20)
    value.maxConcurrent = Math.floor(b.maxConcurrent);
  if (typeof b.maxDailyLossPct === "number" && b.maxDailyLossPct > 0 && b.maxDailyLossPct <= 50)
    value.maxDailyLossPct = b.maxDailyLossPct;
  if (typeof b.maxLot === "number" && b.maxLot > 0 && b.maxLot <= 100)
    value.maxLot = b.maxLot;
  if (typeof b.minRR === "number" && b.minRR >= 0.5 && b.minRR <= 10)
    value.minRR = b.minRR;
  if (typeof b.mode === "string" && ALLOWED_MODES.has(b.mode))
    value.mode = b.mode;
  return { ok: true, value };
}

export type PatchBody = Partial<Omit<CreateBody, "label"> & { label: string }>;

export function validatePatch(input: unknown): {
  ok: true;
  value: PatchBody;
} | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "body must be an object" };
  const b = input as Record<string, unknown>;
  const out: PatchBody = {};
  if (typeof b.label === "string" && b.label.trim()) out.label = b.label.trim();
  if (typeof b.broker === "string") out.broker = b.broker;
  if (typeof b.server === "string" && b.server.trim()) out.server = b.server.trim();
  if (typeof b.login === "string" && b.login.trim()) out.login = b.login.trim();
  if (typeof b.password === "string" && b.password.length > 0) out.password = b.password;
  if (typeof b.region === "string") out.region = b.region;
  if (Array.isArray(b.strategies)) {
    const s = asStrategies(b.strategies);
    out.strategies = s;
  }
  if (b.symbols === null) out.symbols = null;
  else if (Array.isArray(b.symbols)) out.symbols = asSymbols(b.symbols);
  if (typeof b.riskPctPerTrade === "number" && b.riskPctPerTrade > 0 && b.riskPctPerTrade <= 5)
    out.riskPctPerTrade = b.riskPctPerTrade;
  if (typeof b.maxConcurrent === "number" && b.maxConcurrent >= 1 && b.maxConcurrent <= 20)
    out.maxConcurrent = Math.floor(b.maxConcurrent);
  if (typeof b.maxDailyLossPct === "number" && b.maxDailyLossPct > 0 && b.maxDailyLossPct <= 50)
    out.maxDailyLossPct = b.maxDailyLossPct;
  if (typeof b.maxLot === "number" && b.maxLot > 0 && b.maxLot <= 100) out.maxLot = b.maxLot;
  if (typeof b.minRR === "number" && b.minRR >= 0.5 && b.minRR <= 10) out.minRR = b.minRR;
  if (typeof b.mode === "string" && ALLOWED_MODES.has(b.mode)) out.mode = b.mode;
  return { ok: true, value: out };
}
