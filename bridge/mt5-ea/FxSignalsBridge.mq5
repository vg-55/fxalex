//+------------------------------------------------------------------+
//|                                            FxSignalsBridge.mq5 |
//|       Self-hosted bridge: polls fx-signals backend & trades MT5 |
//+------------------------------------------------------------------+
//
// INSTALL (MetaTrader 5 on Windows VPS):
//   1. Tools → Options → Expert Advisors → tick "Allow WebRequest for the
//      following listed URL" and ADD your API base URL (exact origin, e.g.
//      https://your-deployment.vercel.app). Without this, all WebRequest()
//      calls return -1 — this is the #1 setup gotcha.
//   2. File → Open Data Folder → MQL5 → Experts → drop FxSignalsBridge.mq5.
//   3. In MetaEditor: Compile (F7).
//   4. Drag the EA onto ANY chart. Settings:
//        - Allow Algorithmic Trading: ON
//        - Allow modification of Signals settings: ON
//        - Common tab → "Allow WebRequest" must be ticked.
//      Inputs: ApiBaseUrl, BearerToken (one-time mint from web UI).
//
// SAFETY:
//   - Magic number 990001 isolates our trades from manual / other EAs.
//   - We never close manual positions.
//   - Default mode in backend is OFF — flip to LIVE when ready.
//+------------------------------------------------------------------+
#property strict
#property version   "1.00"
#property description "Polls fx-signals /api/bridge/poll, executes orders, ACKs."

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

//--- Inputs --------------------------------------------------------
input string ApiBaseUrl       = "https://your-deployment.vercel.app"; // No trailing slash
input string BearerToken      = "";                                   // From web UI mint
input int    PollSeconds      = 10;
input int    HeartbeatSeconds = 60;
input int    SlippagePoints   = 30;
input string BotVersion       = "1.0.0";
input ulong  MagicNumber      = 990001;

//--- State ---------------------------------------------------------
datetime g_lastPoll = 0;
datetime g_lastBeat = 0;
CTrade   g_trade;
CPositionInfo g_pos;

// Map original signal orderId → broker ticket so we can emit a CLOSED
// ack when the position disappears. Cap size to avoid unbounded growth.
string g_orderIds[];
ulong  g_orderTickets[];
int    g_mapCount = 0;

//+------------------------------------------------------------------+
int OnInit()
{
   if(StringLen(BearerToken) == 0)
   {
      Print("[FxSignalsBridge] FATAL: BearerToken empty. Set it in inputs.");
      return(INIT_FAILED);
   }
   if(StringLen(ApiBaseUrl) == 0)
   {
      Print("[FxSignalsBridge] FATAL: ApiBaseUrl empty.");
      return(INIT_FAILED);
   }
   g_trade.SetExpertMagicNumber(MagicNumber);
   g_trade.SetDeviationInPoints(SlippagePoints);
   g_trade.SetTypeFillingBySymbol(_Symbol);

   EventSetTimer(1); // 1s heartbeat tick — actual poll throttled below.
   PrintFormat("[FxSignalsBridge] Started. Account #%d (%s) → %s",
               (int)AccountInfoInteger(ACCOUNT_LOGIN),
               AccountInfoString(ACCOUNT_COMPANY),
               ApiBaseUrl);
   SendHeartbeat();
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   datetime now = TimeCurrent();
   if(now - g_lastPoll >= PollSeconds)
   {
      g_lastPoll = now;
      PollOnce();
   }
   if(now - g_lastBeat >= HeartbeatSeconds)
   {
      g_lastBeat = now;
      SendHeartbeat();
   }
   ScanClosedPositions();
}

//+------------------------------------------------------------------+
//| HTTP helpers                                                      |
//+------------------------------------------------------------------+
// MQL5's WebRequest signature differs between overloads. We use the
// one that takes a char[] body so POST works for JSON.
int HttpGet(const string url, string &response)
{
   char post[];                  // empty body
   char result[];
   string headers = StringFormat(
      "Authorization: Bearer %s\r\nUser-Agent: FxSignalsBridge-EA/%s\r\n",
      BearerToken, BotVersion);
   string responseHeaders;
   ResetLastError();
   int code = WebRequest("GET", url, headers, 15000, post, result, responseHeaders);
   if(code == -1)
   {
      // Most common cause: URL not in Tools→Options→Expert Advisors whitelist.
      PrintFormat("[http] WebRequest GET failed: err=%d (whitelist URL?)", GetLastError());
      response = "";
      return -1;
   }
   response = CharArrayToString(result, 0, ArraySize(result), CP_UTF8);
   return code;
}

int HttpPost(const string url, const string body, string &response)
{
   char post[];
   StringToCharArray(body, post, 0, StringLen(body), CP_UTF8);
   char result[];
   string headers = StringFormat(
      "Authorization: Bearer %s\r\nContent-Type: application/json\r\nUser-Agent: FxSignalsBridge-EA/%s\r\n",
      BearerToken, BotVersion);
   string responseHeaders;
   ResetLastError();
   int code = WebRequest("POST", url, headers, 15000, post, result, responseHeaders);
   if(code == -1)
   {
      PrintFormat("[http] WebRequest POST failed: err=%d", GetLastError());
      response = "";
      return -1;
   }
   response = CharArrayToString(result, 0, ArraySize(result), CP_UTF8);
   return code;
}

//+------------------------------------------------------------------+
//| Tiny JSON extractors. The backend's response shape is fixed and  |
//| flat per-order, so substring scanning is sufficient and avoids a |
//| third-party JSON parser dependency.                              |
//+------------------------------------------------------------------+
bool JsonField(const string src, const string key, string &out, int from = 0)
{
   string needle = "\"" + key + "\"";
   int p = StringFind(src, needle, from);
   if(p < 0) return false;
   p = StringFind(src, ":", p);
   if(p < 0) return false;
   p++;
   while(p < StringLen(src) && (StringGetCharacter(src, p) == ' ' ||
                                 StringGetCharacter(src, p) == '\t' ||
                                 StringGetCharacter(src, p) == '\n')) p++;
   if(p >= StringLen(src)) return false;
   ushort c = StringGetCharacter(src, p);
   if(c == '"')
   {
      int q = StringFind(src, "\"", p + 1);
      if(q < 0) return false;
      out = StringSubstr(src, p + 1, q - p - 1);
      return true;
   }
   else
   {
      int q = p;
      while(q < StringLen(src))
      {
         ushort cc = StringGetCharacter(src, q);
         if(cc == ',' || cc == '}' || cc == ']' || cc == ' ' || cc == '\n') break;
         q++;
      }
      out = StringSubstr(src, p, q - p);
      return true;
   }
}

double JsonNumber(const string src, const string key, int from = 0, double def = 0.0)
{
   string s;
   if(!JsonField(src, key, s, from)) return def;
   return StringToDouble(s);
}

//+------------------------------------------------------------------+
//| Poll                                                              |
//+------------------------------------------------------------------+
void PollOnce()
{
   string body;
   int code = HttpGet(ApiBaseUrl + "/api/bridge/poll", body);
   if(code != 200) return;

   // Find the "queued":[ ... ] array boundaries, then walk each {...} object.
   int qStart = StringFind(body, "\"queued\"");
   if(qStart < 0) return;
   int arrStart = StringFind(body, "[", qStart);
   if(arrStart < 0) return;
   int depth = 0;
   int objStart = -1;
   for(int i = arrStart; i < StringLen(body); i++)
   {
      ushort c = StringGetCharacter(body, i);
      if(c == ']' && depth == 0) break;
      if(c == '{')
      {
         if(depth == 0) objStart = i;
         depth++;
      }
      else if(c == '}')
      {
         depth--;
         if(depth == 0 && objStart >= 0)
         {
            string obj = StringSubstr(body, objStart, i - objStart + 1);
            ExecuteOrder(obj);
            objStart = -1;
         }
      }
   }
}

//+------------------------------------------------------------------+
//| Execute one queued order                                          |
//+------------------------------------------------------------------+
void ExecuteOrder(const string obj)
{
   string orderId, symbol, side;
   if(!JsonField(obj, "id", orderId))      { Print("[exec] no id"); return; }
   if(!JsonField(obj, "symbol", symbol))   { Ack(orderId, "REJECTED", 0,0,"","","missing symbol"); return; }
   if(!JsonField(obj, "side", side))       { Ack(orderId, "REJECTED", 0,0,"","","missing side"); return; }
   double lot   = JsonNumber(obj, "lot");
   double entry = JsonNumber(obj, "entry");
   double sl    = JsonNumber(obj, "sl");
   double tp    = JsonNumber(obj, "tp");

   if(!SymbolSelect(symbol, true))
   {
      Ack(orderId, "REJECTED", 0,0,"","", StringFormat("symbol not in Market Watch: %s", symbol));
      return;
   }

   // Snap volume to broker step + min/max.
   double step = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   double vol  = MathFloor(lot / step) * step;
   if(vol < vmin) { Ack(orderId, "REJECTED", 0,0,"","", StringFormat("lot %.4f < min %.4f", lot, vmin)); return; }
   if(vol > vmax) vol = vmax;

   bool isBuy = (side == "BUY");
   ENUM_ORDER_TYPE type = isBuy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   double price = isBuy ? SymbolInfoDouble(symbol, SYMBOL_ASK)
                        : SymbolInfoDouble(symbol, SYMBOL_BID);
   string comment = "fxsig:" + StringSubstr(orderId, 0, 8);

   bool ok = g_trade.PositionOpen(symbol, type, vol, price, sl, tp, comment);
   if(!ok)
   {
      uint rc = g_trade.ResultRetcode();
      string desc = g_trade.ResultRetcodeDescription();
      Ack(orderId, "REJECTED", 0,0,"","", StringFormat("retcode=%u %s", rc, desc));
      return;
   }
   ulong ticket = g_trade.ResultDeal();
   double fillPrice = g_trade.ResultPrice();
   double fillVol   = g_trade.ResultVolume();

   RememberOrder(orderId, ticket);
   Ack(orderId, "FILLED", fillPrice, fillVol, IntegerToString(ticket), IntegerToString(ticket), "");
}

//+------------------------------------------------------------------+
//| ACK                                                               |
//+------------------------------------------------------------------+
void Ack(const string orderId, const string status,
         double fillPrice = 0.0, double filledLot = 0.0,
         const string brokerPositionId = "", const string brokerOrderId = "",
         const string reason = "", double pnl = 0.0)
{
   string json = StringFormat(
      "{\"orderId\":\"%s\",\"status\":\"%s\"", orderId, status);
   if(fillPrice > 0)        json += StringFormat(",\"fillPrice\":%.5f", fillPrice);
   if(filledLot > 0)        json += StringFormat(",\"filledLot\":%.4f", filledLot);
   if(StringLen(brokerPositionId) > 0) json += StringFormat(",\"brokerPositionId\":\"%s\"", brokerPositionId);
   if(StringLen(brokerOrderId) > 0)    json += StringFormat(",\"brokerOrderId\":\"%s\"", brokerOrderId);
   if(MathAbs(pnl) > 0.0001) json += StringFormat(",\"pnl\":%.2f", pnl);
   if(StringLen(reason) > 0) json += StringFormat(",\"reason\":\"%s\"", JsonEscape(reason));
   json += "}";
   string resp;
   HttpPost(ApiBaseUrl + "/api/bridge/ack", json, resp);
}

string JsonEscape(const string s)
{
   string o = s;
   StringReplace(o, "\\", "\\\\");
   StringReplace(o, "\"", "\\\"");
   StringReplace(o, "\n", " ");
   StringReplace(o, "\r", " ");
   if(StringLen(o) > 250) o = StringSubstr(o, 0, 250);
   return o;
}

//+------------------------------------------------------------------+
//| Heartbeat                                                         |
//+------------------------------------------------------------------+
void SendHeartbeat()
{
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity  = AccountInfoDouble(ACCOUNT_EQUITY);
   double marginLvl = AccountInfoDouble(ACCOUNT_MARGIN_LEVEL);
   int    openPos = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(PositionGetInteger(POSITION_MAGIC) == (long)MagicNumber) openPos++;
   }
   string currency = AccountInfoString(ACCOUNT_CURRENCY);
   string broker   = AccountInfoString(ACCOUNT_COMPANY);
   long   login    = AccountInfoInteger(ACCOUNT_LOGIN);

   string json = StringFormat(
      "{\"balance\":%.2f,\"equity\":%.2f,\"marginLevel\":%.2f,"
      "\"openPositions\":%d,\"currency\":\"%s\",\"accountLogin\":\"%I64d\","
      "\"brokerName\":\"%s\",\"botVersion\":\"%s\"}",
      balance, equity, marginLvl, openPos, currency, login,
      JsonEscape(broker), BotVersion);
   string resp;
   HttpPost(ApiBaseUrl + "/api/bridge/heartbeat", json, resp);
}

//+------------------------------------------------------------------+
//| Order ↔ ticket bookkeeping (for CLOSED acks)                     |
//+------------------------------------------------------------------+
void RememberOrder(const string orderId, ulong ticket)
{
   const int CAP = 200;
   if(g_mapCount >= CAP)
   {
      // Drop oldest by shifting — bounded so ok.
      for(int i = 0; i < CAP - 1; i++)
      {
         g_orderIds[i]     = g_orderIds[i + 1];
         g_orderTickets[i] = g_orderTickets[i + 1];
      }
      g_mapCount = CAP - 1;
   }
   ArrayResize(g_orderIds,     g_mapCount + 1);
   ArrayResize(g_orderTickets, g_mapCount + 1);
   g_orderIds[g_mapCount]     = orderId;
   g_orderTickets[g_mapCount] = ticket;
   g_mapCount++;
}

bool PositionExistsByTicket(ulong ticket)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(PositionGetTicket(i) == ticket) return true;
      // Fallback: a position opened from this deal may live under a different
      // position ticket on hedging accounts. PositionSelectByTicket covers both.
   }
   return PositionSelectByTicket(ticket);
}

void ScanClosedPositions()
{
   if(g_mapCount == 0) return;
   for(int i = g_mapCount - 1; i >= 0; i--)
   {
      ulong ticket = g_orderTickets[i];
      if(PositionExistsByTicket(ticket)) continue;
      // Position closed — fetch realised P&L from history.
      double pnl = HistoryDealPnlByTicket(ticket);
      Ack(g_orderIds[i], "CLOSED", 0, 0, IntegerToString(ticket), "", "", pnl);
      // Remove from map.
      for(int j = i; j < g_mapCount - 1; j++)
      {
         g_orderIds[j]     = g_orderIds[j + 1];
         g_orderTickets[j] = g_orderTickets[j + 1];
      }
      g_mapCount--;
      ArrayResize(g_orderIds,     g_mapCount);
      ArrayResize(g_orderTickets, g_mapCount);
   }
}

double HistoryDealPnlByTicket(ulong positionTicket)
{
   // Aggregate profit/swap/commission for all deals belonging to this position.
   if(!HistorySelect(0, TimeCurrent())) return 0.0;
   double total = 0.0;
   int n = HistoryDealsTotal();
   for(int i = 0; i < n; i++)
   {
      ulong dealTicket = HistoryDealGetTicket(i);
      if(dealTicket == 0) continue;
      if((ulong)HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID) != positionTicket) continue;
      total += HistoryDealGetDouble(dealTicket, DEAL_PROFIT);
      total += HistoryDealGetDouble(dealTicket, DEAL_SWAP);
      total += HistoryDealGetDouble(dealTicket, DEAL_COMMISSION);
   }
   return total;
}
//+------------------------------------------------------------------+
