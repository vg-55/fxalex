import { NextResponse } from "next/server";
import { db, assertDb, schema } from "@/db/client";
import { desc, isNull, inArray, lt, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    assertDb();
    const url = new URL(req.url);
    const unreadOnly = url.searchParams.get("unread") === "1";
    const limit = Math.min(100, Number(url.searchParams.get("limit") ?? 50));

    const where = unreadOnly ? isNull(schema.notifications.readAt) : undefined;
    const rows = await db
      .select()
      .from(schema.notifications)
      .where(where)
      .orderBy(desc(schema.notifications.createdAt))
      .limit(limit);

    const unreadRows = await db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(isNull(schema.notifications.readAt));

    return NextResponse.json(
      { notifications: rows, unreadCount: unreadRows.length },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "notifications error" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    assertDb();
    const body = (await req.json().catch(() => ({}))) as { ids?: string[]; all?: boolean };
    const now = new Date();

    if (body.all) {
      await db
        .update(schema.notifications)
        .set({ readAt: now })
        .where(isNull(schema.notifications.readAt));
      return NextResponse.json({ ok: true });
    }

    if (body.ids?.length) {
      await db
        .update(schema.notifications)
        .set({ readAt: now })
        .where(
          and(
            inArray(schema.notifications.id, body.ids),
            isNull(schema.notifications.readAt)
          )
        );
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "no ids provided" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "notifications error" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    assertDb();
    await db
      .delete(schema.notifications)
      .where(lt(schema.notifications.createdAt, new Date(Date.now() - 7 * 24 * 3600_000)));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "notifications error" },
      { status: 500 }
    );
  }
}
