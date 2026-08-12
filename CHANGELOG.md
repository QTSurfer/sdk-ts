# @qtsurfer/sdk

## 0.7.1

### Patch Changes

- Bump `@qtsurfer/api-client` to `^0.8.0` (API spec 0.106.0): sweep walk-forward validation and a
  new sweep sensitivity endpoint.

  No SDK-surface change. Sweep is not exposed by this SDK today, so the added `walkForward` request
  and response fields, the `ranking` query param, the new required fields on `SweepProgress`, and
  the new `getSweepSensitivity` operation have nothing in this package to touch — confirmed by
  grepping `src/` and `tests/` for any existing reference to sweep, which found none.

## 0.7.0

### Minor Changes

- Compiling a strategy is now a single request.

  The API compiles synchronously and answers with the `strategyId`, so `backtest()` no longer submits
  with `X-Compile-Async` and then polls `GET /strategy/{jobId}` until the job completes. Nothing
  changes for callers — the same `compiling` progress event fires and the same result comes back —
  but the stage resolves in one round trip, and a compile error surfaces immediately instead of on a
  later poll.

  A `429` from the compile endpoint is now reported as its own condition: the platform is holding too
  many compilations at once and the source was never judged. Wording it like the `400` would send you
  looking for a syntax error that is not there.

  Bumps `@qtsurfer/api-client` to `^0.7.0`, which drops the `X-Compile-Async` header and the
  `202`/`AcceptedJob` branch from `compileStrategy`, and re-types `getStrategy` to the new
  `StrategyState` (`validation`: `not_validated` / `pending` / `passed` / `failed`) — a strategy's
  validation verdict, no longer a compile job status. `getStrategy` is not used by this SDK.

## 0.6.1

### Patch Changes

- [#3](https://github.com/QTSurfer/sdk-ts/pull/3) [`7d6bc6d`](https://github.com/QTSurfer/sdk-ts/commit/7d6bc6ded5c193ea50cfefb4043a893a236ba971) Thanks [@mrmx](https://github.com/mrmx)! - Bump `@qtsurfer/api-client` to `^0.6.0` (API spec 0.99.2), and pin that a `202` on the
  execute-result poll keeps the loop running.

  The client bump is type-only for consumers of this SDK: `GetBacktestResultResponse` widens to a
  union with the 202's empty-object type, which the SDK absorbs internally. Its own public surface
  is unchanged.

  The API answers `202` with an empty body when a job is known but its result is not readable yet.
  Because it is a 2xx, the generated client reports no error and `data` is `{}` — a response with no
  `state` at all. The poll already handled this correctly, since an absent status normalizes to
  "in progress", but nothing said so: a reasonable refactor (throwing on a missing `state`, or
  returning the empty result early) would have silently turned a completed backtest into an empty
  one. `normalizeStatus` now documents the rule and a test drives two `202`s before the real result.

## 0.6.0

### Minor Changes

- Bump `@qtsurfer/api-client` to `^0.5.0` (API spec 0.99.1), which renames all 16 generated
  operations for consistency (no request/response shape, field, or endpoint changes):

  | Old                       | New                      |
  | ------------------------- | ------------------------ |
  | `auth`                    | `authenticate`           |
  | `getExchanges`            | `listExchanges`          |
  | `getInstruments`          | `listInstruments`        |
  | `getSegmentInstruments`   | `listSegmentInstruments` |
  | `getExchangeTickersHour`  | `downloadTickers`        |
  | `getExchangeKlinesHour`   | `downloadKlines`         |
  | `postStrategy`            | `compileStrategy`        |
  | `getStrategyStatus`       | `getStrategy`            |
  | `prepareBacktesting`      | `prepareBacktest`        |
  | `getPreparationStatus`    | `getPrepareStatus`       |
  | `executeSweepBacktesting` | `executeSweep`           |
  | `getExecuteSweepResult`   | `getSweepResult`         |
  | `cancelExecuteSweep`      | `cancelSweep`            |
  | `executeBacktesting`      | `executeBacktest`        |
  | `cancelExecution`         | `cancelBacktest`         |
  | `getExecutionResult`      | `getBacktestResult`      |

  All internal call sites in `@qtsurfer/sdk`'s workflows (`backtest.ts`, `downloads.ts`,
  `auth/session.ts`) now call the renamed generated functions. `QTSurfer` and
  `AuthenticatedClient` keep their existing public method names (`backtest`, `tickers`,
  `klines`) — those already read naturally and don't mirror an operationId 1:1.

  **Breaking:** the SDK's own `auth(apikey?, opts?)` helper is renamed to
  `authenticate(apikey?, opts?)` for end-to-end consistency with the renamed `authenticate`
  operation. Same signature and behavior — update the import and call site:

  ```diff
  -import { auth } from '@qtsurfer/sdk';
  -const qts = await auth();
  +import { authenticate } from '@qtsurfer/sdk';
  +const qts = await authenticate();
  ```

  The bumped `@qtsurfer/api-client` also adds the `executeSweep` / `getSweepResult` /
  `cancelSweep` parameter-sweep operations. The SDK does not yet expose a sweep workflow
  method, so this part of the bump is additive only with no behavioral change to
  `@qtsurfer/sdk`'s public API.

## 0.5.0

### Minor Changes

- Bump `@qtsurfer/api-client` to `^0.4.0` (API spec 0.98.0). The single-instrument preparation endpoint now returns `PrepareJobState`, which adds a `coverageRatio` (0-1) plus a per-hour coverage breakdown, and `Partial` is removed from the job status enum. `BacktestProgress` gains an optional `coverageRatio`, emitted on the final `preparing` event so callers can react to a partially-covered window. No breaking change to the SDK's public method signatures.

## 0.4.0

### Minor Changes

- Bump `@qtsurfer/api-client` to `^0.3.0`, which changes `getInstruments` to return a HAL envelope (`InstrumentListResponse` with `data`, `meta`, `_links`) instead of a bare array, and moves `InstrumentDetail.dataFrom`/`dataTo` into a nested `coverage` object (`InstrumentCoverage` / `CoverageWindow`). The SDK does not yet expose an instruments workflow method, so this is a type-only dependency bump with no behavioral change to `@qtsurfer/sdk`'s public API.

## 0.3.0

### Minor Changes

- [#1](https://github.com/QTSurfer/sdk-ts/pull/1) [`f615d67`](https://github.com/QTSurfer/sdk-ts/commit/f615d673e77472054ef51e5b8e1b94e4a630a3bc) Thanks [@mrmx](https://github.com/mrmx)! - Add `auth(apikey?, opts?)` helper that exchanges a long-lived API key for a
  short-lived JWT in one call. Returns an `AuthenticatedClient` that caches
  the token in memory (or a caller-provided `TokenStore`), refreshes on 401,
  and exposes the same workflow surface as `QTSurfer` (`backtest`, `tickers`,
  `klines`). Reads `QTSURFER_APIKEY` from the environment when no apikey
  argument is passed.

  New public exports: `auth`, `AuthenticatedClient`, `AuthOptions`,
  `TokenStore`, `InMemoryTokenStore`, `QTSAuthError`. `QTSError` (and
  subclasses) now expose the underlying HTTP `status` when available.

  Bumps `@qtsurfer/api-client` to `^0.2.1`.

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
