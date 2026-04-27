import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db, schema } from "@/db/client";

export const dynamic = "force-dynamic";

// GET /api/live/accounts/:id/audit?limit=100
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") ?? "100", 10) || 100));
  const rows = await db
    .select()
    .from(schema.mt5Audit)
    .where(eq(schema.mt5Audit.accountId, id))
    .orderBy(desc(schema.mt5Audit.at))
    .limit(limit);
  return NextResponse.json({
    audit: rows.map((r) => ({ ...r, at: r.at.toISOString() })),
  });
}
