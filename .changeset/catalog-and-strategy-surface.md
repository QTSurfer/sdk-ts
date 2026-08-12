---
'@qtsurfer/sdk': minor
---

Add the platform catalog and the strategy surface to both `QTSurfer` and the authenticated session.

- `exchanges()` — list the exchanges the platform serves.
- `instruments(exchangeId, segment?)` — list an exchange's instruments with their per-data-type
  coverage. Omitting `segment` asks for the exchange's default segment (`'spot'` today); passing one
  targets that segment explicitly. The API's HAL envelope is unwrapped internally, so callers get the
  instrument array rather than `{ data, meta, _links }` — which also means `meta.segment` is not
  visible, so pass `segment` when you need certainty about which one you are looking at.
- `validateStrategy(strategyId)` — ask the platform to check that a registered strategy can actually
  run. Idempotent and **two-outcome**, which the SDK surfaces as a discriminated result rather than
  collapsing: `queued: false` returns an already-recorded verdict in `state` and starts nothing,
  while `queued: true` means a check was just queued and is **not** terminal. The discriminant
  reports whether work was *started*, not whether a verdict *exists* — a `queued: false` answer can
  itself carry `validation: 'pending'` from a check an earlier call queued, so read
  `state.validation`.
- `strategy(strategyId)` — read a strategy's recorded state: verdict, engine notices, required
  market data sources.

The `strategyId` these two take is the one returned when the source was compiled and registered.
This SDK still does not surface compilation on its own — `backtest()` does it internally and keeps
the id — so obtain it from `compileStrategy()` in `@qtsurfer/api-client` if you want to validate a
strategy before running it.

Two things the types cannot say, and that callers get wrong:

- **`'passed'` is a floor, not a guarantee.** It means the compiled class loaded and survived the
  first event of a short synthetic run — not your instrument, not your window, not the rest of the
  run. `dryRunIncomplete` marks a check that ran out of its budget, making the floor lower still and
  making an empty `notices` list no longer a clean bill of health.
- **`'pending'` is not guaranteed to resolve.** A queued check can go unreported far longer than one
  takes, which the platform eventually flags as `validationStalled`. Poll `strategy()` under a
  deadline of your own; this release deliberately ships no polling helper, because the timeout is
  the caller's policy.

All four throw a plain `QTSError` carrying the HTTP `status`, so the authenticated session refreshes
its JWT and retries once on a `401` — the same treatment `tickers()` / `klines()` already get.

New exported types: `Exchange`, `InstrumentDetail`, `InstrumentSegment`, `StrategyState`,
`StrategyValidation`. No existing signature changed.
