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
