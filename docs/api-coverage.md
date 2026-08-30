# API coverage

Measured against API spec **0.111.2**: all 29 operations are reachable from the TypeScript SDK.

| Section | SDK surface |
| --- | --- |
| Auth | `authenticate`, session refresh, `TokenStore` |
| Market data | `getExchanges`, `getInstruments`, `downloadTickers`, `downloadKlines` |
| Strategy | `compileStrategy`, `validateStrategy`, `getStrategy`, `getStrategies`, `getStrategyCode`, `deleteStrategy` |
| Backtesting | `executeBacktest` workflow with progress/cancellation |
| Sweeps | `sweep`; `Sweep.result`, `getResults`, `getSensitivity`, `getEquityCurve`, `cancel` |
| Dataset | `createDataset`, `getDatasets`, `getDataset`, `deleteDataset`, `openDatasetUpload`, `uploadDatasetFile`, `finalizeDatasetUpload`, `getDatasetUpload` |

The SDK deliberately keeps `prepare` and `execute` internal to high-level workflows: their temporary
ids and lifecycle are not useful application state, and preparation is idempotent. The generated
`@qtsurfer/api-client` remains available when an endpoint-level client is explicitly required.
