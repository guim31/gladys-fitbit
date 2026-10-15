// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake one)
// and returns the app, so index.js stays a few lines and the tests drive the
// very same wiring.
//
// Data flow: a timer (src/poller.js) reads the account (src/reader.js) every
// 15 minutes by default; each reading becomes states of the device (only the
// changes, a heartbeat every 6 hours), scene events (src/events.js) and the
// content of the widget (src/widgets.js).
//
// Health data never reaches the logs: they say what happened (connected,
// unreachable, back), never a figure.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { hasClient, normalizeConfig, refreshPeriodMs } from './config.js';
import { buildDevice, buildStates, deviceIds } from './device.js';
import { createEventDetector } from './events.js';
import { ERROR_KINDS, USER_ACTION_KINDS } from './google/errors.js';
import { createHealthClient } from './google/health.js';
import { createAuth } from './google/oauth.js';
import { formatDateTime, formatInteger, LOCALES, MESSAGES, STATUS } from './i18n.js';
import { createIssueLog } from './issues.js';
import { createPoller } from './poller.js';
import { createReader } from './reader.js';
import { Store } from './store.js';
import { buildHealthContent, WIDGET_KEY } from './widgets.js';

const logger = createLogger({ name: 'fitbit' });

// An unchanged value is sent again after this long: Gladys shows "no recent
// value" past 48 hours (a weight entered once a month must not look dead).
export const HEARTBEAT_MS = 6 * 60 * 60 * 1000;

export const ACTION_REFRESH = 'refresh';
export const OAUTH_FIELD = 'google_account';

// Connection status and widget line for each kind of failure.
const PROBLEMS = {
  notConfigured: { status: STATUS.notConfigured, widget: 'setup' },
  [ERROR_KINDS.NOT_CONNECTED]: { status: STATUS.notConnected, widget: 'setup' },
  [ERROR_KINDS.REVOKED]: { status: STATUS.revoked, widget: 'reconnect' },
  [ERROR_KINDS.CLIENT]: { status: STATUS.client, widget: 'setup' },
  [ERROR_KINDS.API_DISABLED]: { status: STATUS.apiDisabled, widget: 'setup' },
  [ERROR_KINDS.NOT_LINKED]: { status: STATUS.notLinked, widget: 'setup' },
  unreachable: { status: STATUS.unreachable, widget: 'unreachable' },
};

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams
 * @param {Store} [options.store]
 * @param {typeof fetch} [options.fetch]
 * @param {boolean} [options.timers]
 * @param {() => number} [options.now]
 */
export function registerHandlers(gladys, options = {}) {
  const store = options.store ?? new Store();
  const now = options.now ?? Date.now;
  let config = normalizeConfig();

  const auth = createAuth({ store, getConfig: () => config, fetch: options.fetch, now });
  const client = createHealthClient({ auth, fetch: options.fetch });
  const reader = createReader({ client, grantedScopes: () => auth.grantedScopes(), now });
  const events = createEventDetector({ store, now });
  const issues = createIssueLog(logger);

  let accountId = null;
  let snapshot = null;
  let problem = null; // a key of PROBLEMS, or null
  let statusKey = null; // last connection status sent, to send only changes

  const poller = createPoller({
    gladys,
    refresh: () => refresh(),
    periodMs: () => refreshPeriodMs(config),
    timers: options.timers ?? true,
    now,
  });

  async function setStatus(key) {
    if (key === statusKey) {
      return;
    }
    statusKey = key;
    if (key === null) {
      await gladys.setConnectionStatus(true);
    } else {
      await gladys.setConnectionStatus(false, PROBLEMS[key].status);
    }
  }

  function setProblem(key) {
    if (key !== problem) {
      problem = key;
      gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The id Google Health gives the account: the device's platform id. */
  async function ensureAccount() {
    if (accountId === null) {
      accountId = (await store.get('accountId')) ?? null;
    }
    if (accountId === null) {
      const identity = await client.identity();
      if (!identity?.healthUserId) {
        throw new Error('Google Health returned no user id');
      }
      accountId = String(identity.healthUserId);
      await store.set('accountId', accountId);
      await publishDevice();
    }
    return accountId;
  }

  async function publishDevice() {
    const id = accountId ?? (await store.get('accountId'));
    await gladys.publishDiscoveredDevices(id ? [buildDevice(gladys, id, config.language)] : []);
  }

  function deviceCreated() {
    if (!accountId) {
      return false;
    }
    const { device } = deviceIds(gladys, accountId);
    return (gladys.devices ?? []).some((created) => created.external_id === device);
  }

  async function publishStates() {
    if (!snapshot || !deviceCreated()) {
      return;
    }
    const states = buildStates(gladys, accountId, snapshot, config.language);
    const { count } = await gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
    logger.debug(`${count} state(s) published`);
  }

  /** One reading of the account. Errors are reported, never thrown. */
  async function refresh() {
    if (!hasClient(config)) {
      await setStatus('notConfigured');
      setProblem('notConfigured');
      return;
    }
    if (!(await auth.isConnected())) {
      await setStatus(ERROR_KINDS.NOT_CONNECTED);
      setProblem(ERROR_KINDS.NOT_CONNECTED);
      return;
    }
    let previous;
    try {
      await ensureAccount();
      previous = JSON.stringify(snapshot);
      snapshot = await reader.read();
      issues.ok('read', 'Google Health answers again');
    } catch (err) {
      const key = err.kind in PROBLEMS ? err.kind : 'unreachable';
      const verb = USER_ACTION_KINDS.has(err.kind) ? 'refused the reading' : 'reading failed';
      issues.fail('read', `Google Health ${verb}: ${err.message}`);
      await setStatus(key).catch(() => {});
      setProblem(key);
      return;
    }
    await setStatus(null).catch(() => {});
    setProblem(null);
    if (JSON.stringify(snapshot) !== previous) {
      gladys.requestWidgetRefresh(WIDGET_KEY);
    }
    // Gladys' side: a refused publication is not Google's fault, and must not
    // stop the scene events (nor the reverse).
    try {
      await publishStates();
      issues.ok('states', 'States accepted by Gladys again');
    } catch (err) {
      issues.fail('states', `Gladys refused the states: ${err.message}`);
    }
    for (const event of await events.detect(snapshot, config)) {
      logger.debug(`Scene event ${event.key}`);
      try {
        await gladys.publishSceneEvent(event.key, event.data);
      } catch (err) {
        logger.warn(`Gladys refused the scene event ${event.key}: ${err.message}`);
      }
    }
  }

  /** The answer of the "Refresh now" action, in every language. */
  function summary() {
    return Object.fromEntries(
      Object.keys(LOCALES).map((lang) => {
        const steps = snapshot?.activity ? formatInteger(snapshot.activity.steps, lang) : '–';
        const sync = snapshot?.tracker?.lastSync
          ? formatDateTime(snapshot.tracker.lastSync, lang, snapshot.timeZone)
          : MESSAGES.unknown[lang];
        return [lang, MESSAGES.refreshed[lang](MESSAGES.summary[lang](steps, sync))];
      }),
    );
  }

  // --- Discovery: the account device, once the account is known -------------
  gladys.onScanRequest(async () => {
    logger.debug('onScanRequest');
    await publishDevice();
  });

  // --- Polling: the core's fallback, the timer does the work ------------------
  gladys.onPoll(async () => {
    if (!(await poller.fromCore())) {
      logger.debug('onPoll skipped: refreshed less than a period ago');
    }
  });

  // --- The device was added: Gladys dropped every state sent before ----------
  const resend = async (device) => {
    if (!accountId || device.external_id !== deviceIds(gladys, accountId).device) {
      return;
    }
    gladys.forgetPublishedStates(device.external_id);
    if (snapshot) {
      await publishStates();
    } else {
      await poller.now();
    }
    gladys.requestWidgetRefresh(WIDGET_KEY);
  };
  gladys.onDeviceCreated(resend);
  gladys.onDeviceUpdated(resend);

  // --- Connect button (manifest field `oauth2`) ------------------------------
  gladys.onOAuthAuthorizeUrl(async (key, redirectUri) => {
    if (!hasClient(config)) {
      throw new Error(STATUS.notConfigured.en);
    }
    logger.info('Google sign-in requested');
    return auth.authorizeUrl(redirectUri);
  });

  gladys.onOAuthCallback(async (key, { code, state, redirectUri }) => {
    try {
      await auth.exchangeCode({ code, state, redirectUri });
    } catch (err) {
      logger.warn(`Google sign-in failed: ${err.message}`);
      throw err;
    }
    logger.info('Google account connected');
    // Maybe another account: read its id again, and everything with it.
    accountId = null;
    await store.set('accountId', undefined);
    reader.reset();
    snapshot = null;
    // The ack is awaited by the Configuration screen: the first reading runs after.
    poller.now().catch(() => {});
  });

  // --- Configuration action: read now ----------------------------------------
  gladys.onAction(ACTION_REFRESH, async () => {
    logger.info('Action: refresh now');
    await poller.now();
    if (problem) {
      const status = PROBLEMS[problem].status;
      return Object.fromEntries(
        Object.keys(LOCALES).map((lang) => [lang, MESSAGES.failed[lang](status[lang])]),
      );
    }
    return summary();
  });

  // --- Dashboard widget --------------------------------------------------------
  gladys.onWidgetGet(WIDGET_KEY, async ({ language }) =>
    buildHealthContent({
      snapshot,
      problem: problem ? PROBLEMS[problem].widget : null,
      detail: problem ? PROBLEMS[problem].status : null,
      config,
      language: LOCALES[language] ? language : config.language,
      now: now(),
    }),
  );

  // --- Configuration updated by the user ---------------------------------------
  gladys.onConfigUpdated(async (newConfig) => {
    logger.info('Configuration updated');
    const previousClient = config.clientId;
    config = normalizeConfig(newConfig);
    if (config.clientId !== previousClient) {
      reader.reset();
    }
    await publishDevice();
    await poller.restart();
    gladys.requestWidgetRefresh(WIDGET_KEY);
  });

  // --- Connection lifecycle ----------------------------------------------------
  gladys.on('connected', async () => {
    try {
      config = normalizeConfig(await gladys.getConfig());
      statusKey = undefined; // Gladys may have restarted: send the status again
      accountId = (await store.get('accountId')) ?? null;
      await publishDevice();
      await poller.restart();
      gladys.requestWidgetRefresh(WIDGET_KEY);
    } catch (err) {
      logger.error(`Post-connection initialization failed: ${err.message}`);
      await gladys.setConnectionStatus(false, STATUS.initFailed).catch(() => {});
    }
  });

  return {
    poller,
    get snapshot() {
      return snapshot;
    },
    async stop() {
      poller.stop();
      await store.flush();
    },
  };
}
