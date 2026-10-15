// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on the device discovered from realistic
// fixtures (the answers of the Google Health API), in every feature-name
// language, and on the states it publishes.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addDevice, createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const scenarios = [
  { label: 'French names (default)', config: {} },
  { label: 'English names', config: { language: 'en' } },
  { label: 'German names', config: { language: 'de' } },
  { label: 'Spanish names', config: { language: 'es' } },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const { gladys, app } = await createWorld({ config: scenario.config });
    try {
      const devices = gladys.fake.discoveredDevices;
      assert.equal(devices.length, 1, 'one device per Google account');

      for (const device of devices) {
        const where = device.name;

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
            const allowed = table.units_by_category[feature.category];
            if (allowed) {
              assert.ok(
                allowed.flat().includes(feature.unit),
                `${at}: unit ${feature.unit} not offered for ${feature.category}`,
              );
            }
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
        }
      }
    } finally {
      await app.stop();
    }
  });
}

test('the published states fit their features (type, bounds, text never empty)', async () => {
  const world = await createWorld();
  try {
    const device = await addDevice(world);
    const states = world.gladys.fake.states;
    assert.ok(states.length >= 14, `every feature gets a value, got ${states.length}`);
    const byId = new Map(device.features.map((feature) => [feature.external_id, feature]));
    for (const state of states) {
      const feature = byId.get(state.device_feature_external_id);
      assert.ok(feature, `state for an unknown feature ${state.device_feature_external_id}`);
      if (feature.category === 'text') {
        assert.equal(typeof state.text, 'string', `${feature.name}: a text feature gets { text }`);
        assert.notEqual(state.text.trim(), '', `${feature.name}: empty text is ignored by Gladys`);
      } else {
        assert.equal(typeof state.state, 'number', `${feature.name}: numeric state`);
        assert.ok(
          state.state >= feature.min && state.state <= feature.max,
          `${feature.name}: ${state.state} outside [${feature.min}, ${feature.max}]`,
        );
        if (feature.type === 'integer') {
          assert.ok(Number.isInteger(state.state), `${feature.name}: integer expected`);
        }
      }
    }
  } finally {
    await world.app.stop();
  }
});
