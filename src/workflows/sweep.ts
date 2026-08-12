import {
  cancelSweep,
  executeSweep,
  getSweepResult,
  getSweepSensitivity,
  type ExecuteSweepAccepted,
  type ExecuteSweepRequest,
  type ExecuteSweepResult,
  type GetSweepResultData,
  type SweepHeatmap as ApiSweepHeatmap,
  type SweepHeatmapCell as ApiSweepHeatmapCell,
  type SweepMarginal as ApiSweepMarginal,
  type SweepMarginalPoint as ApiSweepMarginalPoint,
  type SweepProgress as ApiSweepProgress,
  type SweepRunRow as ApiSweepRunRow,
  type SweepSensitivity as ApiSweepSensitivity,
  type SweepSpecRequest,
  type WalkForwardFold as ApiWalkForwardFold,
  type WalkForwardResult as ApiWalkForwardResult,
} from '@qtsurfer/api-client';
import { QTSCanceledError, QTSError, QTSExecutionError } from '../errors';
import {
  buildStagePolicy,
  normalizeStatus,
  runStage,
  type StagePolicy,
} from '../internal/polling';
import { TICKER, compileStrategySource, prepareDataset } from '../internal/preparation';
import { requestFailed } from '../internal/requestError';
import type { BacktestStage } from './backtest';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * The metric a sweep optimizes, and the one its leaderboard and its
 * sensitivity surfaces are read against.
 *
 * One vocabulary throughout: the objective a {@link SweepRequest} is submitted
 * with is the objective the leaderboard is ranked by, and the one
 * {@link Sweep.sensitivity} aggregates unless a different one is asked for.
 *
 * - `'sharpe'` — risk-adjusted return; the platform default when a request names none.
 * - `'sortino'` — downside-risk-adjusted return.
 * - `'pnl'` — absolute net profit and loss.
 * - `'maxdd'` — maximum drawdown.
 */
export type SweepObjective = 'sharpe' | 'sortino' | 'pnl' | 'maxdd';

/**
 * How the parameter grid is turned into the list of vectors that actually run.
 *
 * - `'grid'` — every combination of every axis value. The platform default;
 *   cost is the product of the axis sizes.
 * - `'random'` — uniformly random draws from the grid, capped at
 *   {@link SweepRequest.samples}.
 * - `'lhs'` — Latin hypercube draws, which spread the sample more evenly than
 *   uniform random.
 *
 * `samples` is required by `'random'` and `'lhs'` and ignored by `'grid'`.
 */
export type SweepSampler = 'grid' | 'random' | 'lhs';

/**
 * How the ranked leaderboard is ordered.
 *
 * The **platform default is `'plateau'`**, so the order a sweep answers with is
 * *not* raw objective order unless you ask for it. A plateau score is the
 * objective of the worst run in a point's immediate neighbourhood, so a point
 * only ranks well when the region around it does too — which exists because
 * the highest raw score is very often a spike that does not survive the
 * parameters moving slightly.
 *
 * **What you request is not always what you get.** Read `ranking` on the
 * result to find out which ordering was actually applied: a sweep with no
 * stored parameter grid has no neighbourhood to score against and falls back
 * to `'raw'`, and a walk-forward sweep is always `'raw'` because its
 * leaderboard is one out-of-sample row per fold rather than a grid.
 *
 * This applies to the ranked view only. Alongside `order: 'natural'` it is
 * **ignored** — that view is always ordered by `runIx`.
 */
export type SweepRanking = 'plateau' | 'raw';

/**
 * Which view of a sweep's rows to read: the display leaderboard, or every row
 * in a stable order.
 *
 * - `'ranked'` — the platform default. Sorted, and capped at a display limit;
 *   `truncated` on the result is `true` when the cap actually bit, in which
 *   case rows exist that this view does not carry. This is the view
 *   {@link SweepRanking} applies to.
 * - `'natural'` — every available row, untruncated, in deterministic `runIx`
 *   order. The view to read when materialising durable trial rows rather than
 *   showing a top-N, and the only way to reach rows the ranked view dropped —
 *   {@link Sweep.results} reads it off an existing sweep without re-running it.
 *   {@link SweepRanking} is **ignored** here and the response reports `'raw'`;
 *   rank, plateau score and neighbour count belong to the ranked view and are
 *   not part of this one.
 */
export type SweepOrder = 'ranked' | 'natural';

/**
 * Sweep lifecycle as observed by the SDK, readable off {@link Sweep.state}.
 *
 * - `'executing'` — submitted and being polled.
 * - `'completed'` — finished. The platform's own status may still be `'PARTIAL'`.
 * - `'failed'` — the poll itself failed: transport, HTTP, or a stage timeout.
 * - `'canceled'` — the sweep was aborted and the platform reported it cancelled.
 */
export type SweepState = 'executing' | 'completed' | 'failed' | 'canceled';

/**
 * One strategy property and the values a sweep should try for it: either a
 * numeric range walked in fixed steps, or an explicit list.
 *
 * ```ts
 * const params: Record<string, ParamAxis> = {
 *   rsiPeriod: { from: 7, to: 28, step: 1 },
 *   useTrendFilter: { values: [true, false] },
 * };
 * ```
 *
 * The two shapes are mutually exclusive on the wire, and mixing them is a
 * request the platform rejects rather than reconciles. A list entry is a number
 * or a boolean — the axis of a boolean flag is `{ values: [true, false] }`, not
 * a range.
 */
export type ParamAxis =
  | {
      /** First value. */
      from: number;
      /** Last value the walk may reach. */
      to: number;
      /** Increment; must be greater than zero. */
      step: number;
    }
  | {
      /** The values to try; at least one. */
      values: Array<number | boolean>;
    };

/**
 * Opt a sweep into walk-forward validation.
 *
 * Attaching this changes what the sweep does, not just how much of it runs.
 * Instead of scoring every parameter vector once over the whole range, the data
 * is cut into sequential folds; each fold optimizes the whole grid on its own
 * window and then scores only its winner on the window immediately after — data
 * that winner was never chosen on. The question it answers is not "which
 * parameters won" but "does re-optimizing this periodically actually work".
 *
 * Omit it and nothing about the sweep changes, including the shape of the
 * response.
 *
 * **It costs folds × grid.** Four folds over a 500-point grid is roughly 2000
 * backtests where the plain sweep is 500, which is why it is opt-in. The
 * platform rejects the request outright when that product exceeds its sweep
 * budget.
 *
 * **It is a different sweep, not a variant of one.** Two requests that differ
 * only in this block do not deduplicate against each other.
 *
 * The answer arrives as `walkForward` on the {@link SweepResult} — see
 * {@link Sweep.result} for how to read it.
 */
export interface SweepWalkForward {
  /**
   * How many sequential optimize-then-score windows to run. Two is the floor
   * and the reason is structural rather than a tuning preference: parameter
   * drift is measured between consecutive fold winners, and a single fold has
   * no consecutive pair, so it would report the strongest possible stability
   * having measured nothing. The ceiling is a platform setting; exceeding it is
   * rejected.
   */
  folds: number;
  /**
   * Share of each fold's window spent optimizing, the rest being where its
   * winner is scored. Omit to take the platform default. Lower values leave
   * more data to score on and, on short sessions, are what let the requested
   * fold count tile the data at all. Must be within 10..90.
   */
  inSamplePct?: number;
}

// ---------------------------------------------------------------------------
// Platform models, re-exported so callers never have to reach for api-client
// ---------------------------------------------------------------------------

/**
 * What the platform answered when it accepted the sweep, exactly as it sent it
 * — see {@link Sweep.accepted} for the three fields that make it worth reading
 * before any result exists.
 */
export type SweepAccepted = ExecuteSweepAccepted;

/**
 * A sweep snapshot: status, progress, and the rows available for the selected
 * view. Resolved by {@link Sweep.result}, which is also where the semantics of
 * every field are documented.
 */
export type SweepResult = ExecuteSweepResult;

/**
 * The platform's own progress record for a running sweep, carried on
 * {@link SweepProgressEvent.snapshot}. Distinct from the event that wraps it:
 * this is what the server reported, the event is what the SDK emitted.
 *
 * Two of its fields are easy to add together by mistake. `aborted` counts
 * individual runs that executed and aborted — a row-level count. `failedShards`
 * counts whole units of work (shards, or folds on a walk-forward sweep) that
 * failed and will not be retried, having never reported anything. A shard that
 * dies before producing a single row leaves `aborted` at zero, which is exactly
 * why the second count exists; **summing them double-counts nothing and
 * describes nothing**.
 *
 * `retrying` is not a failure count either — those units failed on something
 * transient and are queued to be attempted again, so a sweep with a non-zero
 * value there is still expected to finish.
 *
 * `etaSeconds` is **omitted, never zero** when it cannot be computed: a sweep
 * with nothing finished has no observed rate to extrapolate from, and a zero
 * would read as "about to finish". When present it runs conservative — it
 * excludes queue wait entirely, and a sweep that spent part of its life being
 * retried will have diluted the rate it is derived from.
 */
export type SweepProgress = ApiSweepProgress;

/** One trial on a sweep's leaderboard. See {@link Sweep.result} for how to read it. */
export type SweepRunRow = ApiSweepRunRow;

/**
 * Sensitivity aggregates over a sweep's stored rows, returned by
 * {@link Sweep.sensitivity}. Marginals are always complete; the pair surfaces
 * may be capped, in which case `heatmapsTruncated` is `true`.
 */
export type SweepSensitivity = ApiSweepSensitivity;

/** One axis, with every other axis collapsed away. */
export type SweepMarginal = ApiSweepMarginal;

/** How the objective behaved at one value of one axis. */
export type SweepMarginalPoint = ApiSweepMarginalPoint;

/** The surface for one pair of axes, with all others collapsed away. */
export type SweepHeatmap = ApiSweepHeatmap;

/** One cell of a {@link SweepHeatmap}. */
export type SweepHeatmapCell = ApiSweepHeatmapCell;

/**
 * The walk-forward section of a {@link SweepResult}, present exactly when the
 * sweep was submitted with {@link SweepWalkForward}.
 *
 * **`paramDrift` absent is not zero.** The field is omitted whenever the figure
 * could not be computed — fewer than two folds finished, or no stored grid to
 * place the winners on — and zero is itself a meaningful reading there (winners
 * that never moved), so a placeholder would be indistinguishable from perfect
 * stability.
 */
export type WalkForwardResult = ApiWalkForwardResult;

/**
 * What one fold concluded. The out-of-sample row is the answer; the in-sample
 * figure is only there to be compared against it, since any grid produces a
 * flattering in-sample winner — that is what optimizing does. The gap between
 * them is the whole reading.
 */
export type WalkForwardFold = ApiWalkForwardFold;

// ---------------------------------------------------------------------------
// Request, options, progress
// ---------------------------------------------------------------------------

/**
 * A parameter sweep over one instrument and one window: the same strategy run
 * once per parameter vector, scored and ranked against a single objective.
 *
 * ```ts
 * const request: SweepRequest = {
 *   strategy: source,
 *   exchangeId: 'binance',
 *   instrument: 'BTC/USDT',
 *   from: '2026-01-01T00:00:00Z',
 *   to: '2026-02-01T00:00:00Z',
 *   params: {
 *     rsiPeriod: { from: 7, to: 28, step: 1 },
 *     useTrendFilter: { values: [true, false] },
 *   },
 *   objective: 'sharpe',
 * };
 * ```
 */
export interface SweepRequest {
  /** Strategy source code (Java), compiled once and reused by every trial. */
  strategy: string;
  /** Exchange id, e.g. `binance`. */
  exchangeId: string;
  /** Instrument symbol, e.g. `BTC/USDT`. */
  instrument: string;
  /** Range start (ISO-8601, ISO DATE, or BASIC ISO DATE). */
  from: string;
  /** Range end (same formats as `from`; must be later than `from`). */
  to: string;
  /** The grid: one {@link ParamAxis} per strategy property to vary. At least one. */
  params: Record<string, ParamAxis>;
  /**
   * How the grid becomes the list of vectors actually run. Omit to keep the
   * platform default, the full cross product.
   */
  sampler?: SweepSampler;
  /**
   * How many vectors to draw for `'random'` and `'lhs'`; ignored by `'grid'`.
   */
  samples?: number;
  /**
   * Reproducibility seed. Omit to let the platform generate one and report it
   * back on {@link Sweep.accepted}, so a randomly sampled sweep can be replayed
   * exactly by submitting the same seed again.
   */
  seed?: number;
  /**
   * The metric to optimize and rank by; omit to keep the platform default
   * (`'sharpe'`). It is also what {@link Sweep.sensitivity} aggregates unless
   * told otherwise.
   */
  objective?: SweepObjective;
  /**
   * Opt into walk-forward validation, which changes both what runs and the
   * shape of the answer. Omit to run an ordinary sweep.
   */
  walkForward?: SweepWalkForward;
}

/**
 * Emitted at stage transitions and after each poll of a running sweep.
 *
 * The `snapshot` is where the detail lives — see {@link SweepProgress}, whose
 * counts measure different things and must not be added together.
 */
export interface SweepProgressEvent {
  /** Current workflow stage. */
  stage: BacktestStage;
  /**
   * 0-100, computed from the runs finished out of the runs expected (`done` /
   * `total` on the snapshot, both run-level counts — not the shard counts,
   * which partition units of work rather than runs). Absent on stage
   * transitions before the first poll.
   */
  percent?: number;
  /**
   * Fraction (0-1) of the requested window that actually holds data, as
   * reported once preparation completes. Present only on the final `preparing`
   * event. Worth reading on a sweep in particular: a thinly covered window is
   * about to be scored once per parameter vector.
   */
  coverageRatio?: number;
  /**
   * The platform's progress record for the sweep. Present only on `executing`
   * events.
   */
  snapshot?: SweepProgress;
}

/** Tuning knobs for a {@link QTSurfer.sweep} invocation. */
export interface SweepOptions {
  /**
   * Ask the platform to stop the sweep between parameter vectors.
   *
   * **Aborting does not reject {@link Sweep.result}** — it resolves with
   * whatever was scored before the stop. That is a deliberate divergence from
   * `backtest()`, which rejects with `QTSCanceledError` when its run is
   * aborted; see {@link Sweep.result} for why. Aborting *before* the platform
   * has accepted the sweep — during compile, prepare or submission — rejects
   * the {@link QTSurfer.sweep} call itself with `QTSCanceledError`, since there
   * is no sweep yet and so no rows to keep.
   */
  signal?: AbortSignal;
  /** Called on stage transitions and after each poll with updated progress. */
  onProgress?: (p: SweepProgressEvent) => void;
  /**
   * Initial interval between polls. Default 2000ms, backed off up to
   * `maxPollIntervalMs`. Longer than a single backtest's, because a sweep is
   * many backtests and its leaderboard changes on the timescale of shards
   * finishing rather than ticks.
   */
  pollIntervalMs?: number;
  /** Upper bound for exponential backoff. Default 15000ms. */
  maxPollIntervalMs?: number;
  /**
   * Per-stage timeout. Default none. A sweep is many backtests, so the execute
   * stage legitimately outlasts anything a single run would take.
   */
  timeoutMs?: number;
  /**
   * How to order the leaderboard the poll reads. Omit to send no preference and
   * take the platform default, which is `'plateau'` — so leaving this unset
   * does **not** give you raw objective order. What was actually applied is
   * reported on the result. **Ignored entirely when `order` is `'natural'`**,
   * which is always ordered by `runIx`; the platform accepts both and answers
   * with the ordering it applied.
   */
  ranking?: SweepRanking;
  /**
   * Which view of the rows the background poll reads. Omit to take the platform
   * default, `'ranked'` — the sorted, display-capped leaderboard. `'natural'`
   * returns every available row untruncated.
   *
   * This only decides what {@link Sweep.result} resolves with. Reading the same
   * sweep another way afterwards — to reach the rows a `truncated` ranked view
   * dropped, say — is {@link Sweep.results}, which re-reads rather than
   * re-running.
   */
  order?: SweepOrder;
}

// ---------------------------------------------------------------------------
// Handle
// ---------------------------------------------------------------------------

/**
 * Handle for a running parameter sweep, returned by {@link QTSurfer.sweep} once
 * the platform has accepted it. The leaderboard keeps being polled in the
 * background.
 */
export interface Sweep {
  /** Server-side sweep identifier. */
  readonly sweepId: string;
  /**
   * The prepared dataset every trial ran against — the prepare jobId the
   * workflow resolved before submitting, which is also what addresses this
   * sweep on the wire.
   *
   * This is the value the workflow prepared with, not the acceptance echo of
   * it. {@link Sweep.accepted} carries the echo, unmodified, for anyone who
   * wants to compare the two.
   */
  readonly requestId: string;
  /** The compiled strategy every trial shares. */
  readonly strategyId: string;
  /**
   * What acceptance already answered, before a single trial has run, exactly as
   * the platform sent it.
   *
   * Three of its fields are the reason this is exposed rather than folded away:
   *
   * - `seed` — the effective seed, generated platform-side when the request
   *   omitted one. Submitting it again is what makes a randomly sampled sweep
   *   replayable.
   * - `queued` — `false` means an identical sweep already existed and nothing
   *   new was enqueued. The handle is still valid and still resolves; it is
   *   just reading a sweep this call did not start.
   * - `walkForward` — present exactly when this is a walk-forward sweep. It is
   *   the discriminator, and it is available here immediately, so code watching
   *   progress can branch on the answer's shape without waiting for
   *   {@link Sweep.result}.
   */
  readonly accepted: SweepAccepted;
  /**
   * Local snapshot of the sweep lifecycle; reading it does not contact the
   * server.
   */
  readonly state: SweepState;
  /**
   * Resolves with the final leaderboard once the sweep stops advancing.
   *
   * **This resolves on every terminal status, cancellation included** —
   * `'COMPLETED'`, `'PARTIAL'` and `'CANCELLED'` all hand back the result
   * rather than raising. That is a deliberate divergence from `backtest()`,
   * which rejects with `QTSCanceledError` when its run is aborted: cancelling a
   * sweep is documented as leaving completed rows readable, and throwing them
   * away would lose the only reason to cancel a sweep late rather than early.
   * Read `status` to find out which of the three you got. The promise rejects
   * only for transport failures, HTTP errors, and stage timeouts.
   *
   * `'PARTIAL'` means at least one unit of work died and its runs are simply
   * missing. There is no failed status for a sweep as a whole, so a sweep whose
   * every shard died is `'PARTIAL'` with an empty leaderboard — check
   * `leaderboardSize` before reading anything into a top row.
   *
   * ### Reading the leaderboard
   *
   * **The default order is not the raw objective order.** It is plateau order,
   * and `ranking` on the result says which was actually applied — not always
   * the one requested, because a sweep with no stored parameter grid cannot be
   * plateau-ranked and falls back to raw. See {@link SweepRanking}.
   *
   * **The default view is capped.** When `truncated` is `true`, rows exist that
   * the leaderboard does not carry — `leaderboardSize` counts what is
   * available. {@link Sweep.results} with `order: 'natural'` is what returns
   * all of them, in `runIx` order and with no ranking applied. That is a
   * re-read of this same sweep, not a second one.
   *
   * **`plateauScore` and `neighbourCount` are read together.** A neighbour
   * count of `0` means the point had no neighbours in the grid to compare
   * against, so its plateau score is unevidenced rather than confirmed — on its
   * own it is indistinguishable from a genuinely robust one.
   *
   * **`deflatedSharpe`** is the probability that a row's Sharpe reflects real
   * edge rather than the best draw from however many vectors were tried. Around
   * 0.95 and up it survives the multiple-testing correction; near 0.5 or below
   * it is not distinguishable from the best of a pile of coin flips. It is
   * absent on aborted runs, and on sweeps with too few trials to establish any
   * dispersion to deflate against.
   *
   * **`pbo`** is the probability of backtest overfitting for the sweep as a
   * whole: how often the configuration that won in-sample lands below median
   * out-of-sample. Above roughly 0.5 the sweep is selecting noise, and that
   * verdict is about the search, not about any one row — a high value
   * discredits the top row however good it looks. It is computed once the last
   * unit of work finishes, so it is absent while the sweep is still running and
   * on sweeps too small for the statistic to mean anything.
   *
   * ### A walk-forward sweep answers in a different shape
   *
   * `walkForward` is the discriminator, and it appears as soon as the sweep is
   * accepted — before any fold has finished — so it is safe to branch on while
   * polling (it is also on {@link Sweep.accepted}). When it is present, the
   * leaderboard is one row per *completed fold*: that fold's winner as it
   * scored out-of-sample, with **`runIx` carrying the fold index rather than a
   * position in the grid**. No plateau score, deflated Sharpe or PBO figure is
   * reported for one — the out-of-sample numbers are already the honest
   * measurement. See {@link WalkForwardResult} for why an absent `paramDrift`
   * is not a zero.
   */
  readonly result: Promise<SweepResult>;
  /**
   * Re-read this sweep's rows under a different view.
   *
   * **This is a read, not a re-run.** It compiles nothing, prepares nothing and
   * submits nothing: the same sweep is asked for its rows again with different
   * query parameters, so no second sweep is created and nothing is enqueued.
   * The view a {@link SweepOptions} chose applies to the background poll behind
   * {@link Sweep.result}; this is how to look at the same sweep another way
   * afterwards.
   *
   * **It is the route to rows the ranked view dropped.** When `truncated` is
   * `true` on a result, rows exist that the leaderboard does not carry;
   * `order: 'natural'` returns every available row untruncated, in
   * deterministic `runIx` order.
   *
   * **`ranking` is ignored when `order` is `'natural'`** — that view is always
   * ordered by `runIx`, and the response reports `'raw'`. The platform accepts
   * both rather than rejecting the pair, and answers with the ordering it
   * actually applied.
   *
   * Readable while the sweep is still running, in which case it returns the
   * rows finished so far — exactly like {@link Sweep.sensitivity}. Like every
   * handle-scoped call, it does not take part in an
   * {@link AuthenticatedClient}'s refresh-on-401 policy.
   *
   * @param view which view to read; an absent property takes the platform
   * default (`order: 'ranked'`, `ranking: 'plateau'`)
   * @throws QTSError on any non-2xx response, with the HTTP status on `status`.
   */
  results(view?: { order?: SweepOrder; ranking?: SweepRanking }): Promise<SweepResult>;
  /**
   * How the objective moves as each parameter moves — the question a
   * leaderboard cannot answer. A leaderboard says which point won; a sweep can
   * spend its whole budget on an axis that never moved the objective at all,
   * and the top rows hide that completely.
   *
   * A *marginal* takes one axis and collapses every other one: for each value
   * of that axis it aggregates every run that used it, whatever the rest of the
   * parameters were. A flat marginal means the axis did not matter over the
   * range swept. `best`, `mean` and `worst` are all reported because them
   * disagreeing is the signal — a value with a high best and a poor mean only
   * works in specific company, which is an interaction, and a single number
   * would hide it. A *heatmap* does the same over a pair of axes, where that
   * interaction is visible directly.
   *
   * **Check `heatmapsTruncated`.** Marginals are always complete; the pair
   * surfaces are quadratic in the axis count and may be capped to stay inside
   * the response budget. When the flag is `true`, at least one pair was left
   * out, so the list you have is not the full set of interactions. This method
   * hands back the whole {@link SweepSensitivity} rather than just its surfaces
   * precisely so that flag cannot be lost on the way out.
   *
   * Readable while the sweep is still running, in which case the aggregates
   * describe the runs finished so far and `rowsAnalysed` says how many that
   * was. Aborted runs are excluded throughout: a run that threw measured
   * nothing, and counting it as a bad outcome would invent evidence against a
   * parameter value that was never really tested.
   *
   * Like every handle-scoped call, this does not take part in an
   * {@link AuthenticatedClient}'s refresh-on-401 policy.
   *
   * @param objective which metric to aggregate; omit to use the objective the
   * sweep was submitted with
   * @throws QTSError on any non-2xx response, with the HTTP status on `status`.
   */
  sensitivity(objective?: SweepObjective): Promise<SweepSensitivity>;
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

/** Initial interval between polls of a sweep's leaderboard. */
const DEFAULT_POLL_INTERVAL_MS = 2000;
/** Backoff ceiling for a sweep's leaderboard poll. */
const DEFAULT_MAX_POLL_INTERVAL_MS = 15000;

/**
 * Orchestrate compile → prepare → executeSweep, then poll the leaderboard until
 * the sweep stops advancing.
 *
 * One call, not composable stages, and deliberately so: the execute-sweep
 * endpoint is addressed by the id of an already-prepared dataset, so a
 * stage-level API would hand dataset lifecycle to the caller for no gain.
 * Preparing is idempotent — the same instrument and window always resolve to
 * the same job — so preparing on every sweep duplicates no work.
 */
export async function sweep(req: SweepRequest, opts: SweepOptions = {}): Promise<Sweep> {
  validateRequest(req);
  const policy = buildStagePolicy(opts, DEFAULT_POLL_INTERVAL_MS, DEFAULT_MAX_POLL_INTERVAL_MS);

  opts.onProgress?.({ stage: 'compiling' });
  const strategyId = await compileStrategySource(req.strategy, opts.signal);

  opts.onProgress?.({ stage: 'preparing' });
  const requestId = await prepareData(req, policy, opts);

  opts.onProgress?.({ stage: 'executing' });
  const { data, error } = await executeSweep({
    path: { exchangeId: req.exchangeId, type: TICKER, requestId },
    body: buildSweepBody(req, strategyId),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (error) throw new QTSExecutionError('Sweep submission failed', error);
  if (!data?.sweepId) throw new QTSExecutionError('Missing sweepId in executeSweep response');

  // The handle addresses the sweep with the requestId of the dataset just prepared — the value
  // this workflow already knows — rather than the acceptance echo of it. `data` is stored as the
  // server sent it; nothing is written back onto a generated response model.
  return createHandle(req, opts, policy, data, requestId, strategyId);
}

/**
 * Reject the request shapes the platform would only reject over the network.
 * Same set as the sibling Java SDK validates, so both answer the same question
 * the same way.
 */
function validateRequest(req: SweepRequest): void {
  const names = Object.keys(req.params ?? {});
  if (names.length === 0) {
    throw new QTSError('sweep: params must hold at least one axis');
  }
  for (const name of names) {
    const axis = req.params[name];
    if ('values' in axis) {
      if (axis.values.length === 0) {
        throw new QTSError(`sweep: axis "${name}" must hold at least one value`);
      }
    } else if (!(axis.step > 0)) {
      throw new QTSError(`sweep: axis "${name}" needs step > 0, got ${axis.step}`);
    }
  }

  const wf = req.walkForward;
  if (!wf) return;
  if (wf.folds < 2) {
    throw new QTSError(`sweep: walkForward.folds must be >= 2, got ${wf.folds}`);
  }
  if (wf.inSamplePct !== undefined && (wf.inSamplePct < 10 || wf.inSamplePct > 90)) {
    throw new QTSError(
      `sweep: walkForward.inSamplePct must be within 10..90, got ${wf.inSamplePct}`,
    );
  }
}

function prepareData(
  req: SweepRequest,
  policy: StagePolicy,
  opts: SweepOptions,
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
      // A thinly covered window is about to be scored once per parameter vector, so the
      // coverage ratio is worth at least as much here as on a single backtest.
      onPrepared: (state) =>
        opts.onProgress?.({
          stage: 'preparing',
          percent: 100,
          coverageRatio: state.coverageRatio,
        }),
    },
  );
}

function buildSweepBody(req: SweepRequest, strategyId: string): ExecuteSweepRequest {
  const spec: SweepSpecRequest = { params: req.params };
  if (req.sampler !== undefined) spec.sampler = req.sampler;
  if (req.samples !== undefined) spec.samples = req.samples;
  if (req.seed !== undefined) spec.seed = req.seed;
  if (req.objective !== undefined) spec.objective = req.objective;

  const body: ExecuteSweepRequest = { strategyId, sweep: spec };
  if (req.walkForward) {
    body.walkForward = {
      folds: req.walkForward.folds,
      ...(req.walkForward.inSamplePct !== undefined
        ? { inSamplePct: req.walkForward.inSamplePct }
        : {}),
    };
  }
  return body;
}

function createHandle(
  req: SweepRequest,
  opts: SweepOptions,
  policy: StagePolicy,
  accepted: SweepAccepted,
  requestId: string,
  strategyId: string,
): Sweep {
  const sweepId = accepted.sweepId;
  const path = { exchangeId: req.exchangeId, type: TICKER, requestId, sweepId };
  let state: SweepState = 'executing';

  const withQuery = viewQuery(opts);

  const result = (async () => {
    try {
      // Deliberately runs without `opts.signal`: aborting a sweep must not stop the poll, because
      // the rows already scored are only reachable by polling on until the platform reports the
      // sweep CANCELLED. The abort listener below asks the platform to stop instead.
      const finalResult = await runStage(
        policy,
        async ({ signal }) => {
          const res = await getSweepResult({ path, ...withQuery, signal });
          if (res.error) throw new QTSExecutionError('Sweep result request failed', res.error);
          if (!res.data) throw new QTSExecutionError('Empty sweep result response');
          return res.data;
        },
        {
          ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
          onEachAttempt: (r) => {
            const percent = percentOf(r);
            opts.onProgress?.({
              stage: 'executing',
              ...(percent !== undefined ? { percent } : {}),
              snapshot: r.progress,
            });
          },
        },
      );
      state = normalizeStatus(finalResult.status) === 'aborted' ? 'canceled' : 'completed';
      return finalResult;
    } catch (err) {
      state = err instanceof QTSCanceledError ? 'canceled' : 'failed';
      throw err;
    }
  })();
  // A handle whose result is never awaited must not take the process down with an unhandled
  // rejection; the caller still sees the failure on their own `await`.
  void result.catch(() => undefined);

  const { signal } = opts;
  if (signal) {
    const requestCancel = (): void => {
      // Only ever 'executing' → 'canceled'; a cancel that lands after the last unit of work has
      // finished changes nothing, and the poll's own completion settles the state either way.
      if (state === 'executing') state = 'canceled';
      void cancelSweep({ path }).catch(() => undefined);
    };
    if (signal.aborted) {
      requestCancel();
    } else {
      signal.addEventListener('abort', requestCancel, { once: true });
      const detach = (): void => signal.removeEventListener('abort', requestCancel);
      void result.then(detach, detach);
    }
  }

  return {
    sweepId,
    requestId,
    strategyId,
    accepted,
    get state() {
      return state;
    },
    result,
    results: async (view = {}): Promise<SweepResult> => {
      // A read of the sweep that already exists: same path, different query. Nothing here
      // compiles, prepares or submits, so asking for the natural view costs one request rather
      // than a second pipeline.
      const res = await getSweepResult({ path, ...viewQuery(view) });
      if (res.error) {
        throw requestFailed('sweep results call', res.error, res.response?.status);
      }
      if (!res.data) throw new QTSError('Empty sweep result response');
      return res.data;
    },
    sensitivity: async (objective?: SweepObjective): Promise<SweepSensitivity> => {
      const res = await getSweepSensitivity({
        path,
        ...(objective !== undefined ? { query: { objective } } : {}),
      });
      if (res.error) {
        throw requestFailed('sweep sensitivity call', res.error, res.response?.status);
      }
      if (!res.data) throw new QTSError('Empty sweep sensitivity response');
      return res.data;
    },
  };
}

/**
 * The `order` / `ranking` query for one view of a sweep's rows.
 *
 * `ranking` is sent as asked even alongside `order: 'natural'`, which ignores
 * it: the platform accepts both and answers with the ordering it actually
 * applied, which is more informative than the SDK silently dropping the
 * preference. Left off entirely when neither is set, so a default read carries
 * no query string and takes the platform's own defaults.
 */
function viewQuery(view: { order?: SweepOrder; ranking?: SweepRanking }): {
  query?: NonNullable<GetSweepResultData['query']>;
} {
  const query: NonNullable<GetSweepResultData['query']> = {};
  if (view.order !== undefined) query.order = view.order;
  if (view.ranking !== undefined) query.ranking = view.ranking;
  return Object.keys(query).length > 0 ? { query } : {};
}

/**
 * Percentage of the sweep's runs that have finished. Deliberately computed from
 * the run-level counts: the shard counts alongside them partition units of
 * work, not runs, and mixing the two reports a percentage of neither.
 */
function percentOf(result: SweepResult): number | undefined {
  const p = result.progress;
  if (!p || !(p.total > 0)) return undefined;
  return (p.done / p.total) * 100;
}
