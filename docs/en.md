# Fitbit

Brings the data of your **Fitbit** watch or tracker (and of a Google Pixel
Watch using Fitbit) into Gladys: the day's steps, distance, floors, calories
and active minutes, the resting heart rate, last night's sleep, your weight
and body fat when you log them, and the battery and last sync of the watch.
Two scene triggers start your routines: **woke up** and **step goal
reached**. A dashboard widget sums it all up.

**Read only**: the integration never writes anything to your Google account.

> **The Fitbit Web API is being retired.** Google has replaced it with the
> **Google Health API**: support for the Fitbit Web API ended on
> 30 September 2026, Google announced it would be switched off at the end of
> October 2026, and new Fitbit developer apps can no longer be created. This
> integration therefore reads your Fitbit data through the **Google Health
> API**, from the Google account your Fitbit is linked to — like the Home
> Assistant "Google Health" integration that replaced its Fitbit one.

> **Developed without the hardware**: the integration was written and tested
> against the documented answers of the Google Health API, without a Fitbit
> watch or account. Feedback welcome on the Gladys forum or on GitHub.

This integration is not affiliated with Fitbit or Google.

## Requirements

- Gladys **5.1.0** or later.
- A Fitbit watch or tracker whose Fitbit account has been **moved to a Google
  account** (the Fitbit app offers it; it is mandatory for the Google Health
  API).
- A **Google Cloud project** of your own, free: the integration uses _your_
  OAuth client, so your data goes from Google to your Gladys only.
- The Fitbit app on your phone, synced: the watch only sends its data to
  Google when it syncs with the phone.

## Configuration

The setup takes about ten minutes, once. The Connect button of the
Configuration screen shows the **redirect URI** to declare at Google:
`https://my.gladysassistant.com/redirect/oauth` (a page hosted by Gladys that
sends you back to your own Gladys; tokens never go through it).

### 1. Create the Google Cloud project

1. Open the [Google Cloud console](https://console.cloud.google.com/) with
   any Google account and create a project (for example "Gladys").
2. In **APIs & Services → Library**, search for **Google Health API** and
   click **Enable**.

### 2. Set up the OAuth consent screen

1. In **Google Auth Platform** (formerly "OAuth consent screen"), click
   **Get started**: give an app name ("Gladys"), your email, choose the
   **External** audience, and accept the terms. Leave the optional branding
   fields (logo, domains) empty: they would trigger Google's verification.
2. In **Audience**, add your own Google account (the one of your Fitbit) as
   a **test user**, then click **Publish app** so it is **In production**.
   An app left in "Testing" loses its authorization **every 7 days**.

### 3. Create the OAuth client

1. In **Clients** (or **Credentials**), create an **OAuth client ID** of
   type **Web application**.
2. Under **Authorized redirect URIs**, add exactly
   `https://my.gladysassistant.com/redirect/oauth`. If you chose, in Gladys,
   to use the address of your instance instead (Gladys served over HTTPS),
   declare that address instead.
3. Copy the **client ID** and the **client secret**.

### 4. Connect Gladys

1. In Gladys, open **Integrations → Fitbit → Configuration**, paste the
   client ID and the client secret, and **Save**.
2. Click **Connect**: Google asks you to choose your account. As the app is
   yours and not verified by Google, it shows "Google hasn't verified this
   app": click **Advanced**, then **Go to Gladys**.
3. Tick **all** the permissions (activity, health measurements, sleep,
   settings) and confirm. A permission left unticked leaves its features
   empty.
4. The **Fitbit** device appears in the **Discover** tab: add it.

Other settings: the **daily step goal** (for the trigger and the widget), the
**refresh interval** (15 minutes by default) and the **language of the
feature names** (French by default, set it before adding the device: Gladys
keeps the names given at creation).

## The device

One **Fitbit** device per Google account, read only:

| Feature                  | What it holds                                                    |
| ------------------------ | ---------------------------------------------------------------- |
| Steps today              | Steps since midnight (in the time zone of your Fitbit account)   |
| Distance today           | Kilometres                                                       |
| Floors today             | Floors climbed                                                   |
| Calories burned (kcal)   | Total of the day, basal metabolism included                      |
| Active minutes           | Moderately and very active minutes, as in the Fitbit app         |
| Resting heart rate (bpm) | The latest daily value computed by Fitbit                        |
| Sleep duration           | Hours asleep last night (naps excluded)                          |
| Sleep efficiency         | Time asleep over time from bedtime to wake-up, in %              |
| Bedtime / Wake-up time   | Text, "23:12" and "07:05", on the clock of where you slept       |
| Weight (kg) / Body fat   | The latest entry (scale or manual logging), read once an hour    |
| Watch battery            | % of the tracker synced last (a scale is ignored)                |
| Last sync                | Text, date and time of the last sync of the watch with the phone |

A value Google does not give (no weight logged, a permission refused) stays
empty; the last known value is never replaced by 0. Values that do not change
are sent again every 6 hours so Gladys keeps them "recent".

## Widget

**Fitbit summary**: three tiles (steps, hours of sleep, resting heart rate)
and a list: progress towards the step goal, bedtime → wake-up time, sleep
efficiency, watch and battery (orange under 20 %), last sync (orange after
24 hours). When Google cannot be read, a line says why and the last figures
stay. The widget works before the device is added.

## Scene triggers

- **Fitbit: woke up** (`woke_up`): a night of sleep ended. Google only knows
  it once the watch has synced and the night is computed, so the trigger
  arrives **after** you get up — a few minutes to an hour, depending on when
  the phone syncs. Variables: wake-up time, bedtime, hours asleep, sleep
  efficiency. Once per night, never for a nap, never for a night found more
  than 12 hours after its end.
- **Fitbit: step goal reached** (`step_goal_reached`): the day's steps reached
  the goal of the configuration. Once a day. Variables: steps, goal.

The first reading after the installation records the situation without
firing: last night is not news.

## Configuration action

**Refresh now** reads Google Health at once and tells what it got (steps of
the day, last sync) or why it failed.

## Scene examples

- **Morning routine**: trigger "Fitbit: woke up" → open the bedroom shutters,
  turn on the kitchen light, send "Good morning! {{hours asleep}} h of sleep"
  on Telegram.
- **Short night**: trigger "Fitbit: woke up", condition "Sleep duration below
  6" → postpone the noisy appliances to the afternoon.
- **Congratulations**: trigger "Fitbit: step goal reached" → a notification
  and a colour flash of the living-room lamp.
- **Battery reminder**: every evening at 21:00, condition "Watch battery
  below 20" → "Charge your watch before the night".

## Troubleshooting

- **"Enter the client ID and secret…"**: fill in both fields and save before
  clicking Connect.
- **Google shows "redirect_uri_mismatch"**: the authorized redirect URI of
  the OAuth client must be exactly the one shown under the Connect button.
- **"The Google Health API is not enabled…"**: enable it in the library of
  your project, then wait a few minutes.
- **"This Google account has no Fitbit data…"**: move your Fitbit account to
  your Google account in the Fitbit app, then connect that Google account.
- **"Google withdrew the authorization…" every week**: the app of your project
  is still in "Testing": publish it to production, then click Connect again.
- **Figures that do not move**: look at "Last sync" — the watch must sync
  with the Fitbit app on the phone (Bluetooth on, app allowed in the
  background).
- **Empty features**: a permission was left unticked on Google's consent
  screen. Click Connect again and tick everything.
- Detailed logs: start the integration with `LOG_LEVEL=debug`. They never
  contain your health figures nor your tokens.

## Limits

- **Not real time**: Google Health has what the watch sent at its last sync;
  the integration reads it every 15 minutes by default (30 min or 1 h
  possible).
- **Quota**: Google sets the quota of the API per Cloud project (see
  "Quotas" in the console). A reading costs 8 requests (2 more once an hour
  for weight and body fat), about 35 requests an hour at 15 minutes: far
  from the limits. Google can answer "quota exceeded" (429): the integration
  tries again at the next refresh.
- **One Google account** per installation of the integration.
- The step goal of the Fitbit app is not exposed by the API: set yours in the
  configuration.
- No intraday heart rate, no sleep stages, no SpO2: kept for a later version.
- **Unverified Google app**: fine for personal use (up to 100 users); Google
  shows a warning on the consent screen.

## Privacy and data

- The integration talks to Google only (`oauth2.googleapis.com`,
  `health.googleapis.com`), with your own OAuth client.
- The tokens are kept in `/data/fitbit.json`, readable by the integration
  only; the client secret stays in the configuration of Gladys.
- Health data goes to Gladys (states, history, widget) and nowhere else, and
  never into the logs.
