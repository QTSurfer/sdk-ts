export class QTSError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'QTSError';
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
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'QTSDownloadError';
  }
}
