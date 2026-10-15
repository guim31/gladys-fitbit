# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Fitbit data in Gladys through the Google Health API, the successor of the
  retired Fitbit Web API: connect your Google account with the Connect button
  of the Configuration screen (your own Google Cloud OAuth client, read-only
  access).
- One Fitbit device per account: steps, distance, floors, calories and
  active minutes of the day, resting heart rate, last night's sleep
  (duration, efficiency, bedtime, wake-up time), weight and body fat, watch
  battery and last sync.
- Scene triggers "Fitbit: woke up" (with the wake-up time, bedtime, hours
  asleep and efficiency) and "Fitbit: step goal reached" (goal set in the
  configuration).
- Dashboard widget "Fitbit summary": steps and goal, last night, resting heart
  rate, watch battery and last sync.
- "Refresh now" action in the Configuration screen.
- Refresh every 15 minutes by default (30 or 60 possible), only changed values
  published, connection status that says what to fix (client, consent,
  API not enabled, Fitbit account not moved to Google).
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-fitbit/commits/main
