# Dataset uploads

Use datasets for your own ticker CSV. The SDK authenticates metadata calls but uploads bytes straight
to the presigned target without a bearer token or API key.

```ts
const created = await qts.createDataset({ name: 'My BTC ticks', instrument: 'BTC/USDT' });
await qts.uploadDatasetFile(created, csvText);
await qts.finalizeDatasetUpload(created.datasetId, created.uploadId);

const state = await qts.getDatasetUpload(created.datasetId, created.uploadId);
```

Poll until the upload state is ready or failed. Only a ready version is usable. The returned version
contains the discovered range, cadence, row count, and gap information. The CSV format and validation
rules are defined in the API's [dataset reference](https://qtsurfer.github.io/docs/datasets.html).

For another version, or to recover a lost creation response, open a session and repeat the same
transfer/finalize flow. Repeating `openDatasetUpload` while a session is open is safe; a finalized
upload id is spent and finalizing it again returns `409`.

```ts
const next = await qts.openDatasetUpload(created.datasetId);
await qts.uploadDatasetFile(next, correctedCsvText);
await qts.finalizeDatasetUpload(created.datasetId, next.uploadId);
```

Use `exchangeId: 'user'` and `datasetId` (optionally `datasetVersionId`) in `backtest` or `sweep`.
Those workflows still prepare the requested window before execution.
