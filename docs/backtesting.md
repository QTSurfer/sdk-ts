# Backtests and parameter sweeps

`executeBacktest` owns compile, prepare, execution, and polling. It returns the completed result, while
`onProgress`, `AbortSignal`, and timeout options make caller policy explicit.

```ts
const result = await qts.executeBacktest({
  strategy: source, exchangeId: 'binance', instrument: 'BTC/USDT',
  from: '2026-04-13T00:00:00Z', to: '2026-04-14T00:00:00Z',
});
```

## Equity curves

Pass the API-client `EquityCurveOptions` on a backtest request. The result's `equityCurve.meta`
describes the representation actually returned, which may differ from the requested compact mode.

```ts
const result = await qts.executeBacktest({
  strategy: source, exchangeId: 'binance', instrument: 'BTC/USDT', from, to,
  equityCurve: { resample: 500, differential: true, outMode: 'short' },
});
const curve = result.equityCurve;
```

For sweep retention, pass `equityCurve` on `SweepRequest`, then read a retained trial with
`handle.getEquityCurve(runIx, options?)`. Non-retained rows answer `404`. The shared API
[equity-curve guide](https://qtsurfer.github.io/docs/equity_curves.html) defines transforms,
differential decoding, metadata, and the meaning of equity.

## Sweeps

`sweep` owns the same compile/prepare stages and returns an accepted handle. `handle.result` polls
the leaderboard; `handle.getResults({ order: 'natural' })` rereads every available row without rerunning;
`handle.getSensitivity()` provides marginals and heatmaps.

Plateau ranking favors stable parameter neighbourhoods over isolated objective spikes. Walk-forward
changes the sweep into per-fold optimize-then-score validation, so its rows represent folds rather
than grid positions. `AbortSignal` requests cancellation while preserving completed rows.
