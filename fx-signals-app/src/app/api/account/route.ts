import { NextResponse, type NextRequest } from "next/server";
import { db, assertDb, schema } from "@/db/client";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

async function readSettings() {
  const rows = await db.select().from(schema.accountSettings).where(eq(schema.accountSettings.id, 1));
  if (rows.length > 0) return rows[0];
  // Seed defaults on first access
  const [row] = await db
    .insert(schema.accountSettings)
    .values({ id: 1, equity: 10000, riskPerTradePct: 1, maxConcurrent: 3 })
    .onConflictDoNothing({ target: schema.accountSettings.id })
    .returning();
  if (row) return row;
  // Race: read back
  const re = await db.select().from(schema.accountSettings).where(eq(schema.accountSettings.id, 1));
  return re[0];
}

export async function GET() {
  try {
    assertDb();
    const settings = await readSettings();
    return NextResponse.json(settings, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "account error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    assertDb();
    const body = await req.json().catch(() => ({}));

    const patch: Partial<{
      equity: number;
      riskPerTradePct: number;
      maxConcurrent: number;
    }> = {};
    if (typeof body.equity === "number" && body.equity >= 0 && body.equity <= 10_000_000) {
      patch.equity = body.equity;
    }
    if (
      typeof body.riskPerTradePct === "number" &&
      body.riskPerTradePct > 0 &&
      body.riskPerTradePct <= 10
    ) {
      patch.riskPerTradePct = body.riskPerTradePct;
    }
    if (
      typeof body.maxConcurrent === "number" &&
      Number.isInteger(body.maxConcurrent) &&
      body.maxConcurrent >= 1 &&
      body.maxConcurrent <= 20
    ) {
      patch.maxConcurrent = body.maxConcurrent;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "no valid fields" }, { status: 400 });
    }

    await readSettings(); // ensure row exists
    const [updated] = await db
      .update(schema.accountSettings)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.accountSettings.id, 1))
      .returning();

    return NextResponse.json(updated, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "account update error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
