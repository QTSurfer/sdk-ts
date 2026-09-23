# Strategies and validation

Start with an authenticated session; every snippet below uses `qts`:

```ts
import { authenticate } from '@qtsurfer/sdk';

const qts = await authenticate(); // reads QTSURFER_APIKEY
```

`compileStrategy` registers Java source and returns its `strategyId`. Validate before an expensive
run: validation loads the class and drives a bounded synthetic series.

```ts
const compiled = await qts.compileStrategy(source);
const outcome = await qts.validateStrategy(compiled.strategyId);

if (outcome.queued) {
  const state = await qts.getStrategy(compiled.strategyId);
  console.log(state.validation);
}
```

Validation is idempotent. `queued: false` means no new check was started, not necessarily that a
check passed. Poll `getStrategy` with an application deadline while validation is `pending`; a
passed bounded check is a useful floor, not a trading-performance guarantee.

```ts
const mine = await qts.getStrategies();
const registeredSource = await qts.getStrategyCode(compiled.strategyId);
await qts.deleteStrategy(compiled.strategyId);
```

For indicators, `emitBuy`/`emitSell`, information signals, order configuration, and chart metadata,
see the API's [Coding Java strategies](https://qtsurfer.github.io/docs/strategy_coding.html) guide
and the [`qtsurfer-java-strategy`](https://github.com/QTSurfer/strategy-skills) skill.
