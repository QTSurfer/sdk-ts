import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const compileStrategy = vi.fn();
const prepareBacktest = vi.fn();
const getPrepareStatus = vi.fn();
const executeSweep = vi.fn();
const getSweepResult = vi.fn();
const getSweepSensitivity = vi.fn();
const cancelSweep = vi.fn();

vi.mock('@qtsurfer/api-client', () => ({
  client: { setConfig: vi.fn() },
  compileStrategy,
  prepareBacktest,
  getPrepareStatus,
  executeSweep,
  getSweepResult,
  getSweepSensitivity,
  cancelSweep,
}));

const REQ = {
  strategy: 'class S {}',
  exchangeId: 'binance',
  instrument: 'BTC/USDT',
  from: '2026-01-01T00:00:00Z',
  to: '2026-02-01T00:00:00Z',
  params: {
    rsiPeriod: { from: 7, to: 28, step: 1 },
    useTrendFilter: { values: [true, false] },
  },
};

const FAST = { pollIntervalMs: 1, maxPollIntervalMs: 2 };

function ok<T>(data: T) {
  return { data, error: undefined, response: { status: 200 } as Response };
}
function err(e: unknown, status = 400) {
  return { data: undefined, error: e, response: { status } as Response };
}

function progress(done: number, total: number, failedShards = 0) {
  return {
    done,
    total,
    aborted: 0,
    shardCount: 4,
    pendingShards: 0,
    failedShards,
    retrying: 0,
    notStarted: 0,
  };
}

function row(runIx: number, sharpe: number) {
  return {
    runIx,
    rank: 1,
    params: { rsiPeriod: 14 },
    sharpe,
    sortino: 2,
    pnl: 100,
    pnlPct: 1,
    cagr: 0.5,
    maxDdPct: 3,
    trades: 40,
    winRate: 0.6,
    belowTradeFloor: false,
    aborted: false,
    runtimeMs: 120,
  };
}

function snapshot(status: string, extra: Record<string, unknown> = {}) {
  return {
    sweepId: 'swp-1',
    status,
    objective: 'sharpe',
    order: 'ranked',
    ranking: 'plateau',
    progress: progress(44, 44),
    leaderboardSize: 0,
    truncated: false,
    leaderboard: [],
    ...extra,
  };
}

const running = (done: number, total: number) =>
  snapshot('RUNNING', { progress: progress(done, total) });

const completed = () =>
  snapshot('COMPLETED', { pbo: 0.12, pboSplits: 16, leaderboardSize: 1, leaderboard: [row(3, 2.4)] });

/** Compile and prepare always succeed unless a test says otherwise. */
function stubPipeline() {
  compileStrategy.mockResolvedValue(ok({ strategyId: 'strategy-abc' }));
  prepareBacktest.mockResolvedValue(ok({ jobId: 'prep-1' }));
  getPrepareStatus.mockResolvedValue(
    ok({ status: 'Completed', size: 10, completed: 10, coverageRatio: 0.98 }),
  );
  executeSweep.mockResolvedValue(
    ok({
      sweepId: 'swp-1',
      requestId: 'prep-1',
      totalRuns: 44,
      shards: 4,
      seed: 487221,
      queued: true,
    }),
  );
}

describe('sweep workflow', () => {
  beforeEach(() => {
    [
      compileStrategy,
      prepareBacktest,
      getPrepareStatus,
      executeSweep,
      getSweepResult,
      getSweepSensitivity,
      cancelSweep,
    ].forEach((m) => m.mockReset());
    stubPipeline();
  });

  afterEach(() => vi.restoreAllMocks());

  // ---- submission ----

  it('sends the grid as the API spells it', async () => {
    // Both axis shapes are `oneOf` members on the wire, and getting them wrong produces a body
    // that still serializes — just not into a grid.
    getSweepResult.mockResolvedValue(ok(completed()));

    const { sweep } = await import('../../src/workflows/sweep');
    const handle = await sweep(
      { ...REQ, objective: 'sortino', sampler: 'lhs', samples: 100, seed: 487221 },
      FAST,
    );
    await handle.result;

    const [call] = executeSweep.mock.calls[0];
    expect(call.path).toEqual({ exchangeId: 'binance', type: 'ticker', requestId: 'prep-1' });
    expect(call.body.strategyId).toBe('strategy-abc');
    expect(call.body.sweep).toEqual({
      params: {
        rsiPeriod: { from: 7, to: 28, step: 1 },
        useTrendFilter: { values: [true, false] },
      },
      sampler: 'lhs',
      samples: 100,
      seed: 487221,
      objective: 'sortino',
    });
    expect(call.body.walkForward).toBeUndefined();
  });

  it('prepares the dataset before submitting and reports its coverage', async () => {
    getSweepResult.mockResolvedValue(ok(completed()));

    const { sweep } = await import('../../src/workflows/sweep');
    const events: Array<{ stage: string; coverageRatio?: number }> = [];
    const handle = await sweep(REQ, { ...FAST, onProgress: (p) => events.push(p) });
    await handle.result;

    expect(prepareBacktest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { exchangeId: 'binance', type: 'ticker' },
        body: { instrument: 'BTC/USDT', from: REQ.from, to: REQ.to },
      }),
    );
    expect(handle.requestId).toBe('prep-1');
    expect(handle.strategyId).toBe('strategy-abc');

    const stages = events.map((e) => e.stage).filter((s, i, all) => s !== all[i - 1]);
    expect(stages).toEqual(['compiling', 'preparing', 'executing']);
    // A thinly covered window is about to be scored once per parameter vector.
    expect(events.find((e) => e.coverageRatio !== undefined)?.coverageRatio).toBe(0.98);
  });

  it('answers the seed and the dedupe question from acceptance, unmodified', async () => {
    // The acceptance response is stored exactly as the server sent it — the handle's own
    // requestId is the value the workflow prepared with, never a write-back onto the model.
    executeSweep.mockResolvedValue(
      ok({
        sweepId: 'swp-1',
        requestId: 'server-echo',
        totalRuns: 44,
        shards: 4,
        seed: 99,
        queued: false,
      }),
    );
    getSweepResult.mockResolvedValue(ok(completed()));

    const { sweep } = await import('../../src/workflows/sweep');
    const handle = await sweep(REQ, FAST);

    expect(handle.sweepId).toBe('swp-1');
    expect(handle.accepted.seed).toBe(99);
    expect(handle.accepted.totalRuns).toBe(44);
    expect(handle.accepted.queued).toBe(false);
    expect(handle.accepted.requestId).toBe('server-echo');
    expect(handle.requestId).toBe('prep-1');
    await handle.result;
  });

  it('surfaces a rejected submission as QTSExecutionError', async () => {
    executeSweep.mockResolvedValue(err({ code: 400, message: 'grid exceeds the server limit' }));

    const { sweep } = await import('../../src/workflows/sweep');
    const { QTSExecutionError } = await import('../../src/errors');

    await expect(sweep(REQ, FAST)).rejects.toBeInstanceOf(QTSExecutionError);
  });

  it('rejects malformed requests before touching the network', async () => {
    const { sweep } = await import('../../src/workflows/sweep');
    const { QTSError } = await import('../../src/errors');

    await expect(sweep({ ...REQ, params: {} }, FAST)).rejects.toBeInstanceOf(QTSError);
    await expect(
      sweep({ ...REQ, params: { rsiPeriod: { from: 7, to: 28, step: 0 } } }, FAST),
    ).rejects.toThrow(/step > 0/);
    await expect(sweep({ ...REQ, walkForward: { folds: 1 } }, FAST)).rejects.toThrow(/folds/);
    await expect(
      sweep({ ...REQ, walkForward: { folds: 4, inSamplePct: 95 } }, FAST),
    ).rejects.toThrow(/inSamplePct/);
    expect(compileStrategy).not.toHaveBeenCalled();
  });

  // ---- polling the leaderboard ----

  it('polls until the sweep stops advancing and reports run-level progress', async () => {
    getSweepResult
      .mockResolvedValueOnce(ok(running(10, 44)))
      .mockResolvedValueOnce(ok(running(30, 44)))
      .mockResolvedValue(ok(completed()));

    const { sweep } = await import('../../src/workflows/sweep');
    const events: Array<{ stage: string; percent?: number; snapshot?: { failedShards: number } }> =
      [];
    const handle = await sweep(REQ, { ...FAST, onProgress: (p) => events.push(p) });
    const result = await handle.result;

    expect(result.status).toBe('COMPLETED');
    expect(result.leaderboard).toHaveLength(1);
    expect(result.pbo).toBe(0.12);
    expect(handle.state).toBe('completed');

    // Percent comes from the run counts, never from the shard counts beside them.
    const percents = events.filter((e) => e.stage === 'executing').map((e) => e.percent);
    expect(percents).toContain((10 / 44) * 100);
    expect(events.some((e) => e.snapshot?.failedShards !== undefined)).toBe(true);
  });

  it('treats PARTIAL as finished', async () => {
    // Normalizing it as "still running" polls a dead sweep forever, which is why this asserts
    // that the promise resolves at all. No sweep-wide failed status exists: a sweep whose every
    // shard died looks exactly like this, with nothing on the leaderboard.
    getSweepResult.mockResolvedValue(
      ok(snapshot('PARTIAL', { progress: progress(0, 44, 4) })),
    );

    const { sweep } = await import('../../src/workflows/sweep');
    const handle = await sweep(REQ, FAST);
    const result = await handle.result;

    expect(result.status).toBe('PARTIAL');
    expect(result.leaderboardSize).toBe(0);
    expect(getSweepResult).toHaveBeenCalledTimes(1);
    expect(handle.state).toBe('completed');
  });

  it('sends no ranking or order unless asked', async () => {
    getSweepResult.mockResolvedValue(ok(completed()));

    const { sweep } = await import('../../src/workflows/sweep');
    await (await sweep(REQ, FAST)).result;

    const [call] = getSweepResult.mock.calls[0];
    expect(call.path).toEqual({
      exchangeId: 'binance',
      type: 'ticker',
      requestId: 'prep-1',
      sweepId: 'swp-1',
    });
    expect(call.query).toBeUndefined();
  });

  it('sends ranking alongside order=natural and lets the response report what was applied', async () => {
    // Ranking is ignored on the natural view, but the platform accepts it rather than rejecting
    // it and answers `raw` — so the SDK sends what was asked and the result is the authority.
    getSweepResult.mockResolvedValue(
      ok(
        snapshot('COMPLETED', {
          order: 'natural',
          ranking: 'raw',
          leaderboardSize: 2,
          leaderboard: [row(0, 1), row(1, 2)],
        }),
      ),
    );

    const { sweep } = await import('../../src/workflows/sweep');
    const handle = await sweep(REQ, { ...FAST, order: 'natural', ranking: 'plateau' });
    const result = await handle.result;

    expect(getSweepResult.mock.calls[0][0].query).toEqual({
      order: 'natural',
      ranking: 'plateau',
    });
    expect(result.order).toBe('natural');
    expect(result.ranking).toBe('raw');
  });

  it('keeps plateauScore and neighbourCount together', async () => {
    // A plateau score with no neighbours behind it is unevidenced, not confirmed.
    getSweepResult.mockResolvedValue(
      ok(
        snapshot('COMPLETED', {
          leaderboardSize: 1,
          leaderboard: [
            { ...row(3, 3.9), plateauScore: 1.1, neighbourCount: 0, deflatedSharpe: 0.42 },
          ],
        }),
      ),
    );

    const { sweep } = await import('../../src/workflows/sweep');
    const [top] = (await (await sweep(REQ, { ...FAST, ranking: 'raw' })).result).leaderboard;

    expect(getSweepResult.mock.calls[0][0].query).toEqual({ ranking: 'raw' });
    expect(top.plateauScore).toBe(1.1);
    expect(top.neighbourCount).toBe(0);
    expect(top.deflatedSharpe).toBe(0.42);
  });

  it('re-reads the same sweep under another view without submitting again', async () => {
    // `order` and `ranking` are query parameters on the result endpoint, so reaching the rows a
    // truncated ranked view dropped is a read. Re-running the pipeline to change the view would
    // be a write to accomplish a read.
    getSweepResult.mockResolvedValueOnce(
      ok(snapshot('COMPLETED', { leaderboardSize: 1, truncated: true, leaderboard: [row(3, 2.4)] })),
    );
    getSweepResult.mockResolvedValue(
      ok(
        snapshot('COMPLETED', {
          order: 'natural',
          ranking: 'raw',
          leaderboardSize: 3,
          truncated: false,
          leaderboard: [row(0, 1), row(1, 2), row(2, 3)],
        }),
      ),
    );

    const { sweep } = await import('../../src/workflows/sweep');
    const handle = await sweep(REQ, FAST);
    const ranked = await handle.result;
    expect(ranked.truncated).toBe(true);

    const all = await handle.results({ order: 'natural', ranking: 'plateau' });

    expect(all.leaderboard).toHaveLength(3);
    expect(all.order).toBe('natural');
    // Ranking is still sent; the platform ignores it on this view and says so by answering raw.
    expect(getSweepResult.mock.calls[1][0]).toEqual({
      path: { exchangeId: 'binance', type: 'ticker', requestId: 'prep-1', sweepId: 'swp-1' },
      query: { order: 'natural', ranking: 'plateau' },
    });
    // Nothing was compiled, prepared or submitted a second time.
    expect(compileStrategy).toHaveBeenCalledTimes(1);
    expect(prepareBacktest).toHaveBeenCalledTimes(1);
    expect(executeSweep).toHaveBeenCalledTimes(1);
  });

  it('sends no view preference when results() is called bare, and surfaces HTTP failures', async () => {
    getSweepResult.mockResolvedValue(ok(completed()));

    const { sweep } = await import('../../src/workflows/sweep');
    const { QTSError } = await import('../../src/errors');
    const handle = await sweep(REQ, FAST);
    await handle.result;
    await handle.results();

    expect(getSweepResult.mock.calls[1][0].query).toBeUndefined();

    getSweepResult.mockResolvedValue(err({ code: 404, message: 'gone' }, 404));
    const failure = await handle.results().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(QTSError);
    expect(failure).toMatchObject({ status: 404 });
  });

  // ---- cancellation ----

  it('resolves with the rows already scored when the signal aborts', async () => {
    // The deliberate divergence from `backtest()`, which rejects on abort: cancelling a sweep
    // leaves its completed rows readable, and rejecting would throw away the only reason to
    // cancel late rather than early.
    let stopped = false;
    cancelSweep.mockImplementation(async () => {
      stopped = true;
      return ok({ status: 'cancelling', sweepId: 'swp-1' });
    });
    getSweepResult.mockImplementation(async () =>
      ok(
        stopped
          ? snapshot('CANCELLED', {
              progress: progress(10, 44),
              leaderboardSize: 1,
              leaderboard: [row(2, 1.5)],
            })
          : running(10, 44),
      ),
    );

    const { sweep } = await import('../../src/workflows/sweep');
    const controller = new AbortController();
    const handle = await sweep(REQ, { ...FAST, signal: controller.signal });
    expect(handle.state).toBe('executing');

    controller.abort();
    // The listener flips the local state synchronously, before the poll has settled anything.
    expect(handle.state).toBe('canceled');

    const result = await handle.result;

    expect(result.status).toBe('CANCELLED');
    expect(result.leaderboard).toHaveLength(1);
    expect(handle.state).toBe('canceled');
    expect(cancelSweep).toHaveBeenCalledWith({
      path: { exchangeId: 'binance', type: 'ticker', requestId: 'prep-1', sweepId: 'swp-1' },
    });
  });

  it('rejects when the signal aborts before the sweep is accepted', async () => {
    // Nothing has been submitted yet, so there are no rows to keep.
    const controller = new AbortController();
    compileStrategy.mockImplementation(async () => {
      controller.abort();
      return ok({ strategyId: 'strategy-abc' });
    });

    const { sweep } = await import('../../src/workflows/sweep');
    const { QTSCanceledError } = await import('../../src/errors');

    await expect(sweep(REQ, { ...FAST, signal: controller.signal })).rejects.toBeInstanceOf(
      QTSCanceledError,
    );
    expect(executeSweep).not.toHaveBeenCalled();
  });

  // ---- walk-forward ----

  it('requests walk-forward and makes it identifiable from acceptance', async () => {
    executeSweep.mockResolvedValue(
      ok({
        sweepId: 'swp-1',
        requestId: 'prep-1',
        totalRuns: 44,
        shards: 4,
        seed: 7,
        queued: true,
        walkForward: { folds: 4, inSamplePct: 70, totalRuns: 180 },
      }),
    );
    getSweepResult.mockResolvedValue(
      ok(
        snapshot('COMPLETED', {
          ranking: 'raw',
          progress: progress(180, 180),
          leaderboardSize: 2,
          leaderboard: [row(0, 1.1), row(1, 0.4)],
          walkForward: { folds: 4, inSamplePct: 70, completedFolds: 2, results: [] },
        }),
      ),
    );

    const { sweep } = await import('../../src/workflows/sweep');
    const handle = await sweep({ ...REQ, walkForward: { folds: 4, inSamplePct: 70 } }, FAST);

    expect(executeSweep.mock.calls[0][0].body.walkForward).toEqual({ folds: 4, inSamplePct: 70 });
    // Branchable before any fold has finished.
    expect(handle.accepted.walkForward?.totalRuns).toBe(180);

    const result = await handle.result;
    expect(result.walkForward?.completedFolds).toBe(2);
    // Absent is not zero: no drift figure could be computed, and a placeholder would be
    // indistinguishable from winners that never moved.
    expect(result.walkForward?.paramDrift).toBeUndefined();
    // runIx is the fold index here, not a position in the grid.
    expect(result.leaderboard.map((r) => r.runIx)).toEqual([0, 1]);
    // Never plateau-ranked, and no sweep-wide overfitting figure.
    expect(result.ranking).toBe('raw');
    expect(result.pbo).toBeUndefined();
  });

  it('omits inSamplePct when the caller leaves it to the platform', async () => {
    getSweepResult.mockResolvedValue(ok(completed()));

    const { sweep } = await import('../../src/workflows/sweep');
    await (await sweep({ ...REQ, walkForward: { folds: 3 } }, FAST)).result;

    expect(executeSweep.mock.calls[0][0].body.walkForward).toEqual({ folds: 3 });
  });

  // ---- sensitivity ----

  it('surfaces heatmap truncation and sends the requested objective', async () => {
    // A short heatmap list must not read as "these are all the interactions".
    getSweepResult.mockResolvedValue(ok(completed()));
    getSweepSensitivity.mockResolvedValue(
      ok({
        sweepId: 'swp-1',
        status: 'COMPLETED',
        objective: 'sortino',
        rowsAnalysed: 44,
        marginals: [
          { param: 'rsiPeriod', points: [{ value: 14, count: 4, best: 2, mean: 1, worst: 0.1 }] },
        ],
        heatmaps: [],
        heatmapsTruncated: true,
      }),
    );

    const { sweep } = await import('../../src/workflows/sweep');
    const handle = await sweep(REQ, FAST);
    await handle.result;
    const sensitivity = await handle.sensitivity('sortino');

    expect(sensitivity.heatmapsTruncated).toBe(true);
    expect(sensitivity.marginals).toHaveLength(1);
    expect(sensitivity.rowsAnalysed).toBe(44);
    expect(getSweepSensitivity).toHaveBeenCalledWith({
      path: { exchangeId: 'binance', type: 'ticker', requestId: 'prep-1', sweepId: 'swp-1' },
      query: { objective: 'sortino' },
    });
  });

  it("defaults sensitivity to the sweep's own objective and surfaces HTTP failures", async () => {
    getSweepResult.mockResolvedValue(ok(completed()));
    getSweepSensitivity.mockResolvedValueOnce(ok({ sweepId: 'swp-1', heatmapsTruncated: false }));

    const { sweep } = await import('../../src/workflows/sweep');
    const { QTSError } = await import('../../src/errors');
    const handle = await sweep(REQ, FAST);
    await handle.result;
    await handle.sensitivity();

    expect(getSweepSensitivity.mock.calls[0][0].query).toBeUndefined();

    getSweepSensitivity.mockResolvedValue(err({ code: 404, message: 'gone' }, 404));
    const failure = await handle.sensitivity().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(QTSError);
    expect(failure).toMatchObject({ status: 404 });
  });
});
