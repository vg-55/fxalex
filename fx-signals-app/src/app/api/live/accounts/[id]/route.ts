import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { encryptSecret } from "@/lib/mt5/crypto";
import { deleteAccount as metaDelete } from "@/lib/mt5/metaapi";
import { toPublic, validatePatch } from "@/lib/mt5/types";

export const dynamic = "force-dynamic";

async function findAccount(id: string) {
  const rows = await db
    .select()
    .from(schema.mt5Accounts)
    .where(eq(schema.mt5Accounts.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await findAccount(id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ account: toPublic(row) });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await findAccount(id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const v = validatePatch(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const patch = v.value;

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.label !== undefined) updates.label = patch.label;
  if (patch.broker !== undefined) updates.broker = patch.broker;
  // server / login / password require re-provisioning on MetaApi side; for
  // safety we don't allow editing them in-place — the user should delete and
  // recreate the account. Surface a clear error.
  if (patch.server !== undefined && patch.server !== row.server) {
    return NextResponse.json(
      { error: "server cannot be changed on an existing account; delete and recreate" },
      { status: 400 }
    );
  }
  if (patch.login !== undefined && patch.login !== row.login) {
    return NextResponse.json(
      { error: "login cannot be changed on an existing account; delete and recreate" },
      { status: 400 }
    );
  }
  if (patch.password !== undefined) {
    updates.passwordEnc = encryptSecret(patch.password);
    // (For real password rotation we'd also POST to MetaApi /users/current/accounts/:id)
  }
  if (patch.region !== undefined) updates.metaapiRegion = patch.region;
  if (patch.strategies !== undefined) updates.strategies = patch.strategies;
  if (patch.symbols !== undefined) updates.symbols = patch.symbols;
  if (patch.riskPctPerTrade !== undefined) updates.riskPctPerTrade = patch.riskPctPerTrade;
  if (patch.maxConcurrent !== undefined) updates.maxConcurrent = patch.maxConcurrent;
  if (patch.maxDailyLossPct !== undefined) updates.maxDailyLossPct = patch.maxDailyLossPct;
  if (patch.maxLot !== undefined) updates.maxLot = patch.maxLot;
  if (patch.minRR !== undefined) updates.minRR = patch.minRR;
  if (patch.mode !== undefined) updates.mode = patch.mode;

  const [updated] = await db
    .update(schema.mt5Accounts)
    .set(updates)
    .where(eq(schema.mt5Accounts.id, id))
    .returning();

  await db.insert(schema.mt5Audit).values({
    accountId: id,
    level: "info",
    event: "account_updated",
    detail: { fields: Object.keys(updates).filter((k) => k !== "updatedAt") },
  });

  return NextResponse.json({ account: toPublic(updated) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await findAccount(id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Best-effort delete on MetaApi side; if it fails we still remove locally.
  if (row.metaapiAccountId) {
    try {
      await metaDelete(row.metaapiAccountId);
    } catch {
      /* swallow — account may already be gone, or net error */
    }
  }
  await db.delete(schema.mt5Accounts).where(eq(schema.mt5Accounts.id, id));
  await db.insert(schema.mt5Audit).values({
    accountId: id,
    level: "warn",
    event: "account_deleted",
    detail: { metaapiAccountId: row.metaapiAccountId },
  });
  return NextResponse.json({ ok: true });
}
