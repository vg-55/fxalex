import { db, assertDb, schema } from "./client";

type Seed = Omit<typeof schema.instruments.$inferInsert, "updatedAt">;

const SEED: Seed[] = [
  // ── Original 3 ──────────────────────────────────────────────────────────────
  {
    pair: "XAUUSD",
    tvSymbol: "OANDA:XAUUSD",
    timeframe: "1H",
    aoiLow: 3270,
    aoiHigh: 3300,
    ma50: 3280,
    decimals: 2,
    slBufferPct: 0.25,
    enabled: true,
  },
  {
    pair: "EURUSD",
    tvSymbol: "OANDA:EURUSD",
    timeframe: "15m",
    aoiLow: 1.105,
    aoiHigh: 1.108,
    ma50: 1.106,
    decimals: 4,
    slBufferPct: 0.08,
    enabled: true,
  },
  {
    pair: "GBPUSD",
    tvSymbol: "OANDA:GBPUSD",
    timeframe: "1H",
    aoiLow: 1.32,
    aoiHigh: 1.324,
    ma50: 1.322,
    decimals: 4,
    slBufferPct: 0.1,
    enabled: true,
  },

  // ── Watchlist additions ──────────────────────────────────────────────────────
  {
    pair: "GBPNZD",
    tvSymbol: "OANDA:GBPNZD",
    timeframe: "1H",
    aoiLow: 2.12,
    aoiHigh: 2.135,
    ma50: 2.127,
    decimals: 4,
    slBufferPct: 0.12,
    enabled: true,
  },
  {
    pair: "EURJPY",
    tvSymbol: "OANDA:EURJPY",
    timeframe: "1H",
    aoiLow: 161.0,
    aoiHigh: 162.5,
    ma50: 161.75,
    decimals: 2,
    slBufferPct: 0.12,
    enabled: true,
  },
  {
    pair: "CADJPY",
    tvSymbol: "OANDA:CADJPY",
    timeframe: "1H",
    aoiLow: 104.5,
    aoiHigh: 105.5,
    ma50: 105.0,
    decimals: 2,
    slBufferPct: 0.12,
    enabled: true,
  },
  {
    pair: "AUDCAD",
    tvSymbol: "OANDA:AUDCAD",
    timeframe: "1H",
    aoiLow: 0.893,
    aoiHigh: 0.899,
    ma50: 0.896,
    decimals: 4,
    slBufferPct: 0.1,
    enabled: true,
  },
  {
    pair: "GBPAUD",
    tvSymbol: "OANDA:GBPAUD",
    timeframe: "1H",
    aoiLow: 2.045,
    aoiHigh: 2.058,
    ma50: 2.051,
    decimals: 4,
    slBufferPct: 0.12,
    enabled: true,
  },
  {
    pair: "EURAUD",
    tvSymbol: "OANDA:EURAUD",
    timeframe: "1H",
    aoiLow: 1.745,
    aoiHigh: 1.758,
    ma50: 1.751,
    decimals: 4,
    slBufferPct: 0.1,
    enabled: true,
  },
  {
    pair: "USDCAD",
    tvSymbol: "OANDA:USDCAD",
    timeframe: "1H",
    aoiLow: 1.381,
    aoiHigh: 1.389,
    ma50: 1.385,
    decimals: 4,
    slBufferPct: 0.08,
    enabled: true,
  },
  {
    pair: "USDCHF",
    tvSymbol: "OANDA:USDCHF",
    timeframe: "1H",
    aoiLow: 0.818,
    aoiHigh: 0.824,
    ma50: 0.821,
    decimals: 4,
    slBufferPct: 0.08,
    enabled: true,
  },
  {
    pair: "NZDCAD",
    tvSymbol: "OANDA:NZDCAD",
    timeframe: "1H",
    aoiLow: 0.828,
    aoiHigh: 0.834,
    ma50: 0.831,
    decimals: 4,
    slBufferPct: 0.1,
    enabled: true,
  },
  {
    pair: "GBPCHF",
    tvSymbol: "OANDA:GBPCHF",
    timeframe: "1H",
    aoiLow: 1.082,
    aoiHigh: 1.089,
    ma50: 1.085,
    decimals: 4,
    slBufferPct: 0.1,
    enabled: true,
  },
  {
    pair: "USDJPY",
    tvSymbol: "OANDA:USDJPY",
    timeframe: "1H",
    aoiLow: 150.0,
    aoiHigh: 151.0,
    ma50: 150.5,
    decimals: 3,
    slBufferPct: 0.25,
    enabled: true,
  },
  {
    pair: "AUDUSD",
    tvSymbol: "OANDA:AUDUSD",
    timeframe: "1H",
    aoiLow: 0.6500,
    aoiHigh: 0.6600,
    ma50: 0.6550,
    decimals: 5,
    slBufferPct: 0.25,
    enabled: true,
  },
];

export async function seedInstruments() {
  assertDb();
  await db
    .insert(schema.instruments)
    .values(SEED)
    .onConflictDoNothing({ target: schema.instruments.pair });

  // Singleton scanner_state
  await db
    .insert(schema.scannerState)
    .values({ id: 1, consecutiveFailures: 0 })
    .onConflictDoNothing({ target: schema.scannerState.id });

  return { ok: true, count: SEED.length };
}
