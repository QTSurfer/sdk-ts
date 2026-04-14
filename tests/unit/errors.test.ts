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
});
