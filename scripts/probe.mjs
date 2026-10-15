#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe of the real Google services, read only, for a machine with network
// access (the development sessions have none):
//
//   node scripts/probe.mjs
//
// Runs the real code of the integration (src/google/*) with a FAKE client and
// a FAKE token, up to the refusal, and checks that each refusal is the one
// the integration expects. It also says whether the legacy Fitbit Web API
// still answers. Prints statuses and error labels only: no token, no body.
//
// With a real account (optional): FITBIT_PROBE_ACCESS_TOKEN=<an access token
// of the four read-only scopes> also reads the account once and prints which
// data came back (present / absent), never a value.
//
// Exit code: 0 when every answer is the expected one, 1 otherwise.
// -----------------------------------------------------------------------------

import { classifyApiError, ERROR_KINDS } from '../src/google/errors.js';
import { createHealthClient } from '../src/google/health.js';
import { AUTHORIZE_URL, createAuth, SCOPES, TOKEN_URL } from '../src/google/oauth.js';
import { createReader } from '../src/reader.js';

const FAKE_CLIENT = {
  clientId: '000000000000-probe.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-probe-not-a-secret',
};
const REDIRECT_URI = 'https://my.gladysassistant.com/redirect/oauth';
const TIMEOUT = 15000;

let failures = 0;
function report(ok, step, detail) {
  if (!ok) {
    failures += 1;
  }
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${step}: ${detail}`);
}

async function fetchStatus(url, init = {}) {
  try {
    const response = await fetch(url, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const json = await response.json().catch(() => null);
    return { status: response.status, json };
  } catch (err) {
    return { status: 0, error: err.cause?.code ?? err.name };
  }
}

// 1. Google's consent page answers for the URL the Connect button builds.
{
  const store = memoryStore();
  const auth = createAuth({ store, getConfig: () => FAKE_CLIENT });
  const url = auth.authorizeUrl(REDIRECT_URI);
  const { status, error } = await fetchStatus(url);
  report(
    url.startsWith(AUTHORIZE_URL) && status > 0 && status < 500,
    'consent page',
    error ? `unreachable (${error})` : `HTTP ${status} (an unknown client is refused on the page)`,
  );
}

// 2. The token endpoint refuses the fake client, as the code expects.
{
  const store = memoryStore({
    tokens: {
      clientId: FAKE_CLIENT.clientId,
      refreshToken: 'probe-refresh',
      expiresAt: 0,
      scope: '',
    },
  });
  const auth = createAuth({ store, getConfig: () => FAKE_CLIENT });
  try {
    await auth.accessToken();
    report(false, 'token endpoint', 'a fake client got a token');
  } catch (err) {
    report(
      [ERROR_KINDS.CLIENT, ERROR_KINDS.REVOKED].includes(err.kind),
      'token endpoint',
      `${TOKEN_URL} refused: kind "${err.kind}" (${err.message})`,
    );
  }
}

// 3. The Google Health API refuses a fake token on each endpoint the device reads.
{
  const auth = { accessToken: async () => 'probe-fake-token', expireAccessToken: async () => {} };
  const client = createHealthClient({ auth });
  const date = { year: 2026, month: 1, day: 1 };
  const calls = {
    identity: () => client.identity(),
    settings: () => client.settings(),
    'steps rollup': () => client.dailyRollup('steps', date),
    'sleep list': () => client.latest('sleep', 1),
    'paired devices': () => client.pairedDevices(),
  };
  for (const [name, call] of Object.entries(calls)) {
    try {
      await call();
      report(false, `health ${name}`, 'a fake token was accepted');
    } catch (err) {
      report(
        err.kind === ERROR_KINDS.REVOKED,
        `health ${name}`,
        `kind "${err.kind}" (${err.message})`,
      );
    }
  }
}

// 4. The legacy Fitbit Web API: still answering? (informational)
{
  const { status, json, error } = await fetchStatus(
    'https://api.fitbit.com/1/user/-/profile.json',
    {
      headers: { authorization: 'Bearer probe-fake-token' },
    },
  );
  const label = json?.errors?.[0]?.errorType ?? '';
  console.log(
    `INFO legacy Fitbit Web API: ${error ? `unreachable (${error})` : `HTTP ${status} ${label}`.trim()}`,
  );
}

// 5. Optional: one real read-only reading, values never printed.
if (process.env.FITBIT_PROBE_ACCESS_TOKEN) {
  const token = process.env.FITBIT_PROBE_ACCESS_TOKEN;
  const auth = { accessToken: async () => token, expireAccessToken: async () => {} };
  const client = createHealthClient({ auth });
  const reader = createReader({
    client,
    grantedScopes: async () => new Set(Object.values(SCOPES)),
  });
  try {
    const snapshot = await reader.read();
    const present = (value) => (value === null || value === undefined ? 'absent' : 'present');
    report(true, 'real reading', 'done');
    for (const [key, value] of Object.entries({
      activity: snapshot.activity,
      restingHeartRate: snapshot.restingHeartRate,
      sleep: snapshot.sleep,
      weight: snapshot.body?.weightKg,
      bodyFat: snapshot.body?.bodyFat,
      tracker: snapshot.tracker,
      trackerBattery: snapshot.tracker?.battery,
    })) {
      console.log(`     ${key}: ${present(value)}`);
    }
    console.log(`     time zone from the account: ${snapshot.timeZone !== undefined}`);
  } catch (err) {
    report(false, 'real reading', `kind "${err.kind}" (${err.message})`);
  }
}

// A sanity check of the classifier itself, so a refusal is never misread.
report(
  classifyApiError(401, { error: { code: 401, status: 'UNAUTHENTICATED' } }).kind ===
    ERROR_KINDS.REVOKED,
  'classifier',
  '401 is an access refusal',
);

console.log(failures === 0 ? 'Probe passed.' : `Probe failed: ${failures} unexpected answer(s).`);
process.exit(failures === 0 ? 0 : 1);

function memoryStore(initial = {}) {
  const data = { ...initial };
  return {
    get: async (key) => data[key],
    set: async (key, value) => {
      data[key] = value;
    },
  };
}
