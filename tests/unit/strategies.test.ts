import { beforeEach, describe, expect, it, vi } from 'vitest';

const setConfig = vi.fn();
const apiGetStrategy = vi.fn();
const apiValidateStrategy = vi.fn();
const apiListStrategies = vi.fn();
const apiDeleteStrategy = vi.fn();
const apiGetStrategyCode = vi.fn();

vi.mock('@qtsurfer/api-client', () => ({
  client: { setConfig },
  compileStrategy: vi.fn(),
  getStrategy: apiGetStrategy,
  validateStrategy: apiValidateStrategy,
  listStrategies: apiListStrategies,
  deleteStrategy: apiDeleteStrategy,
  getStrategyCode: apiGetStrategyCode,
  prepareBacktest: vi.fn(),
  getPrepareStatus: vi.fn(),
  executeBacktest: vi.fn(),
  getBacktestResult: vi.fn(),
  cancelBacktest: vi.fn(),
  downloadTickers: vi.fn(),
  downloadKlines: vi.fn(),
  listExchanges: vi.fn(),
  listInstruments: vi.fn(),
  listSegmentInstruments: vi.fn(),
}));

function ok<T>(data: T, status = 200) {
  return { data, error: undefined, response: { status } as Response };
}
function err(payload: unknown, status = 404) {
  return { data: undefined, error: payload, response: { status } as Response };
}

const SID = 'strat-abc';

async function client() {
  const { QTSurfer } = await import('../../src/client');
  return new QTSurfer({ baseUrl: 'https://example.test/v1' });
}

describe('QTSurfer.validateStrategy', () => {
  beforeEach(() => {
    apiValidateStrategy.mockReset();
  });

  it('reports queued: false and the recorded verdict on a 200', async () => {
    const state = {
      strategyId: SID,
      validation: 'passed',
      compiledAt: '2026-01-15T09:00:00Z',
      validatedAt: '2026-01-15T09:00:05Z',
    };
    apiValidateStrategy.mockResolvedValue(ok(state, 200));

    const qts = await client();
    const outcome = await qts.validateStrategy(SID);

    expect(outcome).toEqual({ queued: false, strategyId: SID, state });
    expect(apiValidateStrategy).toHaveBeenCalledWith({ path: { strategyId: SID } });
  });

  it('reports queued: true on a 202, which api-client hands back as success', async () => {
    apiValidateStrategy.mockResolvedValue(ok({ strategyId: SID, validation: 'pending' }, 202));

    const qts = await client();

    // A 202 is a 2xx, so it arrives on `data` with `error: undefined` — it is
    // not an error path, and the status is the only thing separating it from
    // the 200 outcome.
    await expect(qts.validateStrategy(SID)).resolves.toEqual({
      queued: true,
      strategyId: SID,
    });
  });

  it('still reports queued: true when the 202 carries no body', async () => {
    // api-client hands back `{}` for an accepted response with an empty body,
    // so the queued branch must not read the strategy id out of the payload.
    apiValidateStrategy.mockResolvedValue(ok({}, 202));

    const qts = await client();

    await expect(qts.validateStrategy(SID)).resolves.toEqual({
      queued: true,
      strategyId: SID,
    });
  });

  it("keeps queued: false for a 200 whose verdict is itself 'pending'", async () => {
    // An earlier call queued the check; this one starts nothing, so the
    // discriminant says "not queued" while the verdict is still unresolved.
    const state = { strategyId: SID, validation: 'pending' };
    apiValidateStrategy.mockResolvedValue(ok(state, 200));

    const qts = await client();
    const outcome = await qts.validateStrategy(SID);

    expect(outcome.queued).toBe(false);
    expect(outcome.state?.validation).toBe('pending');
  });

  it('throws QTSError carrying the HTTP status on a 404', async () => {
    apiValidateStrategy.mockResolvedValue(err({ code: 404, message: 'unknown strategy' }, 404));

    const qts = await client();
    const { QTSError } = await import('../../src/errors');

    const promise = qts.validateStrategy(SID);
    await expect(promise).rejects.toBeInstanceOf(QTSError);
    await expect(promise).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining('unknown strategy'),
    });
  });
});

describe('QTSurfer.strategy', () => {
  beforeEach(() => {
    apiGetStrategy.mockReset();
  });

  it('returns the recorded strategy state', async () => {
    const state = {
      strategyId: SID,
      validation: 'failed',
      detail: 'NullPointerException in onTicker',
      notices: [{ level: 'ERROR', code: 'NPE', message: 'boom' }],
      dryRunIncomplete: false,
    };
    apiGetStrategy.mockResolvedValue(ok(state));

    const qts = await client();

    await expect(qts.strategy(SID)).resolves.toEqual(state);
    expect(apiGetStrategy).toHaveBeenCalledWith({ path: { strategyId: SID } });
  });

  it('passes `_links` through unmodified, with no unwrapping', async () => {
    // Pins the "no machinery needed" decision: StrategyState is a direct
    // alias of api-client's type and getStrategy returns `data` as-is, so
    // the HAL discovery link added for `getStrategyCode` must survive
    // untouched rather than being stripped like the instrument envelope's
    // `_links` is in catalog.ts.
    const state = {
      strategyId: SID,
      validation: 'passed',
      _links: { code: { href: `/v1/strategy/${SID}/code` } },
    };
    apiGetStrategy.mockResolvedValue(ok(state));

    const qts = await client();

    await expect(qts.strategy(SID)).resolves.toEqual(state);
  });

  it('throws QTSError carrying the HTTP status on a 404', async () => {
    apiGetStrategy.mockResolvedValue(err({ code: 404, message: 'unknown strategy' }, 404));

    const qts = await client();
    const { QTSError } = await import('../../src/errors');

    await expect(qts.strategy(SID)).rejects.toMatchObject({
      name: 'QTSError',
      status: 404,
    });
  });
});

describe('QTSurfer.strategies', () => {
  beforeEach(() => {
    apiListStrategies.mockReset();
  });

  it('returns the strategies array, unwrapped from the envelope', async () => {
    const strategies = [
      { strategyId: SID, compiledAt: '2026-08-12T09:02:11Z', requiredSources: ['Ticker'] },
      { strategyId: 'strat-def', compiledAt: '2026-08-19T10:15:00Z' },
    ];
    apiListStrategies.mockResolvedValue(ok({ strategies }));

    const qts = await client();

    await expect(qts.strategies()).resolves.toEqual(strategies);
    expect(apiListStrategies).toHaveBeenCalledWith();
  });

  it('returns an empty array rather than throwing when there are none', async () => {
    apiListStrategies.mockResolvedValue(ok({ strategies: [] }));

    const qts = await client();

    await expect(qts.strategies()).resolves.toEqual([]);
  });

  it('throws QTSError on a non-2xx response', async () => {
    apiListStrategies.mockResolvedValue(err({ code: 500, message: 'boom' }, 500));

    const qts = await client();

    await expect(qts.strategies()).rejects.toMatchObject({
      name: 'QTSError',
      status: 500,
    });
  });
});

describe('QTSurfer.deleteStrategy', () => {
  beforeEach(() => {
    apiDeleteStrategy.mockReset();
  });

  it('resolves with nothing on a 200', async () => {
    apiDeleteStrategy.mockResolvedValue(ok({ strategyId: SID, deleted: true }));

    const qts = await client();

    await expect(qts.deleteStrategy(SID)).resolves.toBeUndefined();
    expect(apiDeleteStrategy).toHaveBeenCalledWith({ path: { strategyId: SID } });
  });

  it('throws QTSError carrying the HTTP status on a 404', async () => {
    apiDeleteStrategy.mockResolvedValue(err({ code: 404, message: 'unknown strategy' }, 404));

    const qts = await client();

    await expect(qts.deleteStrategy(SID)).rejects.toMatchObject({
      name: 'QTSError',
      status: 404,
    });
  });
});

describe('QTSurfer.strategyCode', () => {
  beforeEach(() => {
    apiGetStrategyCode.mockReset();
  });

  it('returns the raw source string', async () => {
    const code = 'package strategy;\npublic class EmaCrossStrategy { }';
    apiGetStrategyCode.mockResolvedValue(ok({ strategyId: SID, code }));

    const qts = await client();

    await expect(qts.strategyCode(SID)).resolves.toBe(code);
    expect(apiGetStrategyCode).toHaveBeenCalledWith({ path: { strategyId: SID } });
  });

  it('throws QTSError carrying the HTTP status on a 404 (unregistered or no-source-of-its-own)', async () => {
    apiGetStrategyCode.mockResolvedValue(err({ code: 404, message: 'no source available' }, 404));

    const qts = await client();

    await expect(qts.strategyCode(SID)).rejects.toMatchObject({
      name: 'QTSError',
      status: 404,
    });
  });
});
