import { NextResponse } from "next/server";
import { db, assertDb, schema } from "@/db/client";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    assertDb();
    const url = new URL(req.url);
    const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") ?? "60", 10)));
    const pairs = ["XAUUSD", "EURUSD", "GBPUSD"] as const;

    const byPair: Record<string, { price: number; fetchedAt: string }[]> = {};
    for (const pair of pairs) {
      const rows = await db
        .select({
          price: schema.priceTicks.price,
          fetchedAt: schema.priceTicks.fetchedAt,
        })
        .from(schema.priceTicks)
        .where(eq(schema.priceTicks.pair, pair))
        .orderBy(desc(schema.priceTicks.fetchedAt))
        .limit(limit);
      byPair[pair] = rows.map((r) => ({
        price: r.price,
        fetchedAt: r.fetchedAt.toISOString(),
      }));
    }

    return NextResponse.json({ byPair }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "price ticks error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
