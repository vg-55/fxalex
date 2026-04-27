import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import type { BridgeAccountRow } from "@/db/schema";
import type { EngineSignal } from "../engine";
import { isHeartbeatStale } from "./types";

// Approximate lot sizing. Conservative & symbol-aware but not broker-perfect.
// The user-set maxLot cap is the real safety net.
//
// 1 lot conventions:
//   forex majors: 100,000 base units, ~$10 / pip when USD-quoted
//   JPY-quoted:   100,000 base, but pip = 0.01 and quote is JPY (~150/USD)
//   XAUUSD:       100 oz, pip = 0.01 (so $1 per 0.01 move per lot)
function approxLots(
  balance: number,
  riskPct: number,
  stopDistance: number,
  symbol: string,
  cap: number
): number {
  if (balance <= 0 || riskPct <= 0 || stopDistance <= 0) return 0;
  const riskAmount = balance * (riskPct / 100);
  const isJpy = /JPY$/i.test(symbol);
  const isGold = /XAU/i.test(symbol);
  const isSilver = /XAG/i.test(symbol);

  let lots: number;
  if (isGold) {
    // 1 lot = 100 oz; risk = stopDistance * 100 per lot (quote in USD)
    lots = riskAmount / (stopDistance * 100);
  } else if (isSilver) {
    // 1 lot = 5000 oz typically; risk = stopDistance * 5000
    lots = riskAmount / (stopDistance * 5000);
  } else if (isJpy) {
    // 1 lot = 100k base; pip = 0.01 = ~$0.67 (assuming USDJPY ≈ 150).
    // risk = stopDistance * 100,000 / 150 (rough USDJPY conversion)
    lots = riskAmount / ((stopDistance * 100_000) / 150);
  } else {
    // Standard USD-quoted majors / minors.
    lots = riskAmount / (stopDistance * 100_000);
  }
  // Round down to 0.01 lot precision, clamp.
  lots = Math.floor(lots * 100) / 100;
  return Math.max(0.01, Math.min(lots, cap));
}

function todayBoundaryUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// Build queue rows for every eligible bridge account. No-throw: any failure
// is logged and skipped so the scanner can keep running.
export async function fanOutSignalToBridges(signal: EngineSignal): Promise<number> {
  let fanned = 0;
  let candidates: BridgeAccountRow[];
  try {
    candidates = await db
      .select()
      .from(schema.bridgeAccounts)
      .where(
        and(
          eq(schema.bridgeAccounts.enabled, true),
          eq(schema.bridgeAccounts.mode, "LIVE")
        )
      );
  } catch (err) {
    console.warn("[bridge] fan-out: select accounts failed", err);
    return 0;
  }

  for (const acc of candidates) {
    try {
      // Heartbeat-stale gate: don't queue to a dead bot.
      if (isHeartbeatStale(acc)) continue;

      // Strategy filter: signal engine emits a single combined product, so we
      // accept any account configured for COMBINED (current default).
      const strategies = Array.isArray(acc.strategies) ? (acc.strategies as string[]) : [];
      if (!strategies.includes("COMBINED")) continue;

      // Per-account symbol allow-list.
      if (Array.isArray(acc.symbols) && acc.symbols.length > 0) {
        const allow = acc.symbols as string[];
        if (!allow.includes(signal.pair)) continue;
      }

      // Risk-reward floor.
      if (signal.rr < acc.minRR) continue;

      // Need a balance to size with.
      if (acc.balance == null || acc.balance <= 0) continue;

      // Concurrent-position cap (in-flight orders for this account).
      const inflight = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.bridgeOrders)
        .where(
          and(
            eq(schema.bridgeOrders.accountId, acc.id),
            inArray(schema.bridgeOrders.status, ["QUEUED", "SENT", "FILLED"])
          )
        );
      const openCount = inflight[0]?.n ?? 0;
      if (openCount >= acc.maxConcurrent) continue;

      // Daily-loss circuit breaker.
      const todayStart = todayBoundaryUtc();
      const dayPnl = await db
        .select({ pnl: sql<number>`coalesce(sum(${schema.bridgeOrders.pnl}), 0)::float` })
        .from(schema.bridgeOrders)
        .where(
          and(
            eq(schema.bridgeOrders.accountId, acc.id),
            gte(schema.bridgeOrders.createdAt, todayStart)
          )
        );
      const cumulativePnl = dayPnl[0]?.pnl ?? 0;
      const lossPct = cumulativePnl < 0 ? (Math.abs(cumulativePnl) / acc.balance) * 100 : 0;
      if (lossPct >= acc.maxDailyLossPct) continue;

      // Sizing.
      const stopDistance = Math.abs(signal.price - signal.sl);
      const lot = approxLots(acc.balance, acc.riskPctPerTrade, stopDistance, signal.pair, acc.maxLot);
      if (lot <= 0) continue;

      await db.insert(schema.bridgeOrders).values({
        accountId: acc.id,
        signalSource: "engine",
        status: "QUEUED",
        symbol: signal.pair,
        side: signal.type,
        requestedLot: lot,
        entry: signal.price,
        sl: signal.sl,
        tp: signal.tp,
      });
      fanned++;
    } catch (err) {
      console.warn(`[bridge] fan-out: account ${acc.id} failed`, err);
    }
  }
  return fanned;
}

// ---------------------------------------------------------------------------
// Fabio fan-out — queues Fabio order-flow signals to FABIO-strategy bridges.
// Used by the dedicated /fabio-live execution lane.
// ---------------------------------------------------------------------------
export type FabioBridgeSignal = {
  pair: string;
  side: "BUY" | "SELL";
  entry: number;
  sl: number;
  tp: number;
  model: string; // FabioSignalModel — e.g. TRIPLE_A_LONG, IB_BREAKOUT_SHORT
};

// Skip queuing if the same FABIO signal (pair+side) already has an open or
// queued order on this account within the last DEDUPE window. Prevents the
// scanner re-firing every minute on the same range candle.
const FABIO_DEDUPE_MS = 60 * 60_000; // 1 hour

export async function fanOutFabioSignalToBridges(
  signal: FabioBridgeSignal
): Promise<number> {
  let fanned = 0;
  let candidates: BridgeAccountRow[];
  try {
    candidates = await db
      .select()
      .from(schema.bridgeAccounts)
      .where(
        and(
          eq(schema.bridgeAccounts.enabled, true),
          eq(schema.bridgeAccounts.mode, "LIVE")
        )
      );
  } catch (err) {
    console.warn("[bridge] fabio fan-out: select accounts failed", err);
    return 0;
  }

  const stopDistance = Math.abs(signal.entry - signal.sl);
  if (stopDistance <= 0) {
    console.warn(`[fabio] reject ${signal.pair} ${signal.side} (${signal.model}): zero stop distance`);
    return 0;
  }

  // Direction sanity — for BUY, TP must be above entry and SL below; symmetric
  // for SELL. Catches model bugs (e.g. Triple-A TP on the wrong side of POC)
  // before they hit the order book.
  const tpOnRightSide =
    signal.side === "BUY"
      ? signal.tp > signal.entry && signal.sl < signal.entry
      : signal.tp < signal.entry && signal.sl > signal.entry;
  if (!tpOnRightSide) {
    console.warn(
      `[fabio] reject ${signal.pair} ${signal.side} (${signal.model}): invalid geometry — entry=${signal.entry} sl=${signal.sl} tp=${signal.tp}`
    );
    return 0;
  }

  const rr = Math.abs(signal.tp - signal.entry) / stopDistance;

  for (const acc of candidates) {
    try {
      if (isHeartbeatStale(acc)) {
        console.warn(`[fabio] skip acc=${acc.id}: heartbeat stale`);
        continue;
      }

      // FABIO-only lane: must explicitly subscribe to FABIO.
      const strategies = Array.isArray(acc.strategies) ? (acc.strategies as string[]) : [];
      if (!strategies.includes("FABIO")) continue;

      if (Array.isArray(acc.symbols) && acc.symbols.length > 0) {
        const allow = acc.symbols as string[];
        if (!allow.includes(signal.pair)) {
          console.warn(`[fabio] skip acc=${acc.id} ${signal.pair}: not in symbol allow-list`);
          continue;
        }
      }
      if (rr < acc.minRR) {
        console.warn(
          `[fabio] skip acc=${acc.id} ${signal.pair} ${signal.side} (${signal.model}): RR ${rr.toFixed(2)} < minRR ${acc.minRR}`
        );
        continue;
      }
      if (acc.balance == null || acc.balance <= 0) {
        console.warn(`[fabio] skip acc=${acc.id}: balance not yet reported`);
        continue;
      }

      const inflight = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.bridgeOrders)
        .where(
          and(
            eq(schema.bridgeOrders.accountId, acc.id),
            inArray(schema.bridgeOrders.status, ["QUEUED", "SENT", "FILLED"])
          )
        );
      const openCount = inflight[0]?.n ?? 0;
      if (openCount >= acc.maxConcurrent) {
        console.warn(`[fabio] skip acc=${acc.id} ${signal.pair}: at maxConcurrent (${openCount}/${acc.maxConcurrent})`);
        continue;
      }

      // Daily-loss circuit breaker.
      const todayStart = todayBoundaryUtc();
      const dayPnl = await db
        .select({ pnl: sql<number>`coalesce(sum(${schema.bridgeOrders.pnl}), 0)::float` })
        .from(schema.bridgeOrders)
        .where(
          and(
            eq(schema.bridgeOrders.accountId, acc.id),
            gte(schema.bridgeOrders.createdAt, todayStart)
          )
        );
      const cumulativePnl = dayPnl[0]?.pnl ?? 0;
      const lossPct =
        cumulativePnl < 0 ? (Math.abs(cumulativePnl) / acc.balance) * 100 : 0;
      if (lossPct >= acc.maxDailyLossPct) {
        console.warn(`[fabio] skip acc=${acc.id}: daily-loss circuit-breaker tripped (${lossPct.toFixed(2)}%)`);
        continue;
      }

      // Dedupe — same pair+side already in flight or recently filed.
      const dedupeSince = new Date(Date.now() - FABIO_DEDUPE_MS);
      const existing = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.bridgeOrders)
        .where(
          and(
            eq(schema.bridgeOrders.accountId, acc.id),
            eq(schema.bridgeOrders.symbol, signal.pair),
            eq(schema.bridgeOrders.side, signal.side),
            eq(schema.bridgeOrders.signalSource, "FABIO"),
            gte(schema.bridgeOrders.createdAt, dedupeSince)
          )
        );
      if ((existing[0]?.n ?? 0) > 0) continue; // common, no log spam

      const lot = approxLots(
        acc.balance,
        acc.riskPctPerTrade,
        stopDistance,
        signal.pair,
        acc.maxLot
      );
      if (lot <= 0) {
        console.warn(`[fabio] skip acc=${acc.id} ${signal.pair}: computed lot <= 0`);
        continue;
      }

      await db.insert(schema.bridgeOrders).values({
        accountId: acc.id,
        signalSource: "FABIO",
        status: "QUEUED",
        symbol: signal.pair,
        side: signal.side,
        requestedLot: lot,
        entry: signal.entry,
        sl: signal.sl,
        tp: signal.tp,
      });
      console.info(
        `[fabio] queued ${signal.pair} ${signal.side} (${signal.model}) lot=${lot} RR=${rr.toFixed(2)} → acc=${acc.id}`
      );
      fanned++;
    } catch (err) {
      console.warn(`[bridge] fabio fan-out: account ${acc.id} failed`, err);
    }
  }
  return fanned;
}

// Cheap pre-check used by the scanner to avoid running getFabioAnalysis (which
// hits the GLM API + price-tick history) when no live FABIO bridges exist.
export async function hasLiveFabioBridges(): Promise<boolean> {
  try {
    const rows = await db
      .select({ strategies: schema.bridgeAccounts.strategies })
      .from(schema.bridgeAccounts)
      .where(
        and(
          eq(schema.bridgeAccounts.enabled, true),
          eq(schema.bridgeAccounts.mode, "LIVE")
        )
      );
    for (const r of rows) {
      const s = Array.isArray(r.strategies) ? (r.strategies as string[]) : [];
      if (s.includes("FABIO")) return true;
    }
    return false;
  } catch {
    return false;
  }
}
