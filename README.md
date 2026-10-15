# Fitbit for Gladys Assistant

External integration for [Gladys Assistant](https://gladysassistant.com) that
brings the data of a **Fitbit** watch or tracker (and of a Google Pixel Watch
used with Fitbit) into Gladys, through the **Google Health API**: the day's
steps, distance, floors, calories and active minutes, the resting heart rate,
last night's sleep (duration, efficiency, bedtime and wake-up time), weight
and body fat when logged, the battery and last sync of the watch. Read only.

> **Developed without the hardware: feedback welcome.** It was written and
> tested against the documented answers of the Google Health API (fixtures of
> Home Assistant and of `python-google-health-api`), without a Fitbit watch or
> account. Please report what you see on the Gladys forum or in an issue.

This project is not affiliated with Fitbit or Google. Fitbit is a trademark of
Google LLC.

## Why the Google Health API, not the Fitbit Web API

Google has replaced the **Fitbit Web API** (`api.fitbit.com`, apps registered
on dev.fitbit.com) by the **Google Health API** (`health.googleapis.com`,
OAuth with a Google Cloud project). Support for the Fitbit Web API ended on
30 September 2026 and Google announced it would be switched off at the end
of October 2026; new Fitbit developer apps can no longer be registered. An
integration started on the Fitbit Web API in October 2026 would have died
within weeks, so this one targets its successor, like the Home Assistant
`google_health` integration (2026.8) did. Users need their Fitbit account
moved to a Google account, which Google requires anyway.

## What it does

- **One device per Google account**, 14 read-only features: steps, distance,
  floors, calories, active minutes, resting heart rate, sleep duration and
  efficiency, bedtime and wake-up time, weight, body fat, watch battery, last
  sync.
- **Scene triggers**: _woke up_ (a night ended, detected when the watch
  syncs, with the wake-up time) and _step goal reached_ (once a day).
- **Dashboard widget** _Fitbit summary_: steps and goal, last night, resting
  heart rate, watch battery and last sync.
- **Configuration action** _Refresh now_.
- Four languages (English, French, German, Spanish) for every text and the
  documentation: [en](docs/en.md), [fr](docs/fr.md), [de](docs/de.md),
  [es](docs/es.md).

## Requirements

- Gladys **5.1.0** or later.
- A Fitbit account moved to a Google account.
- A free Google Cloud project with the Google Health API enabled, an OAuth
  consent screen published "In production" and an OAuth client of type "Web
  application" whose redirect URI is
  `https://my.gladysassistant.com/redirect/oauth` (step by step in the docs).

## Installation

In Gladys: **Integrations → Install from GitHub**, then
`https://github.com/guim31/gladys-fitbit`. In the Configuration screen, enter
the OAuth client ID and secret, save, click **Connect**, then add the
**Fitbit** device from the **Discover** tab.

## How it works

- **OAuth 2.0** authorization code with PKCE (S256) on the user's own Google
  OAuth client, through the `oauth2` field of Gladys (the Connect button).
  Four read-only scopes: activity and fitness, health metrics and
  measurements, sleep, settings. Tokens in `/data/fitbit.json` (mode 0600).
- **Refresh by the container** every 15 minutes (30 or 60 configurable): 8
  requests a reading, weight and body fat once an hour, the account time zone
  once a day — about 35 requests an hour. The core's `onPoll` is only a
  fallback (GladysAssistant/Gladys#3198). Only changed values are published,
  with a 6-hour heartbeat.
- Health data never reaches the logs.

## Limits

- Not real time: the data is what the watch sent at its last sync with the
  phone.
- One Google account per installation; no intraday heart rate, sleep stages
  or SpO2 yet.
- The Fitbit app's step goal is not in the API: it is a configuration field.
- The Google OAuth app is the user's own, unverified: Google shows a warning
  on the consent screen, and an app left in "Testing" must be reconnected
  every 7 days.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
node scripts/probe.mjs        # real Google endpoints, fake credentials, read only
npx -y github:GladysAssistant/integration-store . --skip-image-check
```

`scripts/probe.mjs` runs the real client code against Google with a fake OAuth
client and a fake token, and checks every refusal is the expected one; with
`FITBIT_PROBE_ACCESS_TOKEN` it also reads a real account once and prints which
data came back, never a value.

See [CLAUDE.md](CLAUDE.md) for the project rules and the API pitfalls.

## Releasing

Describe the changes under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md),
then run **Actions → Release** (`patch`, `minor` or `major`): the workflow
bumps `package.json` and the manifest (`version`, `docker_image`), moves the
changelog section, tags, builds the multi-arch image to `ghcr.io` and
publishes the GitHub Release.

A hand-pushed tag (`git tag vX.Y.Z && git push --tags`) builds the image and
the Release too, but touches no file: bump `version` in `package.json` and in
the manifest (with the `docker_image` tag) and commit before tagging.

## Credits

- [Home Assistant](https://github.com/home-assistant/core) — the `fitbit` and
  `google_health` integrations by Allen Porter and contributors (Apache-2.0):
  the choice of data, the polling paces and the API fixtures of
  `test/fixtures/google-health` come from them.
- [python-google-health-api](https://github.com/allenporter/python-google-health-api)
  by Allen Porter (Apache-2.0): the endpoints, the discovery document and the
  error fixtures.
- [Gladys Assistant](https://github.com/GladysAssistant/Gladys) and its
  [integration SDK](https://github.com/GladysAssistant/integration-sdk-js) by
  Pierre-Gilles Leymarie and contributors; started from the official
  JavaScript template.

## License

[Apache-2.0](LICENSE).
