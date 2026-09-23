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
```

## Read current usage

`getAccountUsage()` returns resource counts plus dataset, strategy, signal, and total storage use.

```ts
const usage = await qts.getAccountUsage();
console.log(`signals use ${usage.signalBytesUsed} of ${usage.storageBytesUsed} bytes`);
```

Datasets, registered strategies, and retained execution signals share one storage pool. Check usage
before enabling relay for a high-volume live run; use `relay: false` when no consumer needs live
signals or retained history. See [live.md](live.md) for the relay and signal-history lifecycle.
