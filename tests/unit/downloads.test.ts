import { beforeEach, describe, expect, it, vi } from 'vitest';

const setConfig = vi.fn();
const getExchangeTickersHour = vi.fn();
const getExchangeKlinesHour = vi.fn();

vi.mock('@qtsurfer/api-client', () => ({
  client: { setConfig },
  postStrategy: vi.fn(),
  getStrategyStatus: vi.fn(),
  prepareBacktesting: vi.fn(),
  getPreparationStatus: vi.fn(),
  executeBacktesting: vi.fn(),
  getExecutionResult: vi.fn(),
  cancelExecution: vi.fn(),
  getExchangeTickersHour,
  getExchangeKlinesHour,
}));

function ok<T>(data: T) {
  return { data, error: undefined, response: { status: 200 } as Response };
}
function err(payload: unknown, status = 404) {
  return {
    data: undefined,
    error: payload,
    response: { status } as Response,
  };
}

describe('QTSurfer.tickers / klines', () => {
  beforeEach(() => {
    getExchangeTickersHour.mockReset();
    getExchangeKlinesHour.mockReset();
  });

  it('tickers() defaults to lastra and returns the Blob', async () => {
    const blob = new Blob(['LASTRA'], { type: 'application/vnd.lastra' });
    getExchangeTickersHour.mockResolvedValue(ok(blob));

    const { QTSurfer } = await import('../../src/client');
    const qts = new QTSurfer({ baseUrl: 'https://example.test/v1' });
    const out = await qts.tickers({
      exchangeId: 'binance',
      base: 'BTC',
      quote: 'USDT',
      hour: '2026-01-15T10',
    });

    expect(out).toBe(blob);
    expect(getExchangeTickersHour).toHaveBeenCalledTimes(1);
    expect(getExchangeTickersHour).toHaveBeenCalledWith({
      path: { exchangeId: 'binance', base: 'BTC', quote: 'USDT' },
      query: { hour: '2026-01-15T10' },
    });
  });

  it('tickers() forwards format=parquet when requested', async () => {
    getExchangeTickersHour.mockResolvedValue(ok(new Blob(['ok'])));

    const { QTSurfer } = await import('../../src/client');
    const qts = new QTSurfer({ baseUrl: 'https://example.test/v1' });
    await qts.tickers({
      exchangeId: 'binance',
      base: 'BTC',
      quote: 'USDT',
      hour: '2026-01-15T10',
      format: 'parquet',
    });

    expect(getExchangeTickersHour).toHaveBeenCalledWith({
      path: { exchangeId: 'binance', base: 'BTC', quote: 'USDT' },
      query: { hour: '2026-01-15T10', format: 'parquet' },
    });
  });

  it('klines() routes to getExchangeKlinesHour', async () => {
    getExchangeKlinesHour.mockResolvedValue(ok(new Blob(['ok'])));

    const { QTSurfer } = await import('../../src/client');
    const qts = new QTSurfer({ baseUrl: 'https://example.test/v1' });
    await qts.klines({
      exchangeId: 'binance',
      base: 'BTC',
      quote: 'USDT',
      hour: '2026-01-15T10',
      format: 'parquet',
    });

    expect(getExchangeKlinesHour).toHaveBeenCalledWith({
      path: { exchangeId: 'binance', base: 'BTC', quote: 'USDT' },
      query: { hour: '2026-01-15T10', format: 'parquet' },
    });
  });

  it('throws QTSDownloadError on a 404', async () => {
    getExchangeTickersHour.mockResolvedValue(
      err({ code: 'NOT_FOUND', message: 'hour not backfilled' }, 404),
    );

    const { QTSurfer } = await import('../../src/client');
    const { QTSDownloadError } = await import('../../src/errors');
    const qts = new QTSurfer({ baseUrl: 'https://example.test/v1' });

    await expect(
      qts.tickers({
        exchangeId: 'binance',
        base: 'BTC',
        quote: 'USDT',
        hour: '2026-01-15T10',
      }),
    ).rejects.toMatchObject({
      name: 'QTSDownloadError',
      message: expect.stringContaining('HTTP 404'),
    });

    await expect(
      qts.tickers({
        exchangeId: 'binance',
        base: 'BTC',
        quote: 'USDT',
        hour: '2026-01-15T10',
      }),
    ).rejects.toBeInstanceOf(QTSDownloadError);
  });
});
