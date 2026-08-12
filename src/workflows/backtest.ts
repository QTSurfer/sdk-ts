import {
  cancelBacktest,
  executeBacktest,
  getBacktestResult,
  type ResultMap,
} from '@qtsurfer/api-client';
import { QTSCanceledError, QTSExecutionError } from '../errors';
import {
  buildStagePolicy,
  normalizeStatus,
  runStage,
  type StagePolicy,
} from '../internal/polling';
import {
  TICKER,
  compileStrategySource,
  prepareDataset,
} from '../internal/preparation';

export interface BacktestRequest {
  /** Strategy source code (Java) */
  strategy: string;
  /** Exchange id, e.g. `binance` */
  exchangeId: string;
  /** Instrument symbol, e.g. `BTC/USDT` */
  instrument: string;
  /** Date range start (ISO-8601, ISO DATE or BASIC ISO DATE) */
  from: string;
  /** Date range end (same formats as `from`) */
  to: string;
  /** When true, the worker uploads emitted signals to object storage. */
  storeSignals?: boolean;
}

/**
 * Resolved value of the backtest workflow (see {@link QTSurfer.backtest}).
 * Alias for api-client's `ResultMap` — always includes core fields
 * (`hostName`, `iops`, `instrument`); yield metrics (`pnlTotal`,
 * `totalTrades`, `equityCurve`, etc.) are only present once the strategy
 * has emitted at least one trade.
 */
export type BacktestResult = ResultMap;

/** The three sequential stages {@link QTSurfer.backtest} moves through, in order. */
export type BacktestStage = 'compiling' | 'preparing' | 'executing';

export interface BacktestProgress {
  stage: BacktestStage;
  /** 0-100 when size is known. Undefined during stage start. */
  percent?: number;
  /**
   * Fraction (0-1) of the requested prepare window that actually holds data,
   * reported by the backend once preparation completes. Present only on the
   * final `preparing` event.
   */
  coverageRatio?: number;
}

export interface BacktestOptions {
  /** Abort the workflow. Cancels the current poll and calls `cancelBacktest` server-side if execution has started. */
  signal?: AbortSignal;
  /** Called on stage transitions and after each poll with updated progress. */
  onProgress?: (p: BacktestProgress) => void;
  /** Initial interval between polls. Default 500ms, backed off up to `maxPollIntervalMs`. */
  pollIntervalMs?: number;
  /** Upper bound for exponential backoff. Default 5000ms. */
  maxPollIntervalMs?: number;
  /** Per-stage timeout. Default none. */
  timeoutMs?: number;
}

/** Initial interval between polls of a single backtest. */
const DEFAULT_POLL_INTERVAL_MS = 500;
/** Backoff ceiling for a single backtest. */
const DEFAULT_MAX_POLL_INTERVAL_MS = 5000;

export async function backtest(
  req: BacktestRequest,
  opts: BacktestOptions = {},
): Promise<BacktestResult> {
  const policy = buildStagePolicy(opts, DEFAULT_POLL_INTERVAL_MS, DEFAULT_MAX_POLL_INTERVAL_MS);

  // 1. Compile strategy (single synchronous request)
  opts.onProgress?.({ stage: 'compiling' });
  const strategyId = await compileStrategySource(req.strategy, opts.signal);

  // 2. Prepare data
  opts.onProgress?.({ stage: 'preparing' });
  const prepareJobId = await prepareData(req, policy, opts);

  // 3. Execute
  opts.onProgress?.({ stage: 'executing' });
  return executeStrategy(req, prepareJobId, strategyId, policy, opts);
}

function prepareData(
  req: BacktestRequest,
  policy: StagePolicy,
  opts: BacktestOptions,
): Promise<string> {
  return prepareDataset(
    {
      exchangeId: req.exchangeId,
      instrument: req.instrument,
      from: req.from,
      to: req.to,
    },
    policy,
    {
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      onPercent: (percent) => opts.onProgress?.({ stage: 'preparing', percent }),
      // Surface the backend's coverage ratio for the prepared window (spec 0.98.0) on the
      // final preparing event, so callers can react to a partially-covered range.
      onPrepared: (state) =>
        opts.onProgress?.({
          stage: 'preparing',
          percent: 100,
          coverageRatio: state.coverageRatio,
        }),
    },
  );
}

async function executeStrategy(
  req: BacktestRequest,
  prepareJobId: string,
  strategyId: string,
  policy: StagePolicy,
  opts: BacktestOptions,
): Promise<BacktestResult> {
  const { data, error } = await executeBacktest({
    path: { exchangeId: req.exchangeId, type: TICKER },
    body: {
      prepareJobId,
      strategyId,
      ...(req.storeSignals !== undefined ? { storeSignals: req.storeSignals } : {}),
    },
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (error) throw new QTSExecutionError('Execute submission failed', error);
  if (!data?.jobId) throw new QTSExecutionError('Missing jobId in execute response');

  const executeJobId = data.jobId;

  try {
    const finalResult = await runStage(
      policy,
      async ({ signal }) => {
        const res = await getBacktestResult({
          path: { exchangeId: req.exchangeId, type: TICKER, jobId: executeJobId },
          signal,
        });
        if (res.error) throw new QTSExecutionError('Execution result request failed', res.error);
        if (!res.data) throw new QTSExecutionError('Empty execution result response');
        // A 202 carries an empty body: no `state`, so the spread yields an undefined status and
        // the retry predicate keeps polling. That is the intended handling, not a coincidence —
        // see normalizeStatus. Do not "fix" this into a throw or an early return of the result.
        return { ...res.data.state, __result: res.data.results };
      },
      {
        ...(opts.signal ? { signal: opts.signal } : {}),
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        onEachAttempt: (r) => {
          if (r.size > 0) {
            opts.onProgress?.({ stage: 'executing', percent: (r.completed / r.size) * 100 });
          }
        },
      },
    );

    const execNorm = normalizeStatus(finalResult.status);
    if (execNorm === 'failed') {
      throw new QTSExecutionError(finalResult.statusDetail ?? 'Execution failed');
    }
    if (execNorm === 'aborted') {
      throw new QTSCanceledError('Execution aborted');
    }
    return finalResult.__result;
  } catch (err) {
    if (err instanceof QTSCanceledError) {
      await cancelBacktest({
        path: { exchangeId: req.exchangeId, type: TICKER, jobId: executeJobId },
      }).catch(() => undefined);
    }
    throw err;
  }
}
