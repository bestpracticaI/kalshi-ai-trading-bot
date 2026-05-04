import {
  constants,
  createPrivateKey,
  createSign,
  randomUUID,
} from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { settings } from "../config/settings.js";
import { getTradingLogger } from "../utils/logger.js";

const log = getTradingLogger("kalshi_client");

export class KalshiAPIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KalshiAPIError";
  }
}

export interface KalshiClientOptions {
  apiKey?: string;
  privateKeyPath?: string;
  maxRetries?: number;
  backoffFactor?: number;
}

function resolvePrivateKeyPath(explicit?: string): string {
  if (explicit) return path.resolve(explicit);
  const env = process.env.KALSHI_PRIVATE_KEY_PATH;
  if (env) return path.resolve(env);
  const candidates = [
    path.resolve(process.cwd(), "kalshi_private_key.pem"),
    path.resolve(process.cwd(), "..", "kalshi_private_key.pem"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0]!;
}

/** True when signing material comes from environment variables (not a PEM file). */
function privateKeyFromEnv(): boolean {
  const pem = process.env.KALSHI_PRIVATE_KEY?.trim();
  const b64 = process.env.KALSHI_PRIVATE_KEY_BASE64?.trim();
  return Boolean(pem || b64);
}

/** Kalshi API key present and not the template placeholder. */
export function isKalshiApiKeyConfigured(): boolean {
  const key = (settings.api.kalshiApiKey ?? "").trim();
  if (!key || key === "your_kalshi_api_key_here") return false;
  return true;
}

/** PEM/base64 in env or an existing default PEM file — ready to sign requests. */
export function kalshiTradingEnvReady(): boolean {
  if (!isKalshiApiKeyConfigured()) return false;
  if (privateKeyFromEnv()) return true;
  const pemPath = resolvePrivateKeyPath();
  return existsSync(pemPath);
}

/** Normalize PEM stored in .env (often uses `\n` escapes instead of real newlines). */
function normalizeInlinePem(raw: string): string {
  return raw.trim().replace(/\\n/g, "\n");
}

export class KalshiClient {
  private apiKey: string;
  private baseUrl: string;
  private privateKeyPath: string;
  private privateKeyPem: string;
  private maxRetries: number;
  private backoffFactor: number;

  constructor(opts: KalshiClientOptions = {}) {
    this.apiKey = opts.apiKey ?? settings.api.kalshiApiKey;
    this.baseUrl = settings.api.kalshiBaseUrl.replace(/\/$/, "");
    this.privateKeyPath = privateKeyFromEnv()
      ? "(env: KALSHI_PRIVATE_KEY or KALSHI_PRIVATE_KEY_BASE64)"
      : (opts.privateKeyPath ?? resolvePrivateKeyPath());
    this.maxRetries = opts.maxRetries ?? 5;
    this.backoffFactor = opts.backoffFactor ?? 0.5;
    this.privateKeyPem = this.loadPrivateKeyPem();
    log.info(
      { apiKeyLength: this.apiKey?.length ?? 0 },
      "Kalshi client initialized",
    );
  }

  private loadPrivateKeyPem(): string {
    try {
      const inlinePem = process.env.KALSHI_PRIVATE_KEY?.trim();
      const inlineB64 = process.env.KALSHI_PRIVATE_KEY_BASE64?.trim();

      let pem: string;
      let source: string;

      if (inlinePem) {
        pem = normalizeInlinePem(inlinePem);
        source = "KALSHI_PRIVATE_KEY";
      } else if (inlineB64) {
        pem = Buffer.from(inlineB64, "base64").toString("utf8");
        source = "KALSHI_PRIVATE_KEY_BASE64";
      } else {
        if (!existsSync(this.privateKeyPath)) {
          throw new KalshiAPIError(
            `Private key file not found: ${this.privateKeyPath}. Set KALSHI_PRIVATE_KEY (PEM), KALSHI_PRIVATE_KEY_BASE64, or KALSHI_PRIVATE_KEY_PATH.`,
          );
        }
        pem = readFileSync(this.privateKeyPath, "utf8");
        source = "file";
      }

      createPrivateKey(pem); // validate early
      log.info({ source }, "Private key loaded successfully");
      return pem;
    } catch (e) {
      log.error({ err: e }, "Failed to load private key");
      throw new KalshiAPIError(
        `Failed to load private key: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** RSA-PSS SHA256, matching Python `cryptography` PSS + DIGEST_LENGTH salt. */
  private signRequest(timestampMs: string, method: string, reqPath: string): string {
    const message = `${timestampMs}${method.toUpperCase()}${reqPath}`;
    try {
      const signer = createSign("RSA-SHA256");
      signer.update(message);
      signer.end();
      const sig = signer.sign({
        key: this.privateKeyPem,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
      });
      return sig.toString("base64");
    } catch (e) {
      log.error({ err: e }, "Failed to sign request");
      throw new KalshiAPIError(
        `Failed to sign request: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async request<T = unknown>(
    method: string,
    endpoint: string,
    options: {
      params?: Record<string, string | number | undefined>;
      json?: Record<string, unknown>;
      requireAuth?: boolean;
    } = {},
  ): Promise<T> {
    const requireAuth = options.requireAuth ?? true;
    let url = `${this.baseUrl}${endpoint}`;
    if (options.params) {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(options.params)) {
        if (v === undefined) continue;
        q.set(k, String(v));
      }
      const s = q.toString();
      if (s) url = `${url}?${s}`;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (requireAuth) {
      const timestamp = String(Date.now());
      const signature = this.signRequest(timestamp, method, endpoint);
      headers["KALSHI-ACCESS-KEY"] = this.apiKey;
      headers["KALSHI-ACCESS-TIMESTAMP"] = timestamp;
      headers["KALSHI-ACCESS-SIGNATURE"] = signature;
    }

    const bodyStr =
      options.json !== undefined &&
      ["POST", "PUT", "PATCH"].includes(method.toUpperCase())
        ? JSON.stringify(options.json)
        : undefined;

    let lastErr: unknown;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      await sleep(200);
      try {
        const res = await fetch(url, {
          method,
          headers,
          body: bodyStr,
        });

        if (!res.ok) {
          const text = await res.text();
          const errMsg = `HTTP ${res.status}: ${text}`;
          if (res.status === 429 || res.status >= 500) {
            const sleepTime = this.backoffFactor * 2 ** attempt;
            log.warn(
              { endpoint, attempt: attempt + 1, status: res.status },
              `Kalshi API retry in ${sleepTime}s`,
            );
            await sleep(sleepTime * 1000);
            lastErr = new KalshiAPIError(errMsg);
            continue;
          }
          throw new KalshiAPIError(errMsg);
        }

        return (await res.json()) as T;
      } catch (e) {
        lastErr = e;
        if (e instanceof KalshiAPIError && !String(e.message).startsWith("HTTP 5")) {
          throw e;
        }
        const sleepTime = this.backoffFactor * 2 ** attempt;
        log.warn({ endpoint, err: e }, `Request failed, retry in ${sleepTime}s`);
        await sleep(sleepTime * 1000);
      }
    }

    throw new KalshiAPIError(
      `API request failed after ${this.maxRetries} retries: ${lastErr}`,
    );
  }

  getBalance(): Promise<Record<string, unknown>> {
    return this.request("GET", "/trade-api/v2/portfolio/balance");
  }

  getPositions(ticker?: string): Promise<Record<string, unknown>> {
    return this.request("GET", "/trade-api/v2/portfolio/positions", {
      params: ticker ? { ticker } : {},
    });
  }

  getFills(ticker?: string, limit = 100): Promise<Record<string, unknown>> {
    return this.request("GET", "/trade-api/v2/portfolio/fills", {
      params: { limit, ...(ticker ? { ticker } : {}) },
    });
  }

  getOrders(
    ticker?: string,
    status?: string,
  ): Promise<Record<string, unknown>> {
    return this.request("GET", "/trade-api/v2/portfolio/orders", {
      params: {
        ...(ticker ? { ticker } : {}),
        ...(status ? { status } : {}),
      },
    });
  }

  getMarkets(params: {
    limit?: number;
    cursor?: string;
    event_ticker?: string;
    series_ticker?: string;
    status?: string;
    tickers?: string[];
  } = {}): Promise<Record<string, unknown>> {
    const tickers =
      params.tickers && params.tickers.length > 0
        ? params.tickers.join(",")
        : undefined;
    return this.request("GET", "/trade-api/v2/markets", {
      params: {
        limit: params.limit ?? 100,
        cursor: params.cursor,
        event_ticker: params.event_ticker,
        series_ticker: params.series_ticker,
        status: params.status,
        tickers,
      },
    });
  }

  getMarket(ticker: string): Promise<Record<string, unknown>> {
    return this.request(
      "GET",
      `/trade-api/v2/markets/${encodeURIComponent(ticker)}`,
      { requireAuth: false },
    );
  }

  getOrderbook(
    ticker: string,
    depth = 100,
  ): Promise<Record<string, unknown>> {
    return this.request(
      "GET",
      `/trade-api/v2/markets/${encodeURIComponent(ticker)}/orderbook`,
      { params: { depth }, requireAuth: false },
    );
  }

  getMarketHistory(
    ticker: string,
    opts: { startTs?: number; endTs?: number; limit?: number } = {},
  ): Promise<Record<string, unknown>> {
    return this.request(
      "GET",
      `/trade-api/v2/markets/${encodeURIComponent(ticker)}/history`,
      {
        params: {
          limit: opts.limit ?? 100,
          start_ts: opts.startTs,
          end_ts: opts.endTs,
        },
        requireAuth: false,
      },
    );
  }

  placeOrder(params: {
    ticker: string;
    clientOrderId?: string;
    side: string;
    action: string;
    count: number;
    type?: string;
    yesPrice?: number;
    noPrice?: number;
    expirationTs?: number;
  }): Promise<Record<string, unknown>> {
    const orderData: Record<string, unknown> = {
      ticker: params.ticker,
      client_order_id: params.clientOrderId ?? randomUUID(),
      side: params.side,
      action: params.action,
      count: params.count,
      type: params.type ?? "market",
    };
    if (params.yesPrice !== undefined) orderData.yes_price = params.yesPrice;
    if (params.noPrice !== undefined) orderData.no_price = params.noPrice;
    if (params.expirationTs !== undefined)
      orderData.expiration_ts = params.expirationTs;

    return this.request("POST", "/trade-api/v2/portfolio/orders", {
      json: orderData,
    });
  }

  cancelOrder(orderId: string): Promise<Record<string, unknown>> {
    return this.request(
      "DELETE",
      `/trade-api/v2/portfolio/orders/${encodeURIComponent(orderId)}`,
    );
  }

  getTrades(opts: {
    ticker?: string;
    limit?: number;
    cursor?: string;
  } = {}): Promise<Record<string, unknown>> {
    return this.request("GET", "/trade-api/v2/portfolio/trades", {
      params: {
        limit: opts.limit ?? 100,
        ticker: opts.ticker,
        cursor: opts.cursor,
      },
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
