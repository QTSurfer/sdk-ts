import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authenticate } from '../../src/index';

/**
 * Stub `/auth/token` server with switchable handlers, so each test can
 * script its own response sequence. No live network calls.
 */
type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let server: Server;
let baseUrl: string;
let handler: Handler;
let authHits: { apikey?: string; ts: number }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.endsWith('/auth/token') && req.method === 'POST') {
      authHits.push({
        apikey: req.headers['x-api-key'] as string | undefined,
        ts: Date.now(),
      });
    }
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  authHits = [];
  handler = (_req, res) => {
    res.statusCode = 500;
    res.end('handler not set');
  };
});

afterEach(() => {
  delete process.env.QTSURFER_APIKEY;
});

function jsonResponse(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

describe('integration: authenticate() against a stubbed /auth/token endpoint', () => {
  it('exchanges apikey for a JWT and exposes it on the session', async () => {
    handler = (_req, res) => {
      jsonResponse(res, 200, {
        access_token: 'jwt-int-1',
        token_type: 'Bearer',
        expires_in: 3600,
        tier: 'free',
      });
    };

    const session = await authenticate('ak_int_explicit', { baseUrl });

    expect(session.token?.access_token).toBe('jwt-int-1');
    expect(authHits).toHaveLength(1);
    expect(authHits[0]?.apikey).toBe('ak_int_explicit');
  });

  it('picks up the apikey from QTSURFER_APIKEY env when no arg is passed', async () => {
    process.env.QTSURFER_APIKEY = 'ak_int_from_env';
    handler = (_req, res) => {
      jsonResponse(res, 200, {
        access_token: 'jwt-env',
        token_type: 'Bearer',
        expires_in: 3600,
        tier: 'pro',
      });
    };

    const session = await authenticate(undefined, { baseUrl });

    expect(session.token?.tier).toBe('pro');
    expect(authHits[0]?.apikey).toBe('ak_int_from_env');
  });

  it('writes the JWT to the provided TokenStore on successful auth', async () => {
    handler = (_req, res) => {
      jsonResponse(res, 200, {
        access_token: 'jwt-stored',
        token_type: 'Bearer',
        expires_in: 3600,
        tier: 'elite',
      });
    };

    const saved: unknown[] = [];
    await authenticate('ak', {
      baseUrl,
      store: {
        load: () => null,
        save: (t) => {
          saved.push(t);
        },
        clear: () => undefined,
      },
    });

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ access_token: 'jwt-stored', tier: 'elite' });
  });

  it('throws QTSAuthError when the stub returns 401', async () => {
    handler = (_req, res) => {
      jsonResponse(res, 401, {
        code: 'invalid_apikey',
        message: 'no such apikey',
      });
    };

    const { QTSAuthError } = await import('../../src/errors');
    await expect(authenticate('ak_bad', { baseUrl })).rejects.toBeInstanceOf(QTSAuthError);
  });
});
