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

export interface QTSurferOptions {
  baseUrl: string;
  token?: string;
  fetch?: typeof fetch;
}

export interface DownloadHourArgs {
  exchangeId: string;
  base: string;
  quote: string;
  /** Hour selector in `YYYY-MM-DDTHH` (UTC). */
  hour: string;
  /** Wire format. Defaults to `'lastra'`. */
  format?: DownloadFormat;
}

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
