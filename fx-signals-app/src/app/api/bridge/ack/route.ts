import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { authenticateBridge } from "@/lib/bridge/auth";

export const dynamic = "force-dynamic";

// POST /api/bridge/ack
//
// Bot reports the outcome of an order it received via /poll.
//
// Body: {
//   orderId: string,
//   status: "FILLED" | "REJECTED" | "CLOSED" | "CANCELLED",
//   fillPrice?: number,
//   filledLot?: number,
//   brokerPositionId?: string,
//   brokerOrderId?: string,
//   pnl?: number,
//   reason?: string                    // for REJECTED / CLOSED
// }
//
// We only accept acks for orders that belong to the calling account; this
// prevents one compromised bot from mutating another account's orders.
const ALLOWED: ReadonlySet<string> = new Set([
  "FILLED",
  "REJECTED",
  "CLOSED",
  "CANCELLED",
]);

export async function POST(req: Request) {
  const account = await authenticateBridge(req);
  if (!account) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const orderId = typeof body.orderId === "string" ? body.orderId : null;
  const status = typeof body.status === "string" ? body.status.toUpperCase() : null;
  if (!orderId || !status || !ALLOWED.has(status)) {
    return NextResponse.json(
      { error: "orderId + status (FILLED|REJECTED|CLOSED|CANCELLED) required" },
      { status: 400 }
    );
  }

  // Build the update; ignore any fields the bot didn't send.
  const now = new Date();
  const updates: Record<string, unknown> = {
    status,
    updatedAt: now,
  };
  if (typeof body.fillPrice === "number" && Number.isFinite(body.fillPrice))
    updates.fillPrice = body.fillPrice;
  if (typeof body.filledLot === "number" && body.filledLot >= 0)
    updates.filledLot = body.filledLot;
  if (typeof body.brokerPositionId === "string")
    updates.brokerPositionId = body.brokerPositionId.slice(0, 64);
  if (typeof body.brokerOrderId === "string")
    updates.brokerOrderId = body.brokerOrderId.slice(0, 64);
  if (typeof body.pnl === "number" && Number.isFinite(body.pnl)) updates.pnl = body.pnl;
  if (typeof body.reason === "string")
    updates.rejectionReason = body.reason.slice(0, 256);

  if (status === "FILLED") updates.filledAt = now;
  if (status === "CLOSED" || status === "CANCELLED") updates.closedAt = now;

  // accountId guard — order must belong to the auth'd account.
  const [updated] = await db
    .update(schema.bridgeOrders)
    .set(updates)
    .where(
      and(
        eq(schema.bridgeOrders.id, orderId),
        eq(schema.bridgeOrders.accountId, account.id)
      )
    )
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "order not found for this account" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
