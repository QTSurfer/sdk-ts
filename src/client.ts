import { client as apiClient } from '@qtsurfer/api-client';
import {
  backtest,
  type BacktestOptions,
  type BacktestRequest,
  type BacktestResult,
} from './workflows/backtest';
import {
  downloadKlines,
  downloadTickers,
  type DownloadFormat,
} from './workflows/downloads';

/** Configuration for {@link QTSurfer}. */
export interface QTSurferOptions {
  /** Base URL of the QTSurfer API, e.g. `https://api.qtsurfer.com/v1`. */
  baseUrl: string;
  /**
   * Pre-obtained bearer token. When omitted, requests go out unauthenticated.
   * Use the `authenticate()` helper instead of this constructor if you want
   * the SDK to exchange an apikey for a JWT and refresh it on `401` for you.
   */
  token?: string;
  /** Inject a custom `fetch` (Node 20+, browser, or test mock). */
  fetch?: typeof fetch;
}

/** Selects one hour of tickers or klines for a single instrument. */
export interface DownloadHourArgs {
  /** Exchange id, e.g. `binance`. */
  exchangeId: string;
  /** Base asset of the instrument, e.g. `BTC`. */
  base: string;
  /** Quote asset of the instrument, e.g. `USDT`. */
  quote: string;
  /** Hour selector in `YYYY-MM-DDTHH` (UTC). */
  hour: string;
  /** Wire format. Defaults to `'lastra'`. */
  format?: DownloadFormat;
}

/**
 * Thin, stateless wrapper over `@qtsurfer/api-client` that exposes the SDK's
 * workflow methods (`backtest`, `tickers`, `klines`). Constructing an
 * instance reconfigures the underlying api-client singleton, so avoid
 * holding two `QTSurfer`s with different `baseUrl`s or tokens alive in the
 * same process — they will race. Prefer the `authenticate()` helper over
 * this constructor unless you already manage the JWT lifecycle yourself.
 */
export class QTSurfer {
  constructor(options: QTSurferOptions) {
    apiClient.setConfig({
      baseUrl: options.baseUrl,
      ...(options.token
        ? { headers: { Authorization: `Bearer ${options.token}` } }
        : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  /**
   * Run a backtest end-to-end: compile the strategy, prepare the requested
   * data range, execute it, and resolve with the result once execution
   * completes. See the underlying `backtest` workflow for the
   * stage-by-stage error and retry semantics.
   */
  backtest(req: BacktestRequest, opts?: BacktestOptions): Promise<BacktestResult> {
    return backtest(req, opts);
  }

  /**
   * Download one hour of raw tickers for an instrument as a {@link Blob}.
   * Defaults to Lastra; pass `{ format: 'parquet' }` for Parquet.
   */
  tickers(args: DownloadHourArgs): Promise<Blob> {
    return downloadTickers(args);
  }

  /** Download one hour of klines for an instrument as a {@link Blob}. */
  klines(args: DownloadHourArgs): Promise<Blob> {
    return downloadKlines(args);
  }

  // Future surface:
  //   strategies: { compile, status, list }
  //   instruments: { list, get } with TTL cache
  //   jobs: { cancel, stream, result }
}
