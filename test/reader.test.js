// -----------------------------------------------------------------------------
// Reading the Google Health answers: the fixtures of Home Assistant (numbers)
// and the discovery document (int64 as strings, offsets as "7200s").
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHealthClient, nextDay, todayIn, toNumber } from '../src/google/health.js';
import { SCOPES } from '../src/google/oauth.js';
import {
  BODY_PERIOD_MS,
  createReader,
  parseActivity,
  parseBody,
  parseSleep,
  parseTracker,
  parseUtcOffset,
} from '../src/reader.js';
import { createFakeGoogle, loadFixture } from './helpers/fakeGoogle.js';

const ALL_SCOPES = new Set(Object.values(SCOPES));

function setup({ scopes = ALL_SCOPES, now = () => Date.parse('2026-10-15T08:00:00Z') } = {}) {
  const google = createFakeGoogle();
  google.accessToken = 'access-test';
  const auth = {
    accessToken: async () => google.accessToken,
    expireAccessToken: async () => {},
  };
  const client = createHealthClient({ auth, fetch: google.fetch });
  const reader = createReader({ client, grantedScopes: async () => scopes, now });
  return { google, reader, client };
}

test('a full reading of the fixtures', async () => {
  const { reader } = setup();
  const snapshot = await reader.read();
  assert.deepEqual(snapshot, {
    timeZone: 'Europe/Paris',
    date: '2026-10-15',
    activity: { steps: 8432, distanceKm: 5, floors: 5, calories: 2100, activeMinutes: 35 },
    restingHeartRate: 65,
    sleep: {
      id: 'users/me/dataTypes/sleep/dataPoints/night-20261015',
      start: '2026-10-14T21:12:00.000Z',
      end: '2026-10-15T05:05:00.000Z',
      startOffsetMinutes: 120,
      endOffsetMinutes: 120,
      minutesAsleep: 421,
      minutesInBed: 473,
      efficiency: 89,
    },
    body: { weightKg: 80, bodyFat: 18.5 },
    tracker: { battery: 85, lastSync: '2026-07-18T15:30:00.000Z', model: 'Fitbit Charge 6' },
  });
});

test('the daily rollups ask for today in the account time zone, one day wide', async () => {
  // 23:30 UTC on the 14th is already the 15th in Paris.
  const { reader, google } = setup({ now: () => Date.parse('2026-10-14T23:30:00Z') });
  await reader.read();
  const call = google.calls.find((c) => c.route === 'rollup:steps');
  assert.equal(call.method, 'POST');
  assert.deepEqual(call.body, {
    range: {
      start: { date: { year: 2026, month: 10, day: 15 } },
      end: { date: { year: 2026, month: 10, day: 16 } },
    },
    windowSizeDays: 1,
  });
  assert.equal(call.auth, 'Bearer access-test');
});

test('a day without data yet is zero steps, but unknown calories', () => {
  assert.deepEqual(
    parseActivity({ steps: null, distance: null, floors: null, calories: null, active: null }),
    { steps: 0, distanceKm: 0, floors: 0, calories: null, activeMinutes: 0 },
  );
  // The Home Assistant fixture sends a number where the API documents a string.
  const steps = loadFixture('steps').rollupDataPoints[0];
  assert.equal(parseActivity({ steps }).steps, 10500);
});

test('active minutes are the moderate and vigorous ones, as in the Fitbit app', () => {
  const active = loadFixture('active_minutes').rollupDataPoints[0];
  assert.equal(parseActivity({ active }).activeMinutes, 24 + 11);
});

test('last night is the latest finished main sleep: not a nap, not a session in progress', () => {
  const nap = parseSleep(loadFixture('sleep_stages_and_nap').dataPoints);
  assert.equal(nap.id, 'users/me/dataTypes/sleep/dataPoints/night-20261015');

  const inProgress = parseSleep(loadFixture('sleep_in_progress').dataPoints);
  assert.equal(inProgress.id, 'users/me/dataTypes/sleep/dataPoints/session-12345');
  assert.equal(inProgress.startOffsetMinutes, -7 * 60, '"-07:00" is read too');
  assert.equal(inProgress.efficiency, 88);

  assert.equal(parseSleep([]), null);
  assert.equal(parseSleep(loadFixture('sleep_in_progress').dataPoints.slice(0, 1)), null);
});

test('UTC offsets: protobuf durations and clock offsets', () => {
  assert.equal(parseUtcOffset('7200s'), 120);
  assert.equal(parseUtcOffset('-25200s'), -420);
  assert.equal(parseUtcOffset('19800.0s'), 330);
  assert.equal(parseUtcOffset('+05:30'), 330);
  assert.equal(parseUtcOffset('-07:00'), -420);
  assert.equal(parseUtcOffset(undefined), null);
  assert.equal(parseUtcOffset('soon'), null);
});

test('the watch is the tracker synced last; a scale is never the watch', () => {
  const devices = loadFixture('paired_devices').pairedDevices;
  assert.deepEqual(parseTracker(devices), {
    battery: 85,
    lastSync: '2026-07-18T15:30:00.000Z',
    model: 'Fitbit Charge 6',
  });
  const scaleOnly = devices.filter((device) => device.deviceType === 'SCALE');
  assert.equal(parseTracker(scaleOnly), null);
  assert.equal(parseTracker([]), null);
  // An older tracker reports a status without a level.
  assert.equal(
    parseTracker([{ deviceType: 'TRACKER', batteryStatus: 'Medium', lastSyncTime: 'x' }]).battery,
    50,
  );
  assert.equal(parseTracker([{ deviceType: 'TRACKER', lastSyncTime: 'x' }]).lastSync, null);
});

test('weight and body fat, rounded; nothing entered is null', () => {
  assert.deepEqual(
    parseBody(loadFixture('weight').dataPoints, loadFixture('body_fat').dataPoints),
    {
      weightKg: 80,
      bodyFat: 18.5,
    },
  );
  assert.deepEqual(parseBody([{ weight: { weightGrams: 72449.6 } }], []), {
    weightKg: 72.4,
    bodyFat: null,
  });
});

test('weight and body fat are read once an hour, not at every refresh', async () => {
  let time = Date.parse('2026-10-15T08:00:00Z');
  const { reader, google } = setup({ now: () => time });
  const weightReads = () => google.calls.filter((c) => c.route === 'list:weight').length;
  await reader.read();
  time += 15 * 60 * 1000;
  await reader.read();
  assert.equal(weightReads(), 1);
  time += BODY_PERIOD_MS;
  await reader.read();
  assert.equal(weightReads(), 2);
  assert.equal(google.calls.filter((c) => c.route === 'settings').length, 1, 'time zone: daily');
});

test('a permission unticked on the consent screen leaves its data out, without a request', async () => {
  const { reader, google } = setup({
    scopes: new Set([SCOPES.ACTIVITY, SCOPES.SETTINGS]),
  });
  const snapshot = await reader.read();
  assert.equal(snapshot.activity.steps, 8432);
  assert.equal(snapshot.sleep, undefined);
  assert.equal(snapshot.restingHeartRate, undefined);
  assert.deepEqual(snapshot.body, { weightKg: null, bodyFat: null });
  assert.ok(!google.calls.some((c) => c.route === 'list:sleep'));
});

test('a permission Google refuses at read time is skipped from then on', async () => {
  const { reader, google } = setup();
  google.errors.set('list:sleep', {
    status: 403,
    body: loadFixture('errors/access_token_scope_insufficient'),
  });
  const snapshot = await reader.read();
  assert.equal(snapshot.sleep, undefined);
  assert.equal(snapshot.activity.steps, 8432, 'the rest is still read');
  assert.ok(reader.refusedScopes().has(SCOPES.SLEEP));
  const before = google.calls.filter((c) => c.route === 'list:sleep').length;
  await reader.read();
  assert.equal(google.calls.filter((c) => c.route === 'list:sleep').length, before);
});

test('without the settings permission, the container time zone is used', async () => {
  const { reader } = setup({ scopes: new Set([SCOPES.ACTIVITY]) });
  const snapshot = await reader.read();
  assert.equal(snapshot.timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.equal(snapshot.tracker, undefined);
});

test('dates and numbers helpers', () => {
  assert.deepEqual(nextDay({ year: 2026, month: 12, day: 31 }), { year: 2027, month: 1, day: 1 });
  assert.deepEqual(nextDay({ year: 2028, month: 2, day: 28 }), { year: 2028, month: 2, day: 29 });
  assert.deepEqual(todayIn('Pacific/Auckland', Date.parse('2026-10-15T12:00:00Z')), {
    year: 2026,
    month: 10,
    day: 16,
  });
  assert.equal(toNumber('8432'), 8432);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber('abc'), null);
});
