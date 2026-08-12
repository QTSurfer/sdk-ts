import {
  listExchanges as apiListExchanges,
  listInstruments as apiListInstruments,
  listSegmentInstruments as apiListSegmentInstruments,
  type Exchange as ApiExchange,
  type InstrumentDetail as ApiInstrumentDetail,
} from '@qtsurfer/api-client';
import { QTSError } from '../errors';
import { requestFailed } from '../internal/requestError';

/**
 * One exchange the platform serves. Alias for api-client's `Exchange`:
 * `id` (what every other call takes as `exchangeId`), `name`, and an
 * optional `description`.
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

/**
 * A market segment of an exchange. `'spot'` is the default segment served
 * when {@link QTSurfer.instruments} is called without one.
 */
export type InstrumentSegment = 'spot' | 'futures';

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
  const { data, error, response } = segment
    ? await apiListSegmentInstruments({ path: { exchangeId, segment } })
    : await apiListInstruments({ path: { exchangeId } });
  if (error) throw requestFailed('instruments call', error, response?.status);
  if (!data) throw new QTSError('Empty instruments response');
  return data.data;
}
