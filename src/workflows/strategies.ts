import {
  getStrategy as apiGetStrategy,
  validateStrategy as apiValidateStrategy,
  type StrategyState as ApiStrategyState,
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
