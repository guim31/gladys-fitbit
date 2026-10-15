import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, hasClient, normalizeConfig, refreshPeriodMs } from '../src/config.js';
import { classifyApiError, ERROR_KINDS } from '../src/google/errors.js';
import { loadFixture } from './helpers/fakeGoogle.js';

test('defaults: French names, 15 minutes, 10,000 steps, no client', () => {
  const config = normalizeConfig();
  assert.deepEqual(config, {
    clientId: '',
    clientSecret: '',
    language: 'fr',
    refreshMinutes: 15,
    stepGoal: DEFAULT_CONFIG.step_goal,
  });
  assert.equal(hasClient(config), false);
  assert.equal(refreshPeriodMs(config), 15 * 60 * 1000);
});

test('values are trimmed, bounded and checked', () => {
  const config = normalizeConfig({
    client_id: '  abc.apps.googleusercontent.com ',
    client_secret: ' s ',
    language: 'it',
    refresh_minutes: '5',
    step_goal: '12 500',
  });
  assert.equal(config.clientId, 'abc.apps.googleusercontent.com');
  assert.equal(config.clientSecret, 's');
  assert.equal(config.language, 'fr');
  assert.equal(config.refreshMinutes, 15);
  assert.equal(config.stepGoal, 12500);
  assert.equal(hasClient(config), true);
  assert.equal(normalizeConfig({ step_goal: 50 }).stepGoal, 1000);
  assert.equal(normalizeConfig({ step_goal: 1e9 }).stepGoal, 100000);
  assert.equal(normalizeConfig({ step_goal: 'many' }).stepGoal, 10000);
  assert.equal(normalizeConfig({ refresh_minutes: 60 }).refreshMinutes, 60);
});

test('the error answers of Google Health are told apart', () => {
  const kind = (status, name) => classifyApiError(status, loadFixture(`errors/${name}`)).kind;
  assert.equal(kind(403, 'service_disabled'), ERROR_KINDS.API_DISABLED);
  assert.equal(kind(403, 'access_token_scope_insufficient'), ERROR_KINDS.SCOPE);
  assert.equal(kind(403, 'oauth_insufficient_scope'), ERROR_KINDS.SCOPE);
  assert.equal(kind(400, 'account_not_linked'), ERROR_KINDS.NOT_LINKED);
  assert.equal(kind(429, 'resource_exhausted'), ERROR_KINDS.RATE_LIMIT);
  assert.equal(kind(401, 'unauthenticated'), ERROR_KINDS.REVOKED);
  assert.equal(kind(401, 'oauth_invalid_token'), ERROR_KINDS.REVOKED);
  assert.equal(kind(403, 'permission_denied'), ERROR_KINDS.FORBIDDEN);
  assert.equal(classifyApiError(503, null).kind, ERROR_KINDS.SERVER);
  assert.equal(classifyApiError(418, null).kind, ERROR_KINDS.HTTP);
  // The message names the reason, never the body (it may carry a project number).
  const disabled = classifyApiError(403, loadFixture('errors/service_disabled'));
  assert.equal(disabled.message, 'API not enabled (HTTP 403, PERMISSION_DENIED SERVICE_DISABLED)');
});
