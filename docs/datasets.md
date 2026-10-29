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
contains the discovered range, cadence, row count, and gap information. Once ready, `Dataset.type`
is inferred from the rows: a file with OHLC on every row and no order book is `klines`; rows carrying
book fields, or bare prices, are `ticker`. The type may therefore differ from the initial `ticker`
label returned when the empty upload dataset is created.

Use a candle dataset with `type: 'kline'` in `executeBacktest()` or `sweep()`; the workflow reads
the candles as bars at the version's own cadence. `type: 'ticker'` is the SDK default and accepts
either ticker or candle datasets. A kline workflow over a dataset that is not `klines` fails with
`400`. See [backtesting](backtesting.md#backtests-and-parameter-sweeps) for runnable examples. The
CSV format and validation rules are defined in the API's [dataset reference](https://www.qtsurfer.com/docs/developers/api/datasets).

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
console.log(imported.cadence); // The cadence chosen for this import, when known at acceptance.
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
The `202` response includes `cadence` when the result is already determined. A `402` means the
requested cadence, or the native per-trade data requested by a DEX import, is not included in the
plan. It is not retried; inspect `QTSError.upgradeUrl` when present and change the plan before
trying again.

For `type: 'cex'`, the `cex` block is required: choose a centralized `exchange` from
`getExchanges()`, `segment: 'spot'` (the only supported import segment), and `dataType: 'ticker'`
or `'klines'`. That data type becomes the ready dataset's `type`. DEX exchange ids are refused here.
Optional `cadence` accepts `1s`, `5s`, `1m`, `3m`, `5m`, `15m`, `30m`, `1h`, `2h`, `4h`, `8h`,
`12h`, `1d`, `1w`, or `1q` for either data type. Your plan determines which cadences are available
and its default; see “Cadences by plan” in the [API documentation](https://www.qtsurfer.com/docs/developers/api).
Omitting `cadence` uses that default. On a plan that includes a source's native rate, an omitted
CEX cadence follows the finest cadence available across the requested range. A finer requested
cadence, or one that is not an exact multiple, fails asynchronously; `state.error` names the finest
available cadence. Missing history also fails asynchronously. Invalid source fields or cadence
labels return `400`; a cadence excluded by the plan returns `402` without a retry delay.

For `type: 'dex'`, pass a `dex` block with `network` (`ethereum`, `robinhood`, or `solana`) and
pool/pair `contract`. By default the import builds candles (`klines`) at the plan's default cadence;
it does not need `id`, `version`, or `factory`. A plan that includes the source's native rate can
instead request per-trade data by omitting `cadence`; this path requires `id: 'uniswap'` and
`version: 'v2' | 'v3'`, while `factory` is optional and otherwise discovered on-chain. Set an
allowed cadence explicitly to choose another candle width. Solana supports candles only, so even an
Elite plan uses its default cadence (`1s`) when omitted; `id`, `version`, and `factory` are never
needed. A Solana pool address is base58 and case-sensitive: pass it exactly as written.

Candle imports (explicit cadence or plan default) whose `from` is earlier than 180 days before the
request return `400` immediately, for every network. Per-trade DEX imports and CEX imports do not
have this history limit. DEX candles are not a contiguous grid: a bar can be absent when no trade
occurred during that interval. Unsupported source/cadence combinations can still fail asynchronously.

```ts
const poolHistory = await qts.importDataset({
  name: 'WETH pool history', instrument: 'WETH/USDC', type: 'dex', cadence: '1m',
  from: '2026-09-01T00:00:00Z', to: '2026-09-01T01:00:00Z',
  dex: { network: 'ethereum', contract: '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640' },
});
```

Solana imports always produce candles. Use the pool's base58 address as-is; no protocol or version
is required:

```ts
const solanaHistory = await qts.importDataset({
  name: 'SOL pool history', instrument: 'SOL/USDC', type: 'dex', cadence: '5m',
  from: '2026-10-27T00:00:00Z', to: '2026-10-27T06:00:00Z',
  dex: { network: 'solana', contract: 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE' },
});
```

`DatasetVersion.cadence` is discovered from timestamps, for uploads and imports alike. Fixed-grid
values include `3m`, `2h`, `8h`, `12h`, and `1w`; `rt` means no fixed step, not missing data.
Once ready, import versions use the same `exchangeId: 'user'`, `datasetId`, and optional
`datasetVersionId` backtest/sweep arguments as uploaded versions.
