import { db, assertDb, schema } from "./client";

type Seed = Omit<typeof schema.instruments.$inferInsert, "updatedAt">;

const SEED: Seed[] = [
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
