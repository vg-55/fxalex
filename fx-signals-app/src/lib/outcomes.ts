// Outcome evaluator — inspects recent price ticks to decide whether previously
// ACTIVE signals have hit TP or SL, and writes rows to signal_outcomes.

import { db, schema } from "@/db/client";
import { and, eq, gte, desc } from "drizzle-orm";

export type OutcomeResult = "TP" | "SL" | "EXPIRED";

type ActiveSignal = typeof schema.signals.$inferSelect;

/**
 * For a signal that WAS ACTIVE last scan, walk the ticks since it went ACTIVE
 * and decide if price reached TP or SL. If neither, no outcome yet.
 * Returns the number of outcomes written.
 */
export async function evaluateOutcomes(
  prevActive: ActiveSignal[],
  nowSignals: Map<string, { status: string }>
): Promise<number> {
  let written = 0;

  for (const prev of prevActive) {
    if (prev.status !== "ACTIVE") continue;
    const next = nowSignals.get(prev.pair);
    // Only close when it's no longer ACTIVE (moved away / hit something)
    if (next && next.status === "ACTIVE") continue;

    // Look at ticks since this signal was last marked ACTIVE
    const since = prev.updatedAt;
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

    const entry = prev.price;
    const sl = prev.sl;
    const tp = prev.tp;
    const isBuy = prev.type === "BUY";

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

    const rPnl = result === "TP" ? 2 : -1;
    const holdMinutes = Math.max(
      0,
      Math.round((hitAt.getTime() - since.getTime()) / 60_000)
    );

    await db.insert(schema.signalOutcomes).values({
      pair: prev.pair,
      type: prev.type,
      entry,
      sl,
      tp,
      result,
      rPnl,
      enteredAt: since,
      closedAt: hitAt,
      holdMinutes,
    });
    written++;
  }

  return written;
}
