import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const postStrategy = vi.fn();
const getStrategyStatus = vi.fn();
const prepareBacktesting = vi.fn();
const getPreparationStatus = vi.fn();
const executeBacktesting = vi.fn();
const getExecutionResult = vi.fn();
const cancelExecution = vi.fn();

vi.mock('@qtsurfer/api-client', () => ({
  client: { setConfig: vi.fn() },
  postStrategy,
  getStrategyStatus,
  prepareBacktesting,
  getPreparationStatus,
  executeBacktesting,
  getExecutionResult,
  cancelExecution,
}));

const REQ = {
  strategy: 'class S {}',
  exchangeId: 'binance',
  instrument: 'BTC/USDT',
  from: '2024-01-01',
  to: '2024-01-02',
};

function ok<T>(data: T) {
  return { data, error: undefined };
}
function err(e: unknown) {
  return { data: undefined, error: e };
}

describe('backtest workflow', () => {
  beforeEach(() => {
    [
      postStrategy,
      getStrategyStatus,
      prepareBacktesting,
      getPreparationStatus,
      executeBacktesting,
      getExecutionResult,
      cancelExecution,
    ].forEach((m) => m.mockReset());
  });

  afterEach(() => vi.restoreAllMocks());

  it('runs the full happy path and returns ResultMap', async () => {
    postStrategy.mockResolvedValue(ok({ jobId: 'compile-1' }));
    getStrategyStatus.mockResolvedValue(
      ok({ status: 'Completed', strategyId: 'strategy-abc' }),
    );
    prepareBacktesting.mockResolvedValue(ok({ jobId: 'prep-1' }));
    getPreparationStatus.mockResolvedValue(
      ok({ status: 'Completed', size: 100, completed: 100 }),
    );
    executeBacktesting.mockResolvedValue(ok({ jobId: 'exec-1' }));
    getExecutionResult.mockResolvedValue(
      ok({
        state: { status: 'Completed', size: 100, completed: 100 },
        results: {
          strategyId: 'strategy-abc',
          instrument: 'BTC/USDT',
          pnlTotal: 42,
        },
      }),
    );

    const { backtest } = await import('../../src/workflows/backtest');
    const onProgress = vi.fn();
    const result = await backtest(REQ, { onProgress, pollIntervalMs: 1 });

    expect(result).toEqual({
      strategyId: 'strategy-abc',
      instrument: 'BTC/USDT',
      pnlTotal: 42,
    });
    expect(postStrategy).toHaveBeenCalledTimes(1);
    expect(prepareBacktesting).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { exchangeId: 'binance', type: 'ticker' },
        body: { instrument: 'BTC/USDT', from: '2024-01-01', to: '2024-01-02' },
      }),
    );
    expect(executeBacktesting).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          prepareJobId: 'prep-1',
          strategyId: 'strategy-abc',
        }),
      }),
    );

    const stages = onProgress.mock.calls.map((c) => c[0].stage);
    expect(stages).toContain('compiling');
    expect(stages).toContain('preparing');
    expect(stages).toContain('executing');
  });

  it('uses sync strategyId shortcut when compile returns 200', async () => {
    postStrategy.mockResolvedValue(ok({ strategyId: 'strategy-sync' }));
    prepareBacktesting.mockResolvedValue(ok({ jobId: 'prep-1' }));
    getPreparationStatus.mockResolvedValue(
      ok({ status: 'Completed', size: 1, completed: 1 }),
    );
    executeBacktesting.mockResolvedValue(ok({ jobId: 'exec-1' }));
    getExecutionResult.mockResolvedValue(
      ok({
        state: { status: 'Completed', size: 1, completed: 1 },
        results: { strategyId: 'strategy-sync', instrument: 'BTC/USDT' },
      }),
    );

    const { backtest } = await import('../../src/workflows/backtest');
    const result = await backtest(REQ, { pollIntervalMs: 1 });

    expect(getStrategyStatus).not.toHaveBeenCalled();
    expect(result.strategyId).toBe('strategy-sync');
  });

  it('throws QTSStrategyCompileError when compilation status is Failed', async () => {
    postStrategy.mockResolvedValue(ok({ jobId: 'compile-1' }));
    getStrategyStatus.mockResolvedValue(
      ok({ status: 'Failed', statusDetail: 'syntax error line 4' }),
    );

    const { backtest } = await import('../../src/workflows/backtest');
    const { QTSStrategyCompileError } = await import('../../src/errors');

    await expect(backtest(REQ, { pollIntervalMs: 1 })).rejects.toBeInstanceOf(
      QTSStrategyCompileError,
    );
    await expect(backtest(REQ, { pollIntervalMs: 1 })).rejects.toMatchObject({
      message: expect.stringContaining('syntax error'),
    });
  });

  it('throws QTSPreparationError when prepare status is Failed', async () => {
    postStrategy.mockResolvedValue(ok({ jobId: 'compile-1' }));
    getStrategyStatus.mockResolvedValue(
      ok({ status: 'Completed', strategyId: 'strategy-abc' }),
    );
    prepareBacktesting.mockResolvedValue(ok({ jobId: 'prep-1' }));
    getPreparationStatus.mockResolvedValue(
      ok({
        status: 'Failed',
        size: 100,
        completed: 10,
        statusDetail: 'data not available',
      }),
    );

    const { backtest } = await import('../../src/workflows/backtest');
    const { QTSPreparationError } = await import('../../src/errors');

    await expect(backtest(REQ, { pollIntervalMs: 1 })).rejects.toBeInstanceOf(
      QTSPreparationError,
    );
  });

  it('throws QTSExecutionError when execution fails and calls cancelExecution on abort', async () => {
    postStrategy.mockResolvedValue(ok({ strategyId: 'strategy-sync' }));
    prepareBacktesting.mockResolvedValue(ok({ jobId: 'prep-1' }));
    getPreparationStatus.mockResolvedValue(
      ok({ status: 'Completed', size: 1, completed: 1 }),
    );
    executeBacktesting.mockResolvedValue(ok({ jobId: 'exec-1' }));
    getExecutionResult.mockResolvedValue(
      ok({
        state: {
          status: 'Failed',
          size: 100,
          completed: 50,
          statusDetail: 'worker crashed',
        },
        results: { strategyId: 'strategy-sync', instrument: 'BTC/USDT' },
      }),
    );

    const { backtest } = await import('../../src/workflows/backtest');
    const { QTSExecutionError } = await import('../../src/errors');

    await expect(backtest(REQ, { pollIntervalMs: 1 })).rejects.toBeInstanceOf(
      QTSExecutionError,
    );
    // Failed != canceled, so cancelExecution is NOT invoked
    expect(cancelExecution).not.toHaveBeenCalled();
  });

  it('surfaces submission errors as the matching QTSError subclass', async () => {
    postStrategy.mockResolvedValue(err({ code: 400, message: 'bad source' }));

    const { backtest } = await import('../../src/workflows/backtest');
    const { QTSStrategyCompileError } = await import('../../src/errors');

    await expect(backtest(REQ, { pollIntervalMs: 1 })).rejects.toBeInstanceOf(
      QTSStrategyCompileError,
    );
  });

  it('honors AbortSignal and triggers server-side cancelExecution when aborted during execute', async () => {
    postStrategy.mockResolvedValue(ok({ strategyId: 'strategy-sync' }));
    prepareBacktesting.mockResolvedValue(ok({ jobId: 'prep-1' }));
    getPreparationStatus.mockResolvedValue(
      ok({ status: 'Completed', size: 1, completed: 1 }),
    );
    executeBacktesting.mockResolvedValue(ok({ jobId: 'exec-abort' }));

    // Keep getExecutionResult returning "Started" so the poll loops forever
    getExecutionResult.mockImplementation(async () =>
      ok({
        state: { status: 'Started', size: 100, completed: 10 },
        results: { strategyId: 'strategy-sync', instrument: 'BTC/USDT' },
      }),
    );
    cancelExecution.mockResolvedValue(ok({ status: 'cancelling' }));

    const { backtest } = await import('../../src/workflows/backtest');
    const { QTSCanceledError } = await import('../../src/errors');

    const controller = new AbortController();
    const promise = backtest(REQ, {
      signal: controller.signal,
      pollIntervalMs: 1,
      maxPollIntervalMs: 2,
    });
    setTimeout(() => controller.abort(), 20);

    await expect(promise).rejects.toBeInstanceOf(QTSCanceledError);
    expect(cancelExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { exchangeId: 'binance', type: 'ticker', jobId: 'exec-abort' },
      }),
    );
  });
});
