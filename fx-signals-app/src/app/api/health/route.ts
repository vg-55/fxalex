import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { desc, isNull, sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { hasExternalNotifier } from "@/lib/notifier";

export const dynamic = "force-dynamic";

export type HealthReport = {
  ok: boolean;
  status: "healthy" | "degraded" | "down";
  scanner: {
    lastOkAt: string | null;
    secondsSinceLastOk: number | null;
    consecutiveFailures: number;
    activeProvider: string | null;
    backoffUntil: string | null;
    lastError: string | null;
  };
  db: {
    ok: boolean;
    latencyMs: number | null;
    error?: string;
  };
  notifications: {
    unreadCount: number;
  };
  externalNotifier: {
    enabled: boolean;
  };
  checkedAt: string;
};

export async function GET() {
  const checkedAt = new Date().toISOString();

  // DB ping
  const dbStart = Date.now();
  let dbOk = false;
  let dbLatency: number | null = null;
  let dbError: string | undefined;
  try {
    await db.execute(sql`SELECT 1`);
    dbLatency = Date.now() - dbStart;
    dbOk = true;
  } catch (e) {
    dbError = e instanceof Error ? e.message : "db error";
  }

  let scannerState: typeof schema.scannerState.$inferSelect | undefined;
  let unreadCount = 0;

  if (dbOk) {
    try {
      const [s] = await db.select().from(schema.scannerState).where(eq(schema.scannerState.id, 1));
      scannerState = s;
      const unread = await db
        .select({ id: schema.notifications.id })
        .from(schema.notifications)
        .where(isNull(schema.notifications.readAt));
      unreadCount = unread.length;
    } catch {
      /* keep defaults */
    }
  }

  const lastOkAt = scannerState?.lastOkAt ?? null;
  const secondsSinceLastOk = lastOkAt
    ? Math.floor((Date.now() - new Date(lastOkAt).getTime()) / 1000)
    : null;
  const fails = scannerState?.consecutiveFailures ?? 0;

  let status: HealthReport["status"];
  if (!dbOk) status = "down";
  else if (secondsSinceLastOk == null) status = "degraded";
  else if (secondsSinceLastOk > 180 || fails >= 3) status = "down";
  else if (secondsSinceLastOk > 90 || fails >= 1) status = "degraded";
  else status = "healthy";

  const report: HealthReport = {
    ok: status === "healthy",
    status,
    scanner: {
      lastOkAt: lastOkAt ? new Date(lastOkAt).toISOString() : null,
      secondsSinceLastOk,
      consecutiveFailures: fails,
      activeProvider: scannerState?.activeProvider ?? null,
      backoffUntil: scannerState?.backoffUntil
        ? new Date(scannerState.backoffUntil).toISOString()
        : null,
      lastError: scannerState?.lastError ?? null,
    },
    db: { ok: dbOk, latencyMs: dbLatency, error: dbError },
    notifications: { unreadCount },
    externalNotifier: { enabled: hasExternalNotifier() },
    checkedAt,
  };

  return NextResponse.json(report, {
    status: status === "down" ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
