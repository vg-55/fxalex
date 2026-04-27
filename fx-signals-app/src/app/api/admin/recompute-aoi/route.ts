import { NextResponse } from "next/server";
import { runScanOnce } from "@/lib/scanner";
import { db, schema } from "@/db/client";

export const dynamic = "force-dynamic";

// POST /api/admin/recompute-aoi
// Manually trigger a scan (which auto-recomputes AOIs from recent 4H pivots).
// Returns the updated instrument zones so callers can verify.
export async function POST() {
  const summary = await runScanOnce();
  const instruments = await db
    .select({
      pair: schema.instruments.pair,
      aoiLow: schema.instruments.aoiLow,
      aoiHigh: schema.instruments.aoiHigh,
      updatedAt: schema.instruments.updatedAt,
    })
    .from(schema.instruments);
  return NextResponse.json({ summary, instruments });
}
