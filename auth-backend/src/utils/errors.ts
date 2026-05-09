// Error codes are lowercase machine-readable identifiers — wire-compatible
// with the v2 frontend contract. Routes may also pass route-specific codes
// (e.g. 'opportunity_not_found', 'already_rsvped', 'not_attendee', 'event_started').
export type ErrorCode =
  | 'invalid_body'
  | 'validation_failed'
  | 'unauthorized'
  | 'expired'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'upstream'
  | 'internal'
  // Route-specific codes (free-form strings allowed below; these are the
  // canonical contract names when a generic code isn't precise enough).
  | 'opportunity_not_found'
  | 'user_not_found'
  | 'not_attendee'
  | 'already_rsvped'
  | 'event_started'
  | 'invalid_init_data'
  | 'expired_init_data'
  | (string & {});

export interface ErrorEnvelope {
  ok: false;
  error: ErrorCode;
  message: string;
  details?: unknown;
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
      ok: false,
      error: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }

  static validation(message: string, details?: unknown) {
    return new AppError({ code: 'validation_failed', message, statusCode: 400, details });
  }
  static unauthenticated(message = 'Authentication required') {
    return new AppError({ code: 'unauthorized', message, statusCode: 401 });
  }
  static expired(message = 'Token expired') {
    return new AppError({ code: 'expired', message, statusCode: 401 });
  }
  static forbidden(message = 'Forbidden', code: ErrorCode = 'forbidden') {
    return new AppError({ code, message, statusCode: 403 });
  }
  static notFound(message = 'Not found', code: ErrorCode = 'not_found') {
    return new AppError({ code, message, statusCode: 404 });
  }
  static conflict(message: string, code: ErrorCode = 'conflict') {
    return new AppError({ code, message, statusCode: 409 });
  }
  static upstream(message: string, details?: unknown) {
    return new AppError({ code: 'upstream', message, statusCode: 502, details });
  }
  static internal(message = 'Internal server error') {
    return new AppError({ code: 'internal', message, statusCode: 500 });
  }
}
