import { client as apiClient } from '@qtsurfer/api-client';
import {
  backtest,
  type BacktestOptions,
  type BacktestRequest,
  type BacktestResult,
} from './workflows/backtest';
import {
  listExchanges,
  listInstruments,
  type Exchange,
  type InstrumentDetail,
  type InstrumentSegment,
} from './workflows/catalog';
import {
  downloadKlines,
  downloadTickers,
  type DownloadFormat,
} from './workflows/downloads';
import {
  getStrategy,
  validateStrategy as runValidateStrategy,
  listStrategies,
  deleteStrategy as runDeleteStrategy,
  getStrategyCode,
  type StrategyState,
  type StrategyValidation,
  type StrategySummary,
} from './workflows/strategies';
import {
  sweep as runSweep,
  type Sweep,
  type SweepOptions,
  type SweepRequest,
} from './workflows/sweep';

/** Configuration for {@link QTSurfer}. */
export interface QTSurferOptions {
  /** Base URL of the QTSurfer API, e.g. `https://api.qtsurfer.com/v1`. */
  baseUrl: string;
  /**
   * Pre-obtained bearer token. When omitted, requests go out unauthenticated.
   * Use the `authenticate()` helper instead of this constructor if you want
   * the SDK to exchange an apikey for a JWT and refresh it on `401` for you.
   */
  token?: string;
  /** Inject a custom `fetch` (Node 20+, browser, or test mock). */
  fetch?: typeof fetch;
}

/** Selects one hour of tickers or klines for a single instrument. */
export interface DownloadHourArgs {
  /** Exchange id, e.g. `binance`. */
  exchangeId: string;
  /** Base asset of the instrument, e.g. `BTC`. */
  base: string;
  /** Quote asset of the instrument, e.g. `USDT`. */
  quote: string;
  /** Hour selector in `YYYY-MM-DDTHH` (UTC). */
  hour: string;
  /** Wire format. Defaults to `'lastra'`. */
  format?: DownloadFormat;
}

/**
 * Thin, stateless wrapper over `@qtsurfer/api-client` that exposes the SDK's
 * workflow methods (`backtest`, `sweep`, `tickers`, `klines`), the platform catalog
 * (`exchanges`, `instruments`) and the strategy surface (`validateStrategy`,
 * `strategy`, `strategies`, `deleteStrategy`, `strategyCode`). Constructing an
 * instance reconfigures the underlying api-client singleton, so avoid
 * holding two `QTSurfer`s with different `baseUrl`s or tokens alive in the
 * same process — they will race. Prefer the `authenticate()` helper over
 * this constructor unless you already manage the JWT lifecycle yourself.
 */
export class QTSurfer {
  constructor(options: QTSurferOptions) {
    apiClient.setConfig({
      baseUrl: options.baseUrl,
      ...(options.token
        ? { headers: { Authorization: `Bearer ${options.token}` } }
        : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  /**
   * Run a backtest end-to-end: compile the strategy, prepare the requested
   * data range, execute it, and resolve with the result once execution
   * completes. See the underlying `backtest` workflow for the
   * stage-by-stage error and retry semantics.
   */
  backtest(req: BacktestRequest, opts?: BacktestOptions): Promise<BacktestResult> {
    return backtest(req, opts);
  }

  /**
   * Run the full compile → prepare → executeSweep pipeline and resolve once the
   * platform has accepted the sweep, handing back a {@link Sweep} that keeps
   * polling the leaderboard in the background.
   *
   * The whole sweep is one call because the execute-sweep endpoint is addressed
   * by the id of an already-prepared dataset: exposing the stages separately
   * would hand dataset lifecycle to the caller and buy nothing. Preparing is
   * idempotent, so sweeping the same window twice prepares it once.
   *
   * The returned promise rejects with {@link QTSStrategyCompileError} if
   * compilation fails, {@link QTSPreparationError} if data preparation fails,
   * {@link QTSExecutionError} if the platform rejects the sweep — an expanded
   * grid over the server limit, or a walk-forward request whose fold count
   * multiplies past the sweep budget, both answer `400` — {@link QTSTimeoutError}
   * if a stage exceeds `timeoutMs`, or {@link QTSCanceledError} if the caller's
   * signal fires before the sweep is accepted. A plain {@link QTSError} means
   * the request itself is malformed (an empty grid, a non-positive `step`, a
   * walk-forward block with fewer than two folds) and never reached the network.
   *
   * What the sweep *found* arrives through {@link Sweep.result}, which is also
   * where the semantics of the leaderboard are documented. Acceptance already
   * answers three things worth reading before any result exists — the effective
   * seed, whether this submission enqueued anything, and whether this is a
   * walk-forward sweep — see {@link Sweep.accepted}.
   *
   * ```ts
   * const handle = await qts.sweep({
   *   strategy: source,
   *   exchangeId: 'binance',
   *   instrument: 'BTC/USDT',
   *   from: '2026-01-01T00:00:00Z',
   *   to: '2026-02-01T00:00:00Z',
   *   params: { rsiPeriod: { from: 7, to: 28, step: 1 } },
   * });
   * const leaderboard = await handle.result;
   * ```
   */
  sweep(req: SweepRequest, opts?: SweepOptions): Promise<Sweep> {
    return runSweep(req, opts);
  }

  /**
   * Download one hour of raw tickers for an instrument as a {@link Blob}.
   * Defaults to Lastra; pass `{ format: 'parquet' }` for Parquet.
   */
  tickers(args: DownloadHourArgs): Promise<Blob> {
    return downloadTickers(args);
  }

  /** Download one hour of klines for an instrument as a {@link Blob}. */
  klines(args: DownloadHourArgs): Promise<Blob> {
    return downloadKlines(args);
  }

  /**
   * List the exchanges the platform serves. Each `id` is what every other
   * method takes as `exchangeId`.
   *
   * @throws QTSError on any non-2xx response, with the HTTP status on
   * `status`.
   */
  exchanges(): Promise<Exchange[]> {
    return listExchanges();
  }

  /**
   * List an exchange's instruments, each with the per-data-type `coverage`
   * that says which date windows are actually downloadable.
   *
   * Omitting `segment` asks for the exchange's **default** segment, which is
   * `'spot'` today. The API answers with a HAL envelope that this method
   * unwraps to the instrument array, so the envelope's `meta.segment`,
   * `meta.updatedAt` and segment-discovery `_links` do not reach you: if you
   * need certainty about which segment you are looking at, pass `segment`
   * explicitly rather than relying on the default.
   *
   * @param exchangeId exchange identifier, e.g. `binance`
   * @throws QTSError on any non-2xx response, with the HTTP status on
   * `status`.
   */
  instruments(
    exchangeId: string,
    segment?: InstrumentSegment,
  ): Promise<InstrumentDetail[]> {
    return listInstruments(exchangeId, segment);
  }

  /**
   * Ask the platform to check that a registered strategy can actually run:
   * it instantiates the compiled class and drives it through a bounded
   * synthetic series, so a wiring fault surfaces here instead of at the first
   * backtest.
   *
   * **Idempotent, and two-outcome.** `queued: false` means a verdict already
   * existed for the current compilation and came back unchanged in `state` —
   * nothing was queued. `queued: true` means a check was just started, and is
   * **not** terminal: poll {@link QTSurfer.strategy} until `validation`
   * leaves `'pending'`. The discriminant reports whether work was *started*,
   * not whether a verdict *exists*, because a `queued: false` answer can
   * itself carry `validation: 'pending'` from a check an earlier call queued;
   * `state.validation` is what tells you that.
   *
   * **Poll with a deadline of your own.** `'pending'` is not guaranteed to
   * resolve — a queued check can go unreported for far longer than one takes,
   * which the platform eventually flags as `validationStalled`. Nothing about
   * the strategy is disproved when that happens, but a caller that waits for
   * a terminal verdict without a timeout can wait forever. This SDK ships no
   * polling helper for that reason: the timeout is the caller's policy.
   *
   * Whatever the verdict, it is a floor rather than a guarantee — see
   * {@link StrategyState}.
   *
   * @param strategyId the id returned when the strategy was compiled
   * @throws QTSError on any non-2xx response; a `404` (carried on `status`)
   * means no such registered strategy for this caller.
   */
  validateStrategy(strategyId: string): Promise<StrategyValidation> {
    return runValidateStrategy(strategyId);
  }

  /**
   * Read everything the platform records about a strategy: whether it is
   * registered at all, its validation verdict, the market data its compiled
   * class requires, and any engine notices the check raised. This is what to
   * poll after {@link QTSurfer.validateStrategy} returns `queued: true`, and
   * the only place a verdict is read from.
   *
   * Check `compiledAt` against `validatedAt` before trusting a verdict: the
   * strategy may have been recompiled since it was recorded, in which case
   * the verdict describes bytecode that is no longer what would run.
   * See {@link StrategyState} for why even a fresh `'passed'` is a floor
   * rather than a guarantee.
   *
   * @param strategyId the id returned when the strategy was compiled
   * @throws QTSError on any non-2xx response. A `404` (carried on `status`)
   * means exactly one thing — no such registered strategy for this caller.
   * It is never a stale or expired answer.
   */
  strategy(strategyId: string): Promise<StrategyState> {
    return getStrategy(strategyId);
  }

  /**
   * List every strategy you have registered and not deleted, most recently
   * compiled first. Never `404`s — an empty array means you have none.
   * Each entry deliberately omits `validation`; check a specific strategy's
   * verdict with {@link QTSurfer.strategy}. See {@link StrategySummary}.
   *
   * @throws QTSError on any non-2xx response, with the HTTP status on
   * `status`.
   */
  strategies(): Promise<StrategySummary[]> {
    return listStrategies();
  }

  /**
   * Release a registered strategy: removes it from both {@link
   * QTSurfer.strategy} and {@link QTSurfer.strategies}.
   *
   * Backtests already run against this strategy are unaffected, and
   * re-submitting the same source afterwards registers a **new** strategy
   * with a **new** id rather than undeleting this one. Deleting your own
   * copy of a strategy never affects anyone else's copy of the same source
   * (e.g. a shared/marketplace listing).
   *
   * @param strategyId the id returned when the strategy was compiled
   * @throws QTSError on any non-2xx response; a `404` (carried on `status`)
   * means no such registered strategy for this caller.
   */
  deleteStrategy(strategyId: string): Promise<void> {
    return runDeleteStrategy(strategyId);
  }

  /**
   * Read back the exact source last submitted for a strategy id, whitespace
   * and comments included.
   *
   * A `404` (carried on `status`) covers two indistinguishable cases: the id
   * was never registered by you, or it resolves only through a shared/
   * marketplace reference that carries no source of its own.
   *
   * @param strategyId the id returned when the strategy was compiled
   */
  strategyCode(strategyId: string): Promise<string> {
    return getStrategyCode(strategyId);
  }

  // Future surface:
  //   TTL cache for exchanges / instruments
  //   jobs: { cancel, stream, result }
}
