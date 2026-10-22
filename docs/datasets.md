# Dataset uploads

Start with an authenticated session; every snippet below uses `qts`:

```ts
import { authenticate } from '@qtsurfer/sdk';

const qts = await authenticate(); // reads QTSURFER_APIKEY
```

Use datasets for your own ticker CSV. The SDK authenticates metadata calls but uploads bytes straight
to the presigned target without a bearer token or API key.

```ts
const created = await qts.createDataset({ name: 'My BTC ticks', instrument: 'BTC/USDT' });
await qts.uploadDatasetFile(created, csvText);
await qts.finalizeDatasetUpload(created.datasetId, created.uploadId);

const state = await qts.getDatasetUpload(created.datasetId, created.uploadId);
const activeDatasets = await qts.getDatasets();
const allDatasets = await qts.getDatasets({ includeDeleted: true });
const deleted = allDatasets.find((dataset) => dataset.deletedAt);
console.log(activeDatasets.length, deleted?.datasetId, deleted?.deletedAt);
```

`getDatasets()` excludes soft-deleted datasets by default. Use `{ includeDeleted: true }` when
reconciling a local catalog; deleted entries carry `deletedAt`. Listing them does not restore them
or make them available to new backtests.

Poll until the upload state is ready or failed. Only a ready version is usable. The returned version
contains the discovered range, cadence, row count, and gap information. The CSV format and validation
rules are defined in the API's [dataset reference](https://www.qtsurfer.com/docs/developers/api/datasets).

For another version, or to recover a lost creation response, open a session and repeat the same
transfer/finalize flow. Repeating `openDatasetUpload` while a session is open is safe; a finalized
upload id is spent and finalizing it again returns `409`.

```ts
const next = await qts.openDatasetUpload(created.datasetId);
await qts.uploadDatasetFile(next, correctedCsvText);
await qts.finalizeDatasetUpload(created.datasetId, next.uploadId);
```

Use `exchangeId: 'user'` and `datasetId` (optionally `datasetVersionId`) in `executeBacktest` or `sweep`.
Those workflows still prepare the requested window before execution.

## Importing market history

`importDataset()` fetches CEX market history or DEX pool history, creates a dataset, and returns
immediately. Poll `getDatasetImport(datasetId, importId)` until `ready` or `failed` under a deadline
chosen by your application. A `202` acceptance is not usable data yet.

```ts
const imported = await qts.importDataset({
  name: 'BTC September history', instrument: 'BTC/USDT', type: 'cex',
  from: '2026-09-01T00:00:00Z', to: '2026-09-01T06:00:00Z',
  cadence: '5m',
  cex: { exchange: 'binance', segment: 'spot', dataType: 'klines' },
});
const deadline = Date.now() + 15 * 60_000;
let state = await qts.getDatasetImport(imported.datasetId, imported.importId);
while (state.status !== 'ready' && state.status !== 'failed' && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  state = await qts.getDatasetImport(imported.datasetId, imported.importId);
}
if (state.status === 'failed') throw new Error(state.error ?? 'Import failed');
if (state.status !== 'ready') throw new Error('Import is still running');
console.log(state.version?.cadence);
```

`name` is unique among your datasets (`409` if taken); `instrument` is a plain `BASE/QUOTE` pair.
`from` is inclusive, `to` exclusive, and the span is capped by `getAccount().maxImportRangeHours`.
Imports count towards the account's dataset and storage limits; `429` reports exceeded quotas.

For `type: 'cex'`, the `cex` block is required: choose a centralized `exchange` from
`getExchanges()`, `segment: 'spot'` (the only supported import segment), and `dataType: 'ticker'`
or `'klines'`. That data type becomes the dataset's type. DEX exchange ids are refused here.
Optional `cadence` accepts `1s`, `5s`, `1m`, `3m`, `5m`, `15m`, `30m`, `1h`, `2h`, `4h`, `8h`,
`12h`, `1d`, `1w`, or `1q` for either data type. Omit it to use the finest cadence held across
the whole range: when available cadence changes within the window, the result consistently uses
the coarser one. A finer requested cadence, or one that is not an exact multiple, fails
asynchronously; `state.error` names the finest available cadence. Missing history also fails
asynchronously. Invalid source fields or cadence labels return `400` immediately.

For `type: 'dex'`, pass a `dex` block with `network` (`ethereum` or `robinhood`) and pool/pair
`contract`. Omitted `cadence` preserves native per-trade data (`ticker`); this path also requires
`id: 'uniswap'` and `version: 'v2' | 'v3'`. `factory` is optional and otherwise discovered on-chain.
For preaggregated candles, set `cadence: '1s' | '1m' | '5m'`; protocol/version/factory are ignored,
and the dataset type is `klines`. Unsupported chain/cadence combinations fail asynchronously.

```ts
const poolHistory = await qts.importDataset({
  name: 'WETH pool history', instrument: 'WETH/USDC', type: 'dex', cadence: '1m',
  from: '2026-09-01T00:00:00Z', to: '2026-09-01T01:00:00Z',
  dex: { network: 'ethereum', contract: '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640' },
});
```

`DatasetVersion.cadence` is discovered from timestamps, for uploads and imports alike. Fixed-grid
values include `3m`, `2h`, `8h`, `12h`, and `1w`; `rt` means no fixed step, not missing data.
Once ready, import versions use the same `exchangeId: 'user'`, `datasetId`, and optional
`datasetVersionId` backtest/sweep arguments as uploaded versions.
