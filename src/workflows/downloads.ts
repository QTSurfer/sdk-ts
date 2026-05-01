import {
  getExchangeKlinesHour,
  getExchangeTickersHour,
} from '@qtsurfer/api-client';
import { QTSDownloadError } from '../errors';

/** Wire format for hourly tickers/klines downloads. */
export type DownloadFormat = 'lastra' | 'parquet';

export interface DownloadParams {
  exchangeId: string;
  base: string;
  quote: string;
  /** Hour selector in `YYYY-MM-DDTHH` (UTC). */
  hour: string;
  /** Defaults to {@code 'lastra'}. */
  format?: DownloadFormat;
}

/**
 * Download one hour of raw tickers as a {@link Blob}.
 *
 * The default wire format is Lastra (`application/vnd.lastra`); pass
 * `format: 'parquet'` for on-the-fly Parquet conversion.
 *
 * @throws QTSDownloadError on HTTP 4xx/5xx or transport failure.
 */
export async function downloadTickers(params: DownloadParams): Promise<Blob> {
  const { exchangeId, base, quote, hour, format } = params;
  const { data, error, response } = await getExchangeTickersHour({
    path: { exchangeId, base, quote },
    query: { hour, ...(format ? { format } : {}) },
  });
  if (error) {
    throw new QTSDownloadError(
      `tickers download failed: HTTP ${response.status} — ${describe(error)}`,
      error,
    );
  }
  return data as Blob;
}

/**
 * Download one hour of klines as a {@link Blob}. See {@link downloadTickers}
 * for semantics.
 *
 * @throws QTSDownloadError on HTTP 4xx/5xx or transport failure.
 */
export async function downloadKlines(params: DownloadParams): Promise<Blob> {
  const { exchangeId, base, quote, hour, format } = params;
  const { data, error, response } = await getExchangeKlinesHour({
    path: { exchangeId, base, quote },
    query: { hour, ...(format ? { format } : {}) },
  });
  if (error) {
    throw new QTSDownloadError(
      `klines download failed: HTTP ${response.status} — ${describe(error)}`,
      error,
    );
  }
  return data as Blob;
}

function describe(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { code?: unknown; message?: unknown };
    const code = typeof e.code === 'string' ? e.code : undefined;
    const message = typeof e.message === 'string' ? e.message : undefined;
    if (code && message) return `${code}: ${message}`;
    if (message) return message;
    if (code) return code;
  }
  return String(error);
}
