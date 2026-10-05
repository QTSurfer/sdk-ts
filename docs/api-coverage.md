# API coverage

Measured against OpenAPI **0.128.14**: all 45 REST operation IDs are mapped below. Unless noted,
direct methods are available on both `QTSurfer` and `AuthenticatedClient`; the authenticated session
refreshes its token once on `401`. `authenticate()` is a top-level helper. `Sweep` methods belong to
the handle returned by `sweep()`, and cancellation is requested with an `AbortSignal`.

| Operation | SDK surface or decision |
| --- | --- |
| `authenticate` | Top-level `authenticate()` exchanges the API key and returns an authenticated session. |
| `getAccount` | `getAccount()`; `Account.maxSweepCartesian` reports the account's full-grid cap. |
| `getAccountUsage` | `getAccountUsage()`. |
| `listExchanges` | `getExchanges()`. |
| `listInstruments` | `getInstruments(exchangeId)` (default segment). |
| `listSegmentInstruments` | `getInstruments(exchangeId, segment)`. |
| `downloadTickers` | `downloadTickers(...)` returns a `Blob`. |
| `downloadKlines` | `downloadKlines(...)` returns a `Blob`. |
| `listStrategies` | `getStrategies({ includeDeleted? })`; deleted rows include `deletedAt`. |
| `compileStrategy` | `compileStrategy(source)`; also used by `executeBacktest()` and `sweep()`. |
| `validateStrategy` | `validateStrategy(strategyId)`. |
| `getStrategy` | `getStrategy(strategyId)`. |
| `deleteStrategy` | `deleteStrategy(strategyId)`. |
| `getStrategyCode` | `getStrategyCode(strategyId)`. |
| `prepareBacktest` | Internal to `executeBacktest()` and `sweep()`; its generated request/job IDs are workflow-owned. |
| `getPrepareStatus` | Internal polling in `executeBacktest()` and `sweep()`; the temporary job ID is workflow-owned. |
| `executeSweep` | `sweep()` submits the sweep and returns its lifecycle handle. |
| `getSweepResult` | `Sweep.result` polls; `Sweep.getResults(view?)` rereads results in another view. |
| `cancelSweep` | `AbortSignal` on `SweepOptions`; completed rows remain readable. |
| `getSweepSensitivity` | `Sweep.getSensitivity(objective?)`. |
| `getSweepRunEquityCurve` | `Sweep.getEquityCurve(runIx, options?)`. |
| `executeBacktest` | Internal execution stage of `executeBacktest()`; the SDK returns the completed result. |
| `cancelBacktest` | `AbortSignal` on `BacktestOptions`. |
| `getBacktestResult` | Internal polling stage of `executeBacktest()`; the job ID is workflow-owned. |
| `createDataset` | `createDataset()` opens the first upload session. |
| `listDatasets` | `getDatasets({ includeDeleted? })`; deleted rows include `deletedAt`. |
| `getDataset` | `getDataset(datasetId)`. |
| `deleteDataset` | `deleteDataset(datasetId)`. |
| `openDatasetUpload` | `openDatasetUpload(datasetId)` opens a later upload session. |
| `finalizeDatasetUpload` | `finalizeDatasetUpload(datasetId, uploadId)` queues ingestion. |
| `getDatasetUpload` | `getDatasetUpload(datasetId, uploadId)` reads ingestion state. |
| `importDataset` | `importDataset(request)` starts an external-history import. |
| `getDatasetImport` | `getDatasetImport(datasetId, importId)` reads import progress. |
| `startLive` | `startLive(strategyId, request)`. |
| `getLive` | `getLive(strategyId)` reads the owner's current or most recent run, including a sandbox run. |
| `stopLive` | `stopLive(strategyId)`. |
| `listLive` | `listLive(query?)` lists all runs owned by the caller, including sandbox and stopped runs. |
| `listPublicLive` | `listPublicLive(query?)` lists only public runs promoted to `LIVE` and still running. |
| `getLiveRun` | `getLiveRun(runId)` reads one owned run by id, including `updatedAtMs` and optional `stats`. |
| `updateLive` | `updateLive(runId, request)` changes mutable run metadata. |
| `updateLiveParams` | `updateLiveParams(runId, request)` or `LiveConnection.updateParams(params)`. |
| `rotateLiveStream` | `rotateLiveStream(runId)` replaces a run's secret plain-WebSocket URL. |
| `revokeLiveStream` | `revokeLiveStream(runId)` permanently revokes that URL without stopping the run. |
| `sendLiveCommand` | `sendLiveCommand(runId, request)` delivers transient strategy commands. |
| `getLiveRunSignals` | `getLiveSignals(runId, query?)` and `getNextLiveSignals(runId, page)`. |
| `getLiveRunPaper` | `getLiveRunPaper(runId)` reads simulated accounts and positions. |
| `getLiveRunPaperEquity` | `getLiveRunPaperEquity(...)` and `getNextLiveRunPaperEquity(...)`. |
| `mintLiveConnectionToken` | Internal to `connectLive()`; the SDK manages token minting and refresh rather than exposing a connection credential. |

Prepare/execute/poll stages stay inside the backtest and sweep workflows because their temporary
identifiers and lifecycle are owned there. The generated `@qtsurfer/api-client` remains available
when an endpoint-level call is needed.
