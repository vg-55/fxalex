import { NextResponse } from "next/server";
import { getCurrentSignals } from "@/lib/scanner";
import type { SignalRow } from "@/db/schema";

export const dynamic = "force-dynamic";

export type SignalStatus = "ACTIVE" | "PENDING" | "WATCHING";

export async function GET() {
  try {
    const { signals, state } = await getCurrentSignals();
    return NextResponse.json(
      {
        signals: signals.map((s: SignalRow) => ({
          id: s.pair,
          pair: s.pair,
          type: s.type,
          status: s.status,
          price: s.price.toFixed(s.pair === "XAUUSD" ? 2 : 4),
          sl: s.sl.toFixed(s.pair === "XAUUSD" ? 2 : 4),
          tp: s.tp.toFixed(s.pair === "XAUUSD" ? 2 : 4),
          rr: `1:${s.rr.toFixed(1)}`,
          timestamp: s.updatedAt.toISOString(),
          aoi: s.aoi,
          timeframe: s.timeframe,
          tvSymbol: s.tvSymbol,
          session: s.session,
          trend: s.trend,
          aiConfidence: s.aiConfidence,
          factors: s.factors,
          aiInterpretation: s.aiInterpretation,
          changePercent: s.changePct ?? undefined,
          dayHigh: s.dayHigh ?? undefined,
          dayLow: s.dayLow ?? undefined,
          liveEma50: s.liveEma50 ?? undefined,
          dailyEma50: s.dailyEma50 ?? undefined,
          trendAligned: s.trendAligned,
          atr: s.atr ?? undefined,
          rejectionConfirmed: s.rejectionConfirmed,
          newsBlocked: s.newsBlocked,
          nextEvent: s.nextEvent ?? undefined,
          isStale: s.isStale,
        })),
        fetchedAt: state?.lastOkAt?.toISOString() ?? null,
        activeProvider: state?.activeProvider ?? null,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "signals error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
