import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { buildAuthorizeUrl, isCtraderConfigured } from "@/lib/ctrader/oauth";

export const dynamic = "force-dynamic";

// Kicks off the OAuth flow. We mint a CSRF state, stash it in a short-lived
// cookie, and 302 the user to Spotware's consent screen.
export async function GET() {
  if (!isCtraderConfigured()) {
    return NextResponse.json(
      { error: "CTRADER_CLIENT_ID / CTRADER_CLIENT_SECRET not configured" },
      { status: 500 }
    );
  }
  const state = randomBytes(16).toString("hex");
  const url = buildAuthorizeUrl(state);
  const res = NextResponse.redirect(url, 302);
  // 10-min single-use; HttpOnly so JS can't read it.
  res.cookies.set("ctrader_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return res;
}
