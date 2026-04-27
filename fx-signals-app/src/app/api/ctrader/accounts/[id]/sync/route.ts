import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { decryptSecret, encryptSecret } from "@/lib/mt5/crypto";
import {
  refreshAccessToken,
  listTradingAccounts,
  getProfile,
} from "@/lib/ctrader/oauth";
import { toPublic } from "@/lib/ctrader/types";

export const dynamic = "force-dynamic";

// POST /api/ctrader/accounts/[id]/sync
//
// Verifies the stored OAuth tokens still work end-to-end:
//   1. If the access token is <60s from expiry, mint a new one via refresh.
//    2. Hit /connect/profile + /connect/tradingaccounts to confirm Spotware
//       still recognises us, and pick up any change in broker/login/isLive.
//   3. Persist updated tokens (if rotated) and metadata.
//
// Note: balance/equity/margin are *not* available over REST — they require the
// protobuf stream (Phase 2). This route only validates the OAuth pipeline.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = (
    await db
      .select()
      .from(schema.ctraderAccounts)
      .where(eq(schema.ctraderAccounts.id, id))
      .limit(1)
  )[0];
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    let accessToken: string;
    let accessTokenEnc = row.accessTokenEnc;
    let refreshTokenEnc = row.refreshTokenEnc;
    let tokenExpiresAt = row.tokenExpiresAt;
    let scope = row.scope;
    let rotated = false;

    const now = Date.now();
    const expiresMs = row.tokenExpiresAt.getTime();
    const stale = expiresMs - now < 60_000; // <60s left → refresh proactively

    if (stale) {
      const refreshToken = decryptSecret(row.refreshTokenEnc);
      const fresh = await refreshAccessToken(refreshToken);
      accessToken = fresh.accessToken;
      accessTokenEnc = encryptSecret(fresh.accessToken);
      refreshTokenEnc = encryptSecret(fresh.refreshToken);
      tokenExpiresAt = new Date(Date.now() + fresh.expiresIn * 1000);
      scope = fresh.scope || scope;
      rotated = true;
    } else {
      accessToken = decryptSecret(row.accessTokenEnc);
    }

    // Hit Spotware to confirm tokens are live + sync metadata.
    const [profile, accounts] = await Promise.all([
      getProfile(accessToken),
      listTradingAccounts(accessToken),
    ]);

    const match = accounts.find(
      (a) => String(a.ctidTraderAccountId) === row.ctidTraderAccountId
    );

    const updates: Record<string, unknown> = {
      accessTokenEnc,
      refreshTokenEnc,
      tokenExpiresAt,
      scope,
      lastSyncedAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    };
    if (match) {
      updates.brokerName = match.brokerName ?? row.brokerName;
      updates.traderLogin = String(match.traderLogin);
      updates.isLive = match.isLive;
    }

    const [updated] = await db
      .update(schema.ctraderAccounts)
      .set(updates)
      .where(eq(schema.ctraderAccounts.id, id))
      .returning();

    return NextResponse.json({
      ok: true,
      tokenRotated: rotated,
      profile: { userId: profile.userId, email: profile.email ?? null },
      tradingAccountsVisible: accounts.length,
      stillAuthorised: !!match,
      account: toPublic(updated),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "sync failed";
    await db
      .update(schema.ctraderAccounts)
      .set({ lastError: msg, lastSyncedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.ctraderAccounts.id, id));
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
