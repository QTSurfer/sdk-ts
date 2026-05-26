import {
  auth as apiAuth,
  client as apiClient,
  type AuthTokenResponse,
} from '@qtsurfer/api-client';
import { QTSAuthError } from '../errors';
import {
  backtest as runBacktest,
  type BacktestOptions,
  type BacktestRequest,
  type BacktestResult,
} from '../workflows/backtest';
import {
  downloadKlines,
  downloadTickers,
} from '../workflows/downloads';
import type { DownloadHourArgs } from '../client';
import { InMemoryTokenStore, type TokenStore } from './tokenStore';

const APIKEY_ENV_VAR = 'QTSURFER_APIKEY';
const DEFAULT_BASE_URL = 'https://api.qtsurfer.com/v1';

export interface AuthOptions {
  /** Base URL of the QTSurfer API. Defaults to the public production endpoint. */
  baseUrl?: string;
  /** Custom token store. Defaults to {@link InMemoryTokenStore}. */
  store?: TokenStore;
  /** Inject a custom `fetch` (Node 20+, browser, or test mock). */
  fetch?: typeof fetch;
}

/**
 * Authenticated SDK session.
 *
 * Returned by {@link auth}. Wraps the underlying api-client, owns a JWT
 * (in memory by default, or in the provided {@link TokenStore}), and
 * transparently re-exchanges the apikey for a fresh JWT on 401.
 *
 * Multi-session note: the session mutates the api-client singleton config
 * on every call. Concurrent sessions in the same process will race; today
 * the SDK targets the one-session-per-process pattern.
 */
export class AuthenticatedClient {
  readonly baseUrl: string;
  private readonly apikey: string;
  private readonly store: TokenStore;
  private readonly fetchImpl: typeof fetch | undefined;
  private cached: AuthTokenResponse | null = null;
  private refreshing: Promise<AuthTokenResponse> | null = null;

  constructor(apikey: string, opts: AuthOptions = {}) {
    this.apikey = apikey;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.store = opts.store ?? new InMemoryTokenStore();
    this.fetchImpl = opts.fetch;
  }

  /** Currently cached token, if any. */
  get token(): AuthTokenResponse | null {
    return this.cached;
  }

  /** Force a fresh JWT exchange. Bypasses the cache. */
  async refresh(): Promise<AuthTokenResponse> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const { data, error, response } = await apiAuth({
        baseUrl: this.baseUrl,
        headers: { 'X-API-Key': this.apikey },
        ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}),
      });
      if (error || !data) {
        throw new QTSAuthError(
          `auth() failed: HTTP ${response.status}`,
          error,
        );
      }
      this.cached = data;
      await this.store.save(data);
      return data;
    })();
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }

  /**
   * Load a previously-persisted token from the store. If none, mint one.
   * Called automatically by every workflow method.
   */
  async ensureToken(): Promise<AuthTokenResponse> {
    if (this.cached) return this.cached;
    const stored = await this.store.load();
    if (stored) {
      this.cached = stored;
      return stored;
    }
    return this.refresh();
  }

  /** Drop the cached token (in memory and in the store). */
  async clear(): Promise<void> {
    this.cached = null;
    await this.store.clear();
  }

  /**
   * Run a call with the Bearer header pre-set; if it returns 401, refresh
   * once and retry. A second 401 surfaces to the caller.
   */
  private async withRefreshOn401<T>(call: () => Promise<T>): Promise<T> {
    await this.applyConfig();
    try {
      return await call();
    } catch (err) {
      if (!isUnauthorized(err)) throw err;
      this.cached = null;
      await this.refresh();
      await this.applyConfig();
      return call();
    }
  }

  private async applyConfig(): Promise<void> {
    const token = await this.ensureToken();
    apiClient.setConfig({
      baseUrl: this.baseUrl,
      headers: { Authorization: `Bearer ${token.access_token}` },
      ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}),
    });
  }

  // ---- Workflow surface (mirrors QTSurfer) ----

  backtest(req: BacktestRequest, opts?: BacktestOptions): Promise<BacktestResult> {
    return this.withRefreshOn401(() => runBacktest(req, opts));
  }

  tickers(args: DownloadHourArgs): Promise<Blob> {
    return this.withRefreshOn401(() => downloadTickers(args));
  }

  klines(args: DownloadHourArgs): Promise<Blob> {
    return this.withRefreshOn401(() => downloadKlines(args));
  }
}

/**
 * Exchange a long-lived API key for an authenticated session.
 *
 * If `apikey` is omitted, the SDK reads `QTSURFER_APIKEY` from the
 * environment. The returned {@link AuthenticatedClient} caches the JWT,
 * refreshes it on 401, and exposes the same workflow surface as
 * `QTSurfer` (`backtest`, `tickers`, `klines`).
 *
 * @throws {QTSAuthError} if no apikey is supplied or available in env.
 */
export async function auth(
  apikey?: string,
  opts: AuthOptions = {},
): Promise<AuthenticatedClient> {
  const resolved = apikey ?? readEnvApikey();
  if (!resolved) {
    throw new QTSAuthError(
      `auth() requires an apikey (argument or ${APIKEY_ENV_VAR} env var)`,
    );
  }
  const session = new AuthenticatedClient(resolved, opts);
  await session.ensureToken();
  return session;
}

function readEnvApikey(): string | undefined {
  // `process` is undefined in browser bundlers; guard explicitly.
  if (typeof process === 'undefined' || !process.env) return undefined;
  const value = process.env[APIKEY_ENV_VAR];
  return value && value.length > 0 ? value : undefined;
}

function isUnauthorized(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  // SDK-thrown errors (QTSDownloadError, etc.) carry the HTTP status on
  // a top-level `status` field. Workflow errors that don't yet expose
  // status default to non-401.
  const maybeStatus = (err as { status?: unknown }).status;
  if (typeof maybeStatus === 'number' && maybeStatus === 401) return true;
  return false;
}
