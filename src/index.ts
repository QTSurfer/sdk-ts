/**
 * Public surface of `@qtsurfer/sdk`. Everything a consumer needs — the
 * `QTSurfer` client, the `authenticate()` session helper, workflow types,
 * and the `QTSError` hierarchy — is re-exported from here; see each
 * symbol's own doc comment for behavior and retry semantics.
 */
export { QTSurfer, type QTSurferOptions, type DownloadHourArgs } from './client';
export {
  QTSError,
  QTSStrategyCompileError,
  QTSPreparationError,
  QTSExecutionError,
  QTSTimeoutError,
  QTSCanceledError,
  QTSDownloadError,
  QTSAuthError,
} from './errors';
export type {
  BacktestRequest,
  BacktestResult,
  BacktestProgress,
  BacktestStage,
  BacktestOptions,
} from './workflows/backtest';
export type { DownloadFormat } from './workflows/downloads';
export {
  authenticate,
  AuthenticatedClient,
  type AuthOptions,
} from './auth/session';
export {
  InMemoryTokenStore,
  type TokenStore,
} from './auth/tokenStore';
