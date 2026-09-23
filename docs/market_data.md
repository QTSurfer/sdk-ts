# Exchanges, instruments, and downloads

Start with an authenticated session; every snippet below uses `qts`:

```ts
import { authenticate } from '@qtsurfer/sdk';

const qts = await authenticate(); // reads QTSURFER_APIKEY
```

Discover the available catalog before selecting a data window. `getInstruments` unwraps the API's
HAL envelope and returns the instrument array; coverage is live platform state and is not cached.

```ts
const exchanges = await qts.getExchanges();
const spot = await qts.getInstruments('binance');
const futures = await qts.getInstruments('binance', 'futures');
console.log(spot[0]?.coverage?.tickers);
```

Download one instrument-hour as a `Blob`. Lastra is the default; use Parquet when a downstream
consumer needs it.

```ts
const blob = await qts.downloadTickers({
  exchangeId: 'binance', base: 'BTC', quote: 'USDT', hour: '2026-01-15T10',
  format: 'parquet',
});
```

`downloadKlines` has the same arguments. Download failures raise `QTSDownloadError`.
