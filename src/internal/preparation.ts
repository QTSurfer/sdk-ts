import {
  getPrepareStatus,
  compileStrategy as apiCompileStrategy,
  prepareBacktest,
  type DataSourceType,
  type PrepareJobState,
} from '@qtsurfer/api-client';
import { QTSCanceledError, QTSPreparationError, QTSStrategyCompileError } from '../errors';
import { normalizeStatus, runStage, type StagePolicy } from './polling';

/** The only data source the workflows prepare against today. @internal */
export const TICKER: DataSourceType = 'ticker';

/**
 * Compile in a single request: the API answers synchronously with the `strategyId`,
 * so there is no job to poll. A compile error arrives here as a `400`, not on a later poll.
 *
 * @internal
 */
export async function compileStrategySource(
  source: string,
  signal?: AbortSignal,
): Promise<string> {
  const { data, error, response } = await apiCompileStrategy({
    body: source,
    ...(signal ? { signal } : {}),
  });

  if (error) {
    // A 429 means the platform is holding too many compilations at once and the source was never
    // judged — worth separating from the 400 that says the source itself does not compile.
    // Read the status inside this branch and optionally: a transport failure carries no response,
    // and dereferencing one would raise a TypeError that buries the error actually being reported.
    if (response?.status === 429) {
      throw new QTSStrategyCompileError(
        'Strategy was not compiled, too many compilations in flight; retry later',
        error,
      );
    }
    throw new QTSStrategyCompileError('Strategy compilation failed', error);
  }
  if (!data?.strategyId) {
    throw new QTSStrategyCompileError('Compile response missing strategyId');
  }
  return data.strategyId;
}

/** The instrument and window one prepare covers. @internal */
export interface PrepareTarget {
  exchangeId: string;
  instrument: string;
  from: string;
  to: string;
}

/** Reporting and cancellation for {@link prepareDataset}. @internal */
export interface PrepareRun {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Called after each poll that reports size information. */
  onPercent?: (percent: number) => void;
  /** Called once with the terminal state, so the caller can read its coverage. */
  onPrepared?: (state: PrepareJobState) => void;
}

/**
 * Submit a prepare and poll it to a terminal state.
 *
 * One implementation on purpose. Preparing is idempotent — the same instrument
 * and window always resolve to the same job — so a workflow that prepares on
 * every call duplicates no work, and that argument only holds while there is a
 * single place where it is true.
 *
 * @returns the prepare jobId, which is what identifies the prepared dataset
 *
 * @internal
 */
export async function prepareDataset(
  target: PrepareTarget,
  policy: StagePolicy,
  run: PrepareRun = {},
): Promise<string> {
  const { data, error } = await prepareBacktest({
    path: { exchangeId: target.exchangeId, type: TICKER },
    body: { instrument: target.instrument, from: target.from, to: target.to },
    ...(run.signal ? { signal: run.signal } : {}),
  });
  if (error) throw new QTSPreparationError('Prepare submission failed', error);
  if (!data?.jobId) throw new QTSPreparationError('Missing jobId in prepare response');

  const prepareJobId = data.jobId;
  const state = await runStage(
    policy,
    async ({ signal }) => {
      const res = await getPrepareStatus({
        path: { exchangeId: target.exchangeId, type: TICKER, jobId: prepareJobId },
        signal,
      });
      if (res.error) throw new QTSPreparationError('Preparation status request failed', res.error);
      if (!res.data) throw new QTSPreparationError('Empty preparation status response');
      return res.data;
    },
    {
      ...(run.signal ? { signal: run.signal } : {}),
      ...(run.timeoutMs !== undefined ? { timeoutMs: run.timeoutMs } : {}),
      onEachAttempt: (r) => {
        if (r.size > 0) run.onPercent?.((r.completed / r.size) * 100);
      },
    },
  );

  const prepNorm = normalizeStatus(state.status);
  if (prepNorm === 'failed') {
    throw new QTSPreparationError(state.statusDetail ?? 'Data preparation failed');
  }
  if (prepNorm === 'aborted') {
    throw new QTSCanceledError('Data preparation aborted');
  }
  run.onPrepared?.(state);
  return prepareJobId;
}
