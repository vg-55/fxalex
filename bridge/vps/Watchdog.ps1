# Watchdog.ps1 — keeps cTrader Desktop and MT5 alive on the VPS.
#
# Schedule via Windows Task Scheduler:
#   - Trigger: at log on of <user>, repeat every 2 minutes indefinitely
#   - Action:  powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\fxsig\Watchdog.ps1
#
# Edit the two paths below to match your install locations.

$cTraderExe = "C:\Users\$env:USERNAME\AppData\Local\Spotware\cTrader\cTrader.exe"
$mt5Exe     = "C:\Program Files\MetaTrader 5\terminal64.exe"
$logFile    = "C:\fxsig\watchdog.log"

function Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $logFile -Value "[$ts] $msg"
}

function Ensure($name, $exe) {
    if (-not (Test-Path $exe)) {
        Log "$name not found at $exe"
        return
    }
    $proc = Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($exe)) -ErrorAction SilentlyContinue
    if (-not $proc) {
        Log "$name not running — starting"
        Start-Process -FilePath $exe
    }
}

# Make sure the log directory exists.
$dir = Split-Path $logFile -Parent
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

Ensure "cTrader" $cTraderExe
Ensure "MT5"     $mt5Exe

# Truncate log if it exceeds 1 MB.
if ((Test-Path $logFile) -and ((Get-Item $logFile).Length -gt 1MB)) {
    Get-Content $logFile -Tail 200 | Set-Content $logFile
}
