import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { encryptSecret, isCryptoConfigured } from "@/lib/mt5/crypto";
import {
  isMetaApiConfigured,
  createAccount as metaCreate,
  deployAccount as metaDeploy,
  deleteAccount as metaDelete,
  getAccount as metaGet,
} from "@/lib/mt5/metaapi";
import { toPublic, validateCreate } from "@/lib/mt5/types";

export const dynamic = "force-dynamic";

function configError(): NextResponse | null {
  if (!isCryptoConfigured()) {
    return NextResponse.json(
      {
        error:
          "MT5_ENCRYPTION_KEY missing. Generate with `node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"` and add to .env",
      },
      { status: 500 }
    );
  }
  if (!isMetaApiConfigured()) {
    return NextResponse.json(
      {
        error:
          "METAAPI_TOKEN missing. Sign up free at https://app.metaapi.cloud/token and add to .env",
      },
      { status: 500 }
    );
  }
  return null;
}

export async function GET() {
  try {
    const rows = await db
      .select()
      .from(schema.mt5Accounts)
      .orderBy(desc(schema.mt5Accounts.createdAt));
    return NextResponse.json({
      accounts: rows.map(toPublic),
      configured: { crypto: isCryptoConfigured(), metaapi: isMetaApiConfigured() },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "list error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const cfg = configError();
  if (cfg) return cfg;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const v = validateCreate(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const input = v.value;

  // Provision the MT5 account on MetaApi first — if this fails we don't store
  // anything locally. Password never touches our DB in cleartext.
  let metaapiAccountId: string;
  try {
    const created = await metaCreate({
      name: input.label,
      server: input.server,
      login: input.login,
      password: input.password,
      region: input.region ?? "new-york",
      platform: "mt5",
    });
    metaapiAccountId = created.id;
    // Best-effort deploy — broker login happens asynchronously on MetaApi.
    metaDeploy(metaapiAccountId).catch(() => {
      /* deploy state will be reflected by sync later */
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "metaapi error";
    return NextResponse.json(
      { error: `MetaApi provisioning failed: ${message}` },
      { status: 502 }
    );
  }

  // Encrypt the password for our records (used for re-provision / re-deploy).
  // If anything below this point fails (encryption, DB insert), we tear the
  // MetaApi account down so we don't leak orphan provisioned accounts.
  let row: typeof schema.mt5Accounts.$inferSelect | undefined;
  try {
    const passwordEnc = encryptSecret(input.password);

    const inserted = await db
      .insert(schema.mt5Accounts)
      .values({
        label: input.label,
        broker: input.broker ?? null,
        server: input.server,
        login: input.login,
        passwordEnc,
        metaapiAccountId,
        metaapiRegion: input.region ?? "new-york",
        metaapiState: "DEPLOYING",
        mode: "OFF", // safe default; user must opt-in
        strategies: input.strategies ?? ["COMBINED"],
        symbols: input.symbols ?? null,
        riskPctPerTrade: input.riskPctPerTrade ?? 0.5,
        maxConcurrent: input.maxConcurrent ?? 3,
        maxDailyLossPct: input.maxDailyLossPct ?? 3,
        maxLot: input.maxLot ?? 1,
        minRR: input.minRR ?? 1.5,
      })
      .returning();
    row = inserted[0];
  } catch (err) {
    // Roll back the MetaApi-side provisioning so the user can retry without
    // colliding on (server, login). Best-effort — log if rollback fails too.
    metaDelete(metaapiAccountId).catch((e) =>
      console.error("[live/accounts] orphan MetaApi account, manual cleanup needed:", metaapiAccountId, e)
    );
    const message = err instanceof Error ? err.message : "db insert error";
    return NextResponse.json(
      { error: `local persistence failed (MetaApi rolled back): ${message}` },
      { status: 500 }
    );
  }
  if (!row) {
    metaDelete(metaapiAccountId).catch(() => undefined);
    return NextResponse.json({ error: "db insert returned no row" }, { status: 500 });
  }

  await db.insert(schema.mt5Audit).values({
    accountId: row.id,
    level: "info",
    event: "account_created",
    detail: { metaapiAccountId, server: input.server, login: input.login },
  });

  // Pull the latest state non-blocking (don't fail the response if it errors).
  metaGet(metaapiAccountId)
    .then((info) =>
      db
        .update(schema.mt5Accounts)
        .set({ metaapiState: info.state, updatedAt: new Date() })
        .where(eq(schema.mt5Accounts.id, row.id))
    )
    .catch(() => {
      /* swallow */
    });

  return NextResponse.json({ account: toPublic(row) }, { status: 201 });
}
