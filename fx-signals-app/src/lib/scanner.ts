import { db, assertDb, schema } from "@/db/client";
import { and, eq, lt, or, isNull, sql } from "drizzle-orm";
import { buildSignal, generateAIInterpretation, type EngineSignal } from "./engine";
import { fetchLivePricesValidated } from "./prices";
import { fetchCandles4h, fetchClosesDaily, type CandlePair } from "./candles";
import { ema } from "./ema";
import { atr } from "./atr";
import { hasRejection } from "./patterns";
import { refreshNewsIfStale, nextRelevantEvent } from "./news";
import { evaluateOutcomes } from "./outcomes";
import { pushExternal } from "./notifier";

export type ScanSummary = {
  ok: boolean;
  provider: string | null;
  latencyMs: number;
  signalsCount: number;
  transitionsCount: number;
  outcomesCount?: number;
  error?: string;
  runId: string;
};

export async function getCurrentSignals() {
  const [signals, stateRows] = await Promise.all([
    db.select().from(schema.signals),
    db.select().from(schema.scannerState).where(eq(schema.scannerState.id, 1)),
  ]);
  return { signals, state: stateRows[0] };
}

const COOLDOWN_MS: Record<string, number> = {
  critical: 60_000,
  actionable: 5 * 60_000,
  watch: 10 * 60_000,
  info: 30 * 60_000,
};

async function withCooldown(
  key: string,
  severity: keyof typeof COOLDOWN_MS
): Promise<boolean> {
  const now = new Date();
  await db.delete(schema.dedupeKeys).where(lt(schema.dedupeKeys.expiresAt, now));
  const expiresAt = new Date(now.getTime() + COOLDOWN_MS[severity]);
  const inserted = await db
    .insert(schema.dedupeKeys)
    .values({ key, expiresAt })
    .onConflictDoNothing({ target: schema.dedupeKeys.key })
    .returning();
  return inserted.length > 0;
}

function severityFor(next: EngineSignal, prev: typeof schema.signals.$inferSelect | undefined) {
  if (next.status === "ACTIVE" && (!prev || prev.status !== "ACTIVE") && next.aiConfidence >= 85) {
    return "actionable" as const;
  }
  if (next.status === "ACTIVE" && (!prev || prev.status !== "ACTIVE")) {
    return "watch" as const;
  }
  if (next.status === "PENDING" && prev && prev.status !== "PENDING") {
    return "watch" as const;
  }
  if (prev && Math.abs(next.aiConfidence - prev.aiConfidence) >= 15) {
    return "info" as const;
  }
  return null;
}

function titleFor(next: EngineSignal, prev: typeof schema.signals.$inferSelect | undefined): string {
  if (!prev) return `${next.pair} signal initialized — ${next.status}`;
  if (prev.status !== next.status) return `${next.pair} → ${next.status} (${next.type})`;
  return `${next.pair} confidence ${prev.aiConfidence}% → ${next.aiConfidence}%`;
}

// Advisory lock via scanner_state.locked_until. Prevents concurrent scans
// when multiple SSE connections (or external cron + SSE self-trigger) race.
// Atomic: UPDATE ... WHERE locked_until IS NULL OR locked_until < NOW().
async function tryAcquireScanLock(ttlMs = 90_000): Promise<boolean> {
  const now = new Date();
  const until = new Date(now.getTime() + ttlMs);
  // Ensure row exists
  await db
    .insert(schema.scannerState)
    .values({ id: 1 })
    .onConflictDoNothing({ target: schema.scannerState.id });
  const res = await db
    .update(schema.scannerState)
    .set({ lockedUntil: until })
    .where(
      and(
        eq(schema.scannerState.id, 1),
        or(isNull(schema.scannerState.lockedUntil), lt(schema.scannerState.lockedUntil, now))
      )
    )
    .returning({ id: schema.scannerState.id });
  return res.length > 0;
}

async function releaseScanLock(): Promise<void> {
  await db
    .update(schema.scannerState)
    .set({ lockedUntil: null })
    .where(eq(schema.scannerState.id, 1));
}

// Fire-and-forget self-trigger used by SSE stream when the last successful
// scan is stale. Silently no-ops if another scan is already running.
export async function maybeTriggerScan(staleAfterMs = 90_000): Promise<"triggered" | "fresh" | "locked"> {
  const [state] = await db
    .select()
    .from(schema.scannerState)
    .where(eq(schema.scannerState.id, 1));
  const now = Date.now();
  const fresh = state?.lastOkAt && now - state.lastOkAt.getTime() < staleAfterMs;
  if (fresh) return "fresh";
  const locked = state?.lockedUntil && state.lockedUntil.getTime() > now;
  if (locked) return "locked";
  // Fire & forget — don't block the caller.
  runScanOnce().catch(() => undefined);
  return "triggered";
}

export async function runScanOnce(): Promise<ScanSummary> {
  assertDb();
  const startedAt = new Date();

  const acquired = await tryAcquireScanLock();
  if (!acquired) {
    return {
      ok: false,
      provider: null,
      latencyMs: 0,
      signalsCount: 0,
      transitionsCount: 0,
      error: "scan already in progress",
      runId: "skipped",
    };
  }

  const [run] = await db
    .insert(schema.scannerRuns)
    .values({ ok: false, startedAt })
    .returning();

  try {
    const [state] = await db.select().from(schema.scannerState).where(eq(schema.scannerState.id, 1));
    if (state?.backoffUntil && state.backoffUntil > startedAt) {
      const summary: ScanSummary = {
        ok: false,
        provider: null,
        latencyMs: 0,
        signalsCount: 0,
        transitionsCount: 0,
        error: `backoff until ${state.backoffUntil.toISOString()}`,
        runId: run.id,
      };
      await db
        .update(schema.scannerRuns)
        .set({ finishedAt: new Date(), ok: false, error: summary.error })
        .where(eq(schema.scannerRuns.id, run.id));
      return summary;
    }

    await refreshNewsIfStale();

    const prices = await fetchLivePricesValidated();

    const instruments = await db
      .select()
      .from(schema.instruments)
      .where(eq(schema.instruments.enabled, true));

    type PairEnrichment = {
      ema4h?: number;
      emaDaily?: number;
      atrValue?: number;
      candles?: Awaited<ReturnType<typeof fetchCandles4h>>;
    };
    const enrich: Record<string, PairEnrichment> = {};
    await Promise.all(
      instruments.map(async (inst) => {
        const pair = inst.pair as CandlePair;
        const [candles, dailyCloses] = await Promise.all([
          fetchCandles4h(pair, 60),
          fetchClosesDaily(pair),
        ]);
        const e: PairEnrichment = {};
        if (candles && candles.length >= 50) {
          const closes = candles.map((c) => c.c);
          const v = ema(closes, 50);
          if (v != null && Number.isFinite(v)) e.ema4h = v;
          const a = atr(candles, 14);
          if (a != null && Number.isFinite(a)) e.atrValue = a;
          e.candles = candles;
        }
        if (dailyCloses && dailyCloses.length >= 50) {
          const v = ema(dailyCloses, 50);
          if (v != null && Number.isFinite(v)) e.emaDaily = v;
        }
        enrich[pair] = e;
      })
    );

    const now = new Date();
    const engineSignals: EngineSignal[] = [];
    const signalRowEnrich: Record<
      string,
      {
        changePct?: number;
        dayHigh?: number;
        dayLow?: number;
        liveEma50?: number;
        dailyEma50?: number;
        atr?: number;
        rejectionConfirmed: boolean;
        trendAligned: boolean;
        newsBlocked: boolean;
        nextEvent: unknown;
        isStale: boolean;
      }
    > = {};

    for (const inst of instruments) {
      const pair = inst.pair as CandlePair;
      const quote = prices[pair];
      if (!quote) continue;

      const pe = enrich[pair] ?? {};
      const cfg = pe.ema4h != null ? { ...inst, ma50: pe.ema4h } : inst;

      const fourHBias = quote.price > (pe.ema4h ?? inst.ma50) ? "BUY" : "SELL";
      const dailyBias = pe.emaDaily != null ? (quote.price > pe.emaDaily ? "BUY" : "SELL") : fourHBias;
      const trendAligned = fourHBias === dailyBias;

      const rejectionConfirmed = pe.candles
        ? hasRejection(pe.candles, fourHBias)
        : false;

      const upcoming = await nextRelevantEvent(pair, 30);
      const newsBlocked = upcoming !== null;

      const eng = buildSignal(cfg, quote.price, now, {
        atr: pe.atrValue ?? null,
        dailyEma50: pe.emaDaily ?? null,
        trendAligned,
        rejectionConfirmed,
        newsBlocked,
      });

      if (quote.isStale) {
        if (eng.status === "ACTIVE") eng.status = "PENDING";
        eng.aiConfidence = Math.min(eng.aiConfidence, 45);
        eng.factors = { ...eng.factors, proximity: Math.max(0, eng.factors.proximity - 15) };
      }

      engineSignals.push(eng);

      await db.insert(schema.priceTicks).values({
        pair: inst.pair,
        price: quote.price,
        changePct: quote.changePercent,
        dayHigh: quote.dayHigh,
        dayLow: quote.dayLow,
        source: prices.primary,
        secondarySource: quote.secondarySource ?? null,
        secondaryPrice: quote.secondaryPrice ?? null,
        deviationPct: quote.deviationPct ?? null,
        isStale: quote.isStale,
      });

      signalRowEnrich[inst.pair] = {
        changePct: quote.changePercent,
        dayHigh: quote.dayHigh,
        dayLow: quote.dayLow,
        liveEma50: pe.ema4h,
        dailyEma50: pe.emaDaily,
        atr: pe.atrValue,
        rejectionConfirmed,
        trendAligned,
        newsBlocked,
        nextEvent: upcoming ?? null,
        isStale: quote.isStale,
      };
    }

    const prev = await db.select().from(schema.signals);
    const prevMap = new Map(prev.map((s) => [s.pair, s]));

    const nowMap = new Map(engineSignals.map((s) => [s.pair, { status: s.status }]));
    const outcomesCount = await evaluateOutcomes(prev, nowMap);

    const aiTexts = await Promise.all(engineSignals.map((s) => generateAIInterpretation(s)));

    let transitions = 0;
    for (let i = 0; i < engineSignals.length; i++) {
      const s = engineSignals[i];
      const aiInterpretation = aiTexts[i];
      const before = prevMap.get(s.pair);
      const enr = signalRowEnrich[s.pair] ?? {
        rejectionConfirmed: false,
        trendAligned: false,
        newsBlocked: false,
        nextEvent: null,
        isStale: false,
      };

      const rowData = {
        pair: s.pair,
        type: s.type,
        status: s.status,
        price: s.price,
        sl: s.sl,
        tp: s.tp,
        rr: s.rr,
        aoi: s.aoi,
        timeframe: s.timeframe,
        tvSymbol: s.tvSymbol,
        session: s.session,
        trend: s.trend,
        aiConfidence: s.aiConfidence,
        factors: s.factors,
        aiInterpretation,
        changePct: enr.changePct,
        dayHigh: enr.dayHigh,
        dayLow: enr.dayLow,
        liveEma50: enr.liveEma50,
        dailyEma50: enr.dailyEma50,
        trendAligned: enr.trendAligned,
        atr: enr.atr,
        rejectionConfirmed: enr.rejectionConfirmed,
        newsBlocked: enr.newsBlocked,
        nextEvent: enr.nextEvent as object | null,
        isStale: enr.isStale,
        updatedAt: now,
      };

      await db
        .insert(schema.signals)
        .values(rowData)
        .onConflictDoUpdate({
          target: schema.signals.pair,
          set: rowData,
        });

      const changed =
        !before ||
        before.status !== s.status ||
        Math.abs(before.aiConfidence - s.aiConfidence) >= 5;

      if (changed) {
        transitions++;
        await db.insert(schema.signalHistory).values({
          pair: s.pair,
          fromStatus: before?.status ?? null,
          toStatus: s.status,
          fromConfidence: before?.aiConfidence ?? null,
          toConfidence: s.aiConfidence,
          snapshot: { ...s, aiInterpretation },
        });

        const sev = severityFor(s, before);
        if (sev) {
          const dedupeKey = `${s.pair}:${s.status}:${sev}`;
          const allowed = await withCooldown(dedupeKey, sev);
          if (allowed) {
            const [inserted] = await db
              .insert(schema.notifications)
              .values({
                severity: sev,
                title: titleFor(s, before),
                body: aiInterpretation,
                pair: s.pair,
                dedupeKey,
              })
              .returning();
            if (inserted) pushExternal(inserted).catch(() => undefined);
          }
        }
      }
    }

    await db
      .insert(schema.scannerState)
      .values({
        id: 1,
        lastOkAt: now,
        lastError: null,
        consecutiveFailures: 0,
        activeProvider: prices.primary,
        backoffUntil: null,
      })
      .onConflictDoUpdate({
        target: schema.scannerState.id,
        set: {
          lastOkAt: now,
          lastError: null,
          consecutiveFailures: 0,
          activeProvider: prices.primary,
          backoffUntil: null,
        },
      });

    if (prices.anyStale) {
      const allowed = await withCooldown("scanner:feed-stale", "watch");
      if (allowed) {
        const stalePairs = ["EURUSD", "GBPUSD", "XAUUSD"]
          .filter((p) => prices[p as CandlePair].isStale)
          .join(", ");
        const [n] = await db
          .insert(schema.notifications)
          .values({
            severity: "watch",
            title: "Price feeds disagree",
            body: `Cross-validation flagged ${stalePairs} as stale. Signals on affected pairs are held out of ACTIVE until feeds agree.`,
            pair: null,
            dedupeKey: "scanner:feed-stale",
          })
          .returning();
        if (n) pushExternal(n).catch(() => undefined);
      }
    }

    const latencyMs = Date.now() - startedAt.getTime();
    await db
      .update(schema.scannerRuns)
      .set({
        finishedAt: new Date(),
        ok: true,
        latencyMs,
        provider: prices.primary,
        signalsCount: engineSignals.length,
        transitionsCount: transitions,
      })
      .where(eq(schema.scannerRuns.id, run.id));

    await db
      .delete(schema.priceTicks)
      .where(lt(schema.priceTicks.fetchedAt, new Date(Date.now() - 48 * 3600_000)));

    return {
      ok: true,
      provider: prices.primary,
      latencyMs,
      signalsCount: engineSignals.length,
      transitionsCount: transitions,
      outcomesCount,
      runId: run.id,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "scan failed";
    const latencyMs = Date.now() - startedAt.getTime();

    await db
      .update(schema.scannerRuns)
      .set({ finishedAt: new Date(), ok: false, latencyMs, error: message })
      .where(eq(schema.scannerRuns.id, run.id));

    const [state] = await db.select().from(schema.scannerState).where(eq(schema.scannerState.id, 1));
    const fails = (state?.consecutiveFailures ?? 0) + 1;
    // Exponential-ish backoff: 3 fails → 5 min, 6 fails → 10 min, 10+ fails → 20 min
    let backoffUntil: Date | null = null;
    if (fails >= 3) {
      const backoffMs =
        fails >= 10 ? 20 * 60_000 :
        fails >= 6  ? 10 * 60_000 :
                       5 * 60_000;
      backoffUntil = new Date(Date.now() + backoffMs);
    }
    await db
      .insert(schema.scannerState)
      .values({
        id: 1,
        lastError: message,
        consecutiveFailures: fails,
        backoffUntil,
      })
      .onConflictDoUpdate({
        target: schema.scannerState.id,
        set: { lastError: message, consecutiveFailures: fails, backoffUntil },
      });

    if (fails === 3) {
      const allowed = await withCooldown("scanner:feed-down", "critical");
      if (allowed) {
        const [n] = await db
          .insert(schema.notifications)
          .values({
            severity: "critical",
            title: "Data feed degraded",
            body: `Scanner has failed ${fails} consecutive runs. Last error: ${message}`,
            dedupeKey: "scanner:feed-down",
          })
          .returning();
        if (n) pushExternal(n).catch(() => undefined);
      }
    }

    return {
      ok: false,
      provider: null,
      latencyMs,
      signalsCount: 0,
      transitionsCount: 0,
      error: message,
      runId: run.id,
    };
  } finally {
    // Always release the lock, whether we succeeded or failed
    await releaseScanLock();
  }
}
