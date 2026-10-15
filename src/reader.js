// -----------------------------------------------------------------------------
// One read of the account: the figures of the day, last night's sleep, the
// latest weight and body fat, the watch battery and its last sync. Pure data
// out of the Google Health API, no Gladys here.
//
// Requests per cycle: 5 daily rollups (steps, distance, floors, calories,
// active minutes), resting heart rate, sleep, paired devices = 8. Weight and
// body fat change once a day at most: read once an hour. The time zone of the
// account (which "today" the rollups mean) once a day.
// -----------------------------------------------------------------------------

import { DATA_TYPES, todayIn, toNumber } from './google/health.js';
import { ERROR_KINDS } from './google/errors.js';
import { SCOPES } from './google/oauth.js';

export const BODY_PERIOD_MS = 60 * 60 * 1000;
export const SETTINGS_PERIOD_MS = 24 * 60 * 60 * 1000;
const SLEEP_PAGE_SIZE = 5;

// Fitbit's "active minutes" are its fairly and very active minutes; light
// activity is not counted (the figure of the Fitbit app).
const ACTIVE_LEVELS = new Set(['MODERATE', 'VIGOROUS']);

// Older trackers report a battery status without a level.
const BATTERY_STATUS_LEVELS = { HIGH: 100, MEDIUM: 50, LOW: 20, EMPTY: 0 };

/** The time zone of the container (TZ, injected by the Gladys supervisor). */
export function localTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/**
 * @param {object} options
 * @param {ReturnType<import('./google/health.js').createHealthClient>} options.client
 * @param {() => Promise<Set<string>>} options.grantedScopes
 * @param {() => number} [options.now]
 */
export function createReader({ client, grantedScopes, now = Date.now }) {
  let body = null;
  let bodyAt = -Infinity;
  let timeZone = null;
  let timeZoneAt = -Infinity;
  // Scopes Google refused although the token claims them: skipped until restart.
  const refusedScopes = new Set();

  /** Run a read needing one scope; null when the user did not grant it. */
  async function withScope(scope, read, scopes) {
    if ((scopes.size > 0 && !scopes.has(scope)) || refusedScopes.has(scope)) {
      return null;
    }
    try {
      return await read();
    } catch (err) {
      if (err.kind === ERROR_KINDS.SCOPE) {
        refusedScopes.add(scope);
        return null;
      }
      throw err;
    }
  }

  async function accountTimeZone(scopes) {
    if (timeZone && now() - timeZoneAt < SETTINGS_PERIOD_MS) {
      return timeZone;
    }
    const settings = await withScope(SCOPES.SETTINGS, () => client.settings(), scopes);
    const zone = settings?.timeZone;
    timeZone = isValidTimeZone(zone) ? zone : localTimeZone();
    timeZoneAt = now();
    return timeZone;
  }

  return {
    /** Forget the cached body figures and time zone (a new account). */
    reset() {
      body = null;
      bodyAt = -Infinity;
      timeZone = null;
      timeZoneAt = -Infinity;
      refusedScopes.clear();
    },

    /** Scopes refused by Google so far (for the connection status). */
    refusedScopes() {
      return new Set(refusedScopes);
    },

    /** @returns {Promise<Snapshot>} */
    async read() {
      const scopes = await grantedScopes();
      const zone = await accountTimeZone(scopes);
      const date = todayIn(zone, now());

      const rollup = (type) =>
        withScope(SCOPES.ACTIVITY, () => client.dailyRollup(type, date), scopes);
      const [steps, distance, floors, calories, active, heart, sleepPoints, devices] =
        await Promise.all([
          rollup(DATA_TYPES.STEPS),
          rollup(DATA_TYPES.DISTANCE),
          rollup(DATA_TYPES.FLOORS),
          rollup(DATA_TYPES.TOTAL_CALORIES),
          rollup(DATA_TYPES.ACTIVE_MINUTES),
          withScope(
            SCOPES.MEASUREMENTS,
            () => client.latest(DATA_TYPES.RESTING_HEART_RATE, 1),
            scopes,
          ),
          withScope(SCOPES.SLEEP, () => client.latest(DATA_TYPES.SLEEP, SLEEP_PAGE_SIZE), scopes),
          withScope(SCOPES.SETTINGS, () => client.pairedDevices(), scopes),
        ]);

      if (now() - bodyAt >= BODY_PERIOD_MS) {
        const [weight, fat] = await Promise.all([
          withScope(SCOPES.MEASUREMENTS, () => client.latest(DATA_TYPES.WEIGHT, 1), scopes),
          withScope(SCOPES.MEASUREMENTS, () => client.latest(DATA_TYPES.BODY_FAT, 1), scopes),
        ]);
        body = parseBody(weight, fat);
        bodyAt = now();
      }

      const activityGranted = steps !== null || distance !== null;
      return {
        timeZone: zone,
        date: `${date.year}-${pad(date.month)}-${pad(date.day)}`,
        activity: activityGranted
          ? parseActivity({ steps, distance, floors, calories, active })
          : null,
        restingHeartRate: heart === null ? undefined : parseRestingHeartRate(heart),
        sleep: sleepPoints === null ? undefined : parseSleep(sleepPoints),
        body,
        tracker: devices === null ? undefined : parseTracker(devices),
      };
    },
  };
}

/**
 * @typedef {object} Snapshot
 * @property {string} timeZone
 * @property {string} date YYYY-MM-DD, today in the account's time zone
 * @property {{ steps: number, distanceKm: number, floors: number, calories: number|null, activeMinutes: number }|null} activity
 * @property {number|null|undefined} restingHeartRate undefined: not granted
 * @property {Sleep|null|undefined} sleep
 * @property {{ weightKg: number|null, bodyFat: number|null }|null} body
 * @property {{ battery: number|null, lastSync: string|null, model: string|null }|null|undefined} tracker
 */

// A day without data has no rollup point: zero, the day only started.
export function parseActivity({ steps, distance, floors, calories, active }) {
  const levels = active?.activeMinutes?.activeMinutesRollupByActivityLevel ?? [];
  return {
    steps: toNumber(steps?.steps?.countSum) ?? 0,
    distanceKm: round((toNumber(distance?.distance?.millimetersSum) ?? 0) / 1e6, 2),
    floors: toNumber(floors?.floors?.countSum) ?? 0,
    // Total calories include the basal metabolism: never 0 once the day has
    // started, so an absent point means "not computed yet", not zero.
    calories: calories ? Math.round(toNumber(calories.totalCalories?.kcalSum) ?? 0) : null,
    activeMinutes: levels
      .filter((level) => ACTIVE_LEVELS.has(level.activityLevel))
      .reduce((sum, level) => sum + (toNumber(level.activeMinutesSum) ?? 0), 0),
  };
}

export function parseRestingHeartRate(points) {
  return toNumber(points[0]?.dailyRestingHeartRate?.beatsPerMinute);
}

/**
 * @typedef {object} Sleep
 * @property {string} id the data point name, unique per night
 * @property {string} start ISO instant
 * @property {string} end ISO instant
 * @property {number|null} startOffsetMinutes UTC offset where the night began
 * @property {number|null} endOffsetMinutes UTC offset where it ended
 * @property {number} minutesAsleep
 * @property {number} minutesInBed
 * @property {number|null} efficiency percent
 */

/**
 * The latest finished main sleep: a session still in progress has no summary
 * yet, and a nap is not the night.
 * @returns {Sleep|null}
 */
export function parseSleep(points) {
  const nights = points
    .map((point) => ({ name: point.name, sleep: point.sleep }))
    .filter(
      ({ sleep }) =>
        sleep?.summary &&
        sleep.interval?.startTime &&
        sleep.interval?.endTime &&
        !sleep.metadata?.nap,
    )
    .sort((a, b) => Date.parse(b.sleep.interval.endTime) - Date.parse(a.sleep.interval.endTime));
  const night = nights[0];
  if (!night) {
    return null;
  }
  const { interval, summary } = night.sleep;
  const asleep = toNumber(summary.minutesAsleep) ?? 0;
  const inBed =
    toNumber(summary.minutesInSleepPeriod) ??
    Math.round((Date.parse(interval.endTime) - Date.parse(interval.startTime)) / 60000);
  return {
    id: night.name ?? `sleep:${interval.startTime}`,
    start: new Date(interval.startTime).toISOString(),
    end: new Date(interval.endTime).toISOString(),
    startOffsetMinutes: parseUtcOffset(interval.startUtcOffset),
    endOffsetMinutes: parseUtcOffset(interval.endUtcOffset),
    minutesAsleep: asleep,
    minutesInBed: inBed,
    // Time asleep over the time between bedtime and wake time.
    efficiency: inBed > 0 ? Math.min(100, Math.round((asleep / inBed) * 100)) : null,
  };
}

export function parseBody(weightPoints, fatPoints) {
  const grams = toNumber(weightPoints?.[0]?.weight?.weightGrams);
  const fat = toNumber(fatPoints?.[0]?.bodyFat?.percentage);
  return {
    weightKg: grams === null ? null : round(grams / 1000, 1),
    bodyFat: fat === null ? null : round(fat, 1),
  };
}

/**
 * The watch or band: among the trackers, the one synced last. Scales are
 * left out (their battery is not "the watch's").
 */
export function parseTracker(devices) {
  const trackers = devices
    .filter((device) => device && device.deviceType !== 'SCALE')
    .sort((a, b) => (Date.parse(b.lastSyncTime) || 0) - (Date.parse(a.lastSyncTime) || 0));
  const tracker = trackers.find((device) => device.deviceType === 'TRACKER') ?? trackers[0];
  if (!tracker) {
    return null;
  }
  const level = toNumber(tracker.batteryLevel);
  const status = BATTERY_STATUS_LEVELS[String(tracker.batteryStatus ?? '').toUpperCase()];
  const lastSync = Date.parse(tracker.lastSyncTime);
  return {
    battery: level ?? status ?? null,
    lastSync: Number.isNaN(lastSync) ? null : new Date(lastSync).toISOString(),
    model: typeof tracker.deviceVersion === 'string' ? tracker.deviceVersion : null,
  };
}

/**
 * A UTC offset as Google sends it: a protobuf duration ("-25200s", "3600.5s")
 * or, in some answers, "+02:00". Minutes, or null.
 */
export function parseUtcOffset(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const seconds = value.match(/^(-?\d+(?:\.\d+)?)s$/);
  if (seconds) {
    return Math.round(Number(seconds[1]) / 60);
  }
  const clock = value.match(/^([+-])(\d{2}):(\d{2})$/);
  if (clock) {
    const minutes = Number(clock[2]) * 60 + Number(clock[3]);
    return clock[1] === '-' ? -minutes : minutes;
  }
  return null;
}

export function isValidTimeZone(zone) {
  if (typeof zone !== 'string' || zone === '') {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const pad = (n) => String(n).padStart(2, '0');
const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;
