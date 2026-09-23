# API coverage

Measured against API spec **0.126.1**. The SDK provides a task-oriented surface for all 41 REST
operations. Its managed live connection obtains the connection token internally rather than
exposing it as a credential callers can mishandle.

| Domain | SDK surface | DX boundary |
| --- | --- | --- |
| Authentication | `authenticate`, session refresh, `TokenStore` | API-key exchange and one retry after `401` are owned by `AuthenticatedClient`. |
| Account | `getAccount`, `getAccountUsage` | [account.md](account.md) separates limits from live execution. |
| Market data | `getExchanges`, `getInstruments`, `downloadTickers`, `downloadKlines` | HAL lists become arrays; downloads become `Blob`s. |
| Strategy | `compileStrategy`, `validateStrategy`, `getStrategy`, `getStrategies`, `getStrategyCode`, `deleteStrategy` | Compact listing stays separate from per-strategy validation state. |
| Backtesting | `executeBacktest`, `getBacktestResult`, cancellation and progress options | Compile, prepare, execute, retries, and polling form one workflow. |
| Sweeps | `sweep`; `Sweep.result`, `getResults`, `getSensitivity`, `getEquityCurve`, `cancel` | The handle owns accepted-run identifiers and lifecycle. |
| Dataset | `createDataset`, `importDataset`, `getDatasetImport`, `getDatasets`, `getDataset`, `deleteDataset`, `openDatasetUpload`, `uploadDatasetFile`, `finalizeDatasetUpload`, `getDatasetUpload` | Presigned upload bytes never use the API token. |
| Live execution | `startLive`, `getLive`, `stopLive`, `listPublicLive`, `updateLive`, `updateLiveParams`, `getLiveSignals`, `connectLive` | `connectLive` owns token minting, refresh, reconnects, pings, and the WebSocket channel. |

The SDK deliberately keeps `prepare` and raw `execute` calls internal to high-level workflows:
their temporary ids and lifecycle are not useful application state, and preparation is idempotent.
The generated `@qtsurfer/api-client` remains available when an endpoint-level client is explicitly
required.
