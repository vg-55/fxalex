import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { toPublic } from "@/lib/ctrader/types";

export const dynamic = "force-dynamic";

async function find(id: string) {
  const r = await db
    .select()
    .from(schema.ctraderAccounts)
    .where(eq(schema.ctraderAccounts.id, id))
    .limit(1);
  return r[0] ?? null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await find(id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ account: toPublic(row) });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await find(id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const ALLOWED_MODES = new Set(["OFF", "SHADOW", "LIVE"]);
  const ALLOWED_STRATS = new Set(["ALEX", "FABIO", "COMBINED"]);

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.label === "string" && body.label.trim()) updates.label = body.label.trim();
  if (typeof body.mode === "string" && ALLOWED_MODES.has(body.mode)) updates.mode = body.mode;
  if (Array.isArray(body.strategies)) {
    updates.strategies = body.strategies.filter(
      (x): x is string => typeof x === "string" && ALLOWED_STRATS.has(x)
    );
  }
  if (body.symbols === null) updates.symbols = null;
  else if (Array.isArray(body.symbols)) {
    updates.symbols = body.symbols.filter(
      (x): x is string => typeof x === "string" && x.length <= 16
    );
  }
  if (typeof body.riskPctPerTrade === "number" && body.riskPctPerTrade > 0 && body.riskPctPerTrade <= 5)
    updates.riskPctPerTrade = body.riskPctPerTrade;
  if (typeof body.maxConcurrent === "number" && body.maxConcurrent >= 1 && body.maxConcurrent <= 20)
    updates.maxConcurrent = Math.floor(body.maxConcurrent);
  if (typeof body.maxDailyLossPct === "number" && body.maxDailyLossPct > 0 && body.maxDailyLossPct <= 50)
    updates.maxDailyLossPct = body.maxDailyLossPct;
  if (typeof body.maxLot === "number" && body.maxLot > 0 && body.maxLot <= 100)
    updates.maxLot = body.maxLot;
  if (typeof body.minRR === "number" && body.minRR >= 0.5 && body.minRR <= 10)
    updates.minRR = body.minRR;

  const [updated] = await db
    .update(schema.ctraderAccounts)
    .set(updates)
    .where(eq(schema.ctraderAccounts.id, id))
    .returning();

  return NextResponse.json({ account: toPublic(updated) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await find(id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  // We don't revoke the OAuth grant on Spotware here — user can do that from
  // their cTrader account → Connected Apps page. We just drop our tokens.
  await db.delete(schema.ctraderAccounts).where(eq(schema.ctraderAccounts.id, id));
  return NextResponse.json({ ok: true });
}
