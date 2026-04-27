# Bridge on AWS — Windows EC2 setup guide

End-to-end runbook for hosting the FX Signals bridge (cTrader cBot + MT5 EA)
on an **AWS Windows EC2 instance**. Everything in this doc is copy-paste
ready; replace `eu-central-1`, instance IDs, and IPs with your own.

---

## 0 · Why AWS over a generic VPS

| Need | AWS answer |
|------|-----------|
| Always-on Windows desktop | EC2 Windows AMI |
| Low latency to your broker | Pick the AWS region geographically closest to the broker's matching engine — IC Markets / Pepperstone Equinix → `eu-central-1` (Frankfurt) or `ap-southeast-2` (Sydney) |
| Stable public IP for OAuth callbacks | Elastic IP |
| Auto-restart if the host dies | EC2 auto-recovery alarm (built-in) |
| RDP from anywhere, locked down | Security Group with your IP only |
| Predictable bill | Savings Plan or Reserved Instance after the trial month |

Expected cost: **~$30–45/mo** for a `t3.small` (2 vCPU, 2 GB RAM)
running 24/7. Bump to `t3.medium` (~$60/mo) if you run cTrader + MT5
side-by-side and see RAM pressure.

---

## 1 · Provision the EC2 instance

### 1.1 Launch wizard

AWS Console → **EC2** → **Launch instances**.

| Field | Value |
|-------|-------|
| Name | `fxsig-bridge` |
| AMI | **Microsoft Windows Server 2022 Base** (free-tier eligible base image) |
| Instance type | `t3.small` (start here, scale up if needed) |
| Key pair | Create new RSA `.pem` named `fxsig-bridge-key`. **Download and keep safe** — it decrypts the Administrator password |
| Network | Default VPC, default subnet (any AZ in your chosen region) |
| Auto-assign public IP | Enable (we replace with Elastic IP later) |
| Storage | 50 GB gp3 SSD (default 30 GB is too tight once cTrader + MT5 are installed) |

### 1.2 Security Group (firewall)

Create a new Security Group `fxsig-bridge-sg` with **only**:

| Type | Port | Source | Purpose |
|------|------|--------|---------|
| RDP  | 3389 | **My IP** (auto-detect) | Remote Desktop, you only |
| HTTPS outbound | 443 | 0.0.0.0/0 | Bot polls Vercel + broker WebSocket |

Do **not** open RDP to `0.0.0.0/0`. If your home IP changes often, use AWS
SSM Session Manager (Section 6.2) instead.

### 1.3 Launch + Elastic IP

After launch:

1. **EC2 → Elastic IPs → Allocate** → associate it with `fxsig-bridge`.
2. Note the IP — it's now the stable public address.

---

## 2 · First RDP login

### 2.1 Decrypt Administrator password

EC2 console → select instance → **Connect** → **RDP client** → **Get
password** → upload the `.pem` from §1.1 → copy the decrypted password.

### 2.2 Connect

- **macOS**: install [Microsoft Remote Desktop](https://apps.apple.com/app/microsoft-remote-desktop/id1295203466)
- **Windows**: built-in `mstsc`

PC name = the Elastic IP. User = `Administrator`. Paste the password.

### 2.3 Harden

Inside the RDP session, immediately:

1. **Change the password** — `Ctrl-Alt-End` → Change Password. Use a 20+
   char password from your password manager.
2. **Settings → Accounts → Sign-in options** → enable
   *"Use my sign-in info to automatically finish setting up after an
   update or restart"* so the desktop returns after Windows Updates.
3. **Power & sleep** → Screen / Sleep both *Never*.
4. **Time zone** → set to UTC for sane log timestamps.

---

## 3 · Install trading platforms

Inside the RDP session, open Edge and download:

1. **cTrader Desktop** — `https://ctrader.com/download/`
   Log in to your IC Markets / Pepperstone cTrader account.

2. **MetaTrader 5** — direct download from your broker's site (use the
   broker-branded MT5 build, not the generic one — preset to broker
   server).
   Log in.

3. Open both apps, log in, leave them running. Both have an "Auto
   start with Windows" option in Tools/Options — enable it.

---

## 4 · Wire the bots to the backend

### 4.1 Mint two bridge tokens

In your browser (laptop, not VPS), open the Vercel deployment at
`/live-trading`:

1. Click **Add Bridge** → label `cTrader IC Markets`, provider
   `ctrader` → Submit. **Copy the token immediately** — shown only once.
2. Click **Add Bridge** again → label `MT5 IC Markets`, provider `mt5`
   → Submit. Copy that token too.

Paste both into a temporary text file inside the RDP session — you'll
need them in §4.2 and §4.3.

### 4.2 Install the cTrader cBot

Inside RDP:

1. Open **cTrader → Automate (cBots) → Add cBot → New cBot**.
2. Name it `FxSignalsBridge`. Paste the contents of
   [bridge/cbot/FxSignalsBridge.cs](bridge/cbot/FxSignalsBridge.cs).
   (Get the file by `git clone` on the VPS, or just paste from your
   laptop clipboard into the RDP window.)
3. **Build** (top-right) — must report 0 errors.
4. Drag `FxSignalsBridge` onto **any** chart.
5. Parameters tab:
   - `ApiBaseUrl` = `https://your-vercel-deployment.vercel.app`
     (no trailing slash)
   - `BearerToken` = the cTrader token from §4.1
   - Leave the rest at defaults.
6. **Start**. The Log tab should print `[FxSignalsBridge] Started …`.

### 4.3 Install the MT5 Expert Advisor

**Critical first step (the #1 setup gotcha):**

1. **MT5 → Tools → Options → Expert Advisors** → tick *"Allow
   WebRequest for the following listed URL"* and add **exactly** your
   Vercel origin (e.g. `https://your-vercel-deployment.vercel.app`,
   no path, no trailing slash). Without this every `WebRequest()`
   returns -1.

Then:

2. MT5 → **File → Open Data Folder** → `MQL5 → Experts` → drop
   [bridge/mt5-ea/FxSignalsBridge.mq5](bridge/mt5-ea/FxSignalsBridge.mq5)
   in there.
3. In MetaTrader, right-click *Navigator → Expert Advisors → Refresh*.
4. Open MetaEditor (F4), open `FxSignalsBridge.mq5`, hit **Compile**
   (F7). Must report 0 errors.
5. In the main MT5 window, **toolbar → AutoTrading** must be green.
6. Drag `FxSignalsBridge` onto any chart. Common tab:
   - *Allow Algorithmic Trading* — ON
   - *Allow WebRequest for listed URL* — ON
   Inputs tab:
   - `ApiBaseUrl` = your Vercel URL
   - `BearerToken` = the MT5 token from §4.1
7. OK. The Experts log should show `[FxSignalsBridge] Started …`.

---

## 5 · Watchdog — keep the platforms alive

If cTrader or MT5 crashes (rare, but happens during broker server
maintenance), the watchdog restarts them within 2 minutes.

### 5.1 Drop the script

Inside RDP, create folder `C:\fxsig\` and copy
[bridge/vps/Watchdog.ps1](bridge/vps/Watchdog.ps1) into it.

Edit the two paths at the top of the file to match where you installed
cTrader and MT5 (right-click each shortcut → Properties → Target).

### 5.2 Schedule it

PowerShell as Administrator:

```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File C:\fxsig\Watchdog.ps1"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Minutes 2) `
  -RepetitionDuration ([TimeSpan]::MaxValue)).Repetition
Register-ScheduledTask -TaskName "FxSigWatchdog" -Action $action `
  -Trigger $trigger -RunLevel Highest -User $env:USERNAME
```

Verify: **Task Scheduler → Task Scheduler Library → FxSigWatchdog**
should show "Ready" and next run in <2 min.

### 5.3 Auto-login after reboot

So the watchdog can actually reach the desktop session after a
Windows Update reboot:

1. `Win+R` → `netplwiz` → uncheck *"Users must enter a user name and
   password"* → enter the Administrator password twice. (Or use
   [Sysinternals AutoLogon](https://learn.microsoft.com/sysinternals/downloads/autologon)
   for an encrypted variant.)

---

## 6 · AWS-specific resilience

### 6.1 EC2 auto-recovery alarm

If the underlying host fails, AWS will move your instance to healthy
hardware automatically.

EC2 → select instance → **Actions → Monitor and troubleshoot →
Manage CloudWatch alarms** → tick *"Recover this instance"* on
`StatusCheckFailed_System`. Free.

### 6.2 SSM Session Manager (optional, recommended)

Lets you reach the instance even if RDP/firewall breaks, without
opening port 3389 to the internet.

1. **IAM → Roles → Create role** → AWS service / EC2 → attach policy
   `AmazonSSMManagedInstanceCore` → name `EC2-SSM-Role`.
2. EC2 → instance → Actions → Security → **Modify IAM role** →
   attach `EC2-SSM-Role`.
3. Wait ~5 min, then **Systems Manager → Session Manager → Start
   session** → pick the instance. PowerShell prompt opens in the
   browser, no RDP, no SSH key.

### 6.3 Daily AMI snapshot (optional)

Data Lifecycle Manager → create policy → daily snapshot of the EBS
volume, retain 7. Lets you roll back if a Windows Update breaks
something. ~$0.05/GB/mo.

---

## 7 · Verification checklist

Back on your laptop, refresh `/live-trading`:

- [ ] Each bridge row shows a 🟢 **green dot** (poll within 30 s)
- [ ] Balance / equity match what you see in cTrader / MT5
- [ ] `botVersion` field populated (e.g. `1.0.0`)
- [ ] Mode shows `OFF` (default — safety)

Smoke-test a single trade:

1. Flip one bridge from `OFF` → `LIVE` (mode button).
2. Wait for the next ACTIVE signal to fire (or manually trigger via
   the engine).
3. The bridge row's `openPositions` counter should increment within
   ~10 s.
4. Verify the position appears in the platform with comment
   `fxsig:<8-char-id>` and (MT5 only) magic `990001`.
5. Close the trade manually. The CLOSED ack arrives within ~10 s and
   the bridge_orders row shows realised P&L.

If the dot stays 🔴 red:

- Open the platform's log tab — most likely a 401 (token mismatch)
  or `WebRequest err=4014` (URL not whitelisted in MT5 Tools→Options).

---

## 8 · Cost & ongoing ops

| Item | Approx monthly |
|------|---------------|
| `t3.small` Windows EC2 (on-demand) | ~$30 |
| 50 GB gp3 EBS | ~$4 |
| Elastic IP (when associated) | $0 |
| Outbound data (~5 GB/mo) | <$1 |
| **Total** | **~$35/mo** |

After 1 month of stability, buy a **1-year Compute Savings Plan** at
~30% discount. **Stop** (don't terminate) the instance during planned
downtime — EBS keeps charging but compute does not.

Patch Tuesday: log in once a month, run Windows Update, reboot.
Auto-login + the watchdog bring everything back automatically.

---

## 9 · Security recap

| Surface | Mitigation |
|---------|-----------|
| RDP | Source = your IP only; or replaced by SSM (no inbound port) |
| Bearer tokens | sha-256 hashed at rest; shown once; rotate via `PATCH /api/bridge/accounts/[id] {rotateToken:true}` |
| Magic / label | `990001` (MT5) and `fxsig:` (cTrader) isolate bridge trades; bots never touch positions without these markers |
| Daily loss | `maxDailyLossPct` enforced backend-side before queueing |
| Lot cap | `maxLot` enforced backend-side before queueing |
| Heartbeat-stale gate | Backend stops queuing to a bot that's been silent >5 min |
| Atomic claim | SQL `UPDATE … RETURNING WHERE status='QUEUED'` — two concurrent polls cannot receive the same order |

If you suspect a token leak: in the UI, delete the bridge (cancels
QUEUED orders, cascades the order ledger), or PATCH with
`{rotateToken:true}` and update only the bot.
