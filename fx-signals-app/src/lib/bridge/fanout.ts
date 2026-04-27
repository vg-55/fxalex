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
