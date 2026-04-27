import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { buildPatch, toPublic } from "@/lib/bridge/types";
import { mintToken } from "@/lib/bridge/auth";

export const dynamic = "force-dynamic";

async function find(id: string) {
  const r = await db
    .select()
    .from(schema.bridgeAccounts)
    .where(eq(schema.bridgeAccounts.id, id))
    .limit(1);
  return r[0] ?? null;
}

// GET /api/bridge/accounts/[id] — detail + recent orders.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await find(id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const recent = await db
    .select()
    .from(schema.bridgeOrders)
    .where(eq(schema.bridgeOrders.accountId, id))
    .orderBy(desc(schema.bridgeOrders.createdAt))
    .limit(50);

  return NextResponse.json({
    account: toPublic(row),
    recentOrders: recent.map((o) => ({
      id: o.id,
      status: o.status,
      symbol: o.symbol,
      side: o.side,
      requestedLot: o.requestedLot,
      filledLot: o.filledLot,
      entry: o.entry,
      sl: o.sl,
      tp: o.tp,
      fillPrice: o.fillPrice,
      pnl: o.pnl,
      rejectionReason: o.rejectionReason,
      createdAt: o.createdAt.toISOString(),
      filledAt: o.filledAt?.toISOString() ?? null,
      closedAt: o.closedAt?.toISOString() ?? null,
    })),
  });
}

// PATCH /api/bridge/accounts/[id] — update mode/strategies/risk/etc.
// Special: { rotateToken: true } generates a fresh bearer, returns it once.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await find(id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  let newToken: string | undefined;
  const updates = buildPatch(body);
  if (body.rotateToken === true) {
    const { token, hash } = mintToken();
    newToken = token;
    updates.bearerTokenHash = hash;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no valid fields in body" }, { status: 400 });
  }
  updates.updatedAt = new Date();

  const [updated] = await db
    .update(schema.bridgeAccounts)
    .set(updates)
    .where(eq(schema.bridgeAccounts.id, id))
    .returning();

  return NextResponse.json({ account: toPublic(updated), token: newToken });
}

// DELETE /api/bridge/accounts/[id] — cascade-deletes the order ledger.
// Cancel any pending orders first so the bot doesn't pick them up between
// fan-out and FK cascade (defence in depth).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await find(id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  await db
    .update(schema.bridgeOrders)
    .set({ status: "CANCELLED", closedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.bridgeOrders.accountId, id),
        eq(schema.bridgeOrders.status, "QUEUED")
      )
    );
  await db.delete(schema.bridgeAccounts).where(eq(schema.bridgeAccounts.id, id));
  return NextResponse.json({ ok: true });
}
