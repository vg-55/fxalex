// Thin REST wrapper around MetaApi.cloud — the hosted bridge that lets us
// connect to any MT5 account given { server, login, password }.
//
// Why MetaApi: MT5 has no public REST API. MetaApi runs the MT5 client for us
// and exposes provisioning + RPC over HTTPS. Free tier covers a couple of
// accounts; paid tiers for production.
//
// Sign up at https://app.metaapi.cloud/token, set:
//   METAAPI_TOKEN  — auth token (long-lived JWT)
//   METAAPI_DOMAIN — optional, defaults to "agiliumtrade.agiliumtrade.ai"
//
// All credentials are forwarded over TLS. We never log decrypted passwords.

const DEFAULT_DOMAIN = "agiliumtrade.agiliumtrade.ai";

function token(): string {
  const t = process.env.METAAPI_TOKEN;
  if (!t) {
    throw new Error(
      "METAAPI_TOKEN is not set. Sign up at https://app.metaapi.cloud/token and add it to .env"
    );
  }
  return t;
}

function provisioningUrl(): string {
  const domain = process.env.METAAPI_DOMAIN ?? DEFAULT_DOMAIN;
  return `https://mt-provisioning-api-v1.${domain}`;
}

function clientApiUrl(region: string): string {
  // MetaApi proxies broker terminals through region-specific clusters.
  // The trader-account cluster URL pattern:
  const domain = process.env.METAAPI_DOMAIN ?? DEFAULT_DOMAIN;
  return `https://mt-client-api-v1.${region}.${domain}`;
}

async function request<T>(
  url: string,
  init: RequestInit & { json?: unknown } = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("auth-token", token());
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    init = { ...init, body: JSON.stringify(init.json) };
  }
  const res = await fetch(url, { ...init, headers, cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`MetaApi ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Provisioning — create / update / deploy / undeploy / delete accounts
// ---------------------------------------------------------------------------
export type ProvisionInput = {
  name: string;             // free-form label
  server: string;           // broker MT5 server, e.g. "ICMarketsSC-Demo"
  login: string;            // MT5 account number
  password: string;         // master/investor password
  region?: string;          // default "new-york"
  platform?: "mt5" | "mt4"; // default mt5
};

export type ProvisionResponse = { id: string };

export async function createAccount(input: ProvisionInput): Promise<ProvisionResponse> {
  const body = {
    name: input.name,
    type: "cloud-g2",
    server: input.server,
    login: input.login,
    password: input.password,
    platform: input.platform ?? "mt5",
    region: input.region ?? "new-york",
    application: "MetaApi",
    magic: 0,
    keywords: ["fxaleg"],
  };
  return request<ProvisionResponse>(`${provisioningUrl()}/users/current/accounts`, {
    method: "POST",
    json: body,
  });
}

export type AccountInfo = {
  _id: string;
  state:
    | "CREATED"
    | "DEPLOYING"
    | "DEPLOYED"
    | "UNDEPLOYING"
    | "UNDEPLOYED"
    | "DELETING";
  connectionStatus?: "CONNECTED" | "DISCONNECTED" | "DISCONNECTED_FROM_BROKER";
  name?: string;
  server?: string;
  login?: string;
  region?: string;
};

export async function getAccount(id: string): Promise<AccountInfo> {
  return request<AccountInfo>(`${provisioningUrl()}/users/current/accounts/${id}`);
}

export async function deployAccount(id: string): Promise<void> {
  await request<void>(`${provisioningUrl()}/users/current/accounts/${id}/deploy`, {
    method: "POST",
  });
}

export async function undeployAccount(id: string): Promise<void> {
  await request<void>(`${provisioningUrl()}/users/current/accounts/${id}/undeploy`, {
    method: "POST",
  });
}

export async function deleteAccount(id: string): Promise<void> {
  await request<void>(`${provisioningUrl()}/users/current/accounts/${id}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Trading — RPC against deployed account
// ---------------------------------------------------------------------------
export type AccountInformation = {
  broker: string;
  currency: string;
  server: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  leverage: number;
  name: string;
  login: number;
  type: string;
};

export async function getAccountInformation(
  accountId: string,
  region: string
): Promise<AccountInformation> {
  return request<AccountInformation>(
    `${clientApiUrl(region)}/users/current/accounts/${accountId}/account-information`
  );
}

export type Position = {
  id: string;
  type: "POSITION_TYPE_BUY" | "POSITION_TYPE_SELL";
  symbol: string;
  magic: number;
  time: string;
  openPrice: number;
  currentPrice: number;
  currentTickValue: number;
  stopLoss?: number;
  takeProfit?: number;
  volume: number;
  swap: number;
  profit: number;
  commission?: number;
  comment?: string;
};

export async function getPositions(
  accountId: string,
  region: string
): Promise<Position[]> {
  return request<Position[]>(
    `${clientApiUrl(region)}/users/current/accounts/${accountId}/positions`
  );
}

// ---------------------------------------------------------------------------
// Order placement — market BUY/SELL with SL/TP
// ---------------------------------------------------------------------------
export type TradeResponse = {
  numericCode: number;
  stringCode: string;
  message: string;
  orderId?: string;
  positionId?: string;
};

export type MarketOrderInput = {
  accountId: string;
  region: string;
  symbol: string;
  side: "BUY" | "SELL";
  volume: number;
  stopLoss?: number;
  takeProfit?: number;
  comment?: string;
  clientId?: string;
};

export async function submitMarketOrder(
  input: MarketOrderInput
): Promise<TradeResponse> {
  const actionType =
    input.side === "BUY" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL";
  const body = {
    actionType,
    symbol: input.symbol,
    volume: input.volume,
    stopLoss: input.stopLoss,
    takeProfit: input.takeProfit,
    comment: input.comment?.slice(0, 31),
    clientId: input.clientId?.slice(0, 31),
  };
  return request<TradeResponse>(
    `${clientApiUrl(input.region)}/users/current/accounts/${input.accountId}/trade`,
    { method: "POST", json: body }
  );
}

export async function closePosition(
  accountId: string,
  region: string,
  positionId: string
): Promise<TradeResponse> {
  return request<TradeResponse>(
    `${clientApiUrl(region)}/users/current/accounts/${accountId}/trade`,
    {
      method: "POST",
      json: { actionType: "POSITION_CLOSE_ID", positionId },
    }
  );
}

export function isMetaApiConfigured(): boolean {
  return !!process.env.METAAPI_TOKEN;
}
