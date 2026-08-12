/**
 * Base class for every error the SDK throws. Catch this to handle all SDK
 * failures generically, or catch a specific subclass below to tell which
 * stage failed. `status` is only set when the throw site had an HTTP status
 * to attach: {@link QTSDownloadError} always carries one, and so does the
 * plain `QTSError` thrown by the single-request calls (`exchanges`,
 * `instruments`, `validateStrategy`, `strategy`). The workflow-stage errors
 * carry `cause` instead and encode retryability in their message.
 */
export class QTSError extends Error {
  /** HTTP status code, when the underlying transport surfaced one. */
  readonly status?: number;
  constructor(message: string, readonly cause?: unknown, status?: number) {
    super(message);
    this.name = 'QTSError';
    if (status !== undefined) this.status = status;
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
 * transport failure. Carries the HTTP `status` when one was received: a
 * `4xx` means the request itself is wrong (bad hour or instrument), while a
 * `5xx` or a missing status (transport failure) is generally safe to retry.
 */
export class QTSDownloadError extends QTSError {
  constructor(message: string, cause?: unknown, status?: number) {
    super(message, cause, status);
    this.name = 'QTSDownloadError';
  }
}

/**
 * Thrown by the `authenticate()` helper when the apikey is missing or the JWT
 * exchange fails (HTTP 401 from `POST /v1/auth/token`, etc.).
 */
export class QTSAuthError extends QTSError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'QTSAuthError';
  }
}
