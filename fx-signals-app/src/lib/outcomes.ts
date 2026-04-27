// Outcome evaluator — inspects recent price ticks to decide whether previously
// ACTIVE signals have hit TP or SL, and writes rows to signal_outcomes.

import { db, schema } from "@/db/client";
import { and, eq, gte, desc } from "drizzle-orm";

export type OutcomeResult = "TP" | "SL" | "EXPIRED";

type ActiveSignal = typeof schema.signals.$inferSelect;

/**
 * For a signal that WAS ACTIVE last scan, walk the ticks since it went ACTIVE
 * and decide if price reached TP or SL. If neither, no outcome yet.
 * Returns the set of pairs that produced an outcome this scan.
 */
export async function evaluateOutcomes(
  prevActive: ActiveSignal[],
  nowSignals: Map<string, { status: string }>
): Promise<{ written: number; closedPairs: Set<string> }> {
  let written = 0;
  const closedPairs = new Set<string>();

  for (const prev of prevActive) {
    if (prev.status !== "ACTIVE") continue;
    const next = nowSignals.get(prev.pair);
    // Only close when it's no longer ACTIVE (moved away / hit something)
    if (next && next.status === "ACTIVE") continue;

    // Anchor to first-ACTIVE timestamp from the locked snapshot when present;
    // fall back to prev.updatedAt for legacy rows.
    const factors = (prev.factors ?? {}) as { _locked?: { at: string; entry: number; sl: number; tp: number; type: "BUY" | "SELL" } };
    const lockedAt = factors._locked?.at ? new Date(factors._locked.at) : null;
    const since = lockedAt && !Number.isNaN(lockedAt.getTime()) ? lockedAt : prev.updatedAt;

    // Use frozen levels (the trade's actual entry, not a recomputed value).
    const entry = factors._locked?.entry ?? prev.price;
    const sl = factors._locked?.sl ?? prev.sl;
    const tp = factors._locked?.tp ?? prev.tp;
    const isBuy = (factors._locked?.type ?? prev.type) === "BUY";

    const ticks = await db
      .select({
        price: schema.priceTicks.price,
        fetchedAt: schema.priceTicks.fetchedAt,
      })
      .from(schema.priceTicks)
      .where(
        and(
          eq(schema.priceTicks.pair, prev.pair),
          gte(schema.priceTicks.fetchedAt, since)
        )
      )
      .orderBy(desc(schema.priceTicks.fetchedAt))
      .limit(500);

    if (ticks.length === 0) continue;

    // Walk oldest → newest
    ticks.reverse();

    let result: OutcomeResult | null = null;
    let hitAt: Date | null = null;

    for (const t of ticks) {
      const px = t.price;
      if (isBuy) {
        if (px <= sl) {
          result = "SL";
          hitAt = t.fetchedAt;
          break;
        }
        if (px >= tp) {
          result = "TP";
          hitAt = t.fetchedAt;
          break;
        }
      } else {
        if (px >= sl) {
          result = "SL";
          hitAt = t.fetchedAt;
          break;
        }
        if (px <= tp) {
          result = "TP";
          hitAt = t.fetchedAt;
          break;
        }
      }
    }

    if (!result || !hitAt) continue;

    // R-multiple = (exit − entry) / risk-per-unit, sign-flipped for shorts.
    // risk = |entry − sl|. exit = tp on TP, sl on SL.
    const risk = Math.abs(entry - sl);
    const rPnl = (() => {
      if (risk === 0) return result === "TP" ? 1 : -1; // degenerate guard
      const exit = result === "TP" ? tp : sl;
      const raw = (exit - entry) / risk;
      return isBuy ? raw : -raw;
    })();

    const holdMinutes = Math.max(
      0,
      Math.round((hitAt.getTime() - since.getTime()) / 60_000)
    );

    await db.insert(schema.signalOutcomes).values({
      pair: prev.pair,
      type: factors._locked?.type ?? prev.type,
      entry,
      sl,
      tp,
      result,
      rPnl,
      enteredAt: since,
      closedAt: hitAt,
      holdMinutes,
    });
    closedPairs.add(prev.pair);
    written++;
  }

  return { written, closedPairs };
}
