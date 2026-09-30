# Account limits and storage usage

Create an authenticated session before reading account information:

```ts
import { authenticate } from '@qtsurfer/sdk';

const qts = await authenticate(); // reads QTSURFER_APIKEY
```

## Read tier limits

`getAccount()` returns the caller id, tier, and the account limits.

```ts
const account = await qts.getAccount();
console.log(`${account.tier} allows ${account.maxDatasets} datasets`);
console.log(`full-grid sweep limit: ${account.maxSweepCartesian} combinations`);
```

`maxSweepCartesian` is the maximum product of axis sizes accepted by the `grid` sampler. A larger
grid is rejected; use `random` or `lhs` with an explicit `samples` count to evaluate a bounded subset.
Those samplers are not subject to the Cartesian-grid limit. See [backtesting.md](backtesting.md) for
sweep options.

## Read current usage

`getAccountUsage()` returns resource counts plus dataset, strategy, signal, and total storage use.

```ts
const usage = await qts.getAccountUsage();
console.log(`signals use ${usage.signalBytesUsed} of ${usage.storageBytesUsed} bytes`);
```

Datasets, registered strategies, and retained execution signals share one storage pool. Check usage
before enabling relay for a high-volume live run; use `relay: false` when no consumer needs live
signals or retained history. See [live.md](live.md) for the relay and signal-history lifecycle.
