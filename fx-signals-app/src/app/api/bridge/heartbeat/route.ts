import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { authenticateBridge } from "@/lib/bridge/auth";

export const dynamic = "force-dynamic";

// POST /api/bridge/heartbeat
//
// Body: {
//   balance?: number,
//   equity?: number,
//   marginLevel?: number,
//   openPositions?: number,
//   currency?: string,
//   accountLogin?: string,
//   brokerName?: string,
//   botVersion?: string
// }
//
// Updates the account snapshot. If the bot stops sending heartbeats for >5min,
// the engine fan-out logic stops queueing new orders to it (see lib/engine.ts).
export async function POST(req: Request) {
  const account = await authenticateBridge(req);
  if (!account) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const now = new Date();
  const updates: Record<string, unknown> = {
    lastHeartbeatAt: now,
    lastError: null,
    updatedAt: now,
  };
  if (typeof body.balance === "number" && Number.isFinite(body.balance))
    updates.balance = body.balance;
  if (typeof body.equity === "number" && Number.isFinite(body.equity))
    updates.equity = body.equity;
  if (typeof body.marginLevel === "number" && Number.isFinite(body.marginLevel))
    updates.marginLevel = body.marginLevel;
  if (typeof body.openPositions === "number" && body.openPositions >= 0)
    updates.openPositions = Math.floor(body.openPositions);
  if (typeof body.currency === "string" && body.currency.length <= 8)
    updates.currency = body.currency;
  if (typeof body.accountLogin === "string" && body.accountLogin.length <= 32)
    updates.accountLogin = body.accountLogin;
  if (typeof body.brokerName === "string" && body.brokerName.length <= 64)
    updates.brokerName = body.brokerName;
  if (typeof body.botVersion === "string" && body.botVersion.length <= 32)
    updates.botVersion = body.botVersion;

  await db
    .update(schema.bridgeAccounts)
    .set(updates)
    .where(eq(schema.bridgeAccounts.id, account.id));

  return NextResponse.json({ ok: true, serverTime: now.toISOString() });
}
