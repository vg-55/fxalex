import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { authenticateBridge } from "@/lib/bridge/auth";
import { orderForBot, toPublic } from "@/lib/bridge/types";

export const dynamic = "force-dynamic";

// GET /api/bridge/poll
//
// The bot's only mandatory call. Bearer-authenticated.
//
// Atomic claim: a single SQL UPDATE...WHERE status='QUEUED' RETURNING * flips
// every queued row for this account to 'SENT' and returns them in one round
// trip. Two concurrent polls (e.g. duplicate bot instances) cannot both
// receive the same order — Postgres serialises the UPDATE.
//
// Response shape:
//   { account: BridgeAccountPublic, queued: BridgeOrderForBot[] }
//
// The bot then executes each queued order on its local trading platform and
// reports the result via POST /api/bridge/ack.
export async function GET(req: Request) {
  const account = await authenticateBridge(req);
  if (!account) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Update lastPolledAt — best effort, never fail the request on this.
  const now = new Date();
  await db
    .update(schema.bridgeAccounts)
    .set({ lastPolledAt: now, updatedAt: now })
    .where(eq(schema.bridgeAccounts.id, account.id))
    .catch(() => undefined);

  // Atomic claim. Status check inside WHERE is the dedup guarantee.
  const claimed = await db
    .update(schema.bridgeOrders)
    .set({ status: "SENT", sentAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.bridgeOrders.accountId, account.id),
        eq(schema.bridgeOrders.status, "QUEUED")
      )
    )
    .returning();

  // Re-fetch the account row so toPublic() uses the freshly-set
  // lastPolledAt and the UI dot reads green immediately.
  const refreshed =
    (
      await db
        .select()
        .from(schema.bridgeAccounts)
        .where(eq(schema.bridgeAccounts.id, account.id))
        .limit(1)
    )[0] ?? account;

  const overrides =
    refreshed.symbolOverrides && typeof refreshed.symbolOverrides === "object"
      ? (refreshed.symbolOverrides as Record<string, string>)
      : null;

  return NextResponse.json({
    account: toPublic(refreshed),
    queued: claimed.map((row) => orderForBot(row, overrides)),
    serverTime: now.toISOString(),
  });
}
