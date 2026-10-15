// -----------------------------------------------------------------------------
// The Connect button: authorize URL (PKCE, read-only scopes, offline access),
// the code relayed by Gladys, the tokens in /data, their refresh.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { OAUTH_FIELD } from '../src/app.js';
import { createAuth, SCOPES } from '../src/google/oauth.js';
import { ERROR_KINDS } from '../src/google/errors.js';
import { Store } from '../src/store.js';
import { CLIENT, createFakeGoogle, GOOD_CODE, REDIRECT_URI } from './helpers/fakeGoogle.js';
import { createWorld, DEVICE_ID, settle } from './helpers/world.js';

async function connectButton(world) {
  const ack = await world.gladys.fake.oauthAuthorizeUrl(OAUTH_FIELD, REDIRECT_URI);
  assert.equal(ack.success, true, ack.error);
  return new URL(ack.data.authorize_url);
}

test('the authorize URL: PKCE S256, read-only Google Health scopes, offline access', async (t) => {
  const world = await createWorld({ linked: false });
  t.after(() => world.app.stop());
  const url = await connectButton(world);
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  const params = url.searchParams;
  assert.equal(params.get('client_id'), CLIENT.client_id);
  assert.equal(params.get('redirect_uri'), REDIRECT_URI);
  assert.equal(params.get('response_type'), 'code');
  assert.equal(params.get('access_type'), 'offline');
  assert.equal(params.get('prompt'), 'consent');
  assert.equal(params.get('code_challenge_method'), 'S256');
  assert.match(params.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.ok(params.get('state').length >= 20);
  const scopes = params.get('scope').split(' ');
  assert.deepEqual(scopes.sort(), Object.values(SCOPES).sort());
  for (const scope of scopes) {
    assert.match(scope, /\.readonly$/, 'read-only access only');
  }
  assert.ok(
    !url.toString().includes(CLIENT.client_secret),
    'the secret never leaves the container',
  );
});

test('Connect, then the code relayed by Gladys: tokens kept, account read, device published', async (t) => {
  const world = await createWorld({ linked: false });
  t.after(() => world.app.stop());
  assert.equal(world.gladys.fake.connectionStatus.connected, false);
  assert.deepEqual(world.gladys.fake.discoveredDevices, []);

  const url = await connectButton(world);
  const state = url.searchParams.get('state');
  const ack = await world.gladys.fake.oauthCallback(OAUTH_FIELD, {
    code: GOOD_CODE,
    state,
    redirectUri: REDIRECT_URI,
  });
  assert.equal(ack.success, true, ack.error);
  await settle();
  await world.app.poller.idle();

  // The verifier sent with the code matches the challenge of the URL.
  const exchange = world.google.calls.find(
    (call) => call.route === 'token' && call.body.grant_type === 'authorization_code',
  );
  const challenge = createHash('sha256').update(exchange.body.code_verifier).digest('base64url');
  assert.equal(challenge, url.searchParams.get('code_challenge'));
  assert.equal(exchange.body.client_secret, CLIENT.client_secret);

  const saved = JSON.parse(await readFile(join(world.dataDir, 'fitbit.json'), 'utf8'));
  assert.equal(saved.tokens.refreshToken, 'refresh-1');
  assert.equal(saved.accountId, 'mock-health-user-id');
  const mode = (await stat(join(world.dataDir, 'fitbit.json'))).mode & 0o777;
  assert.equal(mode, 0o600, 'the token file is readable by the integration only');

  assert.equal(world.gladys.fake.discoveredDevices[0].external_id, DEVICE_ID);
  assert.equal(world.gladys.fake.connectionStatus.connected, true);
});

test('a callback with an unknown state is refused, nothing is exchanged', async (t) => {
  const world = await createWorld({ linked: false });
  t.after(() => world.app.stop());
  await connectButton(world);
  const ack = await world.gladys.fake.oauthCallback(OAUTH_FIELD, {
    code: GOOD_CODE,
    state: 'forged',
    redirectUri: REDIRECT_URI,
  });
  assert.equal(ack.success, false);
  assert.ok(!world.google.calls.some((call) => call.route === 'token'));
});

test('a state is used once', async (t) => {
  const world = await createWorld({ linked: false });
  t.after(() => world.app.stop());
  const state = (await connectButton(world)).searchParams.get('state');
  const params = { code: GOOD_CODE, state, redirectUri: REDIRECT_URI };
  assert.equal((await world.gladys.fake.oauthCallback(OAUTH_FIELD, params)).success, true);
  assert.equal((await world.gladys.fake.oauthCallback(OAUTH_FIELD, params)).success, false);
});

test('Connect without a client ID and secret says what to fill in', async (t) => {
  const world = await createWorld({ linked: false, config: { client_id: '', client_secret: '' } });
  t.after(() => world.app.stop());
  const ack = await world.gladys.fake.oauthAuthorizeUrl(OAUTH_FIELD, REDIRECT_URI);
  assert.equal(ack.success, false);
  assert.match(ack.error, /client ID and secret/);
  assert.deepEqual(
    world.gladys.fake.connectionStatus.message.fr.slice(0, 18),
    'Saisissez l’ID cli',
  );
});

test('the access token is refreshed before it expires, one refresh at a time', async () => {
  let time = 1_000_000;
  const google = createFakeGoogle({ expiresIn: 3600 });
  const store = new Store(
    await import('node:fs').then((fs) =>
      fs.mkdtempSync(join((process.env.TMPDIR ?? '/tmp').replace(/\/$/, ''), 'fitbit-auth-')),
    ),
  );
  await store.set('tokens', {
    clientId: CLIENT.client_id,
    refreshToken: google.issueRefreshToken('r'),
    expiresAt: 0,
    scope: '',
  });
  const auth = createAuth({
    store,
    getConfig: () => ({ clientId: CLIENT.client_id, clientSecret: CLIENT.client_secret }),
    fetch: google.fetch,
    now: () => time,
  });
  const [a, b] = await Promise.all([auth.accessToken(), auth.accessToken()]);
  assert.equal(a, b);
  assert.equal(google.calls.length, 1, 'one refresh for two callers');
  time += 30 * 60 * 1000;
  assert.equal(await auth.accessToken(), a, 'still valid');
  time += 30 * 60 * 1000;
  assert.notEqual(await auth.accessToken(), a, 'refreshed a minute before the hour');
  assert.equal(google.calls.length, 2);
  assert.equal((await store.get('tokens')).refreshToken, 'r', 'the refresh token is kept');
});

test('a refresh token Google refuses is forgotten: the user is asked to connect again', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.equal(world.gladys.fake.connectionStatus.connected, true);
  world.google.refreshTokens.clear();
  world.google.accessToken = null;
  await world.store.set('tokens', { ...(await world.store.get('tokens')), expiresAt: 0 });
  await world.app.poller.now();
  const status = world.gladys.fake.connectionStatus;
  assert.equal(status.connected, false);
  assert.match(status.message.en, /press Connect again/);
  assert.equal(await world.store.get('tokens'), undefined);
});

test('tokens of another OAuth client are not used', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await world.gladys.fake.configUpdated({
    ...CLIENT,
    client_id: 'other.apps.googleusercontent.com',
  });
  assert.equal(world.gladys.fake.connectionStatus.connected, false);
  assert.match(world.gladys.fake.connectionStatus.message.en, /Press Connect/);
});

test('an access token refused before its time is refreshed once, then the read goes on', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const tokensBefore = world.google.calls.filter((c) => c.route === 'token').length;
  world.google.accessToken = 'revoked-elsewhere';
  await world.app.poller.now();
  assert.equal(world.google.calls.filter((c) => c.route === 'token').length, tokensBefore + 1);
  assert.equal(world.gladys.fake.connectionStatus.connected, true);
});

test('a client secret Google refuses is reported as such', async (t) => {
  const world = await createWorld({ config: { client_secret: 'wrong' } });
  t.after(() => world.app.stop());
  const status = world.gladys.fake.connectionStatus;
  assert.equal(status.connected, false);
  assert.match(status.message.en, /refused the client ID or secret/);
  assert.equal(ERROR_KINDS.CLIENT, 'client');
});
