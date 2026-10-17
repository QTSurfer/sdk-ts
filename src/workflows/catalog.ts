import {
  listExchanges as apiListExchanges,
  listInstruments as apiListInstruments,
  listSegmentInstruments as apiListSegmentInstruments,
  type Exchange as ApiExchange,
  type InstrumentDetail as ApiInstrumentDetail,
  type InstrumentListResponse,
  type PoolDetail as ApiPoolDetail,
  type PoolListResponse,
} from '@qtsurfer/api-client';
import { QTSError } from '../errors';
import { requestFailed } from '../internal/requestError';

/**
 * One exchange the platform serves. Alias for api-client's `Exchange`:
 * Discover `venueType`, `segments`, and `liveSegments` before selecting a
 * catalogue or starting a live run. DEX exchanges cannot be backtested directly.
 */
export type Exchange = ApiExchange;

/**
 * One instrument on an exchange. Alias for api-client's `InstrumentDetail`:
 * `id` / `base` / `quote`, plus optional `coverage` (the date windows for
 * which tickers and klines actually exist, per data type), `lastPrice` and
 * `volume24h`.
 *
 * `coverage` is what tells you whether a backtest range is downloadable at
 * all; it is optional, and absent means the platform did not report one, not
 * that there is no data.
 */
export type InstrumentDetail = ApiInstrumentDetail;

/** A DEX pool. Use `id` (its address) to start a live run; signals use `symbol`. */
export type PoolDetail = ApiPoolDetail;

/**
 * A market segment of an exchange. `'spot'` is the default segment served
 * when {@link QTSurfer.getInstruments} is called without one.
 */
export type InstrumentSegment = string;

type Catalog = InstrumentListResponse | PoolListResponse;

function isInstrumentCatalog(data: Catalog): data is InstrumentListResponse {
  return data.meta.venueType === 'cex';
}

function isPoolCatalog(data: Catalog): data is PoolListResponse {
  return data.meta.venueType === 'dex';
}

/**
 * List the exchanges the platform serves.
 *
 * @throws QTSError on any non-2xx response, with the HTTP status on `status`.
 */
export async function listExchanges(): Promise<Exchange[]> {
  const { data, error, response } = await apiListExchanges();
  if (error) throw requestFailed('exchanges call', error, response?.status);
  if (!data) throw new QTSError('Empty exchanges response');
  return data;
}

/**
 * List an exchange's instruments, each with its per-data-type coverage.
 *
 * Omitting `segment` asks for the exchange's **default** segment, which is
 * `'spot'` today. The API answers both routes with a HAL envelope
 * (`data` / `meta` / `_links`) that this function unwraps to the instrument
 * array, so `meta.segment`, `meta.updatedAt` and the `_links`
 * segment-discovery links do not reach the caller: if you need certainty
 * about which segment you are looking at, pass `segment` explicitly rather
 * than relying on the default.
 *
 * @param exchangeId exchange identifier, e.g. `binance`
 * @param segment market segment to list; defaults to the exchange's default
 * segment
 * @throws QTSError on any non-2xx response, with the HTTP status on `status`.
 */
export async function listInstruments(
  exchangeId: string,
  segment?: InstrumentSegment,
): Promise<InstrumentDetail[]> {
  const data = await getCatalog(exchangeId, segment);
  if (!isInstrumentCatalog(data)) {
    throw new QTSError('Expected a CEX instrument catalogue; use getPools() for a DEX exchange');
  }
  return data.data;
}

/**
 * Read a DEX pool catalogue, unwrapping its HAL envelope. Omit `segment` to
 * select the exchange's first protocol. Choose a protocol from `Exchange.segments`.
 * The list holds up to 50 pools above its liquidity threshold, refreshed hourly;
 * an unlisted pool can still be used in a live run. Unknown prices, volume, and
 * creation dates are absent. A CEX response raises `QTSError`.
 */
export async function getPools(exchangeId: string, segment?: string): Promise<PoolDetail[]> {
  const data = await getCatalog(exchangeId, segment);
  if (!isPoolCatalog(data)) {
    throw new QTSError('Expected a DEX pool catalogue; use getInstruments() for a CEX exchange');
  }
  return data.data;
}

async function getCatalog(exchangeId: string, segment?: string): Promise<Catalog> {
  const { data, error, response } = segment
    ? await apiListSegmentInstruments({ path: { exchangeId, segment } })
    : await apiListInstruments({ path: { exchangeId } });
  if (error) throw requestFailed('instruments call', error, response?.status);
  if (!data) throw new QTSError('Empty instruments response');
  return data;
}
