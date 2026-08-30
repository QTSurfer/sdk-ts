---
"@qtsurfer/sdk": minor
---

Standardize the high-level API around action verbs and `get…` reads: use
`executeBacktest`, `getExchanges`, `getInstruments`, `getStrategies`,
`getDatasets`, and `Sweep.getResults`, `getSensitivity`, and
`getEquityCurve`. The previous names remain deprecated aliases for migration.

Dataset uploads now explicitly use the platform `fetch` when no custom
transport is configured.
