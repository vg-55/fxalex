import { NextResponse } from "next/server";
import { seedInstruments } from "@/db/seed";

export const dynamic = "force-dynamic";

// GET — callable via `vercel curl /api/admin/seed` (Vercel deployment auth protects it).
// Safe to call multiple times: uses onConflictDoNothing.
export async function GET() {
  try {
    const r = await seedInstruments();
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "seed failed" },
      { status: 500 }
    );
  }
}

// POST — protected by CRON_SECRET for external callers.
export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const r = await seedInstruments();
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "seed failed" },
      { status: 500 }
    );
  }
}
