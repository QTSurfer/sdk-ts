import { beforeEach, describe, expect, it, vi } from 'vitest';

const connection = vi.hoisted(() => ({
  history: vi.fn(),
  rpc: vi.fn(),
  on: vi.fn(),
  connect: vi.fn(),
  ready: vi.fn(),
  disconnect: vi.fn(),
  subscriptionOn: vi.fn(),
  subscribe: vi.fn(),
  subscriptionReady: vi.fn(),
  newSubscription: vi.fn(),
}));

vi.mock('centrifuge', () => ({
  Centrifuge: class {
    on = connection.on;
    connect = connection.connect;
    ready = connection.ready;
    disconnect = connection.disconnect;
    rpc = connection.rpc;
    newSubscription = connection.newSubscription;
  },
}));

describe('LiveConnection signal history', () => {
  beforeEach(() => {
    for (const mock of Object.values(connection)) mock.mockReset();
    connection.newSubscription.mockReturnValue({
      on: connection.subscriptionOn,
      subscribe: connection.subscribe,
      ready: connection.subscriptionReady,
      history: connection.history,
    });
    connection.ready.mockResolvedValue(undefined);
    connection.subscriptionReady.mockResolvedValue(undefined);
  });

  it('reads subscribed sandbox signals and retains their stream positions', async () => {
    const { LiveConnection } = await import('../../src/live');
    const onSignal = vi.fn();
    const live = await LiveConnection.connect('run-1', { onSignal }, async () => 'token');
    const signal = { signalId: 'signal-1', kind: 'BUY' };
    const onPublication = connection.subscriptionOn.mock.calls.find(([event]) => event === 'publication')?.[1];
    onPublication({ data: signal, offset: 41 });
    expect(onSignal).toHaveBeenCalledWith(signal, 41);
    connection.history.mockResolvedValueOnce({
      publications: [{ channel: 'sig:run-1', data: signal, offset: 41 }],
      offset: 41,
      epoch: 'epoch-1',
    });

    await expect(live.getSignalHistory()).resolves.toEqual({
      publications: [{ data: signal, offset: 41 }],
      offset: 41,
      epoch: 'epoch-1',
    });
    expect(connection.newSubscription).toHaveBeenCalledWith('sig:run-1');
    expect(connection.history).toHaveBeenCalledWith({ limit: 300, since: undefined });
  });

  it('passes a previous position and supports a position-only read', async () => {
    const { LiveConnection } = await import('../../src/live');
    const live = await LiveConnection.connect('run-1', { onSignal: vi.fn() }, async () => 'token');
    connection.history.mockResolvedValue({ publications: [], offset: 42, epoch: 'epoch-1' });

    await expect(live.getSignalHistory({ since: { offset: 41, epoch: 'epoch-1' } })).resolves.toEqual({
      publications: [], offset: 42, epoch: 'epoch-1',
    });
    expect(connection.history).toHaveBeenLastCalledWith({
      limit: 300,
      since: { offset: 41, epoch: 'epoch-1' },
    });

    await live.getSignalHistory({ limit: 0 });
    expect(connection.history).toHaveBeenLastCalledWith({ limit: 0, since: undefined });
  });

  it('preserves protocol errors when a position is lost or subscription is absent', async () => {
    const { LiveConnection } = await import('../../src/live');
    const live = await LiveConnection.connect('run-1', { onSignal: vi.fn() }, async () => 'token');
    const lost = { code: 112, message: 'unrecoverable position' };
    const notSubscribed = { code: 103, message: 'not subscribed' };
    connection.history.mockRejectedValueOnce(lost).mockRejectedValueOnce(notSubscribed);

    await expect(live.getSignalHistory({ since: { offset: 42, epoch: 'old' } })).rejects.toBe(lost);
    await expect(live.getSignalHistory()).rejects.toBe(notSubscribed);
  });

  it('rejects a malformed history reply without a publication offset', async () => {
    const { LiveConnection } = await import('../../src/live');
    const live = await LiveConnection.connect('run-1', { onSignal: vi.fn() }, async () => 'token');
    connection.history.mockResolvedValueOnce({
      publications: [{ channel: 'sig:run-1', data: { signalId: 'signal-1' } }],
      offset: 41,
      epoch: 'epoch-1',
    });

    await expect(live.getSignalHistory()).rejects.toThrow('Live signal history publication has no offset');
  });
});
