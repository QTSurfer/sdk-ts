import { describe, expect, it } from 'vitest';
import {
  QTSCanceledError,
  QTSError,
  QTSExecutionError,
  QTSPreparationError,
  QTSStrategyCompileError,
  QTSTimeoutError,
} from '../../src/errors';

describe('error hierarchy', () => {
  const cases = [
    ['QTSStrategyCompileError', QTSStrategyCompileError],
    ['QTSPreparationError', QTSPreparationError],
    ['QTSExecutionError', QTSExecutionError],
    ['QTSTimeoutError', QTSTimeoutError],
    ['QTSCanceledError', QTSCanceledError],
  ] as const;

  for (const [name, Ctor] of cases) {
    it(`${name} extends QTSError and carries message + cause`, () => {
      const cause = new Error('root cause');
      const err = new Ctor('boom', cause);

      expect(err).toBeInstanceOf(QTSError);
      expect(err).toBeInstanceOf(Ctor);
      expect(err.message).toBe('boom');
      expect(err.cause).toBe(cause);
      expect(err.name).toBe(name);
    });
  }

  it('distinguishes subclasses via instanceof', () => {
    const err = new QTSPreparationError('prep broke');
    expect(err).toBeInstanceOf(QTSError);
    expect(err).not.toBeInstanceOf(QTSExecutionError);
    expect(err).not.toBeInstanceOf(QTSStrategyCompileError);
  });

  it('preserves structured authorization and retry guidance from API errors and job states', () => {
    const denied = new QTSError('Forbidden', {
      code: 'insufficient_scope', message: 'Missing scope', required: 'datasets:read',
    }, 403);
    expect(denied).toMatchObject({ code: 'insufficient_scope', required: 'datasets:read', status: 403 });

    const transient = new QTSError('Temporary failure', { reason: 'TEMPORARILY_UNAVAILABLE', retryable: true });
    expect(transient).toMatchObject({ reason: 'TEMPORARILY_UNAVAILABLE', retryable: true });

    const job = new QTSExecutionError('Execution failed', { retryable: true });
    expect(job.retryable).toBe(true);
  });

  it('preserves the optional plan upgrade URL from a 402 response', () => {
    const denied = new QTSError('Plan required', {
      code: 'plan_required', message: 'Pro indicators need an eligible plan',
      retryable: false, upgradeUrl: 'https://www.qtsurfer.com/pricing',
    }, 402);
    expect(denied).toMatchObject({
      status: 402,
      retryable: false,
      upgradeUrl: 'https://www.qtsurfer.com/pricing',
    });
  });
});
