import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  authenticate,
  InMemoryTokenStore,
  QTSurfer,
  QTSDownloadError,
  QTSAuthError,
  QTSError,
  type AuthTokenResponse,
  type AuthTokenError,
  type DatasetImportRequest,
  type InstrumentDetail,
  type KeyScopes,
  type PoolDetail,
  type StartLiveRequest,
} from '../../src/index';

const baseUrl = 'https://example.test/v1';
const scopes: KeyScopes = { exchanges: ['read'], datasets: ['write'], live: ['read', 'execute'] };
const args = { exchangeId: 'binance', base: 'BTC', quote: 'USDT', hour: '2026-10-15T10' };
const pool: PoolDetail = {
  id: '0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca', symbol: 'WETH/USDG',
  base: 'WETH', quote: 'USDG', baseAddress: '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
  quoteAddress: '0x5fc5360d0400a0fd4f2af552add042d716f1d168', feePercent: 0.01,
  tvlUsd: 20_000, volume24hUsd: 80_000,
};

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

describe('OpenAPI contract through the generated transport', () => {
  it('accepts an empty scope map when the deployment permits token issuance', async () => {
    const token: AuthTokenResponse = {
      access_token: 'jwt-without-grants', token_type: 'Bearer', expires_in: 3600, tier: 'free', scopes: {},
    };
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json(token));
    const qts = await authenticate('ak_without_scopes', { baseUrl, fetch: transport });

    expect(qts.token?.scopes).toEqual({});
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('does not mint, persist, or retry a token when a scope-required deployment rejects the key', async () => {
    const rejection: AuthTokenError = {
      code: 'apikey_without_scopes',
      message: 'This API key has no scopes. Create a key with at least one scope in the web app.',
    };
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json(rejection, 403));
    const store = { load: vi.fn().mockReturnValue(null), save: vi.fn(), clear: vi.fn() };
    const failure = await authenticate('ak_without_scopes', { baseUrl, fetch: transport, store })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(QTSAuthError);
    expect(failure).toMatchObject({ status: 403, code: 'apikey_without_scopes', cause: rejection });
    if (!(failure instanceof QTSAuthError)) throw new Error('Expected authentication error');
    expect(failure.message).toContain('Create a key with at least one scope');
    expect(store.save).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('stops after a scope-less key is rejected during the single refresh after a 401', async () => {
    const token: AuthTokenResponse = {
      access_token: 'jwt-before-grant-change', token_type: 'Bearer', expires_in: 3600, tier: 'pro',
      scopes: { exchanges: ['read'] },
    };
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(token))
      .mockResolvedValueOnce(json({ code: 401, message: 'Expired JWT' }, 401))
      .mockResolvedValueOnce(json({ code: 'apikey_without_scopes', message: 'Create a key with at least one scope.' }, 403));
    const qts = await authenticate('ak_example', { baseUrl, fetch: transport });

    await expect(qts.getAccount()).rejects.toMatchObject({ status: 403, code: 'apikey_without_scopes' });
    expect(qts.token).toBeNull();
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('persists and refreshes nonempty scope maps and reads account scopes', async () => {
    const token: AuthTokenResponse = {
      access_token: 'jwt-first', token_type: 'Bearer', expires_in: 3600, tier: 'pro', scopes,
    };
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(token))
      .mockResolvedValueOnce(json({ code: 401, message: 'expired' }, 401))
      .mockResolvedValueOnce(json({ ...token, access_token: 'jwt-second' }))
      .mockResolvedValueOnce(json({ userId: 'account-1', scopes }));
    const store = new InMemoryTokenStore();
    const qts = await authenticate('ak_example', { baseUrl, fetch: transport, store });
    expect(qts.token?.scopes).toEqual(scopes);
    expect((await qts.getAccount()).scopes).toEqual(scopes);
    expect(store.load()?.scopes).toEqual(scopes);
    expect(store.load()?.access_token).toBe('jwt-second');
    expect(transport.mock.calls[3]?.[0]).toBeInstanceOf(Request);
    const finalRequest = transport.mock.calls[3]?.[0];
    if (!(finalRequest instanceof Request)) throw new Error('Expected a Request');
    expect(finalRequest.headers.get('Authorization')).toBe('Bearer jwt-second');
  });

  it('keeps CEX instrument arrays typed and handles DEX pool responses by venue type', async () => {
    const instrument: InstrumentDetail = { id: 'BTC/USDT', symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT' };
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ data: [instrument], meta: { venueType: 'cex' }, _links: {} }))
      .mockResolvedValueOnce(json({ data: [pool], meta: { venueType: 'dex' }, _links: {} }))
      .mockResolvedValueOnce(json({ data: [], meta: { venueType: 'dex' }, _links: {} }))
      .mockResolvedValueOnce(json({ data: [], meta: { venueType: 'cex' }, _links: {} }));
    const qts = new QTSurfer({ baseUrl, fetch: transport });
    expectTypeOf<ReturnType<typeof qts.getInstruments>>().toEqualTypeOf<Promise<InstrumentDetail[]>>();
    expectTypeOf<ReturnType<typeof qts.getPools>>().toEqualTypeOf<Promise<PoolDetail[]>>();
    await expect(qts.getInstruments('binance')).resolves.toEqual([instrument]);
    const pools = await qts.getPools('robinhood', 'uniswap-v3');
    expect(pools).toEqual([pool]);
    expect(pools[0]?.lastPrice).toBeUndefined();
    expect(pools[0]?.createdAt).toBeUndefined();
    await expect(qts.getPools('robinhood')).resolves.toEqual([]);
    await expect(qts.getInstruments('binance')).resolves.toEqual([]);
  });

  it('rejects a venue mismatch even for an empty catalogue', async () => {
    const qts = new QTSurfer({ baseUrl, fetch: vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ data: [], meta: { venueType: 'dex' } }))
      .mockResolvedValueOnce(json({ data: [], meta: { venueType: 'cex' } })) });
    await expect(qts.getInstruments('robinhood')).rejects.toThrow('use getPools()');
    await expect(qts.getPools('binance')).rejects.toThrow('use getInstruments()');
  });

  it('starts a discovered DEX pool as a kline source without changing its address', async () => {
    const request: StartLiveRequest = { sources: [{
      venueType: 'dex', exchange: 'robinhood', segment: 'uniswap-v3', type: 'kline', instruments: [pool.id],
    }], warmFrom: 0 };
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({ runId: 'run-1', sources: request.sources }, 201));
    const qts = new QTSurfer({ baseUrl, fetch: transport });
    expect((await qts.startLive('strategy-1', request)).sources).toEqual(request.sources);
    const sent = transport.mock.calls[0]?.[0];
    if (!(sent instanceof Request)) throw new Error('Expected a Request');
    expect(await sent.json()).toEqual(request);
  });

  it('imports CEX history with the requested cadence and reports its discovered cadence', async () => {
    const request: DatasetImportRequest = {
      name: 'BTC history', instrument: 'BTC/USDT', type: 'cex', cadence: '8h',
      from: '2026-09-01T00:00:00Z', to: '2026-09-02T00:00:00Z',
      cex: { exchange: 'binance', segment: 'spot', dataType: 'klines' },
    };
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ datasetId: 'ds_1', importId: 'im_1', status: 'fetching' }, 202))
      .mockResolvedValueOnce(json({ importId: 'im_1', status: 'ready', version: { cadence: '8h' } }));
    const qts = new QTSurfer({ baseUrl, fetch: transport });
    const imported = await qts.importDataset(request);
    expect((await qts.getDatasetImport(imported.datasetId, imported.importId)).version?.cadence).toBe('8h');
    const sent = transport.mock.calls[0]?.[0];
    if (!(sent instanceof Request)) throw new Error('Expected a Request');
    expect(await sent.json()).toEqual(request);
  });

  it('returns untouched Lastra bytes and provisional metadata, with no markers on a stored hour', async () => {
    const bytes = new Uint8Array([0x4c, 0x41, 0x53, 0x54, 0, 255]);
    const qts = new QTSurfer({ baseUrl, fetch: vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(bytes, { headers: {
        'Content-Type': 'application/vnd.qtsurfer.lastra', 'X-Ts-Unit': 'micros',
        'X-Data-Status': 'provisional', 'X-Data-Through': '2026-10-15T10:42:00.175Z',
        'Content-Disposition': 'attachment; filename=hour.lastra',
      } }))
      .mockResolvedValueOnce(new Response(bytes, { headers: { 'Content-Type': 'application/vnd.apache.parquet' } })) });
    const result = await qts.downloadTickersWithMetadata(args);
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(bytes);
    expect(result).toMatchObject({ tsUnit: 'micros', dataStatus: 'provisional', dataThrough: '2026-10-15T10:42:00.175Z' });
    expect(result.headers.get('Content-Disposition')).toContain('hour.lastra');
    const stored = await qts.downloadKlinesWithMetadata({ ...args, format: 'parquet' });
    expect(stored.tsUnit).toBeUndefined();
    expect(stored.dataStatus).toBeUndefined();
    expect(stored.dataThrough).toBeUndefined();
  });

  it.each([
    [400, 'OUTSIDE_WINDOW'], [404, 'NOT_YET_AVAILABLE'], [404, 'NO_DATA'],
    [503, 'TEMPORARILY_UNAVAILABLE'], [500, 'FUTURE_REASON'],
  ])('preserves structured errors and retry headers: %i %s', async (status, reason) => {
    const next = { method: 'POST', path: '/datasets/imports', body: {
      type: 'cex', instrument: 'BTC/USDT', from: '2026-09-01T10:00:00Z', to: '2026-09-01T11:00:00Z',
      cex: { exchange: 'binance', segment: 'spot', dataType: 'ticker' },
    } };
    const errorBody = { code: status, message: 'Read failed', reason, ...(status === 400 ? { next } : {}) };
    const qts = new QTSurfer({ baseUrl, fetch: vi.fn<typeof fetch>().mockResolvedValue(json(errorBody, status, { 'Retry-After': '30' })) });
    const failure = await qts.downloadTickers(args).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(QTSDownloadError);
    if (!(failure instanceof QTSDownloadError)) throw new Error('Expected download failure');
    expect(failure).toMatchObject({ status, reason, retryAfter: '30', cause: errorBody });
    expect(failure.next).toEqual(status === 400 ? next : undefined);
    expect(failure.headers?.get('Retry-After')).toBe('30');
  });

  it('wraps a transport failure without inventing an HTTP status', async () => {
    const cause = new TypeError('Connection interrupted');
    const qts = new QTSurfer({ baseUrl, fetch: vi.fn<typeof fetch>().mockRejectedValue(cause) });
    await expect(qts.downloadKlines(args)).rejects.toMatchObject({ name: 'QTSDownloadError', cause, status: undefined });
  });

  it('keeps new error fields on single-request errors without treating unknown reasons specially', () => {
    const failure = new QTSError('Failed', { reason: 'FUTURE_REASON', next: { method: 'GET', path: '/account' } }, 400);
    expect(failure.reason).toBe('FUTURE_REASON');
    expect(failure.next).toEqual({ method: 'GET', path: '/account' });
    expect(new QTSError('Failed', { reason: 42, next: { method: 'INVALID', path: '/account' } }).next).toBeUndefined();
  });
});
