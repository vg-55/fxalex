import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db, schema } from "@/db/client";

export const dynamic = "force-dynamic";

// GET /api/live/accounts/:id/orders?limit=50
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));
  const orders = await db
    .select()
    .from(schema.mt5Orders)
    .where(eq(schema.mt5Orders.accountId, id))
    .orderBy(desc(schema.mt5Orders.createdAt))
    .limit(limit);
  return NextResponse.json({
    orders: orders.map((o) => ({
      ...o,
      openedAt: o.openedAt?.toISOString() ?? null,
      closedAt: o.closedAt?.toISOString() ?? null,
      createdAt: o.createdAt.toISOString(),
    })),
  });
}
