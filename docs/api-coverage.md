# API coverage

Measured against OpenAPI **0.128.70**: all 78 REST operation IDs are mapped below. Unless noted,
direct methods are available on both `QTSurfer` and `AuthenticatedClient`; the authenticated session
refreshes its token once on `401`. `authenticate()` is a top-level helper. `Sweep` methods belong to
the handle returned by `sweep()`, and cancellation is requested with an `AbortSignal`.

| Operation | SDK surface or decision |
| --- | --- |
| `authenticate` | Top-level `authenticate()` exchanges the API key; `403 apikey_without_scopes` raises `QTSAuthError` without retrying or minting a token. `401 invalid_credentials` deliberately does not distinguish a missing, unknown, revoked, or expired key; the generated `AuthTokenRejected` body is retained as `QTSAuthError.cause`. |
| `getAccount` | `getAccount()`; `Account.scopes` reports enforced resource/action grants, `maxSweepCartesian` the full-grid cap, and `apiKeyExpiresAt` the API key's expiry when applicable. |
| `getAccountUsage` | `getAccountUsage()`. |
| `listExchanges` | `getExchanges()`. |
| `listInstruments` | `getInstruments(exchangeId)` for CEX, `getPools(exchangeId)` for DEX; default segment. |
| `listSegmentInstruments` | `getInstruments(exchangeId, segment)` for CEX, `getPools(exchangeId, protocol)` for DEX. |
| `downloadTickers` | `downloadTickers(...)` returns a `Blob`; `downloadTickersWithMetadata(...)` also exposes timestamp/provisional headers. |
| `downloadKlines` | `downloadKlines(...)` returns a `Blob`; `downloadKlinesWithMetadata(...)` also exposes timestamp/provisional headers. |
| `listStrategies` | `getStrategies({ includeDeleted? })`; deleted rows include `deletedAt`. Entries report name and language when available. |
| `compileStrategy` | `compileStrategy(source)` reports name, language and `requires` plan capabilities; also used by `executeBacktest()` and `sweep()`. |
| `validateStrategy` | `validateStrategy(strategyId)`. |
| `getStrategy` | `getStrategy(strategyId)`. |
| `deleteStrategy` | `deleteStrategy(strategyId)`. |
| `getStrategyCode` | `getStrategyCode(strategyId)`. |
| `prepareBacktest` | Internal `ticker` (default) or `kline` preparation in `executeBacktest()` and `sweep()`; managed-exchange requests use the plan's default cadence and dataset requests use the version's own cadence. The transient `PrepareAccepted.cadence` is not returned by high-level workflows; explicit cadence and the accepted response remain generated-client operations. |
| `getPrepareStatus` | Internal polling in `executeBacktest()` and `sweep()`; the temporary job ID is workflow-owned. |
| `executeSweep` | `sweep()` submits the sweep and returns its lifecycle handle; incompatible compiled strategies fail with `QTSExecutionError` and status `409`. |
| `getSweepResult` | `Sweep.result` polls; `Sweep.getResults(view?)` rereads results in another view. |
| `cancelSweep` | `AbortSignal` on `SweepOptions`; completed rows remain readable. |
| `getSweepSensitivity` | `Sweep.getSensitivity(objective?)`. |
| `getSweepRunEquityCurve` | `Sweep.getEquityCurve(runIx, options?)`. |
| `executeBacktest` | Internal execution stage of `executeBacktest()`; incompatible compiled strategies fail with `QTSExecutionError` and status `409`. |
| `cancelBacktest` | `AbortSignal` on `BacktestOptions`. |
| `getBacktestResult` | Internal polling stage of `executeBacktest()`; the job ID is workflow-owned. |
| `createDataset` | `createDataset()` opens the first upload session. |
| `listDatasets` | `getDatasets({ includeDeleted?, collectionId? })`; deleted rows include `deletedAt`. |
| `getDataset` | `getDataset(datasetId)`. |
| `deleteDataset` | `deleteDataset(datasetId)`. |
| `openDatasetUpload` | `openDatasetUpload(datasetId)` opens a later upload session. |
| `finalizeDatasetUpload` | `finalizeDatasetUpload(datasetId, uploadId)` queues ingestion. |
| `getDatasetUpload` | `getDatasetUpload(datasetId, uploadId)` reads ingestion state. |
| `importDataset` | `importDataset(request)` starts a CEX history or DEX pool import and returns its accepted `cadence` when known. The plan selects allowed cadences and the default; excluded cadences return a non-retryable `402` with optional `upgradeUrl`. |
| `getDatasetImport` | `getDatasetImport(datasetId, importId)` reads import progress. |
| `moveDataset` | `moveDataset(datasetId, collectionId)`; pass `null` to move to the root. |
| `createCollection` | `createCollection({ name, description? })`. |
| `listCollections` | `getCollections()` unwraps the list of owned collections. |
| `getCollection` | `getCollection(collectionId)` returns counts by dataset type when available. |
| `updateCollection` | `updateCollection(collectionId, request)` renames the collection or changes its description. |
| `deleteCollection` | `deleteCollection(collectionId)` returns its datasets to the root. |
| `startLive` | `startLive(strategyId, request)` accepts zero or one initial source plus optional `warmFrom`, `sandbox`, and `sandboxMinutes`; without a source the run waits until `attachLiveSource()` is called. A `409` reports either an active run or an incompatible compiled strategy. |
| `getLive` | `getLive(strategyId)` reads the owner's current or most recent run, including a sandbox run and its effective `warmFrom` and `sandboxMinutes` when present. |
| `stopLive` | `stopLive(strategyId)`. |
| `listLive` | `listLive(query?)` lists all runs owned by the caller, including sandbox and stopped runs. |
| `listPublicLive` | `listPublicLive(query?)` lists only public runs in `LIVE` and still running, including runs that started in that stage. |
| `getLiveRun` | `getLiveRun(runId)` reads one owned run by id, including `updatedAtMs`, optional `stats`, `warmFrom`, `sandboxMinutes`, and source `attachments` when present. |
| `updateLive` | `updateLive(runId, request)` changes mutable run metadata. |
| `updateLiveParams` | `updateLiveParams(runId, request)` or `LiveConnection.updateParams(params)`. A waiting run stores the values and omits `effectiveAtMs`. |
| `rotateLiveStream` | `rotateLiveStream(runId)` replaces a run's secret plain-WebSocket URL. |
| `revokeLiveStream` | `revokeLiveStream(runId)` permanently revokes that URL without stopping the run. |
| `sendLiveCommand` | `sendLiveCommand(runId, request)` delivers transient strategy commands. |
| `attachLiveSource` | `attachLiveSource(runId, request)` attaches a source to a waiting or running run and returns the accepted attachment transition; inspect `getLiveRun(runId).attachments` for later state. |
| `detachLiveSource` | `detachLiveSource(runId, attachmentId)` requests detachment and returns `DETACHING`; inspect the run to observe `DETACHED`. |
| `getLiveRunSignals` | `getLiveSignals(runId, query?)` and `getNextLiveSignals(runId, page)`, including REST-only `type: 'system'`. |
| `getLiveRunPaper` | `getLiveRunPaper(runId)` reads simulated accounts and positions. |
| `getLiveRunPaperEquity` | `getLiveRunPaperEquity(...)` returns the `LivePaperEquityCurve` shape; `getNextLiveRunPaperEquity(...)` retains curve filters and shaping options. Supports account equity and per-instrument `realisedPnl` / `totalPnl`. |
| `mintLiveConnectionToken` | Internal to `connectLive()`; the SDK manages token minting and refresh rather than exposing a connection credential. |
| `createSignalChannel` | Generated client. Choose channel visibility and store its secret webhook URL. |
| `listSignalChannels` | Generated client. List the channels owned by the authenticated publisher. |
| `listPublicSignalChannels` | Generated client. Browse public channels using the endpoint cursor. |
| `getSignalChannel` | Generated client. Read one public or unlisted channel by ID. |
| `updateSignalChannel` | Generated client. Change publisher-owned channel metadata or visibility. |
| `deleteSignalChannel` | Generated client. Remove a publisher-owned channel. |
| `publishSignalNotice` | Generated client. Publish an authenticated notice and inspect delivery counts. |
| `listSignalNotices` | Generated client. Page through the notices of an owned channel. |
| `createSignalOffer` | Generated client. Set the offer delay, expiry and maximum number of runs. |
| `listSignalOffers` | Generated client. Inspect the placement and limits of a channel’s offers. |
| `mintSignalCodes` | Generated client. Handle the returned single-use secrets at the time of minting. |
| `listSignalCodes` | Generated client. Read previously minted code metadata without secrets. |
| `revokeSignalCode` | Generated client. Revoke a code and its subscription. |
| `redeemSignalCode` | Generated client. Exchange the buyer’s single-use secret for a subscription. |
| `listSignalSubscriptions` | Generated client. List the caller’s subscriptions. |
| `getSignalSubscription` | Generated client. Inspect one subscription and its connected runs. |
| `cancelSignalSubscription` | Generated client. Cancel a subscription and stop feeding its runs. |
| `renewSignalSubscription` | Generated client. Extend a subscription with a new code for the same offer. |
| `feedSignalSubscriptionRun` | Generated client. Associate one existing run with a subscription. |
| `stopFeedingSignalSubscriptionRun` | Generated client. Remove a run from a subscription. |
| `listSignalDeliveries` | Generated client. Inspect the per-run outcome and retain the endpoint cursor. |
| `publishSignalNoticeByHook` | Generated client. Use the secret hook credential in place of an API session. |

Prepare/execute/poll stages stay inside the backtest and sweep workflows because their temporary
identifiers and lifecycle are owned there. The generated `@qtsurfer/api-client` remains available
when an endpoint-level call is needed.

`QTSError` preserves structured server `code`, missing scope `required`, `retryable` guidance, and
the optional plan `upgradeUrl` from API error payloads. An import refusal also exposes `retryAfter` when the server sends it. A `403 insufficient_scope` or `402` plan
refusal is not retried; change the key grants or plan before trying again. Terminal execution errors
expose `JobState.retryable` for an explicit caller decision about a later resubmission.

AsyncAPI **0.4.0** is covered separately by `LiveConnection`: `connectLive()` manages the
connection and `sig:<runId>` subscription, `getSignalHistory()` reads retained sandbox
publications and their stream positions, and `updateParams()` sends `live.params`. The official
Centrifugo client handles ping, token refresh, and reconnect. History must be requested explicitly
after reconnect; subscribing does not replay missed signals. Retention is limited and flushes can
invalidate a saved position (error 112); retry without `since` and fill gaps from REST.
