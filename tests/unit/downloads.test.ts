import { beforeEach, describe, expect, it, vi } from 'vitest';

const setConfig = vi.fn();
const apiDownloadTickers = vi.fn();
const apiDownloadKlines = vi.fn();

vi.mock('@qtsurfer/api-client', () => ({
  client: { setConfig },
  compileStrategy: vi.fn(),
  getStrategy: vi.fn(),
  prepareBacktest: vi.fn(),
  getPrepareStatus: vi.fn(),
  executeBacktest: vi.fn(),
  getBacktestResult: vi.fn(),
  cancelBacktest: vi.fn(),
  downloadTickers: apiDownloadTickers,
  downloadKlines: apiDownloadKlines,
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
    apiDownloadTickers.mockReset();
    apiDownloadKlines.mockReset();
  });

  it('tickers() defaults to lastra and returns the Blob', async () => {
    const blob = new Blob(['LASTRA'], { type: 'application/vnd.lastra' });
    apiDownloadTickers.mockResolvedValue(ok(blob));

    const { QTSurfer } = await import('../../src/client');
    const qts = new QTSurfer({ baseUrl: 'https://example.test/v1' });
    const out = await qts.tickers({
      exchangeId: 'binance',
      base: 'BTC',
      quote: 'USDT',
      hour: '2026-01-15T10',
    });

    expect(out).toBe(blob);
    expect(apiDownloadTickers).toHaveBeenCalledTimes(1);
    expect(apiDownloadTickers).toHaveBeenCalledWith({
      path: { exchangeId: 'binance', base: 'BTC', quote: 'USDT' },
      query: { hour: '2026-01-15T10' },
    });
  });

  it('tickers() forwards format=parquet when requested', async () => {
    apiDownloadTickers.mockResolvedValue(ok(new Blob(['ok'])));

    const { QTSurfer } = await import('../../src/client');
    const qts = new QTSurfer({ baseUrl: 'https://example.test/v1' });
    await qts.tickers({
      exchangeId: 'binance',
      base: 'BTC',
      quote: 'USDT',
      hour: '2026-01-15T10',
      format: 'parquet',
    });

    expect(apiDownloadTickers).toHaveBeenCalledWith({
      path: { exchangeId: 'binance', base: 'BTC', quote: 'USDT' },
      query: { hour: '2026-01-15T10', format: 'parquet' },
    });
  });

  it('klines() routes to downloadKlines', async () => {
    apiDownloadKlines.mockResolvedValue(ok(new Blob(['ok'])));

    const { QTSurfer } = await import('../../src/client');
    const qts = new QTSurfer({ baseUrl: 'https://example.test/v1' });
    await qts.klines({
      exchangeId: 'binance',
      base: 'BTC',
      quote: 'USDT',
      hour: '2026-01-15T10',
      format: 'parquet',
    });

    expect(apiDownloadKlines).toHaveBeenCalledWith({
      path: { exchangeId: 'binance', base: 'BTC', quote: 'USDT' },
      query: { hour: '2026-01-15T10', format: 'parquet' },
    });
  });

  it('throws QTSDownloadError on a 404', async () => {
    apiDownloadTickers.mockResolvedValue(
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
