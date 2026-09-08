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

## Re-running with strategy properties

Pass scalar `params` to apply declared strategy properties without recompiling the strategy
yourself. Keys are the names exposed by the strategy, rather than necessarily its Java field names.
Leave a property out to retain its declared default; arrays, ranges, and `null` are not valid here.
Use `sweep()` for ranges or lists.

```ts
const result = await qts.executeBacktest({
  strategy: source, exchangeId: 'binance', instrument: 'BTC/USDT', from, to,
  params: { 'ema.fast.period': 9, 'ema.slow.period': 21, 'risk.pct': 0.5 },
});

// Present only when the execution was parameterised.
console.log(result.params);
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
