import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { getAccount, getAccountInformation } from "@/lib/mt5/metaapi";
import { toPublic } from "@/lib/mt5/types";

export const dynamic = "force-dynamic";

// Force-refresh an account snapshot from MetaApi → broker.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await db
    .select()
    .from(schema.mt5Accounts)
    .where(eq(schema.mt5Accounts.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!row.metaapiAccountId) {
    return NextResponse.json({ error: "account has no MetaApi id" }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updatedAt: new Date(), lastSyncedAt: new Date() };
  let lastError: string | null = null;

  try {
    const info = await getAccount(row.metaapiAccountId);
    updates.metaapiState = info.state;
  } catch (err) {
    lastError = err instanceof Error ? err.message : "metaapi state error";
  }

  // Only attempt the broker-side info fetch when MetaApi has the account
  // deployed — otherwise a 4xx is expected and shouldn't surface as a red
  // banner on the account row.
  const isDeployed = updates.metaapiState === "DEPLOYED";
  if (isDeployed) {
    try {
      const acct = await getAccountInformation(row.metaapiAccountId, row.metaapiRegion);
      updates.balance = acct.balance;
      updates.equity = acct.equity;
      updates.margin = acct.margin;
      updates.marginLevel = acct.marginLevel;
      updates.currency = acct.currency;
      updates.broker = acct.broker;
    } catch (err) {
      if (!lastError) lastError = err instanceof Error ? err.message : "account info error";
    }
  }

  // When the connection is healthy, clear any stale error from a previous sync.
  updates.lastError = lastError;

  const [updated] = await db
    .update(schema.mt5Accounts)
    .set(updates)
    .where(eq(schema.mt5Accounts.id, id))
    .returning();

  await db.insert(schema.mt5Audit).values({
    accountId: id,
    level: lastError ? "warn" : "info",
    event: "sync",
    detail: { state: updates.metaapiState, error: lastError },
  });

  return NextResponse.json({ account: toPublic(updated), error: lastError });
}
