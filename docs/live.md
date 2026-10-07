# Live Execution

Start with an authenticated session; every snippet below uses `qts`:

```ts
import { authenticate } from '@qtsurfer/sdk';

const qts = await authenticate(); // reads QTSURFER_APIKEY
```

## Selecting instruments

When starting a run, you can leave `instruments` out of its source. If the compiled strategy recorded an
instrument list, the run uses that list; otherwise it reads every instrument offered by the exchange and
segment. An explicit list is used as sent, and `['*']` requests every instrument. Empty lists and `null`
are rejected. Instrument symbols are case-insensitive; `*` on either side of `/` matches any base or quote,
such as `*/USDT` or `BTC/*`.

## Warming up indicators

Set `warmFrom` when starting a run to replay up to 3,600 seconds of market history before its start. It is an
integer from `0` to `3600`; `0` disables replay. If omitted, the platform chooses the beginning of the current
15-minute block (0–900 seconds back), so the first bar of a 15-minute window is complete. The effective value is
returned as `warmFrom` by `startLive()`, `getLive()`, and `getLiveRun()`. It is optional and never `null`: it is
absent only on historical runs started before this field existed.

```ts
const run = await qts.startLive(strategyId, {
  sources: [{ venueType: 'cx', exchange: 'binance', segment: 'spot', type: 'ticker' }],
  warmFrom: 0, // start with empty indicators and no replay
});
console.log(run.warmFrom); // 0
```

The value is fixed for the lifetime of the run and is not a live parameter. To change it, stop and start the run
again. Replayed signals describe time before the run started, so they are not sent over the run's channel or stream.

`QTSurfer.connectLive()` opens a managed [Centrifugo](https://centrifugal.dev/) connection for one live
run. The SDK mints and refreshes its connection token through the configured
REST client; `centrifuge` handles reconnects and server pings.

```ts
const run = await qts.startLive(strategyId, { name: 'ETH breakout', relay: true });
const connection = await qts.connectLive(run.runId, {
  onSignal(signal, offset) {
    console.log(signal.signalId, signal.kind, offset);
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
signals produced meanwhile arrive in order. REST retained signal history is readable in either stage,
whether or not relay was enabled. A reconnect does not replay missed signals, so use
`connection.getSignalHistory()` for recent sandbox signals held by the subscribed WebSocket channel,
or `QTSurfer.getLiveSignals()` for the longer-lived REST history in either stage.
The WebSocket channel holds at most the 300 most recent sandbox signals, until five minutes after
the last sandbox signal; it never holds live-stage signals. Subscribe first, then read history to
catch signals produced before the subscription. Signals received through `onSignal` can overlap
the history reply, so deduplicate by `signalId`.

```ts
const history = await connection.getSignalHistory(); // defaults to limit 300, oldest first
for (const { data: signal, offset } of history.publications) {
  console.log(signal.signalId, offset);
}

// After a disconnect and resubscription, read only after the last saved position.
const lastProcessedOffset = history.publications.at(-1)?.offset ?? history.offset;
const later = await connection.getSignalHistory({
  since: { offset: lastProcessedOffset, epoch: history.epoch },
});
const position = await connection.getSignalHistory({ limit: 0 }); // no publications
```

Save the `offset` of the last signal processed (including the optional second argument to `onSignal`)
and the `epoch` of an earlier history reply for `since`. If the stream history was lost,
Centrifugo rejects with code `112`; read again without
`since` and use REST for signals that the channel no longer holds. Code `103` means this connection
is not subscribed to the channel. `QTSurfer.getLiveSignals()` returns a
`LiveSignalPage` containing oldest-first `signals`, an optional
`_links.next.href` continuation, and the earliest available timestamp when
retention has discarded older signals. Deduplicate by `signalId` when combining
REST pages with the WebSocket stream.

To follow one run independently of which run its strategy most recently started, use
`getLiveRun(runId)`. It returns the run plus `updatedAtMs`, which advances when the run changes, and
optional `stats`. `stats` is a periodic snapshot, absent until the first one exists; `stale` means
the platform stopped refreshing counters, while a flat `processed` count alone does not mean a
problem. A stats refresh does not advance `updatedAtMs`.

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

Use `getLive(strategyId)` to inspect the current run, `getLiveRun(runId)` to re-read a specific run,
`listLive({ cursor, limit })` to list your
own runs, and `listPublicLive({ cursor, limit })` for public runs. Omit `cursor` for the first
page; follow `getNextLiveSignals(runId, page)` for signal pagination. The signal query accepts
`instrument`, `sinceMs`, `limit`, `cursor`, and `type` (for example `{ type: 'paper' }`).
`getLive()` also returns the last known run after it stops; its optional `reason` explains a reported
stop or failure without exposing a stack trace or internal message.

When starting a run, pass `stream: true` to request a plain WebSocket URL. It arrives as
`streamUrl` from `startLive()` and remains available through `getLive()` while the run is running
and your plan allows broadcasting. The URL is a secret: anyone who has it can read the run's signal
frames, so keep it out of logs and shared output. Open it with the WebSocket implementation your
application already uses; `connectLive()` is a separate Centrifugo connection.

```ts
const streamedRun = await qts.startLive(strategyId, { name: 'ETH stream', stream: true });
if (!streamedRun.streamUrl) throw new Error('The run did not return a stream URL');

const socket = new WebSocket(streamedRun.streamUrl);
socket.addEventListener('message', (event) => {
  const signal: unknown = JSON.parse(String(event.data));
  console.log(signal);
});
```

`rotateLiveStream(runId)` replaces the URL and retires the old one; connections using it close
within about 15 seconds. It requires a running run that was started with a stream; a revoked stream
cannot be restored. `revokeLiveStream(runId)` permanently turns off the URL without stopping the
run, and is safe to repeat. Failures remain `QTSError`s with their HTTP `status` and server message:
for example, `409` means the run has no usable stream and `429` means your plan cannot broadcast.

```ts
const { streamUrl: replacementUrl } = await qts.rotateLiveStream(streamRun.runId);
const replacementSocket = new WebSocket(replacementUrl);
await qts.revokeLiveStream(streamRun.runId); // stops this URL; the run itself keeps going
```

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

The protocol is specified in the canonical
[AsyncAPI contract](https://github.com/QTSurfer/qtsurfer-api/blob/main/asyncapi.yaml).
