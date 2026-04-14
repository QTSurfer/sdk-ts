import {
  cancelExecution,
  executeBacktesting,
  getExecutionResult,
  getPreparationStatus,
  getStrategyStatus,
  postStrategy,
  prepareBacktesting,
  type DataSourceType,
  type ResultMap,
} from '@qtsurfer/api-client';
import {
  ExponentialBackoff,
  TaskCancelledError,
  TimeoutStrategy,
  handleWhenResult,
  retry,
  timeout,
  wrap,
  type IPolicy,
  type ICancellationContext,
} from 'cockatiel';
import {
  QTSCanceledError,
  QTSExecutionError,
  QTSPreparationError,
  QTSStrategyCompileError,
  QTSTimeoutError,
} from '../errors';

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

export type BacktestResult = ResultMap;

export type BacktestStage = 'compiling' | 'preparing' | 'executing';

export interface BacktestProgress {
  stage: BacktestStage;
  /** 0-100 when size is known. Undefined during stage start. */
  percent?: number;
}

export interface BacktestOptions {
  /** Abort the workflow. Cancels the current poll and calls `cancelExecution` server-side if execution has started. */
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

const TICKER: DataSourceType = 'ticker';

type JobStatus = 'New' | 'Started' | 'Completed' | 'Aborted' | 'Failed';

/**
 * Normalize the backend job status to a stable lowercase form so we can
 * reason about it regardless of OpenAPI spec drift (the live API sometimes
 * returns lowercase values like `queued` / `completed` / `failed`).
 */
type NormalizedStatus = 'in-progress' | 'completed' | 'failed' | 'aborted';

function normalizeStatus(raw: unknown): NormalizedStatus {
  const value = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (value === 'completed') return 'completed';
  if (value === 'failed') return 'failed';
  if (value === 'aborted' || value === 'cancelled' || value === 'canceled') {
    return 'aborted';
  }
  // new / started / queued / running / anything else → still running
  return 'in-progress';
}

export async function backtest(
  req: BacktestRequest,
  opts: BacktestOptions = {},
): Promise<BacktestResult> {
  const policy = buildStagePolicy(opts);

  // 1. Compile strategy (async mode)
  opts.onProgress?.({ stage: 'compiling' });
  const strategyId = await compileStrategy(req.strategy, policy, opts);

  // 2. Prepare data
  opts.onProgress?.({ stage: 'preparing' });
  const prepareJobId = await prepareData(req, policy, opts);

  // 3. Execute
  opts.onProgress?.({ stage: 'executing' });
  return executeStrategy(req, prepareJobId, strategyId, policy, opts);
}

function buildStagePolicy(opts: BacktestOptions): IPolicy<ICancellationContext, never> {
  const retryPolicy = retry(
    handleWhenResult((r) => {
      const status = (r as { status?: unknown } | undefined)?.status;
      return normalizeStatus(status) === 'in-progress';
    }),
    {
      maxAttempts: Number.MAX_SAFE_INTEGER,
      backoff: new ExponentialBackoff({
        initialDelay: opts.pollIntervalMs ?? 500,
        maxDelay: opts.maxPollIntervalMs ?? 5000,
      }),
    },
  );

  return opts.timeoutMs
    ? wrap(timeout(opts.timeoutMs, TimeoutStrategy.Cooperative), retryPolicy)
    : retryPolicy;
}

async function compileStrategy(
  source: string,
  policy: IPolicy<ICancellationContext, never>,
  opts: BacktestOptions,
): Promise<string> {
  const { data, error } = await postStrategy({
    body: source,
    headers: { 'X-Compile-Async': true },
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (error) throw new QTSStrategyCompileError('Strategy submission failed', error);
  if (!data) throw new QTSStrategyCompileError('Empty response from strategy endpoint');

  // Sync mode returns { strategyId }; async mode returns { jobId }.
  if ('strategyId' in data && data.strategyId) {
    return data.strategyId;
  }
  if (!('jobId' in data) || !data.jobId) {
    throw new QTSStrategyCompileError('Missing jobId/strategyId in compile response');
  }

  const compileJobId = data.jobId;
  const status = await runStage(
    policy,
    opts,
    async ({ signal }) => {
      const res = await getStrategyStatus({ path: { strategyId: compileJobId }, signal });
      if (res.error) throw new QTSStrategyCompileError('Compile status request failed', res.error);
      if (!res.data) throw new QTSStrategyCompileError('Empty compile status response');
      return res.data;
    },
  );

  const norm = normalizeStatus(status.status);
  if (norm === 'failed') {
    throw new QTSStrategyCompileError(status.statusDetail ?? 'Strategy compilation failed');
  }
  if (norm === 'aborted') {
    throw new QTSCanceledError('Strategy compilation aborted');
  }
  if (!status.strategyId) {
    throw new QTSStrategyCompileError('Compile completed without a strategyId');
  }
  return status.strategyId;
}

async function prepareData(
  req: BacktestRequest,
  policy: IPolicy<ICancellationContext, never>,
  opts: BacktestOptions,
): Promise<string> {
  const { data, error } = await prepareBacktesting({
    path: { exchangeId: req.exchangeId, type: TICKER },
    body: { instrument: req.instrument, from: req.from, to: req.to },
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (error) throw new QTSPreparationError('Prepare submission failed', error);
  if (!data?.jobId) throw new QTSPreparationError('Missing jobId in prepare response');

  const prepareJobId = data.jobId;
  const state = await runStage(
    policy,
    opts,
    async ({ signal }) => {
      const res = await getPreparationStatus({
        path: { exchangeId: req.exchangeId, type: TICKER, jobId: prepareJobId },
        signal,
      });
      if (res.error) throw new QTSPreparationError('Preparation status request failed', res.error);
      if (!res.data) throw new QTSPreparationError('Empty preparation status response');
      return res.data;
    },
    (r) => {
      if (r.size > 0) {
        opts.onProgress?.({ stage: 'preparing', percent: (r.completed / r.size) * 100 });
      }
    },
  );

  const prepNorm = normalizeStatus(state.status);
  if (prepNorm === 'failed') {
    throw new QTSPreparationError(state.statusDetail ?? 'Data preparation failed');
  }
  if (prepNorm === 'aborted') {
    throw new QTSCanceledError('Data preparation aborted');
  }
  return prepareJobId;
}

async function executeStrategy(
  req: BacktestRequest,
  prepareJobId: string,
  strategyId: string,
  policy: IPolicy<ICancellationContext, never>,
  opts: BacktestOptions,
): Promise<BacktestResult> {
  const { data, error } = await executeBacktesting({
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
      opts,
      async ({ signal }) => {
        const res = await getExecutionResult({
          path: { exchangeId: req.exchangeId, type: TICKER, jobId: executeJobId },
          signal,
        });
        if (res.error) throw new QTSExecutionError('Execution result request failed', res.error);
        if (!res.data) throw new QTSExecutionError('Empty execution result response');
        return { ...res.data.state, __result: res.data.results };
      },
      (r) => {
        if (r.size > 0) {
          opts.onProgress?.({ stage: 'executing', percent: (r.completed / r.size) * 100 });
        }
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
      await cancelExecution({
        path: { exchangeId: req.exchangeId, type: TICKER, jobId: executeJobId },
      }).catch(() => undefined);
    }
    throw err;
  }
}

async function runStage<T extends { status: JobStatus }>(
  policy: IPolicy<ICancellationContext, never>,
  opts: BacktestOptions,
  fetchFn: (ctx: ICancellationContext) => Promise<T>,
  onEachAttempt?: (r: T) => void,
): Promise<T> {
  try {
    return await policy.execute(async (ctx) => {
      if (opts.signal?.aborted) throw new QTSCanceledError('Workflow aborted');
      const result = await fetchFn(ctx);
      onEachAttempt?.(result);
      if (opts.signal?.aborted) throw new QTSCanceledError('Workflow aborted');
      return result;
    }, opts.signal);
  } catch (err) {
    if (err instanceof QTSCanceledError) throw err;
    if (err instanceof TaskCancelledError) {
      if (opts.signal?.aborted) throw new QTSCanceledError('Workflow aborted', err);
      throw new QTSTimeoutError(`Stage exceeded ${opts.timeoutMs}ms`, err);
    }
    if (opts.signal?.aborted) throw new QTSCanceledError('Workflow aborted', err);
    throw err;
  }
}
