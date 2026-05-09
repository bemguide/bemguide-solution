export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL';

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(opts: { code: ErrorCode; message: string; statusCode: number; details?: unknown }) {
    super(opts.message);
    this.code = opts.code;
    this.statusCode = opts.statusCode;
    this.details = opts.details;
  }

  toEnvelope(): ErrorEnvelope {
    return {
      error: { code: this.code, message: this.message, details: this.details },
    };
  }

  static validation(message: string, details?: unknown) {
    return new AppError({ code: 'VALIDATION_FAILED', message, statusCode: 400, details });
  }
  static unauthenticated(message = 'Authentication required') {
    return new AppError({ code: 'UNAUTHENTICATED', message, statusCode: 401 });
  }
  static forbidden(message = 'Forbidden') {
    return new AppError({ code: 'FORBIDDEN', message, statusCode: 403 });
  }
  static notFound(message = 'Not found') {
    return new AppError({ code: 'NOT_FOUND', message, statusCode: 404 });
  }
  static conflict(message: string) {
    return new AppError({ code: 'CONFLICT', message, statusCode: 409 });
  }
  static upstream(message: string, details?: unknown) {
    return new AppError({ code: 'UPSTREAM_ERROR', message, statusCode: 502, details });
  }
  static internal(message = 'Internal server error') {
    return new AppError({ code: 'INTERNAL', message, statusCode: 500 });
  }
}
