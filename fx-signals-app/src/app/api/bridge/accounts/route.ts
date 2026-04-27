import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { mintToken } from "@/lib/bridge/auth";
import { toPublic, validateCreate } from "@/lib/bridge/types";

export const dynamic = "force-dynamic";

// GET /api/bridge/accounts — list every self-hosted bridge connection.
// Used by the /live-trading UI's BridgePanel.
export async function GET() {
  try {
    const rows = await db
      .select()
      .from(schema.bridgeAccounts)
      .orderBy(desc(schema.bridgeAccounts.createdAt));
    return NextResponse.json({ accounts: rows.map(toPublic) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "list error" },
      { status: 500 }
    );
  }
}

// POST /api/bridge/accounts — mint a new bridge connection.
// Returns the bearer token EXACTLY ONCE in `token`. Caller must save it; we
// only persist a sha256 hash. Subsequent GETs will not include it.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const v = validateCreate(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const { token, hash } = mintToken();

  try {
    const [row] = await db
      .insert(schema.bridgeAccounts)
      .values({
        label: v.data.label,
        provider: v.data.provider,
        bearerTokenHash: hash,
        accountLogin: v.data.accountLogin ?? null,
        brokerName: v.data.brokerName ?? null,
        strategies: v.data.strategies ?? ["COMBINED"],
        symbols: v.data.symbols ?? null,
        riskPctPerTrade: v.data.riskPctPerTrade ?? 0.5,
        maxConcurrent: v.data.maxConcurrent ?? 3,
        maxDailyLossPct: v.data.maxDailyLossPct ?? 3,
        maxLot: v.data.maxLot ?? 1,
        minRR: v.data.minRR ?? 1.5,
      })
      .returning();
    return NextResponse.json({ account: toPublic(row), token });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "create failed" },
      { status: 500 }
    );
  }
}
