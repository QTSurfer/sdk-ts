# @qtsurfer/sdk

Opinionated TypeScript SDK for [QTSurfer](https://qtsurfer.com), built on top of [`@qtsurfer/api-client`](https://github.com/QTSurfer/api-client-ts).

Where `@qtsurfer/api-client` gives you one typed function per API endpoint, `@qtsurfer/sdk` adds **workflow orchestration**, **domain objects**, and **normalized errors** — everything you need to run a backtest with a single `await`.

> Status: scaffold. The `QTSurfer` class and `backtest()` workflow are stubbed. See the roadmap below.

## Scope

- Wrap multi-step API flows (compile → prepare → execute) behind single async methods.
- Handle polling, exponential backoff, timeouts, and `AbortSignal` cancellation internally.
- Expose a unified error hierarchy (`QTSError`, `QTSStrategyCompileError`, …).
- Cache reference data (`exchanges`, `instruments`) with configurable TTL.
- Stream long-running job progress via `AsyncIterator` (future).

Out of scope:

- HTTP plumbing (that lives in `@qtsurfer/api-client`).
- Framework-specific bindings (React hooks, Svelte stores) — those will ship as separate adapter packages.

## Installation

```bash
pnpm add @qtsurfer/sdk
# or
npm install @qtsurfer/sdk
```

## Planned usage

```ts
import { QTSurfer } from '@qtsurfer/sdk';

const qts = new QTSurfer({
  baseUrl: 'https://api.qtsurfer.com/v1',
  token: process.env.QTSURFER_TOKEN,
});

const controller = new AbortController();

const result = await qts.backtest(
  {
    strategy: strategyCode,
    exchangeId: 'binance',
    instrument: 'BTCUSDT',
    from: '2024-01-01',
    to: '2024-12-31',
  },
  {
    signal: controller.signal,
    onProgress: (p) => console.log(p.stage, p.percent),
    pollIntervalMs: 500,
    timeoutMs: 10 * 60 * 1000,
  },
);

console.log(result);
```

## Roadmap

### v0.1 — Core workflow

- [ ] `QTSurfer` client with `setConfig` proxy over `@qtsurfer/api-client`.
- [ ] `qts.backtest()` orchestrating compile → prepare → execute.
- [ ] `poll()` utility with backoff, timeout, `AbortSignal` support.
- [ ] Error hierarchy: `QTSError`, `QTSStrategyCompileError`, `QTSPreparationError`, `QTSExecutionError`, `QTSTimeoutError`, `QTSCanceledError`.

### v0.2 — Domain objects

- [ ] `Strategy` class with `.backtest()`, `.status()`.
- [ ] `BacktestJob` class with `.wait()`, `.cancel()`, `.stream()`.
- [ ] TTL cache for `exchanges` / `instruments`.

### v0.3 — Streaming progress

- [ ] `job.stream()` returns `AsyncIterator<BacktestProgress>`.
- [ ] Server-side hooks (when the backend exposes SSE/WebSocket).

### v0.4 — Ecosystem integration

- [ ] Helpers to load results into DuckDB / Parquet / Lastra.
- [ ] Framework adapters (`@qtsurfer/sdk-react`, `@qtsurfer/sdk-svelte`).

## Project layout

```
src/
├── index.ts              # public exports
├── client.ts             # QTSurfer class
├── errors.ts             # QTSError hierarchy
├── poll.ts               # generic polling utility
└── workflows/
    └── backtest.ts       # compile → prepare → execute
```

## Development

| Script | Description |
| ------ | ----------- |
| `pnpm lint` | Type-check without emitting |
| `pnpm build` | Compile to `dist/` |

During development, `@qtsurfer/api-client` is linked via `file:../qtsurfer-api-client-ts`. Before publishing, switch that dependency to a published version range (`^0.1.0`).

## License

Apache-2.0 — see [LICENSE](./LICENSE).
