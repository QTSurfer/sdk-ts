import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { LiveRunDetail, LiveRunWithStream, StartLiveRequest } from '@qtsurfer/api-client';

const apiSendLiveCommand = vi.fn();
const apiStartLive = vi.fn();
const apiGetLive = vi.fn();
const apiGetLiveRun = vi.fn();
const apiRotateLiveStream = vi.fn();
const apiRevokeLiveStream = vi.fn();

vi.mock('@qtsurfer/api-client', () => ({
  sendLiveCommand: apiSendLiveCommand,
  startLive: apiStartLive,
  getLive: apiGetLive,
  getLiveRun: apiGetLiveRun,
  rotateLiveStream: apiRotateLiveStream,
  revokeLiveStream: apiRevokeLiveStream,
}));

const ok = <T>(data: T, status = 202) => ({ data, error: undefined, response: { status } as Response });

describe('live commands', () => {
  beforeEach(() => {
    apiSendLiveCommand.mockReset();
    apiStartLive.mockReset();
    apiGetLive.mockReset();
    apiGetLiveRun.mockReset();
    apiRotateLiveStream.mockReset();
    apiRevokeLiveStream.mockReset();
  });

  it('sets warm-up on start and accepts omitted values on runs that predate the field', async () => {
    const { startLive, getLive } = await import('../../src/live');
    expectTypeOf<StartLiveRequest['warmFrom']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<StartLiveRequest['sandbox']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<LiveRunWithStream['warmFrom']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<LiveRunDetail['warmFrom']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<StartLiveRequest['sources'][number]['instruments']>().toEqualTypeOf<string[] | undefined>();

    const request = {
      sources: [{ venueType: 'cx', exchange: 'binance', segment: 'spot', type: 'ticker' }],
      warmFrom: 0,
      sandbox: true,
    } satisfies StartLiveRequest;
    const started = { runId: 'run-1', warmFrom: 0 };
    apiStartLive.mockResolvedValueOnce(ok(started, 201));

    await expect(startLive('strategy-1', request)).resolves.toEqual(started);
    expect(apiStartLive).toHaveBeenCalledWith({ path: { strategyId: 'strategy-1' }, body: request });

    const historical = { runId: 'old-run' };
    apiGetLive.mockResolvedValueOnce(ok(historical, 200));
    await expect(getLive('strategy-1')).resolves.toEqual(historical);
  });

  it('reads a run by id with its freshness and statistics', async () => {
    const run = {
      runId: 'run-1',
      updatedAtMs: 1_758_330_015_000,
      stats: { processed: 120, opsPerSecond: 2, instrumentsSeen: 1, asOfMs: 1_758_330_015_000, stale: false },
    };
    apiGetLiveRun.mockResolvedValueOnce(ok(run, 200));
    const { getLiveRun } = await import('../../src/live');

    await expect(getLiveRun('run-1')).resolves.toEqual(run);
    expect(apiGetLiveRun).toHaveBeenCalledWith({ path: { runId: 'run-1' } });
  });

  it('rotates a run stream URL and preserves plan errors', async () => {
    const stream = { streamUrl: 'wss://stream.example/new' };
    apiRotateLiveStream.mockResolvedValueOnce(ok(stream, 200));
    const { rotateLiveStream } = await import('../../src/live');

    await expect(rotateLiveStream('run-1')).resolves.toEqual(stream);
    expect(apiRotateLiveStream).toHaveBeenCalledWith({ path: { runId: 'run-1' } });

    apiRotateLiveStream.mockResolvedValueOnce({
      data: undefined,
      error: { code: 'plan_limit', message: 'Plan cannot broadcast' },
      response: { status: 429 } as Response,
    });
    await expect(rotateLiveStream('run-1')).rejects.toMatchObject({ status: 429 });
  });

  it('revokes a stream without changing the run', async () => {
    const result = { runId: 'run-1', revoked: true };
    apiRevokeLiveStream.mockResolvedValueOnce(ok(result, 200));
    const { revokeLiveStream } = await import('../../src/live');

    await expect(revokeLiveStream('run-1')).resolves.toEqual(result);
    expect(apiRevokeLiveStream).toHaveBeenCalledWith({ path: { runId: 'run-1' } });
  });

  it('sends a transient command with strategy-defined properties', async () => {
    const result = {
      runId: 'run-1',
      commandId: 'cmd-1',
      effectiveAtMs: 1_758_330_015_000,
    };
    apiSendLiveCommand.mockResolvedValueOnce(ok(result));
    const { sendLiveCommand } = await import('../../src/live');
    const request = { command: 'flatten', properties: { instrument: 'BTC/USDT' } };

    await expect(sendLiveCommand('run-1', request)).resolves.toEqual(result);
    expect(apiSendLiveCommand).toHaveBeenCalledWith({ path: { runId: 'run-1' }, body: request });
  });

  it('preserves the HTTP status when the command cannot be delivered', async () => {
    apiSendLiveCommand.mockResolvedValueOnce({
      data: undefined,
      error: { code: 'unavailable', message: 'command was not sent' },
      response: { status: 503 } as Response,
    });
    const { sendLiveCommand } = await import('../../src/live');

    await expect(sendLiveCommand('run-1', { command: 'flatten' })).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining('command was not sent'),
    });
  });
});
