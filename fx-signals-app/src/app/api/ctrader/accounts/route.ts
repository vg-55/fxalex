import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { isCtraderConfigured } from "@/lib/ctrader/oauth";
import { isCryptoConfigured } from "@/lib/mt5/crypto";
import { toPublic } from "@/lib/ctrader/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await db
      .select()
      .from(schema.ctraderAccounts)
      .orderBy(desc(schema.ctraderAccounts.createdAt));
    return NextResponse.json({
      accounts: rows.map(toPublic),
      configured: { crypto: isCryptoConfigured(), ctrader: isCtraderConfigured() },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "list error" },
      { status: 500 }
    );
  }
}
