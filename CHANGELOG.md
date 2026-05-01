# @qtsurfer/sdk

## 0.2.0

### Minor Changes

- [`717d50f`](https://github.com/QTSurfer/sdk-ts/commit/717d50fafcb5cd32f5056a07b67c426f5eb7fd73) Thanks [@mrmx](https://github.com/mrmx)! - Add `qts.tickers({ exchangeId, base, quote, hour, format? })` and `qts.klines(...)` — stream one hour of raw tickers or klines as a `Blob`. Wire format selectable via `format: 'lastra' | 'parquet'` (Lastra default; Parquet via on-the-fly conversion). HTTP errors surface as `QTSDownloadError`, a new subclass of `QTSError`.

### Patch Changes

- [`717d50f`](https://github.com/QTSurfer/sdk-ts/commit/717d50fafcb5cd32f5056a07b67c426f5eb7fd73) Thanks [@mrmx](https://github.com/mrmx)! - Bump `@qtsurfer/api-client` to `^0.1.2` (adds the `getExchangeTickersHour` / `getExchangeKlinesHour` operations) and extend the local `JobStatus` union with `Partial` so the regenerated `JobState` schema type-checks against `runStage` (the backend already emits `Partial` during cold-fallback prepare jobs).

## 0.1.2

### Patch Changes

- Bundle the SDK with `tsup` so the published ESM entry resolves its own relative imports (fixes `ERR_UNSUPPORTED_DIR_IMPORT` / `ERR_MODULE_NOT_FOUND` for consumers on Node ESM).
- Bump dependency to `@qtsurfer/api-client@^0.1.1`.
- Normalize backend job status casing (`queued` / `completed` / `failed`) so the retry predicate and terminal checks work regardless of OpenAPI spec drift.
- Integration test: use a 24h UTC window (`yesterday → today`) to satisfy the API's `from < to` constraint.

## 0.1.1

### Patch Changes

- Re-publish of `0.1.0` with valid sigstore provenance (repository is now public).

## 0.1.0

### Minor Changes

- Initial release of `@qtsurfer/sdk` built on `@qtsurfer/api-client`.
- `QTSurfer` client with `baseUrl`, `token`, and custom `fetch`.
- `backtest()` workflow orchestrating compile → prepare → execute with exponential backoff, timeout, and `AbortSignal` cancellation via [`cockatiel`](https://github.com/connor4312/cockatiel).
- Server-side `cancelExecution` triggered when the workflow is aborted mid-execute.
- Error hierarchy: `QTSError`, `QTSStrategyCompileError`, `QTSPreparationError`, `QTSExecutionError`, `QTSTimeoutError`, `QTSCanceledError`.
- Unit and integration test suites (integration gated on `JWT_API_TOKEN`, runs `ForcedTradeStrategy` on `binance BTC/USDT`).
