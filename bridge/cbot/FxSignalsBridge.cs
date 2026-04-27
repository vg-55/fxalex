// =============================================================================
// FxSignalsBridge.cs — cTrader cBot
// =============================================================================
// Self-hosted bridge between the FX Signals backend and a cTrader account.
// Polls /api/bridge/poll every 10s, executes orders on the local cTrader
// account, ACKs results, and sends a heartbeat snapshot every 60s.
//
// INSTALL (cTrader Desktop on Windows VPS):
//   1. Open cTrader → Automate (cBots) → Add cBot → New cBot.
//   2. Paste this file as FxSignalsBridge.cs. Build.
//   3. Drag the cBot onto a chart (any symbol/TF — it ignores chart context).
//   4. Set Parameters: ApiBaseUrl, BearerToken. Start.
//
// SECURITY: BearerToken is shown once when you mint a bridge in the web UI;
// paste it here, do NOT commit it to source control.
// =============================================================================
using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using cAlgo.API;
using cAlgo.API.Internals;

namespace cAlgo.Robots
{
    [Robot(AccessRights = AccessRights.FullAccess, AddIndicators = true)]
    public class FxSignalsBridge : Robot
    {
        // ── Parameters ───────────────────────────────────────────────────────
        [Parameter("API base URL", DefaultValue = "https://your-deployment.vercel.app")]
        public string ApiBaseUrl { get; set; }

        [Parameter("Bearer token", DefaultValue = "")]
        public string BearerToken { get; set; }

        [Parameter("Poll interval (sec)", DefaultValue = 10, MinValue = 5, MaxValue = 60)]
        public int PollSeconds { get; set; }

        [Parameter("Heartbeat interval (sec)", DefaultValue = 60, MinValue = 30, MaxValue = 300)]
        public int HeartbeatSeconds { get; set; }

        [Parameter("Default slippage (pips)", DefaultValue = 3, MinValue = 0, MaxValue = 50)]
        public double SlippagePips { get; set; }

        [Parameter("Bot version", DefaultValue = "1.0.0")]
        public string BotVersion { get; set; }

        // ── State ────────────────────────────────────────────────────────────
        private static readonly HttpClient Http = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(15)
        };
        private DateTime _lastPoll = DateTime.MinValue;
        private DateTime _lastBeat = DateTime.MinValue;
        private bool _busy;

        protected override void OnStart()
        {
            if (string.IsNullOrWhiteSpace(BearerToken))
            {
                Print("[FxSignalsBridge] FATAL: BearerToken is empty — set it in Parameters.");
                Stop();
                return;
            }
            if (string.IsNullOrWhiteSpace(ApiBaseUrl))
            {
                Print("[FxSignalsBridge] FATAL: ApiBaseUrl is empty.");
                Stop();
                return;
            }
            Http.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", BearerToken);
            Http.DefaultRequestHeaders.UserAgent.ParseAdd($"FxSignalsBridge-cBot/{BotVersion}");
            Print($"[FxSignalsBridge] Started. Account #{Account.Number} ({Account.BrokerName}) " +
                  $"polling {ApiBaseUrl} every {PollSeconds}s.");

            // Send an immediate heartbeat so the backend marks us alive.
            _ = SendHeartbeat();
        }

        protected override void OnTick()
        {
            // OnTick fires very often; throttle our network calls by elapsed wall time.
            var now = DateTime.UtcNow;
            if (_busy) return;

            if ((now - _lastPoll).TotalSeconds >= PollSeconds)
            {
                _lastPoll = now;
                _ = PollOnce();
            }
            if ((now - _lastBeat).TotalSeconds >= HeartbeatSeconds)
            {
                _lastBeat = now;
                _ = SendHeartbeat();
            }
        }

        // ── Poll ─────────────────────────────────────────────────────────────
        private async Task PollOnce()
        {
            _busy = true;
            try
            {
                var res = await Http.GetAsync($"{ApiBaseUrl}/api/bridge/poll");
                if (!res.IsSuccessStatusCode)
                {
                    Print($"[poll] HTTP {(int)res.StatusCode}");
                    return;
                }
                var body = await res.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(body);
                if (!doc.RootElement.TryGetProperty("queued", out var queued)) return;
                foreach (var order in queued.EnumerateArray())
                {
                    ExecuteOrder(order);
                }
            }
            catch (Exception ex)
            {
                Print($"[poll] {ex.Message}");
            }
            finally
            {
                _busy = false;
            }
        }

        // ── Execute one queued order ─────────────────────────────────────────
        private void ExecuteOrder(JsonElement o)
        {
            string orderId = GetString(o, "id");
            string symName = GetString(o, "symbol");
            string sideStr = GetString(o, "side");
            double lot     = GetDouble(o, "lot");
            double entry   = GetDouble(o, "entry");
            double sl      = GetDouble(o, "sl");
            double tp      = GetDouble(o, "tp");

            if (string.IsNullOrEmpty(orderId) || string.IsNullOrEmpty(symName))
            {
                Print("[exec] missing id/symbol — skipping");
                return;
            }

            var symbol = Symbols.GetSymbol(symName);
            if (symbol == null)
            {
                _ = Ack(orderId, "REJECTED", reason: $"symbol not found: {symName}");
                return;
            }

            // Convert lot → volume in units, snap to broker step.
            double units = symbol.QuantityToVolumeInUnits(lot);
            units = symbol.NormalizeVolumeInUnits(units, RoundingMode.Down);
            if (units < symbol.VolumeInUnitsMin)
            {
                _ = Ack(orderId, "REJECTED", reason: $"lot {lot} < min {symbol.VolumeInUnitsMin}");
                return;
            }

            var tradeType = sideStr == "SELL" ? TradeType.Sell : TradeType.Buy;
            // Convert SL/TP absolute prices → pip distances (cTrader API takes pips).
            double slPips = Math.Abs(entry - sl) / symbol.PipSize;
            double tpPips = Math.Abs(tp - entry) / symbol.PipSize;

            string label = $"fxsig:{orderId.Substring(0, Math.Min(8, orderId.Length))}";
            var result = ExecuteMarketOrder(
                tradeType, symbol.Name, units,
                label, slPips, tpPips,
                comment: orderId);

            if (!result.IsSuccessful)
            {
                _ = Ack(orderId, "REJECTED", reason: result.Error?.ToString() ?? "unknown");
                return;
            }
            var pos = result.Position;
            _ = Ack(orderId, "FILLED",
                fillPrice: pos.EntryPrice,
                filledLot: symbol.VolumeInUnitsToQuantity(pos.VolumeInUnits),
                brokerPositionId: pos.Id.ToString());
        }

        // ── ACK ──────────────────────────────────────────────────────────────
        private async Task Ack(string orderId, string status,
            double? fillPrice = null, double? filledLot = null,
            string brokerPositionId = null, string brokerOrderId = null,
            double? pnl = null, string reason = null)
        {
            try
            {
                var sb = new StringBuilder();
                sb.Append('{');
                sb.Append($"\"orderId\":{JsonEncodedText.Encode(orderId)},");
                sb.Append($"\"status\":{JsonEncodedText.Encode(status)}");
                if (fillPrice.HasValue) sb.Append($",\"fillPrice\":{Fmt(fillPrice.Value)}");
                if (filledLot.HasValue) sb.Append($",\"filledLot\":{Fmt(filledLot.Value)}");
                if (brokerPositionId != null) sb.Append($",\"brokerPositionId\":{JsonEncodedText.Encode(brokerPositionId)}");
                if (brokerOrderId != null) sb.Append($",\"brokerOrderId\":{JsonEncodedText.Encode(brokerOrderId)}");
                if (pnl.HasValue) sb.Append($",\"pnl\":{Fmt(pnl.Value)}");
                if (reason != null) sb.Append($",\"reason\":{JsonEncodedText.Encode(Truncate(reason, 250))}");
                sb.Append('}');
                using var content = new StringContent(sb.ToString(), Encoding.UTF8, "application/json");
                var res = await Http.PostAsync($"{ApiBaseUrl}/api/bridge/ack", content);
                if (!res.IsSuccessStatusCode) Print($"[ack {status}] HTTP {(int)res.StatusCode}");
            }
            catch (Exception ex)
            {
                Print($"[ack] {ex.Message}");
            }
        }

        // ── Heartbeat ────────────────────────────────────────────────────────
        private async Task SendHeartbeat()
        {
            try
            {
                var payload = new
                {
                    balance = Account.Balance,
                    equity = Account.Equity,
                    marginLevel = Account.MarginLevel ?? 0.0,
                    openPositions = Positions.Count,
                    currency = Account.Asset?.Name ?? "USD",
                    accountLogin = Account.Number.ToString(),
                    brokerName = Account.BrokerName,
                    botVersion = BotVersion
                };
                var json = JsonSerializer.Serialize(payload);
                using var content = new StringContent(json, Encoding.UTF8, "application/json");
                var res = await Http.PostAsync($"{ApiBaseUrl}/api/bridge/heartbeat", content);
                if (!res.IsSuccessStatusCode) Print($"[heartbeat] HTTP {(int)res.StatusCode}");
            }
            catch (Exception ex)
            {
                Print($"[heartbeat] {ex.Message}");
            }
        }

        // ── Position lifecycle: emit CLOSED ack with realised P&L. ───────────
        protected override void OnPositionClosed(Position p)
        {
            // Comment field is where we stashed the original orderId at fill time.
            if (string.IsNullOrEmpty(p.Comment)) return;
            _ = Ack(p.Comment, "CLOSED",
                pnl: p.NetProfit,
                brokerPositionId: p.Id.ToString());
        }

        // ── Helpers ──────────────────────────────────────────────────────────
        private static string GetString(JsonElement e, string k) =>
            e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : "";
        private static double GetDouble(JsonElement e, string k) =>
            e.TryGetProperty(k, out var v) && v.TryGetDouble(out var d) ? d : 0.0;
        private static string Fmt(double d) =>
            d.ToString("0.#####", System.Globalization.CultureInfo.InvariantCulture);
        private static string Truncate(string s, int n) =>
            s.Length <= n ? s : s.Substring(0, n);
    }
}
