import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { encryptSecret, isCryptoConfigured } from "@/lib/mt5/crypto";
import {
  exchangeCode,
  getProfile,
  listTradingAccounts,
  isCtraderConfigured,
} from "@/lib/ctrader/oauth";

export const dynamic = "force-dynamic";

// OAuth callback. Spotware sends the user back here with `?code=...&state=...`.
// We:
//   1. verify state matches the cookie we minted,
//   2. exchange the code for tokens,
//   3. fetch the profile + every trader account the user authorised,
//   4. upsert one row per ctidTraderAccountId,
//   5. redirect the user back to /live-trading.
export async function GET(req: Request) {
  if (!isCtraderConfigured()) {
    return NextResponse.json({ error: "cTrader not configured" }, { status: 500 });
  }
  if (!isCryptoConfigured()) {
    return NextResponse.json({ error: "MT5_ENCRYPTION_KEY not configured" }, { status: 500 });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorCode = url.searchParams.get("errorCode");

  if (errorCode) {
    return redirectWithError(req, errorCode);
  }
  if (!code || !state) {
    return redirectWithError(req, "missing code/state");
  }

  // CSRF check.
  const cookieHeader = req.headers.get("cookie") ?? "";
  const stateCookie = /(?:^|;\s*)ctrader_oauth_state=([^;]+)/.exec(cookieHeader)?.[1];
  if (!stateCookie || stateCookie !== state) {
    return redirectWithError(req, "state mismatch");
  }

  // Exchange code → tokens.
  let tokens;
  try {
    tokens = await exchangeCode(code);
  } catch (err) {
    return redirectWithError(req, err instanceof Error ? err.message : "token exchange failed");
  }

  // Pull the trader accounts authorised under this token.
  let accounts;
  try {
    [, accounts] = await Promise.all([
      getProfile(tokens.accessToken),
      listTradingAccounts(tokens.accessToken),
    ]);
  } catch (err) {
    return redirectWithError(req, err instanceof Error ? err.message : "profile fetch failed");
  }

  if (accounts.length === 0) {
    return redirectWithError(req, "no trader accounts authorised");
  }

  const accessTokenEnc = encryptSecret(tokens.accessToken);
  const refreshTokenEnc = encryptSecret(tokens.refreshToken);
  const tokenExpiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

  // Upsert each trader account. If the user re-authorises, we just refresh the
  // tokens on the existing row (matched by ctidTraderAccountId).
  for (const acct of accounts) {
    const ctid = String(acct.ctidTraderAccountId);
    const existing = await db
      .select()
      .from(schema.ctraderAccounts)
      .where(eq(schema.ctraderAccounts.ctidTraderAccountId, ctid))
      .limit(1);

    if (existing[0]) {
      await db
        .update(schema.ctraderAccounts)
        .set({
          accessTokenEnc,
          refreshTokenEnc,
          tokenExpiresAt,
          scope: tokens.scope,
          brokerName: acct.brokerName ?? existing[0].brokerName,
          traderLogin: String(acct.traderLogin),
          isLive: acct.isLive,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.ctraderAccounts.id, existing[0].id));
    } else {
      await db.insert(schema.ctraderAccounts).values({
        label: `${acct.brokerName ?? "cTrader"} #${acct.traderLogin}`,
        ctidTraderAccountId: ctid,
        traderLogin: String(acct.traderLogin),
        brokerName: acct.brokerName ?? null,
        isLive: acct.isLive,
        accessTokenEnc,
        refreshTokenEnc,
        tokenExpiresAt,
        scope: tokens.scope,
        mode: "OFF",
      });
    }
  }

  // Clear the state cookie + bounce back to UI.
  const back = new URL("/live-trading?connected=ctrader", req.url);
  const res = NextResponse.redirect(back, 302);
  res.cookies.set("ctrader_oauth_state", "", { path: "/", maxAge: 0 });
  return res;
}

function redirectWithError(req: Request, msg: string): NextResponse {
  const u = new URL("/live-trading", req.url);
  u.searchParams.set("ctrader_error", msg.slice(0, 200));
  return NextResponse.redirect(u, 302);
}
