# @qtsurfer/sdk

<p align="center">
  <a href="https://github.com/QTSurfer/sdk-ts/actions/workflows/ci.yml"><img src="https://github.com/QTSurfer/sdk-ts/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@qtsurfer/sdk"><img src="https://img.shields.io/npm/v/@qtsurfer/sdk" alt="npm"></a>
  <a href="https://qtsurfer.github.io/sdk-ts/"><img src="https://img.shields.io/badge/docs-typedoc-blue" alt="TypeDoc"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License"></a>
</p>

Opinionated TypeScript SDK for [QTSurfer](https://qtsurfer.com), built on top of [`@qtsurfer/api-client`](https://github.com/QTSurfer/api-client-ts).

Where `@qtsurfer/api-client` gives you one typed function per API endpoint, `@qtsurfer/sdk` adds **workflow orchestration**, **normalized errors**, and **cancellation** — run a backtest with a single `await`.

## Installation

```bash
npm install @qtsurfer/sdk
# or
pnpm add @qtsurfer/sdk
```

## Quick start

One call: API key in, ready-to-use session out. JWT refresh on 401 is handled
for you.

```ts
import { authenticate } from '@qtsurfer/sdk';
import { readFileSync } from 'node:fs';

// Reads QTSURFER_APIKEY from env when no argument is passed.
const qts = await authenticate();
// Or: const qts = await authenticate('ak_...');

const result = await qts.backtest({
  strategy: readFileSync('./MyStrategy.java', 'utf8'),
  exchangeId: 'binance',
  instrument: 'BTC/USDT',
  from: '2024-01-01',
  to: '2024-12-31',
  storeSignals: true,
});

console.log('PnL:', result.pnlTotal);
console.log('Trades:', result.totalTrades);
```

### Environment

| Variable           | Purpose                                                     |
| ------------------ | ------------------------------------------------------------ |
| `QTSURFER_APIKEY`  | API key consumed by `authenticate()` when no arg is passed   |

### Pluggable token storage

Tokens are kept in memory by default. Implement `TokenStore` to swap in
browser storage, a file, or a secret manager:

```ts
import { authenticate, type TokenStore, type AuthTokenResponse } from '@qtsurfer/sdk';

const browserStore: TokenStore = {
  load: () => JSON.parse(localStorage.getItem('qts.jwt') ?? 'null'),
  save: (t) => localStorage.setItem('qts.jwt', JSON.stringify(t)),
  clear: () => localStorage.removeItem('qts.jwt'),
};

const qts = await authenticate(undefined, { store: browserStore });
```

`authenticate()` also accepts `{ baseUrl, fetch }` for staging, custom HTTP
transports, or a Node-`fetch` polyfill in legacy runtimes.

### Lower-level: hand-managed JWT

If you already hold a JWT and want to manage refresh yourself, the
`QTSurfer` constructor still accepts a `token`:

```ts
import { QTSurfer } from '@qtsurfer/sdk';

const qts = new QTSurfer({
  baseUrl: 'https://api.qtsurfer.com/v1',
  token: process.env.QTSURFER_TOKEN,
});
```

## What `backtest()` does

Orchestrates the full four-step workflow that the raw API exposes:

1. **Compile** the strategy (`POST /strategy`), which answers synchronously with the `strategyId`.
2. **Prepare** the data range (`POST /backtest/{exchange}/ticker/prepare`) and poll until `Completed`.
3. **Execute** the backtest (`POST /backtest/{exchange}/ticker/execute`) and poll `GET /backtest/.../execute/{jobId}` until `Completed`.
4. Return the `ResultMap` (`pnlTotal`, `totalTrades`, `sharpeRatio`, `signalsUrl`, …).

Polling uses exponential backoff (`intervalMs * 1.5`, capped at `maxIntervalMs`) with per-stage timeout.

Progress is emitted on every stage transition and after each poll whose `size > 0`.

## Parameter sweeps

`sweep()` runs the same strategy once per parameter vector over one instrument and one window,
then scores and ranks the trials against a single objective. It is one call — compile → prepare →
`executeSweep` → poll the leaderboard — because the execute-sweep endpoint is addressed by the id
of an already-prepared dataset, and preparing is idempotent.

It resolves as soon as the platform accepts the sweep, handing back a handle while the leaderboard
keeps being polled in the background.

```ts
const handle = await qts.sweep(
  {
    strategy: source,
    exchangeId: 'binance',
    instrument: 'BTC/USDT',
    from: '2026-01-01T00:00:00Z',
    to: '2026-02-01T00:00:00Z',
    params: {
      rsiPeriod: { from: 7, to: 28, step: 1 },
      useTrendFilter: { values: [true, false] },
    },
    objective: 'sharpe',
  },
  {
    onProgress: (p) => {
      if (p.stage === 'executing') console.log(p.percent, p.snapshot?.etaSeconds);
    },
  },
);

// Available before a single trial has run.
handle.sweepId;
handle.accepted.seed; // effective seed — resubmit it to replay a sampled sweep exactly
handle.accepted.queued; // false ⇒ an identical sweep already existed; nothing was enqueued
handle.accepted.walkForward; // present ⇒ this sweep answers in the walk-forward shape

const result = await handle.result;
const sensitivity = await handle.sensitivity();

// Same sweep, another view — a read, not a re-run.
const everyRow = await handle.results({ order: 'natural' });
```

`params` axes take one of two shapes: `{ from, to, step }` for a numeric range, or
`{ values: [...] }` for an explicit list of numbers or booleans. `sampler: 'random' | 'lhs'` draws
`samples` vectors instead of the full cross product.

### Reading the leaderboard

Five things the types cannot tell you:

- **The default order is not the raw objective order.** `ranking` defaults to `'plateau'` — the
  objective of the worst run in a point's neighbourhood — because the highest raw score is often a
  spike that does not survive small parameter moves. `result.ranking` reports which ordering was
  *actually* applied, which is not always the one requested.
- **`neighbourCount: 0` means unevidenced, not confirmed.** Read it together with `plateauScore`:
  the point simply had no neighbours in the grid to compare against.
- **`truncated === true` means rows were dropped** from the ranked view. `order: 'natural'` is the
  route to them — every available row, untruncated, in `runIx` order. Reach them with
  `handle.results({ order: 'natural' })`, described below.
- **`deflatedSharpe`** is the probability that a row's Sharpe reflects real edge rather than the
  best draw from however many vectors were tried; ~0.95 and up survives the multiple-testing
  correction, ~0.5 and below does not. **`pbo`** says the same thing about the search as a whole:
  above ~0.5 the sweep is selecting noise, whatever its top row says. Both are absent when there is
  too little to compute them from — `pbo` also while the sweep is still running.
- **`aborted` and `failedShards` on the progress snapshot count different things** — runs that ran
  badly versus whole units of work that never reported. Adding them double-counts. `etaSeconds` is
  omitted rather than zeroed when it cannot be computed.

### Re-reading a sweep under another view

`order` and `ranking` are query parameters on the result endpoint, so looking at the same sweep a
different way is a **read**, not a re-run:

```ts
const everyRow = await handle.results({ order: 'natural' });
```

`handle.results(view?)` compiles nothing, prepares nothing and submits nothing — no second sweep is
created. An absent property takes the platform default, and `ranking` is ignored alongside
`order: 'natural'` (that view is always `runIx`-ordered, and the response reports `'raw'`). It works
on a sweep still in flight, returning the rows finished so far, exactly like `sensitivity()`.

The `order` / `ranking` passed in `SweepOptions` only decide what the background poll behind
`handle.result` reads; `results()` is how to change the view afterwards.

### Walk-forward validation

Adding `walkForward: { folds, inSamplePct? }` changes what the sweep does, not just how much of it
runs: the data is cut into sequential folds, each optimizing the whole grid on its own window and
then scoring only its winner on the window immediately after. It costs folds × grid, so it is
opt-in, and a request that multiplies past the platform's sweep budget is rejected.

The answer arrives in a different shape, and `walkForward` is the discriminator — present from
acceptance onward, so it is safe to branch on while polling. Its leaderboard is one row per
completed fold, with **`runIx` carrying the fold index rather than a grid position**, and no
plateau, deflated-Sharpe or PBO figure is reported. An absent `paramDrift` is *not* zero: the
figure could not be computed, and zero is itself a meaningful reading there.

### Sensitivity

`handle.sensitivity(objective?)` answers what a leaderboard cannot: whether an axis moved the
objective at all. Marginals collapse every axis but one; heatmaps do the same over a pair.
**Check `heatmapsTruncated`** — marginals are always complete, but the pair surfaces are quadratic
in the axis count and may be capped, so a short list is not necessarily the whole interaction set.

### Cancelling a sweep

Pass an `AbortSignal`, as with `backtest()`. Unlike `backtest()`, **awaiting a cancelled sweep
resolves rather than rejecting**: cancellation is requested between parameter vectors and the rows
already completed stay readable, so the SDK keeps polling until the platform reports the sweep
`CANCELLED` and then hands back the partial leaderboard. Read `result.status` to tell
`COMPLETED`, `PARTIAL` and `CANCELLED` apart. Aborting *before* the sweep is accepted rejects the
`sweep()` call itself — there is no sweep yet, and so no rows to keep.

## Hourly tickers/klines downloads

Stream one hour of raw ticker or kline data for an instrument. The default wire format is [Lastra](https://github.com/QTSurfer/lastra-ts) (`application/vnd.lastra`); pass `format: 'parquet'` for on-the-fly Parquet conversion.

```ts
// Lastra (default)
const blob = await qts.tickers({
  exchangeId: 'binance',
  base: 'BTC',
  quote: 'USDT',
  hour: '2026-01-15T10',
});
await Bun.write('BTC_USDT_2026-01-15_h10.lastra', await blob.arrayBuffer());

// Parquet
const klines = await qts.klines({
  exchangeId: 'binance',
  base: 'BTC',
  quote: 'USDT',
  hour: '2026-01-15T10',
  format: 'parquet',
});
```

HTTP errors surface as `QTSDownloadError` (subclass of `QTSError`).

## Exchanges and instruments

```ts
const exchanges = await qts.exchanges();

// The exchange's default segment (spot today).
const spot = await qts.instruments('binance');

// A specific segment.
const futures = await qts.instruments('binance', 'futures');

console.log(spot[0]?.coverage?.tickers); // which dates are actually available
```

The API answers the instrument routes with a HAL envelope (`data` / `meta` / `_links`); the SDK
unwraps it and hands you the array. That also means `meta.segment` never reaches you, so if you need
certainty about which segment you are looking at, pass `segment` explicitly instead of relying on
the default.

## Strategy validation

`validateStrategy()` asks the platform to instantiate the compiled class and drive it through a
bounded synthetic series, so a wiring fault surfaces before your first backtest instead of during
it. It is idempotent and has **two outcomes**, which the SDK keeps distinct.

The `strategyId` is the one returned when the source was compiled and registered. This SDK does not
surface compilation on its own — `backtest()` and `sweep()` each do it internally and keep the id —
so obtain it from `compileStrategy()` in
[`@qtsurfer/api-client`](https://github.com/QTSurfer/api-client-ts) if you need to validate a
strategy before running it. That is a real difference between the two SDKs rather than an oversight
in either: the Java SDK exposes a standalone `compile(...)`, and this one does not.

```ts
const outcome = await qts.validateStrategy(strategyId);

if (outcome.queued) {
  // A check was just started. NOT terminal — poll, under a deadline of your own.
  const deadline = Date.now() + 60_000;
  let state = await qts.strategy(strategyId);
  while (state.validation === 'pending' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1_000));
    state = await qts.strategy(strategyId);
  }
} else {
  // A verdict already existed and nothing was queued — but read
  // `state.validation`, because it can itself still be 'pending'.
  console.log(outcome.state.validation);
}
```

Two things worth internalizing, because no type can express them:

- **`'passed'` is a floor, not a guarantee.** The class loaded and survived the first event of a
  short synthetic run — not your instrument, not your window, not the rest of the run. It says
  nothing about whether the strategy is correct or safe to run at scale. `dryRunIncomplete` marks a
  check that ran out of its budget, which makes the floor lower still and makes an empty `notices`
  list no longer a clean bill of health.
- **`'pending'` is not guaranteed to resolve.** A queued check can go unreported for far longer than
  one takes, which the platform eventually flags as `validationStalled` — nothing is disproved about
  the strategy, the check simply did not run. That is why the loop above has a deadline and why the
  SDK ships no polling helper: the timeout is your policy, not the SDK's.

A verdict also describes the bytecode that existed when it was recorded. If `compiledAt` is newer
than `validatedAt`, the strategy was recompiled afterwards and the verdict no longer describes what
would run — ask for validation again.

## API coverage

Measured against **API spec 0.107.0**: 18 operations, all 18 reachable from this SDK.

It exists because the generated `@qtsurfer/api-client` tracks the spec automatically and this
hand-written layer does not, so an operation the platform serves could otherwise have no way in
without anything failing to compile.

**Maintenance contract.** When the spec gains an operation, it gains a row here. If this layer
deliberately does not wrap it, the row says why.

There are two ways an operation is reached:

- **Direct** — callable on its own, without running a workflow. The client methods below
  (`exchanges`, `instruments`, `tickers`, `klines`, `validateStrategy`, `strategy`) exist on
  `QTSurfer` and, identically, on the authenticated session. The remaining direct rows are reached
  otherwise: `authenticate()` is a top-level export rather than a method on either class; the two
  `Sweep.*` entries live on the handle `sweep()` hands back and, being handle-scoped, sit outside
  the session's refresh-on-401 policy; and the two cancels are an option you pass in rather than a
  call you make.
- **Via workflow** — reachable only as a stage inside `backtest(...)` or `sweep(...)`, with no
  standalone method. Deliberate rather than missing: the workflow owns the dataset lifecycle.
  Prepare, execute and result are addressed by ids the workflow mints and threads through the
  stages, so exposing a stage on its own would hand the caller a `requestId` to keep alive and pass
  around correctly, and buy nothing in return — preparing is idempotent, so preparing on every run
  duplicates no work.

| Operation | How it is reached |
| --- | --- |
| `authenticate` | Direct — `authenticate()` |
| `listExchanges` | Direct — `exchanges()` |
| `listInstruments` | Direct — `instruments(exchangeId)` |
| `listSegmentInstruments` | Direct — `instruments(exchangeId, segment)` |
| `downloadTickers` | Direct — `tickers(...)` |
| `downloadKlines` | Direct — `klines(...)` |
| `compileStrategy` | Via workflow — inside `backtest(...)` / `sweep(...)`; no standalone method, unlike the Java SDK |
| `validateStrategy` | Direct — `validateStrategy(strategyId)` |
| `getStrategy` | Direct — `strategy(strategyId)` |
| `prepareBacktest` | Via workflow |
| `getPrepareStatus` | Via workflow |
| `executeBacktest` | Via workflow — `backtest(...)` |
| `getBacktestResult` | Via workflow |
| `cancelBacktest` | Direct — the `signal` (`AbortSignal`) option on `BacktestOptions` |
| `executeSweep` | Via workflow — `sweep(...)` |
| `getSweepResult` | Via workflow (the background poll behind `Sweep.result`) and direct — `Sweep.results(view?)` re-reads the same sweep under another view |
| `cancelSweep` | Direct — the `signal` option on `SweepOptions` |
| `getSweepSensitivity` | Direct — `Sweep.sensitivity(objective?)` |

## Error hierarchy

All SDK errors extend `QTSError` so you can catch them generically or match by subclass.

```ts
import {
  QTSError,
  QTSStrategyCompileError,
  QTSPreparationError,
  QTSExecutionError,
  QTSDownloadError,
  QTSTimeoutError,
  QTSCanceledError,
} from '@qtsurfer/sdk';

try {
  await qts.backtest(req);
} catch (e) {
  if (e instanceof QTSStrategyCompileError) {
    console.error('Compile failed:', e.message);
  } else if (e instanceof QTSPreparationError) {
    console.error('Data prep failed:', e.message);
  } else if (e instanceof QTSExecutionError) {
    console.error('Execution failed:', e.message);
  } else if (e instanceof QTSDownloadError) {
    console.error('Download failed:', e.message);
  } else if (e instanceof QTSTimeoutError) {
    console.error('Stage timed out');
  } else if (e instanceof QTSCanceledError) {
    console.error('Canceled by signal');
  }
}
```

## Cancellation

Pass an `AbortSignal`. The SDK stops polling immediately and, if execution has already started server-side, best-effort calls `cancelBacktest` on the QTSurfer API.

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 60_000);
await qts.backtest(req, { signal: controller.signal });
```

`sweep()` takes the same option but answers differently once the sweep has been accepted — see
[Cancelling a sweep](#cancelling-a-sweep).

## Under the hood

Polling, retry, backoff, timeout, and cancellation are delegated to [`cockatiel`](https://github.com/connor4312/cockatiel). Each workflow stage composes a `retry` policy (exponential backoff on in-progress statuses) with an optional `timeout` policy. If you need advanced resilience primitives (circuit breakers, bulkheads, fallbacks), import them directly from `cockatiel`.

## Roadmap

What the SDK reaches today is the [API coverage](#api-coverage) table; which release added what is
in [CHANGELOG.md](./CHANGELOG.md). Milestone labels below track feature scope, not the npm package's
semver.

### v0.2 — Domain objects

- [ ] `Strategy` class with `.backtest()`, `.status()`
- [ ] `BacktestJob` class with `.wait()`, `.cancel()`, `.stream()`
- [ ] TTL cache for `exchanges` / `instruments`

### v0.3 — Streaming progress

- [ ] `job.stream()` returns `AsyncIterator<BacktestProgress>`
- [ ] Server-side hooks (when the backend exposes SSE/WebSocket)

### v0.4 — Ecosystem integration

- [ ] Helpers to load `signalsUrl` Parquet into DuckDB / Lastra
- [ ] Framework adapters (`@qtsurfer/sdk-react`, `@qtsurfer/sdk-svelte`)

## Project layout

```
src/
├── index.ts              # public exports
├── client.ts             # QTSurfer class
├── errors.ts             # QTSError hierarchy
├── auth/
│   ├── session.ts        # authenticate() — session bootstrap + JWT refresh on 401
│   └── tokenStore.ts     # TokenStore contract + default InMemoryTokenStore
├── internal/
│   ├── polling.ts        # the one poll loop + status normalization every stage runs on
│   ├── preparation.ts    # compile and prepare, shared by every workflow that needs a dataset
│   └── requestError.ts   # QTSError construction for single-request calls
└── workflows/
    ├── backtest.ts       # compile → prepare → execute (cockatiel policies)
    ├── catalog.ts        # exchanges + instruments (HAL envelope unwrapped)
    ├── downloads.ts      # hourly tickers/klines as Lastra/Parquet blobs
    ├── strategies.ts     # validation request + recorded strategy state
    └── sweep.ts          # compile → prepare → executeSweep + leaderboard handle
```

## Development

| Script | Description |
| ------ | ----------- |
| `npm run lint` | Type-check without emitting |
| `npm run build` | Bundle to `dist/` via `tsup` |
| `npm test` | Run unit tests |
| `npm run test:integration` | Run the integration test (requires `JWT_API_TOKEN`). Set `QTSURFER_TEST_VERBOSE=1` to stream progress + final result |
| `npm run changeset` | Record a changeset for the next release |
| `npm run changeset:version` | Consume pending changesets: bump `package.json` and update `CHANGELOG.md` |
| `npm run changeset:publish` | Publish released packages to npm (used by CI) |

### Releasing

Versioning and changelogs are managed with [changesets](https://github.com/changesets/changesets):

1. Create a changeset describing your change: `npm run changeset`
2. Commit the generated `.changeset/<slug>.md` with your PR.
3. When ready to release, run `npm run changeset:version` locally. It bumps `package.json` and appends to `CHANGELOG.md`.
4. Commit the version bump, tag `vX.Y.Z`, and push the tag; the `Publish to npm` workflow handles the rest.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
