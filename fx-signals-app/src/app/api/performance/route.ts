import { NextResponse } from "next/server";
import { db, assertDb, schema } from "@/db/client";
import { desc, gte, eq, and, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

type RangeKey = "7d" | "30d" | "90d" | "all";
const RANGE_DAYS: Record<RangeKey, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};

/**
 * Recompute R-multiple from stored entry/sl/tp/result so historical rows
 * written before the rPnl fix still get correct numbers.
 */
function recomputeR(o: typeof schema.signalOutcomes.$inferSelect): number {
  const risk = Math.abs(o.entry - o.sl);
  if (risk === 0) return o.result === "TP" ? 1 : -1;
  const isBuy = o.type === "BUY";
  const exit = o.result === "TP" ? o.tp : o.sl;
  const raw = (exit - o.entry) / risk;
  return isBuy ? raw : -raw;
}

export async function GET(req: Request) {
  try {
    assertDb();
    const url = new URL(req.url);
    const rangeParam = (url.searchParams.get("range") as RangeKey) || "30d";
    const days = RANGE_DAYS[rangeParam] ?? null;

    const baseQuery = db
      .select()
      .from(schema.signalOutcomes)
      .orderBy(desc(schema.signalOutcomes.closedAt));

    const since = days !== null ? new Date(Date.now() - days * 86_400_000) : null;
    const rows = since
      ? await baseQuery.where(gte(schema.signalOutcomes.closedAt, since)).limit(2000)
      : await baseQuery.limit(2000);

    // Augment each row with the corrected R
    const outcomes = rows.map((o) => ({ ...o, rR: recomputeR(o) }));

    const total = outcomes.length;
    const wins = outcomes.filter((o) => o.result === "TP").length;
    const losses = outcomes.filter((o) => o.result === "SL").length;
    const winRate = total > 0 ? wins / total : 0;

    const totalR = outcomes.reduce((a, o) => a + o.rR, 0);
    const avgR = total > 0 ? totalR / total : 0;

    const winRows = outcomes.filter((o) => o.rR > 0);
    const lossRows = outcomes.filter((o) => o.rR < 0);
    const grossWin = winRows.reduce((a, o) => a + o.rR, 0);
    const grossLoss = Math.abs(lossRows.reduce((a, o) => a + o.rR, 0));
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
    const avgWin = winRows.length > 0 ? grossWin / winRows.length : 0;
    const avgLoss = lossRows.length > 0 ? grossLoss / lossRows.length : 0;
    const lossRate = total > 0 ? lossRows.length / total : 0;
    const expectancy = winRate * avgWin - lossRate * avgLoss;

    const bestTrade = outcomes.reduce<number | null>(
      (a, o) => (a === null || o.rR > a ? o.rR : a),
      null
    );
    const worstTrade = outcomes.reduce<number | null>(
      (a, o) => (a === null || o.rR < a ? o.rR : a),
      null
    );

    const avgHoldMinutes = total > 0 ? outcomes.reduce((a, o) => a + o.holdMinutes, 0) / total : 0;

    // Per-pair
    type PairAgg = { trades: number; wins: number; totalR: number; best: number; worst: number };
    const byPair = new Map<string, PairAgg>();
    for (const o of outcomes) {
      const k = o.pair;
      const cur = byPair.get(k) ?? { trades: 0, wins: 0, totalR: 0, best: -Infinity, worst: Infinity };
      cur.trades++;
      if (o.result === "TP") cur.wins++;
      cur.totalR += o.rR;
      cur.best = Math.max(cur.best, o.rR);
      cur.worst = Math.min(cur.worst, o.rR);
      byPair.set(k, cur);
    }
    const pairStats = Array.from(byPair.entries())
      .map(([pair, v]) => ({
        pair,
        trades: v.trades,
        winRate: v.trades > 0 ? v.wins / v.trades : 0,
        totalR: v.totalR,
        bestR: v.best === -Infinity ? 0 : v.best,
        worstR: v.worst === Infinity ? 0 : v.worst,
      }))
      .sort((a, b) => b.totalR - a.totalR);

    // Equity curve (oldest → newest) + running drawdown
    const chronological = [...outcomes].reverse();
    let running = 0;
    let peak = 0;
    let maxDrawdownR = 0;
    const equityCurve = chronological.map((o) => {
      running += o.rR;
      if (running > peak) peak = running;
      const dd = peak - running;
      if (dd > maxDrawdownR) maxDrawdownR = dd;
      return {
        closedAt: o.closedAt.toISOString(),
        pair: o.pair,
        result: o.result,
        rR: Number(o.rR.toFixed(3)),
        cumR: Number(running.toFixed(3)),
        ddR: Number(dd.toFixed(3)),
      };
    });
    const currentDrawdownR = peak - running;

    // Streak (latest run of same result) + last 20 results for pill row
    let streakType: "W" | "L" | null = null;
    let streak = 0;
    for (const o of outcomes) {
      const t = o.result === "TP" ? "W" : "L";
      if (streakType === null) {
        streakType = t;
        streak = 1;
      } else if (streakType === t) streak++;
      else break;
    }
    const recentResults = outcomes.slice(0, 20).map((o) => (o.result === "TP" ? "W" : "L"));

    // -------- Live open trades (ACTIVE signals + floating R) --------------
    const activeSignals = await db
      .select()
      .from(schema.signals)
      .where(eq(schema.signals.status, "ACTIVE"));

    type LatestPrice = { pair: string; price: number; fetchedAt: Date };
    const latestByPair = new Map<string, LatestPrice>();
    if (activeSignals.length > 0) {
      const pairs = activeSignals.map((s) => s.pair);
      // Pull recent ticks for these pairs and keep the newest per pair.
      const tickRows = await db
        .select({
          pair: schema.priceTicks.pair,
          price: schema.priceTicks.price,
          fetchedAt: schema.priceTicks.fetchedAt,
        })
        .from(schema.priceTicks)
        .where(
          and(
            inArray(schema.priceTicks.pair, pairs),
            gte(schema.priceTicks.fetchedAt, new Date(Date.now() - 10 * 60_000))
          )
        )
        .orderBy(desc(schema.priceTicks.fetchedAt))
        .limit(500);
      for (const t of tickRows) {
        if (!latestByPair.has(t.pair)) {
          latestByPair.set(t.pair, { pair: t.pair, price: t.price, fetchedAt: t.fetchedAt });
        }
      }
    }

    const openTrades = activeSignals.map((s) => {
      const live = latestByPair.get(s.pair);
      const price = live?.price ?? s.price;
      const risk = Math.abs(s.price - s.sl);
      const isBuy = s.type === "BUY";
      const raw = risk > 0 ? (price - s.price) / risk : 0;
      const floatingR = isBuy ? raw : -raw;
      // Progress to TP as a 0..1 number (negative = drawdown towards SL).
      const targetDist = Math.abs(s.tp - s.price);
      const slDist = Math.abs(s.price - s.sl);
      const moved = isBuy ? price - s.price : s.price - price;
      const progressToTp = targetDist > 0 ? Math.max(-1, Math.min(1, moved / targetDist)) : 0;
      const progressToSl = slDist > 0 ? Math.max(0, Math.min(1, -moved / slDist)) : 0;
      return {
        pair: s.pair,
        type: s.type,
        entry: s.price,
        sl: s.sl,
        tp: s.tp,
        currentPrice: price,
        priceAge: live ? Date.now() - live.fetchedAt.getTime() : null,
        floatingR: Number(floatingR.toFixed(3)),
        progressToTp: Number(progressToTp.toFixed(3)),
        progressToSl: Number(progressToSl.toFixed(3)),
        aiConfidence: s.aiConfidence,
        timeframe: s.timeframe,
        enteredAt: s.updatedAt.toISOString(),
      };
    });
    const openFloatingR = openTrades.reduce((a, t) => a + t.floatingR, 0);

    // Day-of-week breakdown (UTC)
    type DowAgg = { trades: number; wins: number; totalR: number };
    const dow: DowAgg[] = Array.from({ length: 7 }, () => ({ trades: 0, wins: 0, totalR: 0 }));
    for (const o of outcomes) {
      const d = new Date(o.closedAt).getUTCDay();
      dow[d].trades++;
      if (o.result === "TP") dow[d].wins++;
      dow[d].totalR += o.rR;
    }
    const dayOfWeek = dow.map((v, i) => ({
      day: i, // 0 = Sun
      trades: v.trades,
      winRate: v.trades > 0 ? v.wins / v.trades : 0,
      totalR: v.totalR,
    }));

    return NextResponse.json(
      {
        range: rangeParam,
        totalTrades: total,
        wins,
        losses,
        winRate,
        totalR,
        avgR,
        avgWin,
        avgLoss,
        expectancy,
        profitFactor: Number.isFinite(profitFactor) ? profitFactor : null,
        bestTrade: bestTrade ?? 0,
        worstTrade: worstTrade ?? 0,
        avgHoldMinutes,
        maxDrawdownR,
        currentDrawdownR,
        pairStats,
        equityCurve,
        dayOfWeek,
        recent: outcomes.slice(0, 50).map((o) => ({
          id: o.id,
          pair: o.pair,
          type: o.type,
          result: o.result,
          rPnl: Number(o.rR.toFixed(3)),
          entry: o.entry,
          sl: o.sl,
          tp: o.tp,
          lotSize: o.lotSize ?? null,
          enteredAt: o.enteredAt.toISOString(),
          closedAt: o.closedAt.toISOString(),
          holdMinutes: o.holdMinutes,
        })),
        streak: { type: streakType, count: streak },
        recentResults,
        openTrades,
        openFloatingR: Number(openFloatingR.toFixed(3)),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "performance error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
