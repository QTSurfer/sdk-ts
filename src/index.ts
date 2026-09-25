/**
 * Public surface of `@qtsurfer/sdk`. Everything a consumer needs — the
 * `QTSurfer` client, the `authenticate()` session helper, workflow types,
 * and the `QTSError` hierarchy — is re-exported from here; see each
 * symbol's own doc comment for behavior and retry semantics.
 */
export { QTSurfer, type QTSurferOptions, type DownloadHourArgs } from './client';
export { getAccount, getAccountUsage } from './account';
export type { Account, AccountUsage } from '@qtsurfer/api-client';
export {
  DEFAULT_LIVE_URL,
  LiveConnection,
  LiveSignalCursorExpiredError,
  getLive,
  getLiveRunPaper,
  getLiveRunPaperEquity,
  getNextLiveRunPaperEquity,
  getNextLiveSignals,
  getLiveSignals,
  listPublicLive,
  listLive,
  startLive,
  stopLive,
  updateLive,
  updateLiveParams,
  type LiveConnectionOptions,
} from './live';
export type {
  LiveParamsUpdateResult,
  LiveRun,
  LiveRunCompact,
  LivePaper,
  LivePaperEquityPage,
  LiveListResponse,
  LiveSignal,
  LiveSignalPage,
  PublicLiveListResponse,
  StartLiveRequest,
  UpdateLiveParamsRequest,
  UpdateLiveRequest,
} from '@qtsurfer/api-client';
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
export type {
  ParamAxis,
  Sweep,
  SweepAccepted,
  SweepHeatmap,
  SweepHeatmapCell,
  SweepMarginal,
  SweepMarginalPoint,
  SweepObjective,
  SweepOptions,
  SweepOrder,
  SweepProgress,
  SweepProgressEvent,
  SweepRanking,
  SweepRequest,
  SweepResult,
  SweepRunRow,
  SweepSampler,
  SweepSensitivity,
  SweepState,
  SweepWalkForward,
  WalkForwardFold,
  WalkForwardResult,
} from './workflows/sweep';
export type { DownloadFormat } from './workflows/downloads';
export type {
  CreateDatasetRequest,
  Dataset,
  DatasetDetail,
  DatasetImport,
  DatasetImportRequest,
  DatasetImportState,
  DatasetUpload,
  DatasetUploadSession,
  DatasetUploadState,
} from './workflows/datasets';
export type {
  Exchange,
  InstrumentDetail,
  InstrumentSegment,
} from './workflows/catalog';
export type {
  CompiledStrategy,
  StrategyState,
  StrategyValidation,
  StrategySummary,
} from './workflows/strategies';
export {
  authenticate,
  AuthenticatedClient,
  type AuthOptions,
} from './auth/session';
export {
  InMemoryTokenStore,
  type TokenStore,
} from './auth/tokenStore';
