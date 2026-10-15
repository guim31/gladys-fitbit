// -----------------------------------------------------------------------------
// Calm logs: nothing at the info level for a normal refresh, one line when
// Google stops answering and one when it is back, never a secret, never a
// health figure (the logs of Gladys are not a health record).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OAUTH_FIELD } from '../src/app.js';
import { CLIENT, GOOD_CODE, REDIRECT_URI } from './helpers/fakeGoogle.js';
import { addDevice, ACCOUNT_ID, createWorld, settle } from './helpers/world.js';

const MINUTE = 60 * 1000;

function captureLogs(t, level) {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  for (const stream of ['log', 'error']) {
    t.mock.method(console, stream, (...args) =>
      lines.push(args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' ')),
    );
  }
  return lines;
}

async function tick(t, world, ms) {
  t.mock.timers.tick(ms);
  await settle();
  await world.app.poller.idle();
  await settle();
}

test('a normal refresh writes nothing at the info level', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-15T08:00:00Z') });
  const lines = captureLogs(t, 'info');
  const world = await createWorld({ timers: true });
  t.after(() => world.app.stop());
  await addDevice(world);
  const startup = lines.length;

  for (let i = 0; i < 8; i += 1) {
    await tick(t, world, 15 * MINUTE);
  }
  await world.gladys.fake.widgetGet('health_summary', { language: 'fr' });
  assert.deepEqual(lines.slice(startup), [], 'two hours of refreshes, not a line');
});

test('a failure that lasts writes one line, its end another', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-15T08:00:00Z') });
  const lines = captureLogs(t, 'info');
  const world = await createWorld({ timers: true });
  t.after(() => world.app.stop());
  const startup = lines.length;

  world.google.errors.set('*', 'network');
  for (let i = 0; i < 4; i += 1) {
    await tick(t, world, 15 * MINUTE);
  }
  world.google.errors.clear();
  await tick(t, world, 15 * MINUTE);
  await tick(t, world, 15 * MINUTE);
  const written = lines.slice(startup);
  assert.equal(written.length, 2, written.join('\n'));
  assert.match(written[0], /\[WARN\].*Google Health reading failed: Google unreachable/);
  assert.match(written[1], /\[INFO\].*Google Health answers again/);
});

test('no secret and no health figure in the logs, even in debug', async (t) => {
  const lines = captureLogs(t, 'debug');
  const world = await createWorld({ linked: false });
  t.after(() => world.app.stop());
  const url = new URL(
    (await world.gladys.fake.oauthAuthorizeUrl(OAUTH_FIELD, REDIRECT_URI)).data.authorize_url,
  );
  await world.gladys.fake.oauthCallback(OAUTH_FIELD, {
    code: GOOD_CODE,
    state: url.searchParams.get('state'),
    redirectUri: REDIRECT_URI,
  });
  await settle();
  await world.app.poller.idle();
  await addDevice(world);
  await world.gladys.fake.action('refresh');
  // A refused refresh token, then a wrong secret: errors are logged too.
  world.google.refreshTokens.clear();
  await world.store.set('tokens', { ...(await world.store.get('tokens')), expiresAt: 0 });
  await world.app.poller.now();
  await world.gladys.fake.configUpdated({ ...CLIENT, client_secret: 'GOCSPX-another-secret' });

  assert.ok(lines.length > 5, 'the debug level writes');
  const text = lines.join('\n');
  const tokens = world.google.calls.flatMap((call) => [call.auth, call.body?.refresh_token]);
  const forbidden = [
    CLIENT.client_secret,
    'GOCSPX-another-secret',
    GOOD_CODE,
    url.searchParams.get('state'),
    url.searchParams.get('code_challenge'),
    'refresh-1',
    ...tokens.filter(Boolean).map((value) => value.replace(/^Bearer /, '')),
    // Health data: the figures of the fixtures, the account and the watch.
    '8432',
    '8 432',
    '5000000',
    '80000',
    '18.5',
    '421',
    'Charge 6',
    ACCOUNT_ID,
  ];
  for (const value of forbidden) {
    assert.ok(!text.includes(value), `"${value}" appears in the logs`);
  }
});
