# @qtsurfer/sdk

<p align="center">
  <a href="https://github.com/QTSurfer/sdk-ts/actions/workflows/ci.yml"><img src="https://github.com/QTSurfer/sdk-ts/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@qtsurfer/sdk"><img src="https://img.shields.io/npm/v/@qtsurfer/sdk" alt="npm"></a>
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

```ts
import { QTSurfer } from '@qtsurfer/sdk';
import { readFileSync } from 'node:fs';

const qts = new QTSurfer({
  baseUrl: 'https://api.qtsurfer.com/v1',
  token: process.env.QTSURFER_TOKEN,
});

const controller = new AbortController();

const result = await qts.backtest(
  {
    strategy: readFileSync('./MyStrategy.java', 'utf8'),
    exchangeId: 'binance',
    instrument: 'BTCUSDT',
    from: '2024-01-01',
    to: '2024-12-31',
    storeSignals: true,
  },
  {
    signal: controller.signal,
    onProgress: (p) => console.log(`[${p.stage}] ${p.percent?.toFixed(1) ?? '-'}%`),
    pollIntervalMs: 500,
    maxPollIntervalMs: 5000,
    timeoutMs: 10 * 60 * 1000,
  },
);

console.log('PnL:', result.pnlTotal);
console.log('Trades:', result.totalTrades);
console.log('Signals:', result.signalsUrl);
```

## What `backtest()` does

Orchestrates the full four-step workflow that the raw API exposes:

1. **Compile** the strategy (`POST /strategy` in async mode) and poll `GET /strategy/{id}` until `Completed`.
2. **Prepare** the data range (`POST /backtest/{exchange}/ticker/prepare`) and poll until `Completed`.
3. **Execute** the backtest (`POST /backtest/{exchange}/ticker/execute`) and poll `GET /backtest/.../execute/{jobId}` until `Completed`.
4. Return the `ResultMap` (`pnlTotal`, `totalTrades`, `sharpeRatio`, `signalsUrl`, …).

Polling uses exponential backoff (`intervalMs * 1.5`, capped at `maxIntervalMs`) with per-stage timeout.

Progress is emitted on every stage transition and after each poll whose `size > 0`.

## Error hierarchy

All SDK errors extend `QTSError` so you can catch them generically or match by subclass.

```ts
import {
  QTSError,
  QTSStrategyCompileError,
  QTSPreparationError,
  QTSExecutionError,
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
  } else if (e instanceof QTSTimeoutError) {
    console.error('Stage timed out');
  } else if (e instanceof QTSCanceledError) {
    console.error('Canceled by signal');
  }
}
```

## Cancellation

Pass an `AbortSignal`. The SDK stops polling immediately and, if execution has already started server-side, best-effort calls `cancelExecution` on the QTSurfer API.

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 60_000);
await qts.backtest(req, { signal: controller.signal });
```

## Under the hood

Polling, retry, backoff, timeout, and cancellation are delegated to [`cockatiel`](https://github.com/connor4312/cockatiel). Each workflow stage composes a `retry` policy (exponential backoff on in-progress statuses) with an optional `timeout` policy. If you need advanced resilience primitives (circuit breakers, bulkheads, fallbacks), import them directly from `cockatiel`.

## Roadmap

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
└── workflows/
    └── backtest.ts       # compile → prepare → execute (cockatiel policies)
```

## Development

| Script | Description |
| ------ | ----------- |
| `npm run lint` | Type-check without emitting |
| `npm run build` | Compile to `dist/` |

## License

Apache-2.0 — see [LICENSE](./LICENSE).
