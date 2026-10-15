// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Google, a temporary
// /data, and the integration wired on top through registerHandlers.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { buildDevice } from '../../src/device.js';
import { SCOPES } from '../../src/google/oauth.js';
import { Store } from '../../src/store.js';
import { CLIENT, createFakeGoogle } from './fakeGoogle.js';

// The integration logs its lifecycle; keep the test output readable
// (LOG_LEVEL is read on every log call). LOG_LEVEL=debug npm test shows them.
process.env.LOG_LEVEL ??= 'silent';

export const ACCOUNT_ID = 'mock-health-user-id';
export const DEVICE_ID = `ext:test-integration:account:${ACCOUNT_ID}`;
export const feature = (key) => `${DEVICE_ID}:${key}`;

/** Let the promises started by a timer or a callback run to their end. */
export async function settle() {
  for (let i = 0; i < 50; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config (client filled in by default)
 * @param {boolean} [options.linked] a Google account is already connected (tokens in /data)
 * @param {boolean} [options.created] the user already added the device to Gladys
 * @param {boolean} [options.connect]
 * @param {boolean} [options.timers] run the refresh timer
 * @param {() => number} [options.now]
 * @param {string} [options.dataDir]
 * @param {ReturnType<typeof createFakeGoogle>} [options.google]
 */
export async function createWorld({
  config = {},
  linked = true,
  created = false,
  connect = true,
  timers = false,
  now = Date.now,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-fitbit-')),
  google = createFakeGoogle(),
} = {}) {
  const store = new Store(dataDir);
  if (linked) {
    await store.set('tokens', {
      clientId: CLIENT.client_id,
      refreshToken: google.issueRefreshToken(),
      expiresAt: 0,
      scope: Object.values(SCOPES).join(' '),
    });
  }
  const gladys = createFakeGladys({
    config: { ...CLIENT, ...config },
    devices: [],
  });
  const app = registerHandlers(gladys, { store, fetch: google.fetch, timers, now });
  const world = { gladys, google, app, store, dataDir };

  if (created) {
    // The device as the user adds it: the one published in Discover.
    const probe = createFakeGladys();
    gladys.fake.devices.push(buildDevice(probe, ACCOUNT_ID, 'fr'));
  }
  if (connect) {
    await gladys.connect();
    await settle();
    await app.poller.idle();
  }
  return world;
}

/** The user adds the published device in Discover. */
export async function addDevice(world) {
  const [device] = world.gladys.fake.discoveredDevices;
  await world.gladys.fake.deviceCreated(device);
  await settle();
  await world.app.poller.idle();
  return device;
}
