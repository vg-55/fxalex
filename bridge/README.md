# FX Signals — self-hosted bridge

Bridge runs **on your own Windows VPS**. The bot polls our backend over
HTTPS, executes orders on the local cTrader / MT5 install, and ACKs the
result. No broker billing, no Open API "Trial" gate, no MetaApi sub.

```
[fx-signals on Vercel]   <───HTTPS───>   [VPS:  cTrader Desktop  +  MT5]
   bridge_orders queue                       └─ FxSignalsBridge cBot
                                              └─ FxSignalsBridge EA
```

## Files

| Path | Purpose |
|------|---------|
| `cbot/FxSignalsBridge.cs` | cTrader cBot (C#) |
| `mt5-ea/FxSignalsBridge.mq5` | MetaTrader 5 EA |
| `vps/Watchdog.ps1` | Restarts cTrader/MT5 if the process dies |

## Backend endpoints used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/bridge/poll`      | GET  | Atomic SQL claim → returns queued orders |
| `/api/bridge/ack`       | POST | Bot reports FILLED / REJECTED / CLOSED |
| `/api/bridge/heartbeat` | POST | Snapshot: balance/equity/openPositions |

Auth: `Authorization: Bearer <token>` on every call. Token is minted
**once** in the Live Trading UI ("Add Bridge"); only sha-256 is stored.

## VPS setup checklist (Contabo VPS S Windows, ~€8.49/mo)

1. **Order VPS** — Contabo VPS S Windows, EU region (closer to Vercel
   edge), Windows Server 2022.
2. **First login** — set strong password, enable auto-login for the user
   that will run the trading apps (Settings → Accounts → Sign-in
   options → "automatically sign in").
3. **Power plan** — set to "High performance"; disable sleep/hibernate.
4. **Install browsers + tools** — Chrome, 7-Zip, Notepad++.
5. **Install cTrader Desktop** — log in to your IC Markets / Pepperstone
   demo or live cTrader account.
6. **Install MetaTrader 5** — same broker, log in.
7. **Mint a bridge token (×2)** — open the production app at
   `/live-trading`, click **Add Bridge** twice (once for `ctrader`,
   once for `mt5`). Copy each token immediately; it's shown only once.
8. **Install the cBot**:
   - cTrader → Automate → Add cBot → New cBot → paste
     `cbot/FxSignalsBridge.cs` → Build (no errors).
   - Drag onto a chart. Set inputs:
     - `ApiBaseUrl` = your Vercel URL (no trailing slash)
     - `BearerToken` = the cTrader token
   - Start.
9. **Install the EA**:
   - **Critical first**: MT5 → Tools → Options → Expert Advisors →
     tick *"Allow WebRequest for the following listed URL"* and add
     your Vercel URL. Without this every `WebRequest()` returns -1.
   - File → Open Data Folder → MQL5 → Experts → drop
     `mt5-ea/FxSignalsBridge.mq5`.
   - In MetaEditor: Compile (F7). No errors.
   - Drag onto any chart. Common tab → "Allow Algo Trading" + "Allow
     WebRequest". Inputs: ApiBaseUrl + BearerToken (the MT5 one).
10. **Watchdog** — copy `vps/Watchdog.ps1` to `C:\fxsig\Watchdog.ps1`.
    Task Scheduler → Create Task:
    - Trigger: at log on (your user), repeat every 2 min indefinitely
    - Action: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\fxsig\Watchdog.ps1`
    - Run with highest privileges.

## Verification

After install, the Live Trading panel will show each bridge with a
**status dot**:

- 🟢 green = polled within 30s
- 🟡 amber = idle but heartbeat fresh
- 🔴 red   = no heartbeat in >5 min — fan-out is paused

Default mode is **OFF**. Switch to **LIVE** (in the bridge row's mode
button) when you're ready to take real orders. Engine fan-out only
queues to LIVE bridges with a fresh heartbeat.

## Safety invariants

- Magic number **990001** (MT5) and label `fxsig:*` (cTrader) isolate
  bridge trades from manual ones.
- `maxLot` clamps every order regardless of risk-percent calculation.
- `maxConcurrent` and `maxDailyLossPct` enforced by backend before any
  order is queued.
- Heartbeat-stale gate (5 min) blocks fan-out to dead bots.
- Atomic SQL `UPDATE...RETURNING WHERE status='QUEUED'` is the dedup
  primitive — two concurrent polls cannot receive the same order.
- Tokens are shown once, sha-256 hashed at rest, and can be rotated
  via `PATCH /api/bridge/accounts/[id]` with `{rotateToken: true}`.
