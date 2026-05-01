---
'@qtsurfer/sdk': patch
---

Bump `@qtsurfer/api-client` to `^0.1.2` (adds the `getExchangeTickersHour` / `getExchangeKlinesHour` operations) and extend the local `JobStatus` union with `Partial` so the regenerated `JobState` schema type-checks against `runStage` (the backend already emits `Partial` during cold-fallback prepare jobs).
