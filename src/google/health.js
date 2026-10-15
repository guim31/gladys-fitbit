// -----------------------------------------------------------------------------
// Client of the Google Health API v4 (https://health.googleapis.com), the
// successor of the Fitbit Web API: read-only, the few endpoints the device
// needs. Shapes taken from Google's discovery document and from the fixtures
// of the Home Assistant `google_health` integration (test/fixtures).
//
// Every int64 of the API (steps, minutes, millimeters…) travels as a JSON
// string: the readers below convert, the callers get numbers.
// -----------------------------------------------------------------------------

import { classifyApiError, ERROR_KINDS, networkError } from './errors.js';

export const API_URL = 'https://health.googleapis.com';
const REQUEST_TIMEOUT_MS = 15000;
const MAX_DEVICE_PAGES = 3;

export const DATA_TYPES = Object.freeze({
  STEPS: 'steps',
  DISTANCE: 'distance',
  FLOORS: 'floors',
  TOTAL_CALORIES: 'total-calories',
  ACTIVE_MINUTES: 'active-minutes',
  RESTING_HEART_RATE: 'daily-resting-heart-rate',
  SLEEP: 'sleep',
  WEIGHT: 'weight',
  BODY_FAT: 'body-fat',
});

/**
 * @param {object} options
 * @param {{ accessToken: () => Promise<string>, expireAccessToken: () => Promise<void> }} options.auth
 * @param {typeof fetch} [options.fetch]
 */
export function createHealthClient({ auth, fetch = globalThis.fetch }) {
  async function request(method, path, { query, body } = {}, retried = false) {
    const token = await auth.accessToken();
    const url = new URL(`${API_URL}/${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, String(value));
    }
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw networkError(err);
    }
    const json = await response.json().catch(() => null);
    if (response.ok) {
      return json ?? {};
    }
    const error = classifyApiError(response.status, json);
    if (error.kind === ERROR_KINDS.REVOKED && !retried) {
      // The access token died before its time: refresh once and try again.
      await auth.expireAccessToken();
      return request(method, path, { query, body }, true);
    }
    throw error;
  }

  return {
    /** `{ healthUserId, legacyUserId }`: the stable ids of the account. */
    async identity() {
      return request('GET', 'v4/users/me/identity');
    },

    /** Account settings: `timeZone` (IANA) is the one used here. */
    async settings() {
      return request('GET', 'v4/users/me/settings');
    },

    /**
     * Daily rollup of one data type for one calendar day of the account.
     * @param {string} dataType
     * @param {{ year: number, month: number, day: number }} date
     * @returns {Promise<object|null>} the rollup point, null when no data yet
     */
    async dailyRollup(dataType, date) {
      const json = await request(
        'POST',
        `v4/users/me/dataTypes/${dataType}/dataPoints:dailyRollUp`,
        {
          body: {
            range: { start: { date }, end: { date: nextDay(date) } },
            windowSizeDays: 1,
          },
        },
      );
      return json.rollupDataPoints?.[0] ?? null;
    },

    /**
     * The latest data points of a type, newest first.
     * @param {string} dataType
     * @param {number} pageSize
     */
    async latest(dataType, pageSize = 1) {
      const json = await request('GET', `v4/users/me/dataTypes/${dataType}/dataPoints`, {
        query: { pageSize },
      });
      return Array.isArray(json.dataPoints) ? json.dataPoints : [];
    },

    /** The trackers and scales paired with the account. */
    async pairedDevices() {
      const devices = [];
      let pageToken;
      for (let page = 0; page < MAX_DEVICE_PAGES; page += 1) {
        const json = await request('GET', 'v4/users/me/pairedDevices', {
          query: pageToken ? { pageToken } : {},
        });
        devices.push(...(Array.isArray(json.pairedDevices) ? json.pairedDevices : []));
        pageToken = json.nextPageToken;
        if (!pageToken) {
          break;
        }
      }
      return devices;
    },
  };
}

/** The calendar day after `date` (Google Date object). */
export function nextDay({ year, month, day }) {
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

/** Today's calendar date in an IANA time zone. */
export function todayIn(timeZone, now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(now));
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** A number from an int64 string or a number; null otherwise. */
export function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
