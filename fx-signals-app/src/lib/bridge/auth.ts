import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import type { BridgeAccountRow } from "@/db/schema";

// Bearer token model:
//   • Generated server-side as 32 random bytes hex-encoded (64 chars).
//   • Hashed sha256 and stored in bridge_accounts.bearer_token_hash.
//   • Shown to the user *once* at creation; we never need to recover it.
//   • Bot sends it on every request as `Authorization: Bearer <token>`.
//
// We compare hashes with timingSafeEqual to avoid timing oracles.

export function mintToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/** Extract the Bearer token from a Request, or null if absent/malformed. */
export function extractBearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!h) return null;
  const m = /^Bearer\s+([A-Za-z0-9._\-+/=]+)$/i.exec(h);
  return m ? m[1] : null;
}

/**
 * Look up the bridge account whose bearer token matches the request's
 * Authorization header. Returns null on any failure (no token, no match,
 * disabled). Constant-time comparison.
 */
export async function authenticateBridge(req: Request): Promise<BridgeAccountRow | null> {
  const token = extractBearer(req);
  if (!token) return null;
  const hash = hashToken(token);

  const rows = await db
    .select()
    .from(schema.bridgeAccounts)
    .where(eq(schema.bridgeAccounts.bearerTokenHash, hash))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // Defence in depth — even though the WHERE matched, double-check with
  // timing-safe equality in case of any future change to lookup strategy.
  if (!safeEqualHex(row.bearerTokenHash, hash)) return null;
  if (!row.enabled) return null;
  return row;
}
