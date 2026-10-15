# Google Health API fixtures

Real answer shapes of the Google Health API v4, the successor of the Fitbit
Web API, used by the tests in place of the network.

- `steps.json`, `distance.json`, `floors.json`, `total_calories.json`,
  `resting_heart_rate.json`, `sleep.json`, `sleep_in_progress.json`,
  `weight.json`, `body_fat.json`, `paired_devices.json`, `identity.json`: from
  the tests of the Home Assistant `google_health` integration
  (`tests/components/google_health/fixtures`, Apache-2.0, © the Home Assistant
  authors). The MAC addresses there are already made up.
- `errors/*.json`: from the tests of `python-google-health-api` by Allen Porter
  (`tests/fixtures/errors`, Apache-2.0), the library Home Assistant uses.
- `active_minutes.json`, `settings.json`, `sleep_stages_and_nap.json`,
  `steps_int64.json`: written for this repository from Google's discovery
  document (`health_v4_discovery.json`): int64 values as JSON strings,
  UTC offsets as protobuf durations (`"7200s"`), a nap next to the night.
