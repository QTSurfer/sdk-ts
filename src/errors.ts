export class QTSError extends Error {
  /** HTTP status code, when the underlying transport surfaced one. */
  readonly status?: number;
  constructor(message: string, readonly cause?: unknown, status?: number) {
    super(message);
    this.name = 'QTSError';
    if (status !== undefined) this.status = status;
  }
}

export class QTSStrategyCompileError extends QTSError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'QTSStrategyCompileError';
  }
}

export class QTSPreparationError extends QTSError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'QTSPreparationError';
  }
}

export class QTSExecutionError extends QTSError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'QTSExecutionError';
  }
}

export class QTSTimeoutError extends QTSError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'QTSTimeoutError';
  }
}

export class QTSCanceledError extends QTSError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'QTSCanceledError';
  }
}

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
