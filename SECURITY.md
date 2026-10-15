# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles, and where:

- **Health data**: steps, activity, resting heart rate, sleep, weight and body
  fat of a Fitbit account. It is read from Google and published to Gladys
  only (device states, scene events, widget). It is never written to the
  logs, at any level, nor to disk outside Gladys: a report showing a health
  figure in the logs is in scope.
- **`/data/fitbit.json`** (mode 0600): the Google OAuth tokens (refresh and
  access token, granted scopes), the Google Health user id of the account,
  and what the scene triggers already announced (the id of the last night,
  the date of the last step goal). No health figure.
- **Secrets**: the OAuth client secret lives in the Gladys configuration
  (`secret` field, never sent back to the browser). Tokens, codes, the PKCE
  verifier and the client secret never appear in the logs.
- **Network**: outbound HTTPS to `oauth2.googleapis.com` and
  `health.googleapis.com` only, with the user's own OAuth client. Read-only
  scopes. No inbound port. The OAuth redirect goes through
  `https://my.gladysassistant.com/redirect/oauth` (Gladys), which sees the
  one-time authorization code, never the tokens (the exchange needs the
  client secret and the PKCE verifier, kept in the container).

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
Google's services, and the Fitbit devices and apps.
