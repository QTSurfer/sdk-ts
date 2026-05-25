---
'@qtsurfer/sdk': minor
---

Add `auth(apikey?, opts?)` helper that exchanges a long-lived API key for a
short-lived JWT in one call. Returns an `AuthenticatedClient` that caches
the token in memory (or a caller-provided `TokenStore`), refreshes on 401,
and exposes the same workflow surface as `QTSurfer` (`backtest`, `tickers`,
`klines`). Reads `QTSURFER_APIKEY` from the environment when no apikey
argument is passed.

New public exports: `auth`, `AuthenticatedClient`, `AuthOptions`,
`TokenStore`, `InMemoryTokenStore`, `QTSAuthError`. `QTSError` (and
subclasses) now expose the underlying HTTP `status` when available.

Bumps `@qtsurfer/api-client` to `^0.2.1`.
