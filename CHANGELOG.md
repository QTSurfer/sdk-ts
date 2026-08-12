# @qtsurfer/sdk

## 0.8.0

### Minor Changes

- [`8c10191`](https://github.com/QTSurfer/sdk-ts/commit/8c101910e31f93466e3aaddac5adfe66e68b7df9) Thanks [@mrmx](https://github.com/mrmx)! - Add the platform catalog and the strategy surface to both `QTSurfer` and the authenticated session.

  - `exchanges()` — list the exchanges the platform serves.
  - `instruments(exchangeId, segment?)` — list an exchange's instruments with their per-data-type
    coverage. Omitting `segment` asks for the exchange's default segment (`'spot'` today); passing one
    targets that segment explicitly. The API's HAL envelope is unwrapped internally, so callers get the
    instrument array rather than `{ data, meta, _links }` — which also means `meta.segment` is not
    visible, so pass `segment` when you need certainty about which one you are looking at.
  - `validateStrategy(strategyId)` — ask the platform to check that a registered strategy can actually
    run. Idempotent and **two-outcome**, which the SDK surfaces as a discriminated result rather than
    collapsing: `queued: false` returns an already-recorded verdict in `state` and starts nothing,
    while `queued: true` means a check was just queued and is **not** terminal. The discriminant
    reports whether work was _started_, not whether a verdict _exists_ — a `queued: false` answer can
    itself carry `validation: 'pending'` from a check an earlier call queued, so read
    `state.validation`.
  - `strategy(strategyId)` — read a strategy's recorded state: verdict, engine notices, required
    market data sources.

  The `strategyId` these two take is the one returned when the source was compiled and registered.
  This SDK still does not surface compilation on its own — `backtest()` does it internally and keeps
  the id — so obtain it from `compileStrategy()` in `@qtsurfer/api-client` if you want to validate a
  strategy before running it.

  Two things the types cannot say, and that callers get wrong:

  - **`'passed'` is a floor, not a guarantee.** It means the compiled class loaded and survived the
    first event of a short synthetic run — not your instrument, not your window, not the rest of the
    run. `dryRunIncomplete` marks a check that ran out of its budget, making the floor lower still and
    making an empty `notices` list no longer a clean bill of health.
  - **`'pending'` is not guaranteed to resolve.** A queued check can go unreported far longer than one
    takes, which the platform eventually flags as `validationStalled`. Poll `strategy()` under a
    deadline of your own; this release deliberately ships no polling helper, because the timeout is
    the caller's policy.

  All four throw a plain `QTSError` carrying the HTTP `status`, so the authenticated session refreshes
  its JWT and retries once on a `401` — the same treatment `tickers()` / `klines()` already get.

  New exported types: `Exchange`, `InstrumentDetail`, `InstrumentSegment`, `StrategyState`,
  `StrategyValidation`. No existing signature changed.

- [`c75d606`](https://github.com/QTSurfer/sdk-ts/commit/c75d6064cf3da66bfdbc696a4e0d85f7f40e6cf6) Thanks [@mrmx](https://github.com/mrmx)! - Add parameter sweeps to both `QTSurfer` and the authenticated session.

  `sweep(request, options?)` runs the same strategy once per parameter vector over one instrument and
  one window, then scores and ranks the trials against a single objective. It is one call — compile →
  prepare → `executeSweep` → poll the leaderboard — because the execute-sweep endpoint is addressed by
  the id of an already-prepared dataset, and preparing is idempotent, so the stages buy nothing when
  exposed separately.

  It resolves as soon as the platform accepts the sweep, handing back a `Sweep` handle while the
  leaderboard keeps being polled in the background: `sweepId`, `requestId`, `strategyId`, `accepted`
  (the acceptance response, exactly as the server sent it), a live `state`, a `result` promise,
  `results(view?)` and `sensitivity(objective?)`. Axes take one of two shapes — `{ from, to, step }`
  or `{ values: [...] }` — and `sampler: 'random' | 'lhs'` draws `samples` vectors instead of the full
  cross product.

  `results({ order?, ranking? })` re-reads the same sweep under a different view. `order` and
  `ranking` are query parameters on the result endpoint, so this is a **read**: it compiles nothing,
  prepares nothing and submits nothing, and creates no second sweep. It is the route to the rows a
  `truncated` ranked view dropped, it works on a sweep still in flight (returning the rows finished so
  far, like `sensitivity()`), and an absent property takes the platform default. The `order` /
  `ranking` in `SweepOptions` decide only what the background poll behind `result` reads.

  **Cancellation diverges from `backtest()` on purpose.** Pass an `AbortSignal` as usual, but awaiting
  a cancelled sweep **resolves rather than rejecting**: cancellation is requested between parameter
  vectors and the rows already completed stay readable, so the SDK keeps polling until the platform
  reports the sweep `CANCELLED` and then hands back the partial leaderboard. Rejecting would throw
  away rows a caller has no other route to. Aborting _before_ the sweep is accepted still rejects —
  there is no sweep yet, and so no rows to keep.

  Things the types cannot say, and that callers get wrong:

  - **The default order is not raw objective order.** `ranking` defaults to `'plateau'` — the
    objective of the worst run in a point's neighbourhood — because the highest raw score is often a
    spike that does not survive small parameter moves. `result.ranking` reports which ordering was
    _actually_ applied, which is not always the one requested. Setting `ranking` alongside
    `order: 'natural'` is accepted and ignored; that view is always ordered by `runIx`.
  - **`neighbourCount: 0` means unevidenced, not confirmed** — read it together with `plateauScore`.
  - **`truncated === true` means rows were dropped** from the ranked view, and `order: 'natural'` is
    the only route to them — reachable with `results({ order: 'natural' })` on the existing handle.
  - **`deflatedSharpe`** is the probability a row's Sharpe reflects real edge rather than the best
    draw from however many vectors were tried; **`pbo`** says the same about the search as a whole.
    Both are absent when there is too little to compute them from.
  - **A walk-forward sweep answers in a different shape.** `walkForward` is the discriminator and
    appears from acceptance onward, so it is safe to branch on while polling. Its leaderboard is one
    row per completed fold, with `runIx` carrying the fold index rather than a grid position, and no
    plateau, deflated-Sharpe or PBO figure. An absent `paramDrift` is _not_ zero.
  - **`aborted` and `failedShards` count different things** — runs that ran badly versus whole units
    of work that never reported — so adding them double-counts. `etaSeconds` is omitted rather than
    zeroed when it cannot be computed.
  - **`heatmapsTruncated`** exists so a short heatmap list cannot be read as "these are all the
    interactions"; `sensitivity()` returns the whole record rather than just its surfaces so the flag
    cannot be lost on the way out.

  Internally, `partial` now normalizes as a terminal status. It appears only on the two sweep schemas
  and is absent from `JobState`, so the prepare and execute paths are unaffected; without it the poll
  would never stop on a finished sweep. The compile, prepare and poll machinery `backtest()` already
  used now lives in `src/internal/`, shared by both workflows rather than duplicated — sweep polls on
  longer defaults (2s, backing off to 15s) because a leaderboard changes on the timescale of shards
  finishing rather than ticks.

  New exported types: `Sweep`, `SweepRequest`, `SweepOptions`, `SweepProgressEvent`, `SweepResult`,
  `SweepAccepted`, `SweepProgress`, `SweepRunRow`, `SweepSensitivity`, `SweepMarginal`,
  `SweepMarginalPoint`, `SweepHeatmap`, `SweepHeatmapCell`, `SweepState`, `SweepObjective`,
  `SweepSampler`, `SweepRanking`, `SweepOrder`, `SweepWalkForward`, `ParamAxis`, `WalkForwardResult`,
  `WalkForwardFold`. No existing signature changed.

- Bump `@qtsurfer/api-client` to `0.9.0` (API spec `0.107.0`), which adds `failReason` to the sweep
  result.

  A sweep can finish having scored nothing, because every shard failed before producing a row — and
  until now the result said only that, leaving an empty leaderboard indistinguishable from a grid that
  genuinely found nothing. `failReason` carries the cause reported by the first shard to fail,
  typically something the whole grid would have hit, such as a strategy that could not be loaded. The
  platform always reported it; the contract never declared it, so every generated client dropped it
  silently.

  Only the first failure is recorded, so where several shards failed for different reasons it names
  one of them rather than summarising all — read it alongside `progress.failedShards` for the count.
  `Sweep.result` documents how to tell the two kinds of empty apart.

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
