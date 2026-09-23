# Live Execution

`QTSurfer.connectLive()` opens a managed [Centrifugo](https://centrifugal.dev/) connection for one live
run. The SDK mints and refreshes its connection token through the configured
REST client; `centrifuge` handles reconnects and server pings.

```ts
const connection = await qts.connectLive(runId, {
  onSignal(signal) {
    console.log(signal.signalId, signal.kind);
  },
  onError(error) {
    console.error('live connection problem', error);
  },
});

await connection.updateParams({ emaFastPeriod: '12' });
connection.disconnect();
```

Start the run with `relay: true`; signals are emitted only after it reaches the
`live` stage. A reconnect does not replay missed signals, so use
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

const nextHref = page._links?.next?.href;
if (nextHref) {
  const cursor = new URL(nextHref).searchParams.get('cursor');
  const nextPage = await qts.getLiveSignals(runId, { cursor: cursor ?? undefined });
}
```

When `LiveSignalCursorExpiredError` is thrown, restart without `cursor`. The
replacement page reports its `availableSinceMs` value, which is the oldest
retained signal timestamp.

The protocol is specified in the canonical
[AsyncAPI contract](https://github.com/QTSurfer/qtsurfer-api/blob/main/asyncapi.yaml).
