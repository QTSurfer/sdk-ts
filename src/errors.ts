import type { ErrorNextCall } from '@qtsurfer/api-client';

/**
 * Base class for every error the SDK throws. Catch this to handle all SDK
 * failures generically, or catch a specific subclass below to tell which
 * stage failed. `status` is only set when the throw site had an HTTP status
 * to attach: {@link QTSDownloadError} carries one after an HTTP response, as does the
 * plain `QTSError` thrown by the single-request calls (`exchanges`,
 * `instruments`, `validateStrategy`, `strategy`). The workflow-stage errors
 * carry `cause` instead and encode retryability in their message.
 */
export class QTSError extends Error {
  /** HTTP status code, when the underlying transport surfaced one. */
  readonly status?: number;
  /** Stable server cause. Treat an unknown value like an absent reason. */
  readonly reason?: string;
  /** Suggested recovery request; caller-specific fields such as a name may be absent. */
  readonly next?: ErrorNextCall;
  constructor(message: string, readonly cause?: unknown, status?: number) {
    super(message);
    this.name = 'QTSError';
    if (status !== undefined) this.status = status;
    if (cause && typeof cause === 'object') {
      if ('reason' in cause && typeof cause.reason === 'string') this.reason = cause.reason;
      if ('next' in cause && isNextCall(cause.next)) this.next = cause.next;
    }
  }
}

/**
 * Thrown when strategy compilation fails. A `429` means the source was never
 * judged — too many compilations were already in flight — and is safe to
 * retry. Any other status (typically `400`) means the source itself does
 * not compile, so retrying with the same input fails again.
 */
export class QTSStrategyCompileError extends QTSError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'QTSStrategyCompileError';
  }
}

/**
 * Thrown when the data-preparation stage fails: submitting the prepare
 * request, polling its status, or a backend-reported preparation failure
 * (e.g. no data available for the requested range) all surface here.
 */
export class QTSPreparationError extends QTSError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'QTSPreparationError';
  }
}

/**
 * Thrown when the execute stage fails: submitting the execute request,
 * polling its result, or a backend-reported execution failure all surface
 * here.
 */
export class QTSExecutionError extends QTSError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'QTSExecutionError';
  }
}

/**
 * Thrown when a stage (prepare or execute) exceeds `timeoutMs`. The stage
 * may still be running server-side — this only means the SDK stopped
 * waiting locally — so it is fine to retry, optionally with a larger
 * `timeoutMs`.
 */
export class QTSTimeoutError extends QTSError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'QTSTimeoutError';
  }
}

/**
 * Thrown when a stage is aborted — either because the caller's
 * `AbortSignal` fired, or because the backend itself reported the
 * prepare/execute job as aborted. Either way this reflects a deliberate
 * stop, not a failure, and is not something to retry automatically.
 */
export class QTSCanceledError extends QTSError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'QTSCanceledError';
  }
}

/**
 * Thrown by the tickers/klines download functions on any non-2xx response or
 * transport failure. Inspect `reason`: `OUTSIDE_WINDOW` provides `next` for a
 * dataset import; `NOT_YET_AVAILABLE` and `TEMPORARILY_UNAVAILABLE` can be retried
 * after `retryAfter` seconds; `NO_DATA` means the stored hour has no rows.
 */
export class QTSDownloadError extends QTSError {
  /** Raw response headers, when a response was received. */
  readonly headers?: Headers;
  /** Server-provided delay, in seconds. Absent when no delay was given. */
  readonly retryAfter?: string;
  constructor(message: string, cause?: unknown, status?: number, headers?: Headers) {
    super(message, cause, status);
    this.name = 'QTSDownloadError';
    this.headers = headers;
    this.retryAfter = headers?.get('Retry-After') ?? undefined;
  }
}

function isNextCall(value: unknown): value is ErrorNextCall {
  return !!value && typeof value === 'object'
    && 'method' in value && typeof value.method === 'string'
    && ['GET', 'POST', 'PUT', 'DELETE'].includes(value.method)
    && 'path' in value && typeof value.path === 'string'
    && (!('body' in value) || value.body === undefined
      || (!!value.body && typeof value.body === 'object' && !Array.isArray(value.body)));
}

/**
 * Thrown by the `authenticate()` helper when the apikey is missing or the JWT
 * exchange fails. Invalid, revoked, or expired keys return `401`; a deployment
 * requiring scopes can return `403` / `apikey_without_scopes` without minting a
 * token. Create a key with at least one resource/action scope before trying again.
 */
export class QTSAuthError extends QTSError {
  /** Machine-readable server code, including `apikey_without_scopes` on a scope-required rejection. */
  readonly code?: string;
  constructor(message: string, cause?: unknown, status?: number) {
    super(message, cause, status);
    this.name = 'QTSAuthError';
    if (cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string') {
      this.code = cause.code;
    }
  }
}
