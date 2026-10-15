// -----------------------------------------------------------------------------
// The Gladys device: one per Google account, read-only, every feature always
// declared (a permission refused or a scale never used leaves its feature
// without a value, the structure stays the same: no "Update" in Discover).
//
// Gladys knows no health category: the couples are the closest generic ones
// of the core (test/fixtures/gladys-feature-table.json). Counters without a
// unit carry it in their name; weight, body fat and sleep efficiency share
// `unknown/unknown`, which keeps their names on the dashboard (a type alone on
// a device shows its generic label instead of the feature name).
// -----------------------------------------------------------------------------

import { DEVICE_POLL_FREQUENCIES } from '@gladysassistant/integration-sdk';
import { formatClock, formatDateTime, NAMES } from './i18n.js';

export const DEVICE_TYPE = 'account';

// Feature keys: part of the external ids, permanent once published.
export const FEATURES = Object.freeze({
  STEPS: 'steps',
  DISTANCE: 'distance',
  FLOORS: 'floors',
  CALORIES: 'calories',
  ACTIVE_MINUTES: 'active-minutes',
  RESTING_HEART_RATE: 'resting-heart-rate',
  SLEEP_DURATION: 'sleep-duration',
  SLEEP_EFFICIENCY: 'sleep-efficiency',
  BEDTIME: 'bedtime',
  WAKE_TIME: 'wake-time',
  WEIGHT: 'weight',
  BODY_FAT: 'body-fat',
  BATTERY: 'battery',
  LAST_SYNC: 'last-sync',
});

const sensor = (category, type, min, max, unit) => ({ category, type, min, max, unit });
// min/max are NOT NULL in Gladys, text features included (0/0).
const SPECS = [
  [FEATURES.STEPS, 'steps', sensor('counter-sensor', 'integer', 0, 200000)],
  [FEATURES.DISTANCE, 'distance', sensor('distance-sensor', 'decimal', 0, 500, 'km')],
  [FEATURES.FLOORS, 'floors', sensor('counter-sensor', 'integer', 0, 2000)],
  [FEATURES.CALORIES, 'calories', sensor('counter-sensor', 'integer', 0, 20000)],
  [FEATURES.ACTIVE_MINUTES, 'activeMinutes', sensor('duration', 'integer', 0, 1440, 'minutes')],
  [FEATURES.RESTING_HEART_RATE, 'restingHeartRate', sensor('counter-sensor', 'integer', 0, 250)],
  [FEATURES.SLEEP_DURATION, 'sleepDuration', sensor('duration', 'decimal', 0, 24, 'hours')],
  [FEATURES.SLEEP_EFFICIENCY, 'sleepEfficiency', sensor('unknown', 'unknown', 0, 100, 'percent')],
  [FEATURES.BEDTIME, 'bedtime', sensor('text', 'text', 0, 0)],
  [FEATURES.WAKE_TIME, 'wakeTime', sensor('text', 'text', 0, 0)],
  [FEATURES.WEIGHT, 'weight', sensor('unknown', 'unknown', 0, 500)],
  [FEATURES.BODY_FAT, 'bodyFat', sensor('unknown', 'unknown', 0, 100, 'percent')],
  [FEATURES.BATTERY, 'battery', sensor('battery', 'integer', 0, 100, 'percent')],
  [FEATURES.LAST_SYNC, 'lastSync', sensor('text', 'text', 0, 0)],
];

/** Ids of the account device. `accountId`: the healthUserId of Google Health. */
export function deviceIds(gladys, accountId) {
  return gladys.externalIds(DEVICE_TYPE, accountId);
}

/**
 * The device published in Discover.
 * @param {object} gladys
 * @param {string} accountId
 * @param {string} language feature names, fixed when the user adds the device
 */
export function buildDevice(gladys, accountId, language) {
  const ids = deviceIds(gladys, accountId);
  const names = NAMES[language] ?? NAMES.fr;
  return {
    name: names.device,
    external_id: ids.device,
    // The container refreshes by itself (src/poller.js, Gladys#3198); the
    // core's poll, once a minute, is the fallback and skips most of the time.
    should_poll: true,
    poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
    features: SPECS.map(([key, nameKey, spec]) => ({
      name: names[nameKey],
      external_id: ids.feature(key),
      category: spec.category,
      type: spec.type,
      min: spec.min,
      max: spec.max,
      ...(spec.unit ? { unit: spec.unit } : {}),
      read_only: true,
      has_feedback: false,
    })),
  };
}

/**
 * The states of a snapshot (src/reader.js). A value Google did not give is
 * left out, never published as 0: the last known one stays in Gladys.
 * @param {object} gladys
 * @param {string} accountId
 * @param {import('./reader.js').Snapshot} snapshot
 * @param {string} language for the date of the last sync
 */
export function buildStates(gladys, accountId, snapshot, language) {
  const ids = deviceIds(gladys, accountId);
  const states = [];
  const number = (key, value) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      states.push({ device_feature_external_id: ids.feature(key), state: value });
    }
  };
  const text = (key, value) => {
    // An empty text is ignored by Gladys: say nothing rather than "".
    if (typeof value === 'string' && value.trim() !== '') {
      states.push({ device_feature_external_id: ids.feature(key), text: value });
    }
  };

  const { activity, sleep, body, tracker } = snapshot;
  if (activity) {
    number(FEATURES.STEPS, activity.steps);
    number(FEATURES.DISTANCE, activity.distanceKm);
    number(FEATURES.FLOORS, activity.floors);
    number(FEATURES.CALORIES, activity.calories);
    number(FEATURES.ACTIVE_MINUTES, activity.activeMinutes);
  }
  number(FEATURES.RESTING_HEART_RATE, snapshot.restingHeartRate);
  if (sleep) {
    number(FEATURES.SLEEP_DURATION, Math.round((sleep.minutesAsleep / 60) * 100) / 100);
    number(FEATURES.SLEEP_EFFICIENCY, sleep.efficiency);
    text(FEATURES.BEDTIME, sleepClock(sleep, 'start', snapshot.timeZone));
    text(FEATURES.WAKE_TIME, sleepClock(sleep, 'end', snapshot.timeZone));
  }
  if (body) {
    number(FEATURES.WEIGHT, body.weightKg);
    number(FEATURES.BODY_FAT, body.bodyFat);
  }
  if (tracker) {
    number(FEATURES.BATTERY, tracker.battery);
    if (tracker.lastSync) {
      text(FEATURES.LAST_SYNC, formatDateTime(tracker.lastSync, language, snapshot.timeZone));
    }
  }
  return states;
}

/**
 * Bedtime or wake time on the clock of where the night happened (its UTC
 * offset), the account's time zone otherwise.
 * @param {'start'|'end'} edge
 */
export function sleepClock(sleep, edge, timeZone) {
  const offsetMinutes = edge === 'start' ? sleep.startOffsetMinutes : sleep.endOffsetMinutes;
  return formatClock(sleep[edge], { offsetMinutes, timeZone });
}
