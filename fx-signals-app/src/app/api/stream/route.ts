import { db, schema } from "@/db/client";
import { desc, gt, isNull } from "drizzle-orm";

export const dynamic = "force-dynamic";

// Server-Sent Events stream.
// Polls the DB every 2s on the server side and pushes diffs to the client.
// Clients use EventSource("/api/stream") — auto-reconnects, no WebSocket needed.
export async function GET(req: Request) {
  const encoder = new TextEncoder();
  const POLL_MS = 2000;
  const HEARTBEAT_MS = 25_000;

  let lastSignalsHash = "";
  let lastNotificationTs = new Date(0);
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          closed = true;
        }
      };

      // Initial snapshot
      try {
        const signals = await db.select().from(schema.signals);
        const [state] = await db
          .select()
          .from(schema.scannerState);
        send("signals", { signals, state });
        lastSignalsHash = hashSignals(signals);

        const unread = await db
          .select()
          .from(schema.notifications)
          .where(isNull(schema.notifications.readAt))
          .orderBy(desc(schema.notifications.createdAt))
          .limit(20);
        send("notifications:snapshot", { items: unread });
        if (unread[0]) lastNotificationTs = unread[0].createdAt;
      } catch (e) {
        send("error", { message: (e as Error).message });
      }

      const poll = async () => {
        if (closed) return;
        try {
          const signals = await db.select().from(schema.signals);
          const hash = hashSignals(signals);
          if (hash !== lastSignalsHash) {
            const [state] = await db.select().from(schema.scannerState);
            send("signals", { signals, state });
            lastSignalsHash = hash;
          }

          const fresh = await db
            .select()
            .from(schema.notifications)
            .where(gt(schema.notifications.createdAt, lastNotificationTs))
            .orderBy(desc(schema.notifications.createdAt));
          if (fresh.length) {
            send("notifications:new", { items: fresh });
            lastNotificationTs = fresh[0].createdAt;
          }
        } catch (e) {
          send("error", { message: (e as Error).message });
        }
      };

      const pollId = setInterval(poll, POLL_MS);
      const hbId = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          closed = true;
        }
      }, HEARTBEAT_MS);

      const cleanup = () => {
        closed = true;
        clearInterval(pollId);
        clearInterval(hbId);
        try { controller.close(); } catch {}
      };

      req.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function hashSignals(rows: Array<{ pair: string; status: string; aiConfidence: number; price: number; updatedAt: Date }>): string {
  return rows
    .map((r) => `${r.pair}:${r.status}:${r.aiConfidence}:${r.price}:${r.updatedAt.getTime()}`)
    .sort()
    .join("|");
}
