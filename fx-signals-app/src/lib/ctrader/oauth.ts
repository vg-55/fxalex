// Spotware Open API OAuth + REST helpers.
// Docs: https://help.ctrader.com/open-api/
// Auth flow:
//   1. user → /api/ctrader/auth/start → 302 to https://openapi.ctrader.com/apps/auth
//   2. user logs in at Spotware, approves scopes
//   3. Spotware → /api/ctrader/auth/callback?code=...
//   4. we POST to /apps/token (form-encoded) → access_token + refresh_token
//   5. with the access_token we GET /connect/profile and /connect/tradingaccounts
//      to enumerate the trader accounts the user authorised.
//
// Tokens last ~30 days, refresh tokens are long-lived. We re-mint access tokens
// transparently when they're <60s from expiry.

const AUTH_BASE = "https://openapi.ctrader.com";
const CONNECT_BASE = "https://api.spotware.com/connect";

export type CtraderTokenResponse = {
  accessToken: string;
  tokenType: "bearer";
  expiresIn: number;       // seconds
  refreshToken: string;
  scope: string;
  errorCode?: string;
  description?: string;
};

export type CtraderProfile = {
  userId: number;
  email?: string;
  nickname?: string;
};

export type CtraderTradingAccount = {
  ctidTraderAccountId: number;
  traderLogin: number;
  isLive: boolean;
  brokerName: string;
  brokerTitle?: string;
  accountId?: number;
  // balance/equity/etc not exposed by /connect — those need the protobuf API
};

function clientId(): string {
  const v = process.env.CTRADER_CLIENT_ID;
  if (!v) throw new Error("CTRADER_CLIENT_ID is not set");
  return v;
}
function clientSecret(): string {
  const v = process.env.CTRADER_CLIENT_SECRET;
  if (!v) throw new Error("CTRADER_CLIENT_SECRET is not set");
  return v;
}
export function redirectUri(): string {
  return (
    process.env.CTRADER_REDIRECT_URI ??
    "http://localhost:3000/api/ctrader/auth/callback"
  );
}

export function isCtraderConfigured(): boolean {
  return !!(process.env.CTRADER_CLIENT_ID && process.env.CTRADER_CLIENT_SECRET);
}

/** Build the authorize URL the user must visit. */
export function buildAuthorizeUrl(state: string): string {
  const u = new URL(`${AUTH_BASE}/apps/auth`);
  u.searchParams.set("client_id", clientId());
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "accounts trading");
  u.searchParams.set("state", state);
  return u.toString();
}

/** Exchange the authorization code for access + refresh tokens. */
export async function exchangeCode(code: string): Promise<CtraderTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    client_id: clientId(),
    client_secret: clientSecret(),
  });
  const res = await fetch(`${AUTH_BASE}/apps/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const json = (await res.json()) as Partial<CtraderTokenResponse> & {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: "bearer";
    errorCode?: string;
    description?: string;
  };
  if (!res.ok || json.errorCode) {
    throw new Error(
      `cTrader token exchange failed (${res.status}): ${json.errorCode ?? ""} ${json.description ?? ""}`.trim()
    );
  }
  // Spotware returns snake_case; normalise.
  return {
    accessToken: json.access_token ?? json.accessToken!,
    tokenType: "bearer",
    expiresIn: json.expires_in ?? json.expiresIn!,
    refreshToken: json.refresh_token ?? json.refreshToken!,
    scope: json.scope ?? "",
  };
}

/** Refresh an access token. */
export async function refreshAccessToken(refreshToken: string): Promise<CtraderTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId(),
    client_secret: clientSecret(),
  });
  const res = await fetch(`${AUTH_BASE}/apps/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    errorCode?: string;
    description?: string;
  };
  if (!res.ok || json.errorCode) {
    throw new Error(
      `cTrader token refresh failed (${res.status}): ${json.errorCode ?? ""} ${json.description ?? ""}`.trim()
    );
  }
  return {
    accessToken: json.access_token!,
    tokenType: "bearer",
    expiresIn: json.expires_in!,
    refreshToken: json.refresh_token ?? refreshToken,
    scope: json.scope ?? "",
  };
}

/** Fetch the authenticated user's profile (one Spotware login can manage many trader accounts). */
export async function getProfile(accessToken: string): Promise<CtraderProfile> {
  const u = new URL(`${CONNECT_BASE}/profile`);
  u.searchParams.set("oauth_token", accessToken);
  const res = await fetch(u, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`cTrader profile failed (${res.status}): ${await res.text()}`);
  }
  const j = (await res.json()) as { data: CtraderProfile };
  return j.data;
}

/** List the trader (cTID) accounts the user authorised this app to access. */
export async function listTradingAccounts(accessToken: string): Promise<CtraderTradingAccount[]> {
  const u = new URL(`${CONNECT_BASE}/tradingaccounts`);
  u.searchParams.set("oauth_token", accessToken);
  const res = await fetch(u, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`cTrader tradingaccounts failed (${res.status}): ${await res.text()}`);
  }
  const j = (await res.json()) as { data: CtraderTradingAccount[] };
  return j.data;
}
