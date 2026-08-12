import {
  ExponentialBackoff,
  TaskCancelledError,
  TimeoutStrategy,
  handleWhenResult,
  retry,
  timeout,
  wrap,
  type ICancellationContext,
  type IPolicy,
} from 'cockatiel';
import { QTSCanceledError, QTSTimeoutError } from '../errors';

/**
 * The stable form of a backend job/sweep status, so the rest of the SDK can
 * reason about it regardless of OpenAPI spec drift (the live API sometimes
 * returns lowercase values like `queued` / `completed` / `failed`).
 *
 * @internal
 */
export type NormalizedStatus = 'in-progress' | 'completed' | 'failed' | 'aborted';

/**
 * Normalize a raw status value.
 *
 * Only the terminal statuses end a poll loop. Everything else — including a
 * **missing** status — means "keep asking": the API answers `202` with an empty body when a
 * job is known but its result is not readable yet, and that response carries no state at all.
 * Mapping absent to in-progress is what makes a 202 continue the loop under its timeout
 * instead of being mistaken for a finished job with no data.
 *
 * @internal
 */
export function normalizeStatus(raw: unknown): NormalizedStatus {
  const value = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (value === 'completed') return 'completed';
  // A sweep that finishes with at least one shard dead reports `partial`, and that is
  // terminal: the rows it did produce are readable and nothing more is coming, so treating it
  // as in-progress would poll a finished sweep forever. `PARTIAL` exists only on the two sweep
  // schemas (`ExecuteSweepResult.status` and `SweepSensitivity.status`) and is absent from
  // `JobState`, so mapping it here cannot reach the prepare or execute paths. It folds into
  // `completed` because this enum drives the poll loop — stop asking, hand the response back —
  // and the caller reads `partial` off the response itself, where the distinction survives.
  if (value === 'partial') return 'completed';
  if (value === 'failed') return 'failed';
  if (value === 'aborted' || value === 'cancelled' || value === 'canceled') {
    return 'aborted';
  }
  // new / started / queued / running / absent (202) / anything else → still running
  return 'in-progress';
}

/** The retry-with-backoff policy one workflow stage polls under. @internal */
export type StagePolicy = IPolicy<ICancellationContext, never>;

/** Poll tuning shared by every workflow's options object. @internal */
export interface PollTuning {
  pollIntervalMs?: number;
  maxPollIntervalMs?: number;
  timeoutMs?: number;
}

/**
 * Build the poll policy for a workflow's stages.
 *
 * The defaults are a per-workflow argument rather than a constant, because how
 * often it is worth asking depends on what is being watched: a single backtest
 * advances tick by tick, while a sweep's leaderboard changes on the timescale
 * of shards finishing.
 *
 * @param opts caller overrides
 * @param defaultPollMs initial interval when the caller sets none
 * @param defaultMaxPollMs backoff ceiling when the caller sets none
 *
 * @internal
 */
export function buildStagePolicy(
  opts: PollTuning,
  defaultPollMs: number,
  defaultMaxPollMs: number,
): StagePolicy {
  const retryPolicy = retry(
    handleWhenResult((r) => {
      const status = (r as { status?: unknown } | undefined)?.status;
      return normalizeStatus(status) === 'in-progress';
    }),
    {
      maxAttempts: Number.MAX_SAFE_INTEGER,
      backoff: new ExponentialBackoff({
        initialDelay: opts.pollIntervalMs ?? defaultPollMs,
        maxDelay: opts.maxPollIntervalMs ?? defaultMaxPollMs,
      }),
    },
  );

  return opts.timeoutMs
    ? wrap(timeout(opts.timeoutMs, TimeoutStrategy.Cooperative), retryPolicy)
    : retryPolicy;
}

/** How one call to {@link runStage} is cancelled and reported. @internal */
export interface StageRun<T> {
  /**
   * Aborts the stage, surfacing as {@link QTSCanceledError}. Omit it to run a
   * stage the caller's signal must **not** interrupt.
   */
  signal?: AbortSignal;
  /** Only used to render the timeout message. */
  timeoutMs?: number;
  /** Called with every attempt's result, terminal or not. */
  onEachAttempt?: (r: T) => void;
}

/**
 * Poll `fetchFn` under `policy` until its result stops normalizing to
 * `in-progress`, then return that result.
 *
 * @internal
 */
export async function runStage<T>(
  policy: StagePolicy,
  fetchFn: (ctx: ICancellationContext) => Promise<T>,
  run: StageRun<T> = {},
): Promise<T> {
  try {
    return await policy.execute(async (ctx) => {
      if (run.signal?.aborted) throw new QTSCanceledError('Workflow aborted');
      const result = await fetchFn(ctx);
      run.onEachAttempt?.(result);
      if (run.signal?.aborted) throw new QTSCanceledError('Workflow aborted');
      return result;
    }, run.signal);
  } catch (err) {
    if (err instanceof QTSCanceledError) throw err;
    if (err instanceof TaskCancelledError) {
      if (run.signal?.aborted) throw new QTSCanceledError('Workflow aborted', err);
      throw new QTSTimeoutError(`Stage exceeded ${run.timeoutMs}ms`, err);
    }
    if (run.signal?.aborted) throw new QTSCanceledError('Workflow aborted', err);
    throw err;
  }
}
