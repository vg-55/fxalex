# fxalex

Two complementary FX trading systems wrapped in a Next.js app:

| Strategy | Source doc | UI |
|----------|------------|----|
| **FX Alex G — Set & Forget** (4H/Daily AOI + 50 EMA + rejection) | [real_stat/fx_alex_g_strategy.md](real_stat/fx_alex_g_strategy.md) | `/` (live signals dashboard) |
| **Fabio Valentino — Order Flow** (40-range candles + Volume Profile + tick-Δ proxy) | [real_stat/Fabio.md](real_stat/Fabio.md), [real_stat/fabio_valentino_strategy.md](real_stat/fabio_valentino_strategy.md) | `/fabio` |

## App layout

```
fx-signals-app/
  src/app/                Next.js routes (App Router)
    api/cron/scan         Scanner entrypoint (cron-triggered)
    api/stream            SSE for live signals
    api/fabio             Fabio analysis endpoint
  src/lib/
    scanner.ts            Set & Forget engine driver
    engine.ts             Signal scoring + GLM AI calls
    fabio.ts              40-range candles, volume profile, models 1–3
    candles.ts / atr.ts / ema.ts / patterns.ts
  src/db/                 Drizzle schema + client (Postgres / Neon)
  drizzle/                Migrations
real_stat/                Strategy reference docs
```

## Run locally

```sh
cd fx-signals-app
npm install
cp env.example .env   # fill DATABASE_URL, GLM_API_KEY, IBR_TOKEN, etc.
npm run dev
```

The scanner is triggered via `GET /api/cron/scan` (also self-triggered by the SSE stream when stale).

## Fabio — what's actually computed

- **40-range candles**, with adaptive fallback (40 → 0.1 ticks) for weekends; the page badges the card when range was forced below 40.
- **Volume profile** binned to `5 × tickSize` for stable POC / VAH / VAL.
- **Tick-Δ proxy** — magnitude-weighted up-tick − down-tick count. Spot FX has no centralised tape, so this is **not** real CVD; it's labelled as a proxy in the UI.
- **Market state** — `BALANCE` vs `EXPANSION` based on whether recent candles closed inside or outside the value area.
- **Three signal models**:
  1. `TRIPLE_A` — 80% rule reversion at VAL/VAH (BALANCE only)
  2. `ABSORPTION` — LVN reclaim during EXPANSION
  3. `IB_BREAKOUT` — break of the NY Initial Balance (first 30 min after NY open)
- **NY Initial Balance** is computed from today's tick window; `null` until enough ticks land in the window.

## Known follow-ups

- Persist Fabio signals + outcomes in `signals` / `signal_history` so they get the same dedupe / notifier / performance treatment as Set & Forget.
- Server-side position sizing for push notifications.
- Unit tests for `getFabioAnalysis` (sparse data, weekend, single-price-level edge cases).
