// -----------------------------------------------------------------------------
// The `health_summary` widget: rendered exactly as sent (vocabulary, budget,
// lengths) in every language and every situation, checked with the SDK's own
// validator.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { LANGUAGES } from '../src/config.js';
import { STATUS } from '../src/i18n.js';
import { buildHealthContent, WIDGET_KEY } from '../src/widgets.js';
import { createWorld } from './helpers/world.js';

const world = await createWorld();
const snapshot = world.app.snapshot;
await world.app.stop();
const config = { stepGoal: 10000 };
const now = Date.parse('2026-07-19T08:00:00Z');

const situations = {
  'a full day': { snapshot },
  'goal reached, low battery, old sync': {
    snapshot: {
      ...snapshot,
      activity: { ...snapshot.activity, steps: 12345 },
      tracker: { ...snapshot.tracker, battery: 12, lastSync: '2026-07-10T08:00:00Z' },
    },
  },
  'nothing granted but activity': {
    snapshot: { ...snapshot, sleep: undefined, restingHeartRate: undefined, tracker: undefined },
  },
  'no figure at all': {
    snapshot: { ...snapshot, activity: null, sleep: null, restingHeartRate: null, tracker: null },
  },
  'Google unreachable, last figures': { snapshot, problem: 'unreachable' },
  'to reconnect': { snapshot, problem: 'reconnect' },
  'never read': { snapshot: null },
  'never read, not configured': { snapshot: null, problem: 'setup', detail: STATUS.notConfigured },
};

for (const [label, situation] of Object.entries(situations)) {
  test(`the widget is rendered as sent: ${label}`, () => {
    for (const language of LANGUAGES) {
      const content = buildHealthContent({ ...situation, config, language, now });
      assert.deepEqual(validateWidgetContent(content), [], `${label} (${language})`);
      assert.ok(content.components.length >= 1);
    }
  });
}

test('the step goal: progress, and the success colour once reached', () => {
  const content = buildHealthContent({ snapshot, config, language: 'fr', now });
  const status = content.components.find((c) => c.type === 'status');
  assert.match(status.items[0].value, /^8\s432 \/ 10\s000 \(84 %\)$/);
  assert.equal(status.items[0].icon, 'target');

  const reached = buildHealthContent({ snapshot, config: { stepGoal: 8000 }, language: 'en', now });
  assert.equal(reached.components[0].color, 'success');
  assert.equal(reached.components.find((c) => c.type === 'status').items[0].icon, 'check-circle');
});

test('the night on the local clock, the stale sync in warning', () => {
  const content = buildHealthContent({ snapshot, config, language: 'de', now });
  const items = content.components.find((c) => c.type === 'status').items;
  assert.deepEqual(
    items.map((item) => item.label),
    ['Schrittziel', 'Letzte Nacht', 'Schlafeffizienz', 'Uhr', 'Letzte Synchronisierung'],
  );
  assert.equal(items[1].value, '23:12 → 07:05');
  assert.equal(items[4].color, 'neutral', 'synced 16 hours before');
  const later = buildHealthContent({ snapshot, config, language: 'de', now: now + 86400000 });
  assert.equal(later.components.find((c) => c.type === 'status').items[4].color, 'warning');
});

test('the widget is served by the integration in the language of the dashboard', async (t) => {
  const served = await createWorld();
  t.after(() => served.app.stop());
  const ack = await served.gladys.fake.widgetGet(WIDGET_KEY, { language: 'es' });
  assert.equal(ack.success, true);
  assert.equal(ack.data.content.components[0].label, 'Pasos');
  // A language Gladys does not translate: the one of the configuration.
  const other = await served.gladys.fake.widgetGet(WIDGET_KEY, { language: 'it' });
  assert.equal(other.data.content.components[0].label, 'Pas');
});
