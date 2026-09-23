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
`live` stage. A reconnect does not replay missed signals, so use the REST
`GET /live/{runId}/signals` endpoint and deduplicate by `signalId` when a
complete history is required.

The protocol is specified in the canonical
[AsyncAPI contract](https://github.com/QTSurfer/qtsurfer-api/blob/main/asyncapi.yaml).
