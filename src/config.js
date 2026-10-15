// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in minutes. The Google
// Health API has no per-user quota published for personal projects; 15 min
// is the pace of the Home Assistant integration and keeps a cycle around 35
// requests an hour (see docs, "Limits").
export const REFRESH_CHOICES = ['15', '30', '60'];

export const STEP_GOAL_MIN = 1000;
export const STEP_GOAL_MAX = 100000;

export const DEFAULT_CONFIG = {
  client_id: '',
  client_secret: '',
  language: 'fr',
  refresh_minutes: '15',
  step_goal: 10000,
};

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (value) => (typeof value === 'string' ? value.trim() : '');
  const refresh = String(source.refresh_minutes ?? DEFAULT_CONFIG.refresh_minutes);
  return {
    clientId: text(source.client_id),
    clientSecret: text(source.client_secret),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
    refreshMinutes: Number(
      REFRESH_CHOICES.includes(refresh) ? refresh : DEFAULT_CONFIG.refresh_minutes,
    ),
    stepGoal: parseStepGoal(source.step_goal),
  };
}

function parseStepGoal(value) {
  const number = typeof value === 'string' ? Number(value.replace(/[\s.,]/g, '')) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) {
    return DEFAULT_CONFIG.step_goal;
  }
  return Math.min(STEP_GOAL_MAX, Math.max(STEP_GOAL_MIN, Math.round(number)));
}

/** The Google OAuth client is filled in: the Connect button can work. */
export function hasClient(config) {
  return config.clientId !== '' && config.clientSecret !== '';
}

/** Refresh period in milliseconds. */
export function refreshPeriodMs(config) {
  return config.refreshMinutes * 60 * 1000;
}
