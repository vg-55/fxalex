import { NextResponse } from "next/server";
import { seedInstruments } from "@/db/seed";

export const dynamic = "force-dynamic";

// One-shot bootstrap endpoint. Hit this once after running migrations.
// Protected by CRON_SECRET to prevent random re-seeding.
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
