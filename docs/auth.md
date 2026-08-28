# Authentication

`authenticate()` exchanges an API key for a short-lived JWT. The returned `AuthenticatedClient`
caches it, refreshes once after a `401`, and retries the failed request once.

```ts
import { authenticate } from '@qtsurfer/sdk';

const qts = await authenticate(); // reads QTSURFER_APIKEY
// Or: const qts = await authenticate('ak_...');
```

Pass `baseUrl`, `fetch`, or a `TokenStore` when the default environment and in-memory storage do
not suit the application. The store owns its security policy.

```ts
const qts = await authenticate(undefined, { baseUrl: 'https://api.qtsurfer.net/v1', store });
```

Use `new QTSurfer({ baseUrl, token })` only when the application deliberately owns JWT refresh.
It does not exchange API keys or refresh the supplied token.
