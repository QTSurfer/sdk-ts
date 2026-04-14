import { beforeEach, describe, expect, it, vi } from 'vitest';

const setConfig = vi.fn();

vi.mock('@qtsurfer/api-client', () => ({
  client: { setConfig },
  postStrategy: vi.fn(),
  getStrategyStatus: vi.fn(),
  prepareBacktesting: vi.fn(),
  getPreparationStatus: vi.fn(),
  executeBacktesting: vi.fn(),
  getExecutionResult: vi.fn(),
  cancelExecution: vi.fn(),
}));

describe('QTSurfer client', () => {
  beforeEach(() => {
    setConfig.mockClear();
  });

  it('propagates baseUrl to api-client singleton', async () => {
    const { QTSurfer } = await import('../../src/client');
    new QTSurfer({ baseUrl: 'https://example.test/v1' });

    expect(setConfig).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://example.test/v1' }),
    );
  });

  it('sets Authorization header when token is provided', async () => {
    const { QTSurfer } = await import('../../src/client');
    new QTSurfer({ baseUrl: 'https://example.test/v1', token: 't0k3n' });

    expect(setConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { Authorization: 'Bearer t0k3n' },
      }),
    );
  });

  it('omits Authorization header when no token is provided', async () => {
    const { QTSurfer } = await import('../../src/client');
    new QTSurfer({ baseUrl: 'https://example.test/v1' });

    const call = setConfig.mock.calls.at(-1)?.[0];
    expect(call?.headers).toBeUndefined();
  });

  it('passes custom fetch when provided', async () => {
    const { QTSurfer } = await import('../../src/client');
    const customFetch = vi.fn() as unknown as typeof fetch;
    new QTSurfer({ baseUrl: 'https://example.test/v1', fetch: customFetch });

    expect(setConfig).toHaveBeenCalledWith(
      expect.objectContaining({ fetch: customFetch }),
    );
  });
});
