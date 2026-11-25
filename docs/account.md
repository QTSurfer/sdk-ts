# Account limits and storage usage

Create an authenticated session before reading account information:

```ts
import { authenticate } from '@qtsurfer/sdk';

const qts = await authenticate(); // reads QTSURFER_APIKEY
```

## Read tier limits

`getAccount()` returns the caller id, tier, resource/action scopes, and account limits.

```ts
const account = await qts.getAccount();
console.log(`${account.tier} allows ${account.maxDatasets} datasets`);
console.log(`full-grid sweep limit: ${account.maxSweepCartesian} combinations`);
console.log(account.scopes.backtests); // e.g. ['read', 'write', 'execute']
```

`maxSweepCartesian` is the maximum product of axis sizes accepted by the `grid` sampler. A larger
grid is rejected; use `random` or `lhs` with an explicit `samples` count to evaluate a bounded subset.
Those samplers are not subject to the Cartesian-grid limit. See [backtesting.md](backtesting.md) for
sweep options.

`scopes` is a required resource-to-actions map, with `{}` for a key with none. It is the same
map returned with the token for that key. A resource is present only with at least one action.
Protected operations enforce these grants and return `403 insufficient_scope` when the token
lacks a required `resource:action`; the SDK error exposes it as `code` and `required`. Change the
key's grants and refresh the token before retrying. Token issuance can also reject a key with no
scopes. See [authentication](auth.md#resource-and-action-scopes).

`apiKeyExpiresAt` is the API key's expiry in UTC, or `null` when no key expiry applies. It is the
same moment as `key_exp` on the token response. Rotate an expiring key before that time; the
token's `expires_in` is independent. See [authentication](auth.md#when-your-key-expires).

For [dataset imports](datasets.md#importing-market-history), `maxImportRangeHours` limits a DEX
pool's range and `maxCexImportRangeHours` limits a CEX market's range. `maxConcurrentImports`
counts queued or running imports of either type. `maxCexHistoryDays` bounds how far back a CEX
import may start, and `maxCexImportInstrumentsPerMonth` limits distinct instruments per market
each UTC calendar month.

## Read current usage

`getAccountUsage()` returns resource counts plus dataset, strategy, signal, and total storage use.

```ts
const usage = await qts.getAccountUsage();
console.log(`signals use ${usage.signalBytesUsed} of ${usage.storageBytesUsed} bytes`);
console.log(usage.cexImportMonth, usage.cexImportInstruments);
```

Datasets, registered strategies, and retained execution signals share one storage pool. Check usage
before enabling relay for a high-volume live run; use `relay: false` when no consumer needs live
signals or retained history. See [live.md](live.md) for the relay and signal-history lifecycle.
