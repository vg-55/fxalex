import { NextResponse } from "next/server";
import { runScanOnce } from "@/lib/scanner";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function authorized(req: Request): boolean {
  // Vercel Cron sends a special header; also allow Bearer CRON_SECRET.
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const vercelCron = req.headers.get("x-vercel-cron");
  if (vercelCron) return true;
  if (secret && auth === secret) return true;
  // Dev convenience: allow local unauthenticated calls
  return process.env.NODE_ENV !== "production";
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runScanOnce();
  return NextResponse.json(result, {
    status: result.ok ? 200 : 502,
    headers: { "Cache-Control": "no-store" },
  });
}

// POST also allowed for manual triggers
export const POST = GET;
