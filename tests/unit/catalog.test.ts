import { beforeEach, describe, expect, it, vi } from 'vitest';

const setConfig = vi.fn();
const apiListExchanges = vi.fn();
const apiListInstruments = vi.fn();
const apiListSegmentInstruments = vi.fn();

vi.mock('@qtsurfer/api-client', () => ({
  client: { setConfig },
  compileStrategy: vi.fn(),
  getStrategy: vi.fn(),
  validateStrategy: vi.fn(),
  listStrategies: vi.fn(),
  deleteStrategy: vi.fn(),
  getStrategyCode: vi.fn(),
  prepareBacktest: vi.fn(),
  getPrepareStatus: vi.fn(),
  executeBacktest: vi.fn(),
  getBacktestResult: vi.fn(),
  cancelBacktest: vi.fn(),
  downloadTickers: vi.fn(),
  downloadKlines: vi.fn(),
  listExchanges: apiListExchanges,
  listInstruments: apiListInstruments,
  listSegmentInstruments: apiListSegmentInstruments,
}));

function ok<T>(data: T, status = 200) {
  return { data, error: undefined, response: { status } as Response };
}
function err(payload: unknown, status = 404) {
  return { data: undefined, error: payload, response: { status } as Response };
}

const BTC = { id: 'BTC/USDT', base: 'BTC', quote: 'USDT' };
const ETH = { id: 'ETH/USDT', base: 'ETH', quote: 'USDT' };

function envelope(data: unknown[], segment: 'spot' | 'futures' = 'spot') {
  return {
    data,
    meta: { updatedAt: '2026-01-15T10:00:00Z', exchange: 'binance', segment },
    _links: { self: { href: '/exchange/binance/instruments' } },
  };
}

async function client() {
  const { QTSurfer } = await import('../../src/client');
  return new QTSurfer({ baseUrl: 'https://example.test/v1' });
}

describe('QTSurfer.exchanges', () => {
  beforeEach(() => {
    apiListExchanges.mockReset();
  });

  it('returns the exchange list', async () => {
    const exchanges = [
      { id: 'binance', name: 'Binance' },
      { id: 'kraken', name: 'Kraken', description: 'Kraken exchange' },
    ];
    apiListExchanges.mockResolvedValue(ok(exchanges));

    const qts = await client();

    await expect(qts.exchanges()).resolves.toEqual(exchanges);
    expect(apiListExchanges).toHaveBeenCalledTimes(1);
  });

  it('throws QTSError carrying the HTTP status on a 5xx', async () => {
    apiListExchanges.mockResolvedValue(err({ code: 503, message: 'unavailable' }, 503));

    const qts = await client();
    const { QTSError } = await import('../../src/errors');

    const promise = qts.exchanges();
    await expect(promise).rejects.toBeInstanceOf(QTSError);
    await expect(promise).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining('HTTP 503'),
    });
  });
});

describe('QTSurfer.instruments', () => {
  beforeEach(() => {
    apiListInstruments.mockReset();
    apiListSegmentInstruments.mockReset();
  });

  it('unwraps the HAL envelope to the instrument array', async () => {
    apiListInstruments.mockResolvedValue(ok(envelope([BTC, ETH])));

    const qts = await client();

    await expect(qts.instruments('binance')).resolves.toEqual([BTC, ETH]);
  });

  it('hits the default-segment route when no segment is given', async () => {
    apiListInstruments.mockResolvedValue(ok(envelope([BTC])));

    const qts = await client();
    await qts.instruments('binance');

    expect(apiListInstruments).toHaveBeenCalledTimes(1);
    expect(apiListInstruments).toHaveBeenCalledWith({
      path: { exchangeId: 'binance' },
    });
    expect(apiListSegmentInstruments).not.toHaveBeenCalled();
  });

  it('routes to the segment endpoint when a segment is given', async () => {
    apiListSegmentInstruments.mockResolvedValue(ok(envelope([BTC], 'futures')));

    const qts = await client();
    await expect(qts.instruments('binance', 'futures')).resolves.toEqual([BTC]);

    expect(apiListSegmentInstruments).toHaveBeenCalledTimes(1);
    expect(apiListSegmentInstruments).toHaveBeenCalledWith({
      path: { exchangeId: 'binance', segment: 'futures' },
    });
    expect(apiListInstruments).not.toHaveBeenCalled();
  });

  it("takes the explicit 'spot' segment route rather than the default one", async () => {
    apiListSegmentInstruments.mockResolvedValue(ok(envelope([BTC])));

    const qts = await client();
    await qts.instruments('binance', 'spot');

    expect(apiListSegmentInstruments).toHaveBeenCalledWith({
      path: { exchangeId: 'binance', segment: 'spot' },
    });
    expect(apiListInstruments).not.toHaveBeenCalled();
  });

  it('returns an empty array for an empty envelope rather than throwing', async () => {
    apiListInstruments.mockResolvedValue(ok(envelope([])));

    const qts = await client();

    await expect(qts.instruments('binance')).resolves.toEqual([]);
  });

  it('throws QTSError carrying the HTTP status on a 404', async () => {
    apiListInstruments.mockResolvedValue(err({ code: 404, message: 'no such exchange' }, 404));

    const qts = await client();
    const { QTSError } = await import('../../src/errors');

    const promise = qts.instruments('nope');
    await expect(promise).rejects.toBeInstanceOf(QTSError);
    await expect(promise).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining('no such exchange'),
    });
  });
});
