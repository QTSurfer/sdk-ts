# Live Execution

Start with an authenticated session; every snippet below uses `qts`:

```ts
import { authenticate, type StartLiveRequest } from '@qtsurfer/sdk';

const qts = await authenticate(); // reads QTSURFER_APIKEY
const cexSources: NonNullable<StartLiveRequest['sources']> = [{
  venueType: 'cex', exchange: 'binance', segment: 'spot', type: 'ticker', instruments: ['ETH/USDT'],
}];
```

## Selecting sources

At start, `sources` may contain one entry or be omitted. Discover `venueType`, `exchange`, and
`segment` together from `getExchanges()`: choose `cex` or `dex`, the venue's id, and one of its
`liveSegments`. A listed catalogue segment without live data is refused with `400`; for example,
CEX `futures` is currently catalogue-only. Values and `type` are normalized to lower case;
the server also accepts legacy `cx`/`dx`, but new typed requests use `cex`/`dex`. A run started
without a source waits in `WAITING` and holds no live-run place until a source is attached.

`startLive()` can throw `QTSError` with `status === 409` when the strategy was compiled against an
older platform version and a release removed something it uses. No run is created in that case.
Register the same source again with `compileStrategy()` and start the new `strategyId`. A `409` can
also mean this strategy already has an active run; inspect `error.message` to distinguish the cases.

## Selecting instruments

For a CEX run, you can leave `instruments` out of its source. If the compiled strategy recorded an
instrument list, the run uses that list; otherwise it reads every instrument offered by the exchange and
segment. An explicit list is used as sent, and `['*']` requests every instrument. Empty lists and `null`
are rejected. Instrument symbols are case-insensitive; `*` on either side of `/` matches any base or quote,
such as `*/USDT` or `BTC/*`.

## DEX pools

A DEX source uses `type: 'kline'` and exactly one identifier in `instruments`. For an EVM
market, pass a pool address. For `solana/pumpfun`, pass the token's case-sensitive base58 mint
address. That segment follows a token from its bonding curve to its PumpSwap pool. Discover live
availability with `getExchanges()`. Solana pool listings from `getPools()` are useful for
[dataset imports](datasets.md#importing-market-history). The `pumpfun` segment has no listing.

```ts
const solana = (await qts.getExchanges()).find((venue) => venue.id === 'solana');
if (!solana?.liveSegments.includes('pumpfun')) throw new Error('Solana token live feed unavailable');
const tokenRun = await qts.startLive(klineStrategyId, {
  sources: [{ venueType: 'dex', exchange: 'solana', segment: 'pumpfun', type: 'kline', instruments: [mintAddress] }],
  warmFrom: 0,
});
```

The strategy receives one candle per second, carrying forward the previous close when there is no
trade. Warm-up requires available history. A source can fail to start if the pool or mint cannot
be served. Read the run and attachment state and reason. A DEX signal's `instrument.id` gives the
pool address or token mint, which identifies the feed even when tickers share a symbol.

## Attaching and detaching sources

Attach a source to a waiting or already-running run. Sources active at the same time must share a
market feed: the same exchange for CEX sources, or the same chain and protocol for DEX pools.
`attachLiveSource()` returns `202` acceptance, not completion. Re-read the run with
`getLiveRun(runId)` and inspect `attachments` until its state is `ATTACHED` or `REFUSED`. Supply
`ref` if the caller might retry after a lost response; resending that reference for the same run
returns the existing attachment. When attaching a second DEX pool, `warmFrom` must be `0` or
omitted. A run using `paper.accounts: 'instrument'` needs explicit instrument names.
For DEX, `resolveInstrument: true` (default) resolves the pair from the first candle before
calling `onAttach`. Set it to `false` to call the hook immediately with a stand-in instrument.

```ts
const waitingRun = await qts.startLive(strategyId, { relay: true });
const accepted = await qts.attachLiveSource(waitingRun.runId, {
  source: { venueType: 'cex', exchange: 'binance', segment: 'spot', type: 'ticker', instruments: ['ETH/USDT'] },
  warmFrom: 120,
  ref: 'alert-8841',
});
console.log(accepted.attachmentId, accepted.state, accepted.effectiveAtMs);

const run = await qts.getLiveRun(waitingRun.runId);
console.log(run.attachments?.find((item) => item.attachmentId === accepted.attachmentId)?.state);
```

An additional source takes effect at its `effectiveAtMs`; read the attachment state to know when
it is active. If a DEX pool for a pair the run already reads cannot stay attached, it is detached
with reason `SAME_PAIR`; the strategy's `onDetach` hook receives `REFUSED`.

`detachLiveSource()` also returns an accepted transition (`DETACHING`). Re-read the run to observe
`DETACHED`. Detaching the final source returns the run to `WAITING`, releases strategy memory, and
keeps its paper accounts. Open paper positions in a detached source are reported as gaps.

```ts
const detached = await qts.detachLiveSource(run.runId, accepted.attachmentId);
console.log(detached.state); // DETACHING
```

A strategy can also detach from a source itself. The attachment ends `DETACHED` with reason
`STRATEGY`. Use `getLiveSignals(runId, { type: 'system' })` to read its `DETACH` records. System
signals require this explicit REST filter and are excluded from WebSocket delivery.

## Warming up indicators

Set `warmFrom` when starting a run to replay up to 3,600 seconds of market history before its start. It is an
integer from `0` to `3600`. Set `0` to disable replay. If omitted, the platform chooses how far back to replay. The effective value is
returned as `warmFrom` by `startLive()`, `getLive()`, and `getLiveRun()`. It is optional and never `null`: it is
absent only on historical runs started before this field existed.

```ts
const run = await qts.startLive(strategyId, {
  sources: cexSources,
  warmFrom: 0, // start with empty indicators and no replay
});
console.log(run.warmFrom); // 0
```

The value is fixed for the lifetime of the run and is not a live parameter. To change it, stop and start the run
again. Replayed signals describe time before the run started, so they are not sent over the run's channel or stream.

## Sandbox trial duration

Set `sandboxMinutes` when starting a run to ask for a minimum trial duration from 5 to 1,440 minutes.
If omitted, the plan's shortest duration applies. Asking for less than that plan allows returns `429`;
values outside the range or non-integers return `400`. The trial also waits for enough market-feed
updates to judge the run, so a quiet instrument can keep it in `SANDBOX` beyond the requested time,
up to 24 hours. The effective value is returned on `startLive()`, `getLive()`, and `getLiveRun()`;
it is fixed at start and absent for runs that have no trial.

```ts
const run = await qts.startLive(strategyId, {
  sources: cexSources,
  sandboxMinutes: 120,
});
console.log(run.sandboxMinutes); // 120
```

`QTSurfer.connectLive()` opens a managed [Centrifugo](https://centrifugal.dev/) connection for one live
run. The SDK mints and refreshes its connection token through the configured
REST client; `centrifuge` handles reconnects and server pings.

```ts
const run = await qts.startLive(strategyId, {
  sources: cexSources,
  name: 'ETH breakout',
  relay: true,
  sandbox: true, // retain WebSocket history even for an already-promoted strategy
});
const connection = await qts.connectLive(run.runId, {
  onSignal(signal, offset) {
    console.log(signal.signalId, signal.kind, offset);
  },
  onError(error) {
    console.error('live connection problem', error);
  },
});

const params = await connection.updateParams({ emaFastPeriod: '12' });
console.log(params.paramsVersion, params.effectiveAtMs);
connection.disconnect();
await qts.stopLive(strategyId);
```

`updateLiveParams(runId, { params })` is the REST equivalent of `connection.updateParams(params)`.
On a waiting run, both store the change for the first source and omit `effectiveAtMs`.

The first run of a compiled strategy starts in the `SANDBOX` stage. After one of your runs has
passed the trial and been promoted, later runs of that same compiled strategy start in `LIVE` at once,
with the earlier verdict in `gate`; recompiling the strategy starts a new trial. This inherited
verdict applies when none of that compilation's runs was stopped for exceeding its resource limit.
The owner can inspect either stage with `getLive()` or `listLive()`. A public run appears in
`listPublicLive()` only while it is running in `LIVE`; public visibility alone does not expose a
sandbox trial.

Pass `sandbox: true` to repeat the trial for an already-promoted compilation, for example when
debugging and reading signals back over the connection. It has no effect before a strategy has
passed its first trial. The default is `false`.

Set `relay: true` to receive WebSocket signals from the run's first signal, including during
`SANDBOX`; only the owner can subscribe during that trial. The same subscription continues after
promotion. The transition can be quiet before signals produced in the meantime arrive in order.
REST retained signal history is readable in either stage, whether or not relay was enabled.
A reconnect does not replay missed signals, so use `connection.getSignalHistory()` for recent sandbox
signals held by the subscribed WebSocket channel, or `QTSurfer.getLiveSignals()` for the longer-lived
REST history in either stage. A run that starts directly in `LIVE` does not retain WebSocket history;
use `sandbox: true` when you need that history.
The WebSocket channel holds a limited number of sandbox signals for a limited time. Live-stage
signals are available from REST history. Subscribe first, then read history to
catch signals produced before the subscription. Signals received through `onSignal` can overlap
the history reply, so deduplicate by `signalId`.

```ts
const history = await connection.getSignalHistory(); // requests up to 300 signals, oldest first
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
const streamedRun = await qts.startLive(strategyId, { sources: cexSources, name: 'ETH stream', stream: true });
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
const { streamUrl: replacementUrl } = await qts.rotateLiveStream(streamedRun.runId);
const replacementSocket = new WebSocket(replacementUrl);
await qts.revokeLiveStream(streamedRun.runId); // stops this URL; the run itself keeps going
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
equity history are read through these methods. By default, accounts are split by quote currency;
`paper: { accounts: 'instrument' }` instead gives every selected instrument an isolated account,
each funded independently with `initialFunding`. Instrument mode requires an explicit instrument
list, not a wildcard.

```ts
const paperRun = await qts.startLive(strategyId, {
  sources: cexSources,
  name: 'ETH paper run',
  relay: true,
  paper: { initialFunding: 1_000, feeRate: 0.001, percentAmountToLock: 20, output: 'separate', accounts: 'instrument' },
});
const snapshot = await qts.getLiveRunPaper(paperRun.runId);
const equity = await qts.getLiveRunPaperEquity(paperRun.runId, {
  instrument: 'ETH/USDT', outMode: 'SHORT', differential: true, limit: 100,
});
const nextEquity = await qts.getNextLiveRunPaperEquity(paperRun.runId, equity);
```

`LivePaperAccount.instrument` identifies an instrument-mode account; a shared currency account
instead has `instruments`, one result for every instrument that traded or still holds a position.
Each open position reports its last `markPrice`, `markedAtMs`, and `unrealisedPnl` when a current
mark is available. The account's `unrealisedPnl` sums those positions, and `totalPnl` adds it to
`realisedPnl`. These aggregate values are absent while any open position has no current mark.
Per-instrument results on a shared account describe its realised allocation, not a hypothetical
account that traded the instrument alone: entries shared capital with the other instruments.

`getLiveRunPaperEquity()` now returns a `LivePaperEquityCurve`, not a page wrapper. Its shape is
the same as backtest curves: `points` for `outMode: 'ARRAY'`, or parallel `timestamps` and
`equities` for `SHORT`, plus `meta`, `currency`, `measure`, `gaps`, and a next link when paged.
With no `instrument`, it reads account equity (`measure: 'equity'`); supply `currency` when a run
has multiple currency accounts. With `instrument`, it reads that instrument's cumulative
`realisedPnl` (the default) or `totalPnl` including the open position's unrealised value. For an
instrument-mode run, the selected instrument identifies its account and the curve is that
account's equity.

The request also accepts `sinceMs`, `outMode`, `resample`, `differential`, `limit`, and `cursor`.
Use `sinceMs` for incremental reads; use `limit`/`cursor` for a full-resolution long curve (they
cannot be combined with `resample`). `getNextLiveRunPaperEquity()` follows the returned next link
and retains the instrument, measure, currency, and shaping options.

Paper configuration fields are `initialFunding` (default 100), `feeRate` (default 0.001),
`buyFeeRate`/`sellFeeRate` (override `feeRate`), `feeLeg` (`RECEIVED`, `QUOTE`, or `BASE`),
`percentAmountToLock` (defaults to 10% of remaining free balance for live runs), and `output`
(`separate` by default or `mix` to include paper events in signal history). Paper account reads can
return 404 when the run was started without paper configuration. `instrument` can be null on
account-level paper signals.

The protocol is specified in the canonical
[AsyncAPI contract](https://github.com/QTSurfer/qtsurfer-api/blob/main/asyncapi.yaml).
