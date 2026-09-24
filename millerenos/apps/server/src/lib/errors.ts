export type ErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'access_expired'
  | 'not_configured'
  | 'feature_disabled'
  | 'payment_error'
  | 'ai_error'
  | 'internal';

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  quota_exceeded: 429,
  access_expired: 402,
  not_configured: 503,
  feature_disabled: 403,
  payment_error: 400,
  ai_error: 502,
  internal: 500,
};

/** Errors that are safe to show to clients. Anything else becomes a generic 500. */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const notFound = (what = 'Resource') => new AppError('not_found', `${what} not found`);
export const forbidden = (msg = 'Not allowed') => new AppError('forbidden', msg);
