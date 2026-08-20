import {
  getStrategy as apiGetStrategy,
  validateStrategy as apiValidateStrategy,
  listStrategies as apiListStrategies,
  deleteStrategy as apiDeleteStrategy,
  getStrategyCode as apiGetStrategyCode,
  type StrategyState as ApiStrategyState,
  type StrategySummary as ApiStrategySummary,
} from '@qtsurfer/api-client';
import { QTSError } from '../errors';
import { requestFailed } from '../internal/requestError';

/**
 * Everything the platform records about a registered strategy. Alias for
 * api-client's `StrategyState`.
 *
 * `validation` is the verdict and is one of:
 *
 * - `'not_validated'` — registered, never checked.
 * - `'pending'` — a check was asked for and has not answered yet.
 * - `'passed'` — the class loaded and survived its first event.
 * - `'failed'` — it did not; `detail` says how.
 *
 * **`'passed'` is a floor, not a guarantee.** It means the compiled class
 * could be instantiated and got through the first event of a short synthetic
 * run — not the caller's instrument, not the caller's window, and not the
 * rest of the run. It says nothing about whether the strategy is correct,
 * profitable, or safe to run at scale. `dryRunIncomplete` marks a check that
 * ran out of its budget, which makes a `'passed'` verdict a lower floor
 * still, and makes an empty `notices` list no longer a clean bill of health.
 *
 * A verdict describes the bytecode that existed when it was recorded:
 * `compiledAt` newer than `validatedAt` means the strategy was recompiled
 * afterwards and the verdict no longer describes what would run.
 *
 * `_links.code`, when present, is a discovery link to this strategy's raw
 * source (`GET /strategy/{strategyId}/code` — the same thing
 * {@link QTSurfer.strategyCode} fetches by id, so there is no need to follow
 * the link yourself). It is present on a full `StrategyState` body — this
 * function's result, and {@link QTSurfer.validateStrategy}'s already-validated
 * `200` — and **absent** from that same operation's `queued: true` (`202`)
 * outcome, which is a deliberately partial stub. This field passes through
 * unmodified from api-client, so it needs no unwrapping on the SDK's part.
 */
export type StrategyState = ApiStrategyState;

/**
 * Outcome of {@link QTSurfer.validateStrategy} — the SDK's rendering of the
 * two answers that operation has, which the response body alone cannot tell
 * apart.
 *
 * - `queued: false` — a verdict already existed for the current compilation
 *   and comes back in `state` unchanged; nothing new was queued. This is
 *   **not** the same as "terminal": a check queued by an earlier call can
 *   still be running, so read `state.validation` rather than treating
 *   `queued: false` as "there is an answer".
 * - `queued: true` — a check was just queued. Nothing is known yet; poll
 *   {@link QTSurfer.strategy} until `validation` leaves `'pending'`.
 */
export type StrategyValidation =
  | { queued: false; strategyId: string; state: StrategyState }
  | { queued: true; strategyId: string; state?: undefined };

/**
 * Ask the platform to check that a registered strategy can actually run: it
 * instantiates the compiled class and drives it through a bounded synthetic
 * series, so a wiring fault surfaces here instead of at the first backtest.
 *
 * **Idempotent, and two-outcome.** If a verdict already exists for the
 * current compilation it is returned unchanged and nothing is queued
 * (`queued: false`); otherwise a check is queued (`queued: true`) and this
 * call is *not* terminal — poll {@link QTSurfer.strategy} until `validation`
 * is `'passed'` or `'failed'`. Because a `queued: false` answer can itself carry
 * `validation: 'pending'` (a check an earlier call queued), the discriminant
 * tells you whether work was *started*, not whether a verdict *exists*;
 * `state.validation` is what tells you that.
 *
 * **Poll with a deadline of your own.** `'pending'` is not guaranteed to
 * resolve: a queued check can go unreported for far longer than one takes,
 * which the platform eventually flags as `validationStalled` on the strategy.
 * Nothing about the strategy is disproved when that happens — the check
 * simply did not run — but a caller that waits for a terminal verdict without
 * a timeout can wait forever. This SDK deliberately ships no polling helper
 * for that reason; the timeout is the caller's policy to set.
 *
 * Whatever the verdict, remember it is a floor rather than a guarantee — see
 * {@link StrategyState}.
 *
 * @param strategyId the id returned when the strategy was compiled
 * @throws QTSError on any non-2xx response; a `404` (carried on `status`)
 * means no such registered strategy for this caller.
 */
export async function validateStrategy(strategyId: string): Promise<StrategyValidation> {
  const { data, error, response } = await apiValidateStrategy({ path: { strategyId } });
  if (error) throw requestFailed('strategy validation request', error, response?.status);
  // The two outcomes are distinguishable only by status: a `200` body is a
  // full StrategyState whose `validation` may itself be `'pending'`, so the
  // payload cannot be used to tell "queued just now" from "already queued".
  // The queued branch echoes back the caller's own id rather than reading one
  // out of the body, because an accepted-but-not-done response on this API is
  // not guaranteed to carry a body at all.
  if (response?.status === 202) return { queued: true, strategyId };
  if (!data) throw new QTSError('Empty strategy validation response');
  return { queued: false, strategyId, state: data as StrategyState };
}

/**
 * Read everything the platform records about a strategy: whether it is
 * registered at all, its validation verdict, the market data its compiled
 * class requires, and any engine notices the check raised.
 *
 * This is the endpoint to poll after {@link QTSurfer.validateStrategy}
 * returns `queued: true`, and the only place a verdict is read from.
 *
 * Check `compiledAt` against `validatedAt` before trusting a verdict: the
 * strategy may have been recompiled since the verdict was recorded, in which
 * case the verdict describes bytecode that is no longer what would run.
 * Re-request validation to get an answer about the current compilation.
 *
 * @param strategyId the id returned when the strategy was compiled
 * @throws QTSError on any non-2xx response. A `404` (carried on `status`)
 * means exactly one thing — no such registered strategy for this caller. It is
 * never a stale or expired answer: registration and verdict are stored
 * durably, not cached.
 */
export async function getStrategy(strategyId: string): Promise<StrategyState> {
  const { data, error, response } = await apiGetStrategy({ path: { strategyId } });
  if (error) throw requestFailed('strategy lookup', error, response?.status);
  if (!data) throw new QTSError('Empty strategy response');
  return data;
}

/**
 * One entry in {@link QTSurfer.strategies}'s result: the same provenance
 * {@link QTSurfer.strategy} reports — `compiledAt`, `requiredSources` — but
 * never `validation`, which is what keeps listing cheap no matter how many
 * strategies you have registered. Check a specific strategy's verdict with
 * {@link QTSurfer.strategy}.
 *
 * Note: the spec types this endpoint's `requiredSources` as a plain
 * `string[]`, not the `'Ticker' | 'KLine' | 'FundingRate'` union that
 * {@link StrategyState}'s own `requiredSources` carries — narrow it yourself
 * if you need the literal type. Alias for api-client's `StrategySummary`.
 */
export type StrategySummary = ApiStrategySummary;

/**
 * List every strategy you have registered and not deleted, most recently
 * compiled first.
 *
 * **Never `404`.** An empty array means you have none registered — not an
 * error. Each entry omits `validation` on purpose (see {@link
 * StrategySummary}); check a specific strategy's verdict with {@link
 * QTSurfer.strategy}.
 *
 * @throws QTSError on any non-2xx response, with the HTTP status on `status`.
 */
export async function listStrategies(): Promise<StrategySummary[]> {
  const { data, error, response } = await apiListStrategies();
  if (error) throw requestFailed('strategies list', error, response?.status);
  if (!data) throw new QTSError('Empty strategies response');
  return data.strategies;
}

/**
 * Release a registered strategy: removes it from both {@link
 * QTSurfer.strategy} and {@link QTSurfer.strategies}.
 *
 * **Does not undo anything already run.** Backtests you ran against this
 * strategy before deleting it are completely unaffected — deleting only
 * stops you from validating or re-running it under this id going forward.
 * Re-submitting the exact same source afterwards registers a **new**
 * strategy with a **new** id; it does not "undelete" this one, because
 * nothing about the id itself is restored.
 *
 * **Scoped to your own registration.** If you copied someone else's strategy
 * (a shared/marketplace listing), deleting your copy never affects theirs,
 * or anyone else's, regardless of how many callers registered the same
 * source independently.
 *
 * Resolves with nothing: the response body is `{ strategyId, deleted: true }`,
 * and both fields are things the caller already knows before calling this —
 * `strategyId` is the argument just passed in, and `deleted` is always `true`
 * on a `200`. There is nothing in it a `void` return would lose.
 *
 * @param strategyId the id returned when the strategy was compiled
 * @throws QTSError on any non-2xx response; a `404` (carried on `status`)
 * means no such registered strategy for this caller.
 */
export async function deleteStrategy(strategyId: string): Promise<void> {
  const { error, response } = await apiDeleteStrategy({ path: { strategyId } });
  if (error) throw requestFailed('strategy delete', error, response?.status);
}

/**
 * Read back the exact source last submitted for a strategy id — the same
 * text `strategyId` was derived from, whitespace and comments included.
 *
 * **A `404` here covers two cases the response cannot tell apart:** the id
 * was never registered by you, or it resolves only through a shared/
 * marketplace reference that carries no source of its own (a strategy you
 * copied by reference rather than by resubmitting its code). Both read as
 * "nothing to return" from this endpoint's point of view, and the SDK does
 * not attempt to distinguish them — there is nothing in the response to tell
 * them apart with.
 *
 * @param strategyId the id returned when the strategy was compiled
 * @throws QTSError on any non-2xx response; a `404` (carried on `status`)
 * is the two-case ambiguity described above.
 */
export async function getStrategyCode(strategyId: string): Promise<string> {
  const { data, error, response } = await apiGetStrategyCode({ path: { strategyId } });
  if (error) throw requestFailed('strategy code lookup', error, response?.status);
  if (!data) throw new QTSError('Empty strategy code response');
  return data.code;
}
