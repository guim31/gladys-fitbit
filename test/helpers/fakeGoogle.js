// -----------------------------------------------------------------------------
// A fake Google behind `fetch`: the OAuth token endpoint and the Google
// Health API v4, serving the fixtures of test/fixtures/google-health. Tests
// change `google.data`, inject errors per route and read `google.calls`.
// The tests never touch the network.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const fixture = (name) =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/google-health/${name}.json`, import.meta.url), 'utf8'),
  );

export const loadFixture = fixture;

export const CLIENT = {
  client_id: '123456789012-test.apps.googleusercontent.com',
  client_secret: 'GOCSPX-test-client-secret',
};
export const REDIRECT_URI = 'https://my.gladysassistant.com/redirect/oauth';
export const GOOD_CODE = '4/0AVG7fiQ-test-code';

/** The default answers: a full day of data. */
export function defaultData() {
  return {
    identity: fixture('identity'),
    settings: fixture('settings'),
    pairedDevices: fixture('paired_devices'),
    rollups: {
      steps: fixture('steps_int64'),
      distance: fixture('distance'),
      floors: fixture('floors'),
      'total-calories': fixture('total_calories'),
      'active-minutes': fixture('active_minutes'),
    },
    lists: {
      'daily-resting-heart-rate': fixture('resting_heart_rate'),
      sleep: fixture('sleep_stages_and_nap'),
      weight: fixture('weight'),
      'body-fat': fixture('body_fat'),
    },
  };
}

/**
 * @param {object} [options]
 * @param {number} [options.expiresIn] seconds of an access token
 */
export function createFakeGoogle({ expiresIn = 3600 } = {}) {
  let tokenCount = 0;
  const google = {
    data: defaultData(),
    /** Every request: `{ method, url, route, body, auth }`. */
    calls: [],
    /** route → { status, body } or 'network': the next answers of that route. */
    errors: new Map(),
    /** Refresh tokens Google accepts. */
    refreshTokens: new Set(),
    /** The access token currently valid. */
    accessToken: null,
    /** Scopes put in the token answers (null: the requested ones). */
    grantedScope: null,

    /** Routes read from Google Health (token endpoint excluded). */
    healthCalls() {
      return google.calls.filter((call) => call.route !== 'token');
    },

    /** Issue a refresh token as a previous Connect would have. */
    issueRefreshToken(token = 'refresh-1') {
      google.refreshTokens.add(token);
      return token;
    },

    async fetch(input, init = {}) {
      const url = new URL(String(input));
      const method = (init.method ?? 'GET').toUpperCase();
      const route = routeOf(url, method);
      const body =
        init.body instanceof URLSearchParams
          ? Object.fromEntries(init.body)
          : init.body
            ? JSON.parse(init.body)
            : undefined;
      const auth = init.headers?.authorization;
      google.calls.push({ method, url: url.toString(), route, body, auth });

      const error = google.errors.get(route) ?? google.errors.get('*');
      if (error === 'network') {
        throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
      }
      if (error) {
        return json(error.status, error.body);
      }
      if (route === 'token') {
        return token(body);
      }
      if (auth !== `Bearer ${google.accessToken}` || !google.accessToken) {
        return json(401, fixture('errors/unauthenticated'));
      }
      switch (route) {
        case 'identity':
          return json(200, google.data.identity);
        case 'settings':
          return json(200, google.data.settings);
        case 'pairedDevices':
          return json(200, google.data.pairedDevices);
        default:
          break;
      }
      const [kind, type] = route.split(':');
      if (kind === 'rollup') {
        return json(200, google.data.rollups[type] ?? { rollupDataPoints: [] });
      }
      if (kind === 'list') {
        const answer = google.data.lists[type] ?? { dataPoints: [] };
        const size = Number(url.searchParams.get('pageSize') ?? 100);
        return json(200, { dataPoints: (answer.dataPoints ?? []).slice(0, size) });
      }
      return json(404, { error: { code: 404, status: 'NOT_FOUND', message: 'no route' } });
    },
  };

  function token(body) {
    if (body.client_id !== CLIENT.client_id || body.client_secret !== CLIENT.client_secret) {
      return json(401, { error: 'invalid_client', error_description: 'Unauthorized' });
    }
    const scope =
      google.grantedScope ??
      [
        'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
        'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
        'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
        'https://www.googleapis.com/auth/googlehealth.settings.readonly',
      ].join(' ');
    tokenCount += 1;
    google.accessToken = `access-${tokenCount}`;
    if (body.grant_type === 'authorization_code') {
      if (body.code !== GOOD_CODE || !body.code_verifier || body.redirect_uri !== REDIRECT_URI) {
        return json(400, { error: 'invalid_grant', error_description: 'Bad Request' });
      }
      const refresh = google.issueRefreshToken(`refresh-${tokenCount}`);
      return json(200, {
        access_token: google.accessToken,
        expires_in: expiresIn,
        refresh_token: refresh,
        scope,
        token_type: 'Bearer',
      });
    }
    if (body.grant_type === 'refresh_token') {
      if (!google.refreshTokens.has(body.refresh_token)) {
        return json(400, {
          error: 'invalid_grant',
          error_description: 'Token has been expired or revoked.',
        });
      }
      return json(200, {
        access_token: google.accessToken,
        expires_in: expiresIn,
        scope,
        token_type: 'Bearer',
      });
    }
    return json(400, { error: 'unsupported_grant_type' });
  }

  return google;
}

function routeOf(url, method) {
  if (url.host === 'oauth2.googleapis.com') {
    return 'token';
  }
  const path = url.pathname;
  if (path === '/v4/users/me/identity') return 'identity';
  if (path === '/v4/users/me/settings') return 'settings';
  if (path === '/v4/users/me/pairedDevices') return 'pairedDevices';
  const rollup = path.match(/^\/v4\/users\/me\/dataTypes\/([a-z-]+)\/dataPoints:dailyRollUp$/);
  if (rollup && method === 'POST') return `rollup:${rollup[1]}`;
  const list = path.match(/^\/v4\/users\/me\/dataTypes\/([a-z-]+)\/dataPoints$/);
  if (list) return `list:${list[1]}`;
  return `unknown:${path}`;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
