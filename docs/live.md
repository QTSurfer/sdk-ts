# Live Execution

Start with an authenticated session; every snippet below uses `qts`:

```ts
import { authenticate } from '@qtsurfer/sdk';

const qts = await authenticate(); // reads QTSURFER_APIKEY
```

`QTSurfer.connectLive()` opens a managed [Centrifugo](https://centrifugal.dev/) connection for one live
run. The SDK mints and refreshes its connection token through the configured
REST client; `centrifuge` handles reconnects and server pings.

```ts
const run = await qts.startLive(strategyId, { name: 'ETH breakout', relay: true });
const connection = await qts.connectLive(run.runId, {
  onSignal(signal) {
    console.log(signal.signalId, signal.kind);
  },
  onError(error) {
    console.error('live connection problem', error);
  },
});

await connection.updateParams({ emaFastPeriod: '12' });
connection.disconnect();
await qts.stopLive(strategyId);
```

Every new run starts in the `SANDBOX` stage. The owner can inspect that run with `getLive()` or
`listLive()` even while it is in sandbox, regardless of its requested visibility. A public run appears
in `listPublicLive()` only after promotion to `LIVE` and while it is running; public visibility alone
does not expose a sandbox trial. Set `relay: true` to receive WebSocket signals from the run's first
signal, including during `SANDBOX`; only the owner can subscribe during that trial. The same
subscription continues after promotion; the transition can be quiet for several minutes, then
signals produced meanwhile arrive in order. Retained signal history is readable in either stage,
whether or not relay was enabled. A reconnect does not replay missed signals, so use
`QTSurfer.getLiveSignals()` to read the retained history. It returns a
`LiveSignalPage` containing oldest-first `signals`, an optional
`_links.next.href` continuation, and the earliest available timestamp when
retention has discarded older signals. Deduplicate by `signalId` when combining
REST pages with the WebSocket stream.

```ts
const page = await qts.getLiveSignals(runId, { limit: 100 });
for (const signal of page.signals) {
  console.log(signal.signalId, signal.kind);
}

const nextPage = await qts.getNextLiveSignals(runId, page);
nextPage?.signals.forEach((signal) => console.log(signal.signalId));
```

When `LiveSignalCursorExpiredError` is thrown, restart without `cursor`. The
replacement page reports its `availableSinceMs` value, which is the oldest
retained signal timestamp.

Use `getLive(strategyId)` to inspect the current run, `listLive({ cursor, limit })` to list your
own runs, and `listPublicLive({ cursor, limit })` for public runs. Omit `cursor` for the first
page; follow `getNextLiveSignals(runId, page)` for signal pagination. The signal query accepts
`instrument`, `sinceMs`, `limit`, `cursor`, and `type` (for example `{ type: 'paper' }`).
`getLive()` also returns the last known run after it stops; its optional `reason` explains a reported
stop or failure without exposing a stack trace or internal message.

```ts
const ownRuns = await qts.listLive({ limit: 50 });
const publicRuns = await qts.listPublicLive({ limit: 25 });
const paperSignals = await qts.getLiveSignals(runId, { type: 'paper', sinceMs: Date.now() - 86_400_000 });
```

`updateLive(runId, { visibility })` changes run metadata; `updateLiveParams(runId, { params })`
updates strategy parameters over REST.

```ts
await qts.updateLive(runId, { visibility: 'public' });
await qts.updateLiveParams(runId, { params: { emaFastPeriod: '12' } });
```

Send a one-time command to every execution behind an owned running run with `sendLiveCommand()`. The
strategy must implement the engine's `CommandRequestHandler`; values in `properties` become top-level
entries on its `CommandRequest` (they are not strategy parameters). `202` means accepted for delivery
at `effectiveAtMs`, not that the handler has completed. Commands are transient and are not replayed
after an execution restart; use `updateLiveParams()` for values that must persist.

```ts
const accepted = await qts.sendLiveCommand(runId, {
  command: 'flatten',
  properties: { instrument: 'BTC/USDT', reason: 'risk limit' },
});
console.log(accepted.commandId, new Date(accepted.effectiveAtMs));
```

The request body is limited to 2 KiB. A `409` means the run is not running or its compiled strategy
does not support commands. A `503` guarantees the command was not sent, so that response is safe to
retry; a timeout has an unknown outcome, and retrying can deliver a second command because commands
have no idempotency key. All request failures are `QTSError`s with the HTTP code on `status`.

Paper trading is opt-in and simulated; it never sends orders to an exchange. Account snapshots and
equity history are read through these methods. Equity accepts optional `currency`, `sinceMs`,
`limit` (default 100, maximum 1000), and opaque `cursor`; use the helper to retain page filters.

```ts
const paperRun = await qts.startLive(strategyId, {
  name: 'ETH paper run',
  relay: true,
  paper: { initialFunding: 1_000, feeRate: 0.001, percentAmountToLock: 20, output: 'separate' },
});
const snapshot = await qts.getLiveRunPaper(paperRun.runId);
const equity = await qts.getLiveRunPaperEquity(paperRun.runId, { currency: 'USDT', limit: 100 });
const nextEquity = await qts.getNextLiveRunPaperEquity(paperRun.runId, equity);
```

Paper configuration fields are `initialFunding` (default 100), `feeRate` (default 0.001),
`buyFeeRate`/`sellFeeRate` (override `feeRate`), `feeLeg` (`RECEIVED`, `QUOTE`, or `BASE`),
`percentAmountToLock` (defaults to 10% of remaining free balance for live runs), and `output`
(`separate` by default or `mix` to include paper events in signal history). Paper account reads can
return 404 when the run was started without paper configuration. `instrument` can be null on
account-level paper signals.

Only this TypeScript SDK currently provides managed WebSocket connections. Java and Python SDKs
provide REST lifecycle and retained-signal APIs; those clients can use the protocol directly if
they need streaming.

The protocol is specified in the canonical
[AsyncAPI contract](https://github.com/QTSurfer/qtsurfer-api/blob/main/asyncapi.yaml).
