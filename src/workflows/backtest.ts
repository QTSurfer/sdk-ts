export interface BacktestRequest {
  strategy: string;
  exchangeId: string;
  instrument: string;
  from: string;
  to: string;
}

export interface BacktestResult {
  jobId: string;
  // TODO(sdk): map from api-client ResultMap once shape is stable
}

export type BacktestStage = 'compiling' | 'preparing' | 'executing';

export interface BacktestProgress {
  stage: BacktestStage;
  percent?: number;
}

export interface BacktestOptions {
  signal?: AbortSignal;
  onProgress?: (p: BacktestProgress) => void;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

/**
 * Orchestrates the full backtest flow: compile → prepare → execute → result.
 *
 * Intentionally a stub. The real implementation should:
 *   1. postStrategy(req.strategy)      → poll getStrategyStatus until compiled
 *   2. prepareBacktesting(...)          → poll getPreparationStatus until ready
 *   3. executeBacktesting(...)          → poll getExecutionResult until completed
 * At each failure branch, throw the matching QTSError subclass.
 */
export async function backtest(
  req: BacktestRequest,
  opts: BacktestOptions = {},
): Promise<BacktestResult> {
  void req;
  void opts;
  throw new Error('Not implemented yet. See TODO in src/workflows/backtest.ts');
}
