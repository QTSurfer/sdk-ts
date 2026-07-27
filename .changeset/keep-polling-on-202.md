---
'@qtsurfer/sdk': patch
---

Document and pin that a `202` on the execute-result poll keeps the loop running.

The API answers `202` with an empty body when a job is known but its result is not readable yet.
Because it is a 2xx, the generated client reports no error and `data` is `{}` — a response with no
`state` at all. The poll already handled this correctly, since an absent status normalizes to
"in progress", but nothing said so: a reasonable refactor (throwing on a missing `state`, or
returning the empty result early) would have silently turned a completed backtest into an empty
one. `normalizeStatus` now documents the rule and a test drives two `202`s before the real result.
