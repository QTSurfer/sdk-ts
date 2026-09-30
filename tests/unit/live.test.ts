import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiSendLiveCommand = vi.fn();

vi.mock('@qtsurfer/api-client', () => ({
  sendLiveCommand: apiSendLiveCommand,
}));

const ok = <T>(data: T, status = 202) => ({ data, error: undefined, response: { status } as Response });

describe('live commands', () => {
  beforeEach(() => apiSendLiveCommand.mockReset());

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
