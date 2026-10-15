// -----------------------------------------------------------------------------
// The integration as Gladys sees it: the refresh timer (no onPoll needed,
// Gladys#3198), only changes published, the heartbeat, the device added
// after the first reading, the connection status, the scene triggers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEARTBEAT_MS } from '../src/app.js';
import { TRIGGERS, WAKE_FRESHNESS_MS } from '../src/events.js';
import { loadFixture } from './helpers/fakeGoogle.js';
import { addDevice, createWorld, DEVICE_ID, feature, settle } from './helpers/world.js';

const START = Date.parse('2026-10-15T08:00:00Z');
const MINUTE = 60 * 1000;

/** A world on mocked timers and clock, the device added. */
async function timedWorld(t, options = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START });
  const world = await createWorld({ timers: true, ...options });
  t.after(() => world.app.stop());
  if (options.created !== false) {
    await addDevice(world);
  }
  return world;
}

async function tick(t, world, ms) {
  t.mock.timers.tick(ms);
  await settle();
  await world.app.poller.idle();
  await settle();
}

const stepsReads = (world) => world.google.calls.filter((c) => c.route === 'rollup:steps').length;

function setSteps(world, steps) {
  world.google.data.rollups.steps = {
    rollupDataPoints: [{ steps: { countSum: String(steps) } }],
  };
}

test('the container refreshes by itself every period, without any onPoll (Gladys#3198)', async (t) => {
  const world = await timedWorld(t);
  const first = stepsReads(world);
  assert.ok(first >= 1);

  await tick(t, world, 15 * MINUTE);
  assert.equal(stepsReads(world), first + 1, 'read again after 15 minutes');
  setSteps(world, 9000);
  await tick(t, world, 15 * MINUTE);
  assert.equal(stepsReads(world), first + 2);
  assert.equal(world.gladys.fake.lastState(feature('steps')), 9000, 'the new value reached Gladys');
});

test('the refresh interval of the configuration is followed', async (t) => {
  const world = await timedWorld(t, { config: { refresh_minutes: '60' } });
  const first = stepsReads(world);
  await tick(t, world, 45 * MINUTE);
  assert.equal(stepsReads(world), first);
  await tick(t, world, 15 * MINUTE);
  assert.equal(stepsReads(world), first + 1);
});

test("the core's onPoll is a fallback: it never reads Google while the timer runs", async (t) => {
  const world = await timedWorld(t);
  const [device] = world.gladys.fake.discoveredDevices;
  const first = stepsReads(world);
  for (let i = 0; i < 13; i += 1) {
    t.mock.timers.tick(MINUTE);
    assert.deepEqual(await world.gladys.fake.poll(device), { success: true });
  }
  assert.equal(stepsReads(world), first, 'the core polls every minute, Google is not read');

  // The timer stalls: the core takes over, once a period.
  world.app.poller.stop();
  await tick(t, world, 5 * MINUTE);
  await world.gladys.fake.poll(device);
  assert.equal(stepsReads(world), first + 1);
  await world.gladys.fake.poll(device);
  assert.equal(stepsReads(world), first + 1);
});

test('only the values that changed are published again, and every 6 hours the rest', async (t) => {
  const world = await timedWorld(t);
  // The fake returns a copy at each read.
  const states = () => world.gladys.fake.states;
  const first = states().length;
  assert.equal(first, 14, 'every feature once');

  await tick(t, world, 15 * MINUTE);
  assert.equal(states().length, first, 'nothing changed, nothing sent');

  setSteps(world, 9100);
  await tick(t, world, 15 * MINUTE);
  assert.deepEqual(
    states()
      .slice(first)
      .map((s) => [s.device_feature_external_id, s.state]),
    [[feature('steps'), 9100]],
  );

  // A weight entered once a month must not look dead in Gladys (48 h).
  const before = states().length;
  for (let elapsed = 30 * MINUTE; elapsed < HEARTBEAT_MS; elapsed += 15 * MINUTE) {
    await tick(t, world, 15 * MINUTE);
  }
  await tick(t, world, 15 * MINUTE);
  assert.ok(
    states()
      .slice(before)
      .some((s) => s.device_feature_external_id === feature('weight')),
    'the unchanged weight is sent again after the heartbeat',
  );
});

test('the states read before the device was added are all sent once it is', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.equal(world.gladys.fake.states.length, 0, 'Gladys would drop them: nothing sent');
  assert.ok(world.app.snapshot, 'but the account was read (triggers, widget)');
  const reads = stepsReads(world);

  await addDevice(world);
  assert.equal(world.gladys.fake.states.length, 14);
  assert.equal(stepsReads(world), reads, 'sent from the last reading, Google not asked again');
  assert.ok(world.gladys.fake.widgetRefreshes.includes('health_summary'));
});

test('a device deleted then added again gets all its states again', async (t) => {
  const world = await createWorld({ created: true });
  t.after(() => world.app.stop());
  assert.equal(world.gladys.fake.states.length, 14);
  const [device] = world.gladys.fake.devices;
  await world.gladys.fake.deviceDeleted(device);
  await world.gladys.fake.deviceCreated(device);
  await settle();
  assert.equal(world.gladys.fake.states.length, 28);
});

test('not configured, then configured: the status says what to do at each step', async (t) => {
  const world = await createWorld({ linked: false, config: { client_id: '', client_secret: '' } });
  t.after(() => world.app.stop());
  assert.match(world.gladys.fake.connectionStatus.message.en, /Enter the client ID and secret/);
  assert.equal(world.google.calls.length, 0, 'Google is not called without a client');

  await world.gladys.fake.configUpdated({
    client_id: '123456789012-test.apps.googleusercontent.com',
    client_secret: 'GOCSPX-test-client-secret',
  });
  assert.match(world.gladys.fake.connectionStatus.message.en, /Press Connect/);
});

test('Google unreachable: one status, the last figures stay, back to connected', async (t) => {
  const world = await timedWorld(t);
  const count = world.gladys.fake.connectionStatuses.length;
  world.google.errors.set('*', 'network');
  await tick(t, world, 15 * MINUTE);
  await tick(t, world, 15 * MINUTE);
  assert.equal(
    world.gladys.fake.connectionStatuses.length,
    count + 1,
    'the status is sent once, not at every failure',
  );
  assert.match(world.gladys.fake.connectionStatus.message.en, /does not answer/);

  const widget = await world.gladys.fake.widgetGet('health_summary', { language: 'en' });
  const status = widget.data.content.components.find((c) => c.type === 'status');
  assert.equal(status.items[0].value, 'Unreachable, last figures');
  assert.equal(widget.data.content.components[0].value, 8432, 'the last figures stay');

  world.google.errors.clear();
  await tick(t, world, 15 * MINUTE);
  assert.equal(world.gladys.fake.connectionStatus.connected, true);
});

test('the Google Health API not enabled, the Fitbit account not migrated: said plainly', async (t) => {
  for (const [fixture, expected] of [
    ['service_disabled', /not enabled in your Google Cloud project/],
    ['account_not_linked', /move your Fitbit account to Google/],
  ]) {
    const world = await createWorld();
    t.after(() => world.app.stop());
    const body = loadFixture(`errors/${fixture}`);
    world.google.errors.set('*', { status: body.error.code, body });
    await world.app.poller.now();
    assert.match(world.gladys.fake.connectionStatus.message.en, expected);
  }
});

test('"woke up" fires once per night, with the wake-up time on the local clock', async (t) => {
  // The night of the fixture ended at 05:05 UTC (07:05 in Paris).
  const now = Date.parse('2026-10-15T05:30:00Z');
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now });
  const world = await createWorld({ timers: true });
  t.after(() => world.app.stop());
  // First reading after the installation: this night is not news.
  assert.deepEqual(world.gladys.fake.sceneEvents, []);

  // The next night syncs.
  const next = structuredClone(loadFixture('sleep_stages_and_nap'));
  next.dataPoints[1].name = 'users/me/dataTypes/sleep/dataPoints/night-20261016';
  next.dataPoints[1].sleep.interval.startTime = '2026-10-15T20:58:00Z';
  next.dataPoints[1].sleep.interval.endTime = '2026-10-16T04:47:00Z';
  world.google.data.lists.sleep = next;
  t.mock.timers.setTime(Date.parse('2026-10-16T05:00:00Z'));
  await world.app.poller.now();
  assert.deepEqual(world.gladys.fake.sceneEvents, [
    {
      key: TRIGGERS.WOKE_UP,
      data: { wake_time: '06:47', bedtime: '22:58', sleep_hours: 7.02, efficiency: 89 },
    },
  ]);

  // Read again, and again after a restart: still one event.
  await world.app.poller.now();
  await world.app.stop();
  const again = await createWorld({ dataDir: world.dataDir, google: world.google });
  t.after(() => again.app.stop());
  assert.deepEqual(again.gladys.fake.sceneEvents, []);
});

test('"woke up" does not fire for a night found long after its end', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const next = structuredClone(loadFixture('sleep_stages_and_nap'));
  next.dataPoints[1].name = 'users/me/dataTypes/sleep/dataPoints/old-night';
  const end = Date.now() - WAKE_FRESHNESS_MS - MINUTE;
  next.dataPoints[1].sleep.interval.endTime = new Date(end).toISOString();
  next.dataPoints[1].sleep.interval.startTime = new Date(end - 8 * 60 * MINUTE).toISOString();
  world.google.data.lists.sleep = next;
  await world.app.poller.now();
  assert.deepEqual(world.gladys.fake.sceneEvents, []);
});

test('"step goal reached" fires once a day, when the steps cross the goal', async (t) => {
  const world = await timedWorld(t, { config: { step_goal: 9000 } });
  assert.deepEqual(world.gladys.fake.sceneEvents, [], '8,432 steps: below the goal');

  setSteps(world, 9050);
  await tick(t, world, 15 * MINUTE);
  assert.deepEqual(world.gladys.fake.sceneEvents, [
    { key: TRIGGERS.STEP_GOAL_REACHED, data: { steps: 9050, goal: 9000 } },
  ]);
  setSteps(world, 12000);
  await tick(t, world, 15 * MINUTE);
  assert.equal(world.gladys.fake.sceneEvents.length, 1, 'once a day');
});

test('a goal already reached at the first reading after the installation is not news', async (t) => {
  const world = await createWorld({ config: { step_goal: 5000 } });
  t.after(() => world.app.stop());
  assert.deepEqual(world.gladys.fake.sceneEvents, []);
});

test('the "Refresh now" action reads at once and says what it got, or why not', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const reads = stepsReads(world);
  const ok = await world.gladys.fake.action('refresh');
  assert.equal(ok.success, true);
  assert.equal(stepsReads(world), reads + 1);
  assert.match(ok.data.message.fr, /Pas du jour : 8\s432/);

  world.google.errors.set('*', 'network');
  const failed = await world.gladys.fake.action('refresh');
  assert.match(failed.data.message.en, /^Reading failed: Google Health does not answer/);
});

test('the device keeps its ids: the platform id is the Google Health user id', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const [device] = world.gladys.fake.discoveredDevices;
  assert.equal(device.external_id, DEVICE_ID);
  // Google unreachable at the next start: the device is still published.
  world.google.errors.set('*', 'network');
  await world.app.stop();
  const again = await createWorld({ dataDir: world.dataDir, google: world.google });
  t.after(() => again.app.stop());
  assert.equal(again.gladys.fake.discoveredDevices[0]?.external_id, DEVICE_ID);
});

test('a publication Gladys refuses is not reported as Google unreachable', async (t) => {
  const world = await createWorld({ created: true });
  t.after(() => world.app.stop());
  t.mock.method(world.gladys, 'publishChangedStates', async () => {
    throw new Error('TOO_MANY_REQUESTS');
  });
  t.mock.method(world.gladys, 'publishSceneEvent', async () => {
    throw new Error('NOT_FOUND');
  });
  await world.app.poller.now();
  assert.equal(world.gladys.fake.connectionStatus.connected, true);
});
