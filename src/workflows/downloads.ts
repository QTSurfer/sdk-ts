import {
  downloadKlines as apiDownloadKlines,
  downloadTickers as apiDownloadTickers,
} from '@qtsurfer/api-client';
import { QTSDownloadError } from '../errors';

/** Wire format for hourly tickers/klines downloads. */
export type DownloadFormat = 'lastra' | 'parquet';

export interface DownloadParams {
  /** Exchange id, e.g. `binance`. */
  exchangeId: string;
  /** Base asset of the instrument, e.g. `BTC`. */
  base: string;
  /** Quote asset of the instrument, e.g. `USDT`. */
  quote: string;
  /** Hour selector in `YYYY-MM-DDTHH` (UTC), within the last seven days. */
  hour: string;
  /** Defaults to `'lastra'`. */
  format?: DownloadFormat;
}

/** Download bytes together with timestamp units and provisional-data markers. */
export interface DownloadResult {
  blob: Blob;
  /** Response headers, including Content-Disposition when a filename is supplied. */
  headers: Headers;
  /** `micros` for Lastra. Parquet timestamps remain milliseconds. */
  tsUnit?: string;
  /** `provisional` means the hour can still grow; absent for a stored hour. */
  dataStatus?: string;
  /** Last row's ISO-8601 UTC instant, irrespective of `tsUnit`, for provisional data. */
  dataThrough?: string;
}

/**
 * Download one hour of raw tickers as a {@link Blob}.
 *
 * The last seven days are available. Lastra (`application/vnd.qtsurfer.lastra`)
 * uses microseconds; Parquet uses milliseconds. Use the metadata variant when
 * provisional answers matter.
 *
 * @throws QTSDownloadError on HTTP 4xx/5xx or transport failure.
 */
export async function downloadTickers(params: DownloadParams): Promise<Blob> {
  return (await downloadTickersWithMetadata(params)).blob;
}

/**
 * Download one hour of klines as a {@link Blob}. See {@link downloadTickers}
 * for semantics.
 *
 * @throws QTSDownloadError on HTTP 4xx/5xx or transport failure.
 */
export async function downloadKlines(params: DownloadParams): Promise<Blob> {
  return (await downloadKlinesWithMetadata(params)).blob;
}

/**
 * Download tickers with response metadata. A provisional answer can still grow:
 * fetch again later to obtain the stored hour. Where provisional data is not
 * served, recent hours raise `NOT_YET_AVAILABLE` instead. Retry delays and
 * recovery requests are available on `QTSDownloadError`.
 */
export function downloadTickersWithMetadata(params: DownloadParams): Promise<DownloadResult> {
  return download('tickers', apiDownloadTickers, params);
}

/** Download klines with the same metadata and recovery semantics as ticker downloads. */
export function downloadKlinesWithMetadata(params: DownloadParams): Promise<DownloadResult> {
  return download('klines', apiDownloadKlines, params);
}

async function download(
  kind: string,
  call: typeof apiDownloadTickers,
  { exchangeId, base, quote, hour, format }: DownloadParams,
): Promise<DownloadResult> {
  try {
    const { data, error, response } = await call({
      path: { exchangeId, base, quote },
      query: { hour, ...(format ? { format } : {}) },
      parseAs: 'blob',
    });
    if (error) {
      throw new QTSDownloadError(
        `${kind} download failed: HTTP ${response?.status ?? 'unknown'} — ${describe(error)}`,
        error,
        response?.status,
        response?.headers,
      );
    }
    if (!(data instanceof Blob)) throw new QTSDownloadError(`Empty ${kind} download response`);
    const headers = response.headers ?? new Headers();
    return {
      blob: data,
      headers,
      tsUnit: headers.get('X-Ts-Unit') ?? undefined,
      dataStatus: headers.get('X-Data-Status') ?? undefined,
      dataThrough: headers.get('X-Data-Through') ?? undefined,
    };
  } catch (error) {
    if (error instanceof QTSDownloadError) throw error;
    throw new QTSDownloadError(`${kind} download transport failed`, error);
  }
}

function describe(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { code?: unknown; message?: unknown };
    const code = typeof e.code === 'string' || typeof e.code === 'number' ? e.code : undefined;
    const message = typeof e.message === 'string' ? e.message : undefined;
    if (code !== undefined && message) return `${code}: ${message}`;
    if (message) return message;
    if (code !== undefined) return String(code);
  }
  return String(error);
}
