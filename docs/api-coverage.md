# API coverage

Measured against OpenAPI **0.128.48**: all 48 REST operation IDs are mapped below. Unless noted,
direct methods are available on both `QTSurfer` and `AuthenticatedClient`; the authenticated session
refreshes its token once on `401`. `authenticate()` is a top-level helper. `Sweep` methods belong to
the handle returned by `sweep()`, and cancellation is requested with an `AbortSignal`.

| Operation | SDK surface or decision |
| --- | --- |
| `authenticate` | Top-level `authenticate()` exchanges the API key; `403 apikey_without_scopes` raises `QTSAuthError` without retrying or minting a token. |
| `getAccount` | `getAccount()`; `Account.scopes` reports enforced resource/action grants and `maxSweepCartesian` the full-grid cap. |
| `getAccountUsage` | `getAccountUsage()`. |
| `listExchanges` | `getExchanges()`. |
| `listInstruments` | `getInstruments(exchangeId)` for CEX, `getPools(exchangeId)` for DEX; default segment. |
| `listSegmentInstruments` | `getInstruments(exchangeId, segment)` for CEX, `getPools(exchangeId, protocol)` for DEX. |
| `downloadTickers` | `downloadTickers(...)` returns a `Blob`; `downloadTickersWithMetadata(...)` also exposes timestamp/provisional headers. |
| `downloadKlines` | `downloadKlines(...)` returns a `Blob`; `downloadKlinesWithMetadata(...)` also exposes timestamp/provisional headers. |
| `listStrategies` | `getStrategies({ includeDeleted? })`; deleted rows include `deletedAt`. |
| `compileStrategy` | `compileStrategy(source)` reports `requires` plan capabilities; also used by `executeBacktest()` and `sweep()`. |
| `validateStrategy` | `validateStrategy(strategyId)`. |
| `getStrategy` | `getStrategy(strategyId)`. |
| `deleteStrategy` | `deleteStrategy(strategyId)`. |
| `getStrategyCode` | `getStrategyCode(strategyId)`. |
| `prepareBacktest` | Internal `ticker` (default) or `kline` preparation in `executeBacktest()` and `sweep()`; explicit cadence and funding remain generated-client operations. |
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
| `importDataset` | `importDataset(request)` starts a CEX history or DEX pool import. |
| `getDatasetImport` | `getDatasetImport(datasetId, importId)` reads import progress. |
| `startLive` | `startLive(strategyId, request)` accepts optional `warmFrom`, `sandbox`, and `sandboxMinutes`; previously promoted compilations start in `LIVE` by default, and the response reports effective warm-up and sandbox duration when present. |
| `getLive` | `getLive(strategyId)` reads the owner's current or most recent run, including a sandbox run and its effective `warmFrom` and `sandboxMinutes` when present. |
| `stopLive` | `stopLive(strategyId)`. |
| `listLive` | `listLive(query?)` lists all runs owned by the caller, including sandbox and stopped runs. |
| `listPublicLive` | `listPublicLive(query?)` lists only public runs in `LIVE` and still running, including runs that started in that stage. |
| `getLiveRun` | `getLiveRun(runId)` reads one owned run by id, including `updatedAtMs`, optional `stats`, `warmFrom`, and `sandboxMinutes` when present. |
| `updateLive` | `updateLive(runId, request)` changes mutable run metadata. |
| `updateLiveParams` | `updateLiveParams(runId, request)` or `LiveConnection.updateParams(params)`. |
| `rotateLiveStream` | `rotateLiveStream(runId)` replaces a run's secret plain-WebSocket URL. |
| `revokeLiveStream` | `revokeLiveStream(runId)` permanently revokes that URL without stopping the run. |
| `sendLiveCommand` | `sendLiveCommand(runId, request)` delivers transient strategy commands. |
| `getLiveRunSignals` | `getLiveSignals(runId, query?)` and `getNextLiveSignals(runId, page)`. |
| `getLiveRunPaper` | `getLiveRunPaper(runId)` reads simulated accounts and positions. |
| `getLiveRunPaperEquity` | `getLiveRunPaperEquity(...)` returns the `LivePaperEquityCurve` shape; `getNextLiveRunPaperEquity(...)` retains curve filters and shaping options. Supports account equity and per-instrument `realisedPnl` / `totalPnl`. |
| `mintLiveConnectionToken` | Internal to `connectLive()`; the SDK manages token minting and refresh rather than exposing a connection credential. |

Prepare/execute/poll stages stay inside the backtest and sweep workflows because their temporary
identifiers and lifecycle are owned there. The generated `@qtsurfer/api-client` remains available
when an endpoint-level call is needed.

`QTSError` preserves structured server `code`, missing scope `required`, `retryable` guidance, and
the optional plan `upgradeUrl` from API error payloads. A `403 insufficient_scope` or `402` plan
refusal is not retried; change the key grants or plan before trying again. Terminal execution errors
expose `JobState.retryable` for an explicit caller decision about a later resubmission.

AsyncAPI **0.3.0** is covered separately by `LiveConnection`: `connectLive()` manages the
connection and `sig:<runId>` subscription, `getSignalHistory()` reads retained sandbox
publications and their stream positions, and `updateParams()` sends `live.params`. The official
Centrifugo client handles ping, token refresh, and reconnect. History must be requested explicitly
after reconnect; subscribing does not replay missed signals.
