# Exchanges, instruments, and downloads

Start with an authenticated session; every snippet below uses `qts`:

```ts
import { authenticate } from '@qtsurfer/sdk';

const qts = await authenticate(); // reads QTSURFER_APIKEY
```

Discover the available catalog before selecting a data window. `getInstruments` unwraps the API's
HAL envelope and returns the instrument array; coverage is live platform state and is not cached.
`Exchange.venueType` is `cex` or `dex`; `segments` lists its catalogue segments, and `liveSegments`
the subset usable by a live run. A DEX exchange id is only accepted by catalogue routes: import
its pool's history as a dataset to backtest it.

```ts
const exchanges = await qts.getExchanges();
const spot = await qts.getInstruments('binance');
const futures = await qts.getInstruments('binance', 'futures');
console.log(spot[0]?.coverage?.tickers);
```

`getInstruments(exchangeId, segment?)` remains a CEX method returning `InstrumentDetail[]`.
`symbol` equals `id`; a futures instrument can carry `settle`. For a DEX, call
`getPools(exchangeId, protocol?)`, which returns `PoolDetail[]`; omitting the protocol selects the
exchange's first segment. A mismatch between the method and returned `meta.venueType` raises
`QTSError`, even for an empty catalogue. Segments are strings discovered from `getExchanges()`.

```ts
const dex = exchanges.find((exchange) => exchange.venueType === 'dex');
if (dex) {
  const pools = await qts.getPools(dex.id, dex.segments[0]);
  console.log(pools[0]?.id, pools[0]?.symbol); // address for live input, pair for output signals
}
```

The pool list holds the 50 most traded pools with at least USD 10,000 liquidity, refreshed hourly.
It is a starting point: an unlisted pool can still run. Pools expose token addresses, fee tier,
USD liquidity and volume; `volume24h` is in quote tokens. Pool price and volume can be an hour old;
CEX figures refresh every few minutes. Unknown `lastPrice`, `volume24h`, and pool `createdAt` are
absent, never `null`. The SDK unwraps both catalogues, so metadata and HAL links are available
through the generated client's `InstrumentCatalogueResponse` when needed. Unknown exchange or
segment returns `400`; an unavailable catalogue returns `404`.

## Hourly downloads

Download one CEX instrument-hour as a `Blob`. `exchangeId`, `base`, `quote`, and `hour` are
required; `hour` is `YYYY-MM-DDTHH` UTC, without minutes or a timezone suffix. Choose an hour that
started no more than seven days ago. Lastra is the default; `format: 'parquet'` requests Parquet.

```ts
// A recent completed hour, rather than a calendar date that will expire.
const hour = new Date(Date.now() - 2 * 3_600_000).toISOString().slice(0, 13);
const blob = await qts.downloadTickers({
  exchangeId: 'binance', base: 'BTC', quote: 'USDT', hour,
  format: 'parquet',
});
```

`downloadKlines` has the same arguments. Bytes are returned untouched: Lastra's content type is
`application/vnd.qtsurfer.lastra` and its `ts` values are microseconds since the epoch, also
declared by the column metadata `ts_unit: micros`. Parquet's `TIMESTAMP` column uses milliseconds.

Use `downloadTickersWithMetadata()` or `downloadKlinesWithMetadata()` to inspect the response:

```ts
const result = await qts.downloadTickersWithMetadata({
  exchangeId: 'binance', base: 'BTC', quote: 'USDT', hour,
});
console.log(result.tsUnit, result.headers.get('Content-Disposition'));
if (result.dataStatus === 'provisional') {
  console.log(`Rows received through ${result.dataThrough}; fetch again for the stored hour`);
}
```

The result contains `blob`, raw `headers`, and optional `tsUnit`, `dataStatus`, and `dataThrough`.
`dataThrough` is always an ISO-8601 UTC instant, irrespective of the timestamp unit. A deployment
may answer current or recent unstored hours provisionally. Those bytes can still grow: fetch again
later and do not retain them as the final hour. Where provisional answers are unavailable, or no
rows can be returned, recent hours answer `NOT_YET_AVAILABLE` instead. Stored hours omit the
provisional markers. Browser access to headers also depends on the server's CORS exposure policy.

## Download recovery

Failures raise `QTSDownloadError`, carrying `status`, optional `reason` and `next`, raw response
`headers`, and `retryAfter` (seconds as a string). The SDK does not sleep or retry automatically,
apart from the authenticated session's single JWT refresh after a `401`.

| Status and reason | Caller action |
| --- | --- |
| `400 OUTSIDE_WINDOW` | Import history as a dataset; `next` provides method, relative path, and body. Add a dataset name. |
| `404 NOT_YET_AVAILABLE` | Retry after `retryAfter` seconds. |
| `404 NO_DATA` | The stored hour has no rows for this instrument. |
| `503 TEMPORARILY_UNAVAILABLE` | Retry after `retryAfter` seconds; stored or provisional reads are limited. |
| Other `400` | Correct malformed/future `hour`, unsupported format, or other request input. |
| Unknown reason | Handle it like an absent reason using HTTP status and application policy. |

```ts
import { QTSDownloadError } from '@qtsurfer/sdk';

try {
  await qts.downloadTickers({ exchangeId: 'binance', base: 'BTC', quote: 'USDT', hour });
} catch (error) {
  if (!(error instanceof QTSDownloadError)) throw error;
  if (error.reason === 'OUTSIDE_WINDOW') console.log(error.next);
  else if (error.reason === 'NOT_YET_AVAILABLE' || error.reason === 'TEMPORARILY_UNAVAILABLE') {
    console.log(`Ask again in ${error.retryAfter ?? 'an application-chosen number of'} seconds`);
  } else throw error;
}
```

For older history or ranges, use [CEX dataset imports](datasets.md#importing-market-history).
