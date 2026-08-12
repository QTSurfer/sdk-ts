import { QTSError } from '../errors';

/**
 * Build the {@link QTSError} for a failed single-request call.
 *
 * The HTTP status is attached to the error rather than only rendered into the
 * message, because callers branch on it — a `4xx` means the request itself was
 * wrong, a `5xx` is generally worth retrying, and the authenticated session
 * re-mints its JWT on a `401`.
 *
 * @param what short description of the call, e.g. `'exchanges call'`
 * @param error the api-client error payload
 * @param status HTTP status of the failing response
 *
 * @internal
 */
export function requestFailed(
  what: string,
  error: unknown,
  status?: number,
): QTSError {
  const prefix = status === undefined ? '' : `HTTP ${status} — `;
  return new QTSError(`${what} failed: ${prefix}${describe(error)}`, error, status);
}

function describe(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { code?: unknown; message?: unknown };
    const code = typeof e.code === 'string' || typeof e.code === 'number' ? e.code : undefined;
    const message = typeof e.message === 'string' ? e.message : undefined;
    if (code !== undefined && message) return `${code}: ${message}`;
    if (message) return message;
    if (code !== undefined) return String(code);
  }
  return String(error);
}
