# Backtests and parameter sweeps

Start with an authenticated session; every snippet below uses `qts`:

```ts
import { authenticate } from '@qtsurfer/sdk';

const qts = await authenticate(); // reads QTSURFER_APIKEY
```

`executeBacktest` owns compile, prepare, execution, and polling. It returns the completed result, while
`onProgress`, `AbortSignal`, and timeout options make caller policy explicit.

The high-level `executeBacktest()` and `sweep()` workflows use `ticker` by default. Set `type: 'kline'`
to run a candle strategy against a dataset whose ready version has `type: 'klines'`; the candles
are consumed as bars at the dataset version's own cadence. Ticker runs accept either dataset type.
The `type` passed to the SDK selects the prepare, execute, and polling routes consistently.

```ts
const candleResult = await qts.executeBacktest({
  strategy: candleStrategy, exchangeId: 'user', datasetId: 'ds_candles', type: 'kline',
  from: '2026-04-13T00:00:00Z', to: '2026-04-14T00:00:00Z',
});

const candleSweep = await qts.sweep({
  strategy: candleStrategy, exchangeId: 'user', datasetId: 'ds_candles', type: 'kline',
  from: '2026-04-13T00:00:00Z', to: '2026-04-14T00:00:00Z',
  params: { emaPeriod: { from: 8, to: 24, step: 2 } },
});
```

A `kline` prepare over a dataset that is not `klines` fails with `400`; check the ready dataset's
`type` before submitting. Uploads are classified from their rows once ingested, so a candle CSV
becomes `klines`. For managed exchange data, the plan determines which cadence labels are allowed
and which is the default; the [API documentation](https://www.qtsurfer.com/docs/developers/api)
lists them under “Cadences by plan”. The high-level `executeBacktest()` and `sweep()` workflows
omit cadence and use that plan default. A dataset-backed prepare uses the dataset version's own
cadence and is not limited by the plan. Explicit cadence remains available through the generated
API client; a managed-exchange request for a cadence outside the plan returns HTTP `402`, with
`retryable: false` and an optional `upgradeUrl`. A DEX venue id cannot be prepared directly; import
the pool's history as a dataset first.

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
  equityCurve: { resample: 500, differential: true, outMode: 'SHORT' },
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
[equity-curve guide](https://www.qtsurfer.com/docs/developers/api/equity_curves) defines transforms,
differential decoding, metadata, and the meaning of equity.

## Sweeps

`sweep` owns the same compile/prepare stages and returns an accepted handle. `handle.result` polls
the leaderboard; `handle.getResults({ order: 'natural' })` rereads every available row without rerunning;
`handle.getSensitivity()` provides marginals and heatmaps.

The default `grid` sampler runs the Cartesian product of all parameter axes. Read
`(await qts.getAccount()).maxSweepCartesian` before submitting a large grid: a grid over that account
limit is rejected. For bounded sampling, choose `random` or `lhs` and set `samples`; those samplers
run the requested sample count rather than the full product. Account limits are described in
[account.md](account.md).

Plateau ranking favors stable parameter neighbourhoods over isolated objective spikes. Walk-forward
changes the sweep into per-fold optimize-then-score validation, so its rows represent folds rather
than grid positions. `AbortSignal` requests cancellation while preserving completed rows.
