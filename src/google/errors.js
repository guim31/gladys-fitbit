// -----------------------------------------------------------------------------
// One error type for everything Google can answer, with a `kind` the rest of
// the code (connection status, logs, widget) can act on. Messages never carry
// a token, a code or a response body beyond Google's own error label.
// -----------------------------------------------------------------------------

export const ERROR_KINDS = Object.freeze({
  NOT_CONNECTED: 'not_connected', // no refresh token yet: press Connect
  REVOKED: 'revoked', // refresh token refused (revoked, expired, 7-day testing app)
  CLIENT: 'client', // client id / secret refused by Google
  API_DISABLED: 'api_disabled', // the Google Health API is not enabled in the project
  SCOPE: 'scope', // a permission was unticked on the consent screen
  NOT_LINKED: 'not_linked', // the Fitbit account is not migrated to Google Health
  FORBIDDEN: 'forbidden', // any other 403
  RATE_LIMIT: 'rate_limit', // 429
  NETWORK: 'network', // no answer, DNS, timeout
  SERVER: 'server', // 5xx
  HTTP: 'http', // anything else
});

export class HealthError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message safe to log
   * @param {number} [status]
   */
  constructor(kind, message, status) {
    super(message);
    this.name = 'HealthError';
    this.kind = kind;
    this.status = status;
  }
}

// The kinds the user has to fix: polling again without a change is useless.
export const USER_ACTION_KINDS = new Set([
  ERROR_KINDS.NOT_CONNECTED,
  ERROR_KINDS.REVOKED,
  ERROR_KINDS.CLIENT,
  ERROR_KINDS.API_DISABLED,
  ERROR_KINDS.NOT_LINKED,
]);

/**
 * Classify an error answer of the Google Health API (google.rpc.Status body,
 * or an OAuth error body) — see test/fixtures/google-health/errors.
 * @param {number} status HTTP status
 * @param {unknown} body parsed JSON, or null
 */
export function classifyApiError(status, body) {
  const error = body && typeof body === 'object' ? body.error : undefined;
  const reasons =
    error && typeof error === 'object' && Array.isArray(error.details)
      ? error.details.map((detail) => detail?.reason).filter(Boolean)
      : [];
  const statusText = error && typeof error === 'object' ? error.status : undefined;
  const message =
    error && typeof error === 'object' && typeof error.message === 'string' ? error.message : '';
  const label = [statusText ?? (typeof error === 'string' ? error : undefined), reasons[0]]
    .filter(Boolean)
    .join(' ');
  const describe = (text) => `${text} (HTTP ${status}${label ? `, ${label}` : ''})`;

  if (reasons.includes('SERVICE_DISABLED')) {
    return new HealthError(ERROR_KINDS.API_DISABLED, describe('API not enabled'), status);
  }
  if (
    reasons.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT') ||
    error === 'insufficient_scope' ||
    /insufficient authentication scopes/i.test(message)
  ) {
    return new HealthError(ERROR_KINDS.SCOPE, describe('permission not granted'), status);
  }
  if (statusText === 'FAILED_PRECONDITION' && /not linked/i.test(message)) {
    return new HealthError(ERROR_KINDS.NOT_LINKED, describe('account not linked'), status);
  }
  if (status === 429 || reasons.includes('RATE_LIMIT_EXCEEDED')) {
    return new HealthError(ERROR_KINDS.RATE_LIMIT, describe('quota exceeded'), status);
  }
  if (status === 401 || error === 'invalid_token') {
    return new HealthError(ERROR_KINDS.REVOKED, describe('access refused'), status);
  }
  if (status === 403) {
    return new HealthError(ERROR_KINDS.FORBIDDEN, describe('forbidden'), status);
  }
  if (status >= 500) {
    return new HealthError(ERROR_KINDS.SERVER, describe('Google server error'), status);
  }
  return new HealthError(ERROR_KINDS.HTTP, describe('unexpected answer'), status);
}

/** A fetch that threw (no HTTP answer at all). */
export function networkError(err) {
  const cause = err?.cause?.code ?? err?.name ?? 'error';
  return new HealthError(ERROR_KINDS.NETWORK, `Google unreachable (${cause})`);
}
