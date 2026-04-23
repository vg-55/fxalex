import { NextResponse } from "next/server";
import { db, assertDb, schema } from "@/db/client";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    assertDb();
    const outcomes = await db
      .select()
      .from(schema.signalOutcomes)
      .orderBy(desc(schema.signalOutcomes.closedAt))
      .limit(500);

    const total = outcomes.length;
    const wins = outcomes.filter((o) => o.result === "TP").length;
    const losses = outcomes.filter((o) => o.result === "SL").length;
    const winRate = total > 0 ? wins / total : 0;
    const totalR = outcomes.reduce((a, o) => a + o.rPnl, 0);
    const avgR = total > 0 ? totalR / total : 0;
    const grossWin = outcomes.filter((o) => o.rPnl > 0).reduce((a, o) => a + o.rPnl, 0);
    const grossLoss = Math.abs(outcomes.filter((o) => o.rPnl < 0).reduce((a, o) => a + o.rPnl, 0));
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
    const avgHoldMinutes =
      total > 0 ? outcomes.reduce((a, o) => a + o.holdMinutes, 0) / total : 0;

    // Per-pair breakdown
    const byPair: Record<string, { trades: number; wins: number; totalR: number }> = {};
    for (const o of outcomes) {
      const k = o.pair;
      if (!byPair[k]) byPair[k] = { trades: 0, wins: 0, totalR: 0 };
      byPair[k].trades++;
      if (o.result === "TP") byPair[k].wins++;
      byPair[k].totalR += o.rPnl;
    }
    const pairStats = Object.entries(byPair).map(([pair, v]) => ({
      pair,
      trades: v.trades,
      winRate: v.trades > 0 ? v.wins / v.trades : 0,
      totalR: v.totalR,
    }));
    pairStats.sort((a, b) => b.totalR - a.totalR);

    // Equity curve (oldest → newest)
    const chronological = [...outcomes].reverse();
    let running = 0;
    const equityCurve = chronological.map((o) => {
      running += o.rPnl;
      return {
        closedAt: o.closedAt.toISOString(),
        pair: o.pair,
        result: o.result,
        cumR: running,
      };
    });

    // Current streak (consecutive same-result)
    let streakType: "W" | "L" | null = null;
    let streak = 0;
    for (const o of outcomes) {
      const t = o.result === "TP" ? "W" : "L";
      if (streakType === null) {
        streakType = t;
        streak = 1;
      } else if (streakType === t) {
        streak++;
      } else break;
    }

    return NextResponse.json(
      {
        totalTrades: total,
        wins,
        losses,
        winRate,
        totalR,
        avgR,
        profitFactor: Number.isFinite(profitFactor) ? profitFactor : null,
        avgHoldMinutes,
        pairStats,
        equityCurve,
        recent: outcomes.slice(0, 20).map((o) => ({
          id: o.id,
          pair: o.pair,
          type: o.type,
          result: o.result,
          rPnl: o.rPnl,
          entry: o.entry,
          sl: o.sl,
          tp: o.tp,
          enteredAt: o.enteredAt.toISOString(),
          closedAt: o.closedAt.toISOString(),
          holdMinutes: o.holdMinutes,
        })),
        streak: { type: streakType, count: streak },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "performance error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
