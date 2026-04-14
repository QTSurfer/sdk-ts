import { QTSCanceledError, QTSTimeoutError } from './errors';

export interface PollOptions<T> {
  fn: (signal?: AbortSignal) => Promise<T>;
  isDone: (result: T) => boolean;
  isError?: (result: T) => false | Error;
  intervalMs?: number;
  maxIntervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function poll<T>(opts: PollOptions<T>): Promise<T> {
  const {
    fn,
    isDone,
    isError,
    intervalMs = 500,
    maxIntervalMs = 5000,
    timeoutMs,
    signal,
  } = opts;

  const start = Date.now();
  let interval = intervalMs;

  while (true) {
    if (signal?.aborted) throw new QTSCanceledError('Poll aborted');
    if (timeoutMs && Date.now() - start > timeoutMs) {
      throw new QTSTimeoutError(`Poll exceeded ${timeoutMs}ms`);
    }

    const result = await fn(signal);

    const err = isError?.(result);
    if (err) throw err;

    if (isDone(result)) return result;

    await sleep(interval, signal);
    interval = Math.min(Math.floor(interval * 1.5), maxIntervalMs);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new QTSCanceledError('Sleep aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
