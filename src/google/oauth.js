// -----------------------------------------------------------------------------
// Google OAuth 2.0 for the Google Health API: authorization code with PKCE
// (S256), on the user's own Google Cloud OAuth client.
//
// The Connect button of the Configuration screen (manifest field `oauth2`)
// asks for the authorize URL, Gladys opens it, Google redirects to the fixed
// page https://my.gladysassistant.com/redirect/oauth, which bounces back to
// Gladys, which relays the code here. The redirect URI comes from Gladys with
// each call and is used as given (never hardcoded).
//
// Tokens live in /data (src/store.js). The access token lasts one hour and is
// refreshed a minute before it expires; one refresh at a time.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { ERROR_KINDS, HealthError, networkError } from './errors.js';

export const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const SCOPE_PREFIX = 'https://www.googleapis.com/auth/googlehealth.';
// Read-only, and only what the device shows: no profile, no location, no ECG.
export const SCOPES = Object.freeze({
  ACTIVITY: `${SCOPE_PREFIX}activity_and_fitness.readonly`,
  MEASUREMENTS: `${SCOPE_PREFIX}health_metrics_and_measurements.readonly`,
  SLEEP: `${SCOPE_PREFIX}sleep.readonly`,
  SETTINGS: `${SCOPE_PREFIX}settings.readonly`,
});

// A pending Connect is forgotten after 15 minutes.
const PENDING_TTL_MS = 15 * 60 * 1000;
// Refresh a minute before Google says the access token expires.
const EXPIRY_MARGIN_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 15000;

const base64url = (buffer) => buffer.toString('base64url');

/**
 * @param {object} options
 * @param {import('../store.js').Store} options.store
 * @param {() => { clientId: string, clientSecret: string }} options.getConfig
 * @param {typeof fetch} [options.fetch]
 * @param {() => number} [options.now]
 */
export function createAuth({ store, getConfig, fetch = globalThis.fetch, now = Date.now }) {
  /** state → { verifier, at } */
  const pending = new Map();
  let refreshing = null;

  async function postToken(params) {
    const { clientId, clientSecret } = getConfig();
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      ...params,
    });
    let response;
    try {
      response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw networkError(err);
    }
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      // Only Google's error label: the body of a token answer is never logged.
      const label = typeof json?.error === 'string' ? json.error : `HTTP ${response.status}`;
      if (label === 'invalid_grant') {
        throw new HealthError(
          ERROR_KINDS.REVOKED,
          'Google refused the authorization (invalid_grant)',
          response.status,
        );
      }
      if (['invalid_client', 'unauthorized_client'].includes(label) || response.status === 401) {
        throw new HealthError(
          ERROR_KINDS.CLIENT,
          `Google refused the OAuth client (${label})`,
          response.status,
        );
      }
      if (response.status >= 500) {
        throw new HealthError(
          ERROR_KINDS.SERVER,
          `Google token server error (${label})`,
          response.status,
        );
      }
      throw new HealthError(
        ERROR_KINDS.HTTP,
        `Google token request failed (${label})`,
        response.status,
      );
    }
    if (!json || typeof json.access_token !== 'string') {
      throw new HealthError(ERROR_KINDS.HTTP, 'Google token answer without access token');
    }
    return json;
  }

  async function saveTokens(json, previous = {}) {
    const tokens = {
      clientId: getConfig().clientId,
      accessToken: json.access_token,
      // Google sends a refresh token on the first exchange only (and again
      // when consent is asked again): keep the one we have otherwise.
      refreshToken: json.refresh_token ?? previous.refreshToken,
      expiresAt: now() + Math.max(60, Number(json.expires_in) || 3600) * 1000,
      scope: typeof json.scope === 'string' ? json.scope : (previous.scope ?? ''),
    };
    await store.set('tokens', tokens);
    return tokens;
  }

  /** Tokens of the current OAuth client, or null. */
  async function currentTokens() {
    const tokens = await store.get('tokens');
    if (!tokens?.refreshToken || tokens.clientId !== getConfig().clientId) {
      return null;
    }
    return tokens;
  }

  const auth = {
    /**
     * Build the Google consent URL for the Connect button.
     * @param {string} redirectUri the one Gladys gives, used as is
     */
    authorizeUrl(redirectUri) {
      const { clientId } = getConfig();
      for (const [state, entry] of pending) {
        if (now() - entry.at > PENDING_TTL_MS) {
          pending.delete(state);
        }
      }
      const state = base64url(randomBytes(24));
      const verifier = base64url(randomBytes(48));
      const challenge = base64url(createHash('sha256').update(verifier).digest());
      pending.set(state, { verifier, at: now() });
      const url = new URL(AUTHORIZE_URL);
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: Object.values(SCOPES).join(' '),
        // A refresh token, and asked again at each Connect: Google only sends
        // one on a consent, and a reconnection must get a fresh one.
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }).toString();
      return url.toString();
    },

    /**
     * The code came back through Gladys: exchange it, keep the tokens.
     * @returns {Promise<{ scope: string }>}
     */
    async exchangeCode({ code, state, redirectUri }) {
      const entry = pending.get(state);
      pending.delete(state);
      if (!entry || now() - entry.at > PENDING_TTL_MS) {
        throw new HealthError(ERROR_KINDS.HTTP, 'Unknown or expired connection attempt (state)');
      }
      if (typeof code !== 'string' || code === '') {
        throw new HealthError(ERROR_KINDS.HTTP, 'Google returned no authorization code');
      }
      const json = await postToken({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: entry.verifier,
      });
      if (!json.refresh_token) {
        throw new HealthError(ERROR_KINDS.HTTP, 'Google returned no refresh token');
      }
      const tokens = await saveTokens(json);
      return { scope: tokens.scope };
    },

    /** A refresh token exists for the configured client. */
    async isConnected() {
      return (await currentTokens()) !== null;
    },

    /** The scopes the user granted (space separated in Google's answer). */
    async grantedScopes() {
      const tokens = await currentTokens();
      return new Set((tokens?.scope ?? '').split(/\s+/).filter(Boolean));
    },

    /** A valid access token, refreshed when needed. */
    async accessToken() {
      const tokens = await currentTokens();
      if (!tokens) {
        throw new HealthError(ERROR_KINDS.NOT_CONNECTED, 'Google account not connected');
      }
      if (tokens.accessToken && tokens.expiresAt - EXPIRY_MARGIN_MS > now()) {
        return tokens.accessToken;
      }
      refreshing ??= (async () => {
        try {
          const json = await postToken({
            grant_type: 'refresh_token',
            refresh_token: tokens.refreshToken,
          });
          return await saveTokens(json, tokens);
        } catch (err) {
          if (err.kind === ERROR_KINDS.REVOKED) {
            // Dead for good: forget it, the user has to press Connect again.
            await store.set('tokens', undefined);
          }
          throw err;
        } finally {
          refreshing = null;
        }
      })();
      return (await refreshing).accessToken;
    },

    /** The access token was refused by the API: force a refresh next time. */
    async expireAccessToken() {
      const tokens = await store.get('tokens');
      if (tokens) {
        await store.set('tokens', { ...tokens, accessToken: undefined, expiresAt: 0 });
      }
    },

    /** Forget the tokens (another OAuth client, or a new Connect). */
    async forget() {
      await store.set('tokens', undefined);
    },
  };
  return auth;
}
