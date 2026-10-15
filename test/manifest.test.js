// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTION_REFRESH, OAUTH_FIELD } from '../src/app.js';
import {
  DEFAULT_CONFIG,
  LANGUAGES,
  REFRESH_CHOICES,
  STEP_GOAL_MAX,
  STEP_GOAL_MIN,
} from '../src/config.js';
import { TRIGGERS } from '../src/events.js';
import { WIDGET_KEY } from '../src/widgets.js';
import { loadFixture } from './helpers/fakeGoogle.js';
import { createWorld } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const CAPABILITY_FIELDS = ['scene_triggers', 'scene_actions', 'widgets'];
const CAPABILITY_MIN_GLADYS_VERSION = [5, 1, 0];
const CATEGORIES_MIN_GLADYS_VERSION = [4, 86, 0];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const field = (key) => manifest.config_schema.find((entry) => entry.key === key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('identity: name, image, cloud transport, catalog category', () => {
  assert.equal(manifest.name, 'Fitbit');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-fitbit:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-fitbit/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.deepEqual(manifest.categories, ['services']);
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    `docker_image must be tagged :${manifest.version}, got "${manifest.docker_image}"`,
  );
});

test('declaring catalog categories requires Gladys >= 4.86.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(isAtLeast(minGladysVersion(), CATEGORIES_MIN_GLADYS_VERSION));
});

test('declaring scene triggers or widgets requires Gladys >= 5.1.0', () => {
  const declared = CAPABILITY_FIELDS.filter((key) => manifest[key] !== undefined);
  assert.deepEqual(declared, ['scene_triggers', 'widgets']);
  assert.ok(isAtLeast(minGladysVersion(), CAPABILITY_MIN_GLADYS_VERSION));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${lang} has ${text.length} characters (10 to 100 allowed)`,
    );
  }
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG, and the choices with the code', () => {
  for (const entry of manifest.config_schema) {
    if (entry.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[entry.key], entry.default, `DEFAULT_CONFIG.${entry.key}`);
    }
  }
  assert.deepEqual(
    field('language').options.map((option) => option.value),
    LANGUAGES,
  );
  assert.deepEqual(
    field('refresh_minutes').options.map((option) => option.value),
    REFRESH_CHOICES,
  );
  assert.equal(field('step_goal').min, STEP_GOAL_MIN);
  assert.equal(field('step_goal').max, STEP_GOAL_MAX);
  // Number fields have no step in Gladys: integer bounds and default only.
  for (const entry of allFields.filter((f) => f.type === 'number')) {
    for (const value of [entry.min, entry.max, entry.default].filter((v) => v !== undefined)) {
      assert.ok(Number.isInteger(value), `${entry.key}: ${value} is not an integer`);
    }
  }
});

test('the Connect button is the oauth2 field the code answers, the secret a secret field', async (t) => {
  const oauth = manifest.config_schema.filter((entry) => entry.type === 'oauth2');
  assert.deepEqual(keysOf(oauth), [OAUTH_FIELD]);
  assert.equal(field('client_secret').type, 'secret');
  assert.equal(oauth[0].default, undefined);

  const world = await createWorld({ linked: false });
  t.after(() => world.app.stop());
  const ack = await world.gladys.fake.oauthAuthorizeUrl(OAUTH_FIELD, 'https://example.com/cb');
  assert.equal(ack.success, true);
});

test('section fields are purely presentational, with https links', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
    for (const text of Object.values(section.description)) {
      assert.ok(text.length <= 1000, 'a section text holds 1000 characters at most');
    }
  }
});

test('field placeholders are multi-language objects', () => {
  for (const entry of allFields.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof entry.placeholder, 'object', `field "${entry.key}": placeholder`);
    assert.ok(entry.placeholder.en);
  }
});

test('every manifest action has a handler', async (t) => {
  assert.deepEqual(keysOf(manifest.actions), [ACTION_REFRESH]);
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (const key of keysOf(manifest.actions)) {
    const ack = await world.gladys.fake.action(key);
    assert.equal(ack.success, true, `${key}: ${ack.error}`);
  }
});

test('every widget has a handler', async (t) => {
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.gladys.fake.widgetGet(WIDGET_KEY, { language: 'fr' });
  assert.equal(ack.success, true, ack.error);
});

test('every scene trigger the code fires is declared, with its variables, and vice versa', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-15T05:30:00Z') });
  const world = await createWorld({ config: { step_goal: 9000 } });
  t.after(() => world.app.stop());
  const next = structuredClone(loadFixture('sleep_stages_and_nap'));
  next.dataPoints[1].name = 'users/me/dataTypes/sleep/dataPoints/next';
  next.dataPoints[1].sleep.interval.endTime = '2026-10-16T04:47:00Z';
  world.google.data.lists.sleep = next;
  world.google.data.rollups.steps = { rollupDataPoints: [{ steps: { countSum: '9500' } }] };
  t.mock.timers.setTime(Date.parse('2026-10-16T05:00:00Z'));
  await world.app.poller.now();
  const events = world.gladys.fake.sceneEvents;
  assert.deepEqual(events.map((e) => e.key).sort(), Object.values(TRIGGERS).sort());
  for (const event of events) {
    const trigger = manifest.scene_triggers.find((entry) => entry.key === event.key);
    assert.deepEqual(Object.keys(event.data).sort(), keysOf(trigger.variables).sort());
    for (const variable of trigger.variables) {
      const value = event.data[variable.key];
      assert.equal(typeof value, variable.type, `${event.key}.${variable.key}`);
    }
  }
});
