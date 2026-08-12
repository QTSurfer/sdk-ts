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
surface compilation on its own — `backtest()` does it internally and keeps the id — so obtain it
from `compileStrategy()` in [`@qtsurfer/api-client`](https://github.com/QTSurfer/api-client-ts) if
you need to validate a strategy before running it.

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

## Under the hood

Polling, retry, backoff, timeout, and cancellation are delegated to [`cockatiel`](https://github.com/connor4312/cockatiel). Each workflow stage composes a `retry` policy (exponential backoff on in-progress statuses) with an optional `timeout` policy. If you need advanced resilience primitives (circuit breakers, bulkheads, fallbacks), import them directly from `cockatiel`.

## Roadmap

Milestone labels below (`v0.1`–`v0.4`) track feature scope, not the npm package's
semver — see [CHANGELOG.md](./CHANGELOG.md) for the actual release history.

### v0.1 — Core workflow ✅

- [x] `QTSurfer` client over `@qtsurfer/api-client`
- [x] `qts.backtest()` orchestrating compile → prepare → execute
- [x] Backoff, timeout, and `AbortSignal` cancellation via `cockatiel` policies
- [x] Error hierarchy: `QTSError`, `QTSStrategyCompileError`, `QTSPreparationError`, `QTSExecutionError`, `QTSTimeoutError`, `QTSCanceledError`

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
│   └── requestError.ts   # QTSError construction for single-request calls
└── workflows/
    ├── backtest.ts       # compile → prepare → execute (cockatiel policies)
    ├── catalog.ts        # exchanges + instruments (HAL envelope unwrapped)
    ├── downloads.ts      # hourly tickers/klines as Lastra/Parquet blobs
    └── strategies.ts     # validation request + recorded strategy state
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
