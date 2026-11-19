# Authentication

`authenticate()` exchanges an API key for a short-lived JWT. The returned `AuthenticatedClient`
caches it, refreshes once after a `401`, and retries the failed request once.

```ts
import { authenticate } from '@qtsurfer/sdk';

const qts = await authenticate(); // reads QTSURFER_APIKEY
// Or: const qts = await authenticate('ak_...');
```

An invalid, revoked, missing, or expired key returns the same `401` response with
`error: 'invalid_credentials'`; the server does not distinguish those causes. The SDK raises `QTSAuthError`
with the HTTP `status` and the response body as `cause`. A deployment that requires scopes returns
`403` with `apikey_without_scopes` for a key with none, and mints no token. It does not
automatically retry either rejection: create a valid key with at least one resource/action scope,
then authenticate with it.

```ts
import { authenticate, QTSAuthError } from '@qtsurfer/sdk';

try {
  const qts = await authenticate('ak_...');
  console.log(qts.token?.scopes);
} catch (error) {
  if (error instanceof QTSAuthError && error.code === 'apikey_without_scopes') {
    console.error('Create an API key with at least one resource/action scope before authenticating.');
  } else throw error;
}
```

Pass `baseUrl`, `fetch`, or a `TokenStore` when the default environment and in-memory storage do
not suit the application. The store owns its security policy.

```ts
const qts = await authenticate(undefined, { baseUrl: 'https://api.qtsurfer.net/v1', store });
```

Use `new QTSurfer({ baseUrl, token })` only when the application deliberately owns JWT refresh.
It does not exchange API keys or refresh the supplied token.

## When your API key expires

An API key can expire independently of the JWT. When it does, `qts.token?.key_exp` is its expiry
in seconds since epoch, and `qts.getAccount().apiKeyExpiresAt` reports the same moment in UTC.
`key_exp` is absent and `apiKeyExpiresAt` is `null` when no key expiry applies. The JWT's own
`expires_in` is unchanged: a token issued just before the key expires remains valid for its own
remaining lifetime, but the expired key cannot mint another token. Rotate the key before
`key_exp`.

```ts
const tokenExpiry = qts.token?.key_exp;
if (tokenExpiry !== undefined) console.log(new Date(tokenExpiry * 1000));
console.log((await qts.getAccount()).apiKeyExpiresAt);
```

## Resource and action scopes

`qts.token?.scopes` is a `KeyScopes` map, for example
`{ backtests: ['read', 'write', 'execute'], exchanges: ['read'] }`. A key with no grants reports
`{}`. A scope is one resource and one action; a resource with zero actions is omitted rather
than reported with `[]`. `AuthTokenResponse.scopes` is optional for older responses;
`getAccount().scopes` is required and reports the same map for that key. Protected operations
enforce those grants. A valid token missing the operation's scope gets `403 insufficient_scope`
with the required `resource:action`; because the JWT preserves the key's grants from issuance,
edit the key and refresh or re-authenticate before trying again. The SDK exposes this as
`QTSError.code` and `QTSError.required` and never retries it automatically.

```ts
const scopes = qts.token?.scopes ?? {};
console.log(scopes.backtests?.includes('execute') ?? false);
const account = await qts.getAccount();
console.log(account.scopes);
```

Handle a missing grant as a permissions change, not as a transient failure:

```ts
import { QTSError } from '@qtsurfer/sdk';

try {
  await qts.getDatasets();
} catch (error) {
  if (error instanceof QTSError && error.code === 'insufficient_scope') {
    console.error(`Grant ${error.required} to this API key, then refresh the session.`);
  } else throw error;
}
```

Resource names are `exchanges`, `market_data`, `strategies`, `backtests`, `datasets`, and `live`.
The API's [authentication guide](https://github.com/QTSurfer/qtsurfer-api/blob/main/docs/auth.md)
maps each operation to its future required action. Token grants reflect the key when the JWT was
issued; call `qts.refresh()` after changing the key's grants to see them immediately.

Custom `TokenStore` implementations should persist the complete token, including the map.
On loading a token saved by an older SDK with `scopes: []`, the session replaces that legacy list
with `{}` and saves the migrated token. The JWT is reused; a valid nonempty map is kept intact.
See [account limits and usage](account.md) for the other account fields.
