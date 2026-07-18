import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const setConfig = vi.fn();
const apiAuth = vi.fn();
const apiDownloadTickers = vi.fn();
const apiDownloadKlines = vi.fn();

vi.mock('@qtsurfer/api-client', () => ({
  client: { setConfig },
  authenticate: apiAuth,
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

function authOk(token = 'jwt-1') {
  return {
    data: {
      access_token: token,
      token_type: 'Bearer',
      expires_in: 3600,
      tier: 'free',
    },
    error: undefined,
    response: { status: 200 } as Response,
  };
}

function authFail() {
  return {
    data: undefined,
    error: { code: 'invalid_apikey', message: 'nope' },
    response: { status: 401 } as Response,
  };
}

function ok<T>(data: T) {
  return { data, error: undefined, response: { status: 200 } as Response };
}

function http401(payload: unknown = { code: 'unauthorized', message: 'expired' }) {
  return {
    data: undefined,
    error: payload,
    response: { status: 401 } as Response,
  };
}

describe('authenticate() helper', () => {
  beforeEach(() => {
    setConfig.mockClear();
    apiAuth.mockReset();
    apiDownloadTickers.mockReset();
    apiDownloadKlines.mockReset();
    delete process.env.QTSURFER_APIKEY;
  });

  afterEach(() => {
    delete process.env.QTSURFER_APIKEY;
  });

  it('uses the apikey argument when one is passed', async () => {
    apiAuth.mockResolvedValueOnce(authOk('jwt-from-arg'));
    const { authenticate } = await import('../../src/auth/session');

    const session = await authenticate('ak_explicit');

    expect(apiAuth).toHaveBeenCalledTimes(1);
    expect(apiAuth.mock.calls[0]?.[0]?.headers).toEqual({
      'X-API-Key': 'ak_explicit',
    });
    expect(session.token?.access_token).toBe('jwt-from-arg');
  });

  it('falls back to QTSURFER_APIKEY env var when no apikey is passed', async () => {
    process.env.QTSURFER_APIKEY = 'ak_from_env';
    apiAuth.mockResolvedValueOnce(authOk());
    const { authenticate } = await import('../../src/auth/session');

    await authenticate();

    expect(apiAuth.mock.calls[0]?.[0]?.headers).toEqual({
      'X-API-Key': 'ak_from_env',
    });
  });

  it('explicit apikey overrides the env var', async () => {
    process.env.QTSURFER_APIKEY = 'ak_from_env';
    apiAuth.mockResolvedValueOnce(authOk());
    const { authenticate } = await import('../../src/auth/session');

    await authenticate('ak_explicit');

    expect(apiAuth.mock.calls[0]?.[0]?.headers).toEqual({
      'X-API-Key': 'ak_explicit',
    });
  });

  it('throws QTSAuthError when neither apikey arg nor env var is set', async () => {
    const { authenticate, QTSAuthError } = await import('../../src/index');

    await expect(authenticate()).rejects.toBeInstanceOf(QTSAuthError);
    expect(apiAuth).not.toHaveBeenCalled();
  });

  it('throws QTSAuthError when the initial JWT exchange returns 401', async () => {
    apiAuth.mockResolvedValueOnce(authFail());
    const { authenticate, QTSAuthError } = await import('../../src/index');

    await expect(authenticate('ak_bad')).rejects.toBeInstanceOf(QTSAuthError);
  });

  it('saves the token via the provided TokenStore', async () => {
    apiAuth.mockResolvedValueOnce(authOk('jwt-saved'));
    const { authenticate } = await import('../../src/auth/session');

    const saved: unknown[] = [];
    const store = {
      load: vi.fn().mockReturnValue(null),
      save: vi.fn((t: unknown) => {
        saved.push(t);
      }),
      clear: vi.fn(),
    };

    await authenticate('ak', { store });

    expect(store.load).toHaveBeenCalledTimes(1);
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(saved[0]).toMatchObject({ access_token: 'jwt-saved' });
  });

  it('seeds from the TokenStore without minting when load() returns a token', async () => {
    const cached = {
      access_token: 'jwt-cached',
      token_type: 'Bearer',
      expires_in: 3600,
      tier: 'pro',
    };
    const store = {
      load: vi.fn().mockReturnValue(cached),
      save: vi.fn(),
      clear: vi.fn(),
    };
    const { AuthenticatedClient } = await import('../../src/auth/session');

    const session = new AuthenticatedClient('ak', { store });
    const tok = await session.ensureToken();

    expect(tok).toBe(cached);
    expect(apiAuth).not.toHaveBeenCalled();
  });
});

describe('AuthenticatedClient refresh-on-401', () => {
  beforeEach(() => {
    setConfig.mockClear();
    apiAuth.mockReset();
    apiDownloadTickers.mockReset();
  });

  it('refreshes JWT once on 401 then retries the original call', async () => {
    // First mint at session start, second mint when the workflow 401s.
    apiAuth.mockResolvedValueOnce(authOk('jwt-1'));
    apiAuth.mockResolvedValueOnce(authOk('jwt-2'));

    const blob = new Blob(['LASTRA'], { type: 'application/vnd.lastra' });
    apiDownloadTickers.mockResolvedValueOnce(http401());
    apiDownloadTickers.mockResolvedValueOnce(ok(blob));

    const { authenticate } = await import('../../src/auth/session');
    const session = await authenticate('ak');

    // Wrap the download to throw on the api-client error, mimicking what
    // the workflow does internally (downloads.ts throws QTSDownloadError
    // with the original payload as cause).
    const out = await session.tickers({
      exchangeId: 'binance',
      base: 'BTC',
      quote: 'USDT',
      hour: '2026-01-15T10',
    });

    expect(out).toBe(blob);
    // Two auth calls: initial mint + refresh after 401.
    expect(apiAuth).toHaveBeenCalledTimes(2);
    // Two tickers calls: the 401 and the retry.
    expect(apiDownloadTickers).toHaveBeenCalledTimes(2);
    // The Authorization header for the retry must carry the new JWT.
    const lastSetConfig = setConfig.mock.calls.at(-1)?.[0];
    expect(lastSetConfig?.headers?.Authorization).toBe('Bearer jwt-2');
  });

  it('surfaces the error when the retry also returns 401', async () => {
    apiAuth.mockResolvedValueOnce(authOk('jwt-1'));
    apiAuth.mockResolvedValueOnce(authOk('jwt-2'));

    apiDownloadTickers.mockResolvedValueOnce(http401());
    apiDownloadTickers.mockResolvedValueOnce(http401());

    const { authenticate } = await import('../../src/auth/session');
    const { QTSDownloadError } = await import('../../src/errors');
    const session = await authenticate('ak');

    await expect(
      session.tickers({
        exchangeId: 'binance',
        base: 'BTC',
        quote: 'USDT',
        hour: '2026-01-15T10',
      }),
    ).rejects.toBeInstanceOf(QTSDownloadError);

    // One mint + one refresh.
    expect(apiAuth).toHaveBeenCalledTimes(2);
    // Two attempts: original + one retry, then surface.
    expect(apiDownloadTickers).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-401 errors', async () => {
    apiAuth.mockResolvedValueOnce(authOk('jwt-1'));
    apiDownloadTickers.mockResolvedValueOnce({
      data: undefined,
      error: { message: 'gone' },
      response: { status: 404 } as Response,
    });

    const { authenticate } = await import('../../src/auth/session');
    const { QTSDownloadError } = await import('../../src/errors');
    const session = await authenticate('ak');

    await expect(
      session.tickers({
        exchangeId: 'binance',
        base: 'BTC',
        quote: 'USDT',
        hour: '2026-01-15T10',
      }),
    ).rejects.toBeInstanceOf(QTSDownloadError);

    // Only the initial mint — no refresh.
    expect(apiAuth).toHaveBeenCalledTimes(1);
    expect(apiDownloadTickers).toHaveBeenCalledTimes(1);
  });
});
