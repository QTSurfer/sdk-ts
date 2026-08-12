---
'@qtsurfer/sdk': minor
---

Add parameter sweeps to both `QTSurfer` and the authenticated session.

`sweep(request, options?)` runs the same strategy once per parameter vector over one instrument and
one window, then scores and ranks the trials against a single objective. It is one call — compile →
prepare → `executeSweep` → poll the leaderboard — because the execute-sweep endpoint is addressed by
the id of an already-prepared dataset, and preparing is idempotent, so the stages buy nothing when
exposed separately.

It resolves as soon as the platform accepts the sweep, handing back a `Sweep` handle while the
leaderboard keeps being polled in the background: `sweepId`, `requestId`, `strategyId`, `accepted`
(the acceptance response, exactly as the server sent it), a live `state`, a `result` promise,
`results(view?)` and `sensitivity(objective?)`. Axes take one of two shapes — `{ from, to, step }`
or `{ values: [...] }` — and `sampler: 'random' | 'lhs'` draws `samples` vectors instead of the full
cross product.

`results({ order?, ranking? })` re-reads the same sweep under a different view. `order` and
`ranking` are query parameters on the result endpoint, so this is a **read**: it compiles nothing,
prepares nothing and submits nothing, and creates no second sweep. It is the route to the rows a
`truncated` ranked view dropped, it works on a sweep still in flight (returning the rows finished so
far, like `sensitivity()`), and an absent property takes the platform default. The `order` /
`ranking` in `SweepOptions` decide only what the background poll behind `result` reads.

**Cancellation diverges from `backtest()` on purpose.** Pass an `AbortSignal` as usual, but awaiting
a cancelled sweep **resolves rather than rejecting**: cancellation is requested between parameter
vectors and the rows already completed stay readable, so the SDK keeps polling until the platform
reports the sweep `CANCELLED` and then hands back the partial leaderboard. Rejecting would throw
away rows a caller has no other route to. Aborting *before* the sweep is accepted still rejects —
there is no sweep yet, and so no rows to keep.

Things the types cannot say, and that callers get wrong:

- **The default order is not raw objective order.** `ranking` defaults to `'plateau'` — the
  objective of the worst run in a point's neighbourhood — because the highest raw score is often a
  spike that does not survive small parameter moves. `result.ranking` reports which ordering was
  *actually* applied, which is not always the one requested. Setting `ranking` alongside
  `order: 'natural'` is accepted and ignored; that view is always ordered by `runIx`.
- **`neighbourCount: 0` means unevidenced, not confirmed** — read it together with `plateauScore`.
- **`truncated === true` means rows were dropped** from the ranked view, and `order: 'natural'` is
  the only route to them — reachable with `results({ order: 'natural' })` on the existing handle.
- **`deflatedSharpe`** is the probability a row's Sharpe reflects real edge rather than the best
  draw from however many vectors were tried; **`pbo`** says the same about the search as a whole.
  Both are absent when there is too little to compute them from.
- **A walk-forward sweep answers in a different shape.** `walkForward` is the discriminator and
  appears from acceptance onward, so it is safe to branch on while polling. Its leaderboard is one
  row per completed fold, with `runIx` carrying the fold index rather than a grid position, and no
  plateau, deflated-Sharpe or PBO figure. An absent `paramDrift` is *not* zero.
- **`aborted` and `failedShards` count different things** — runs that ran badly versus whole units
  of work that never reported — so adding them double-counts. `etaSeconds` is omitted rather than
  zeroed when it cannot be computed.
- **`heatmapsTruncated`** exists so a short heatmap list cannot be read as "these are all the
  interactions"; `sensitivity()` returns the whole record rather than just its surfaces so the flag
  cannot be lost on the way out.

Internally, `partial` now normalizes as a terminal status. It appears only on the two sweep schemas
and is absent from `JobState`, so the prepare and execute paths are unaffected; without it the poll
would never stop on a finished sweep. The compile, prepare and poll machinery `backtest()` already
used now lives in `src/internal/`, shared by both workflows rather than duplicated — sweep polls on
longer defaults (2s, backing off to 15s) because a leaderboard changes on the timescale of shards
finishing rather than ticks.

New exported types: `Sweep`, `SweepRequest`, `SweepOptions`, `SweepProgressEvent`, `SweepResult`,
`SweepAccepted`, `SweepProgress`, `SweepRunRow`, `SweepSensitivity`, `SweepMarginal`,
`SweepMarginalPoint`, `SweepHeatmap`, `SweepHeatmapCell`, `SweepState`, `SweepObjective`,
`SweepSampler`, `SweepRanking`, `SweepOrder`, `SweepWalkForward`, `ParamAxis`, `WalkForwardResult`,
`WalkForwardFold`. No existing signature changed.
