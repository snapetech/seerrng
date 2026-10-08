# CodeQL triage — October 8, 2026

This records the 26 open CodeQL alerts fetched from `main` at
`fe1ef9790369c4694cb6b7de4444e6c9330dcfc1` before the all-branches integration.
The alert IDs let the GitHub dispositions be checked against the reviewed
source.

## Fixed in source

- **#481 — `js/missing-rate-limiting`** at
  `server/routes/gameLibrary.test.ts:51`. The alert surfaced at the test app's
  mount of the production router. The Game Library router now limits every
  authenticated user's requests to 120 per minute; the existing Steam sync
  limit remains 4 per minute. Test and E2E environments skip these limits. The
  next CodeQL analysis should close this alert as fixed.

## Dismissed as false positives

The `js/file-access-to-http` alerts are **#480, #482–#484, #503–#514, #517,
#521–#522, #526, #528–#529, and #535**. CodeQL traces values loaded from
SeerrNG's local settings and metadata into outbound calls. Review of each sink
found that the data is intentionally sent to its selected integration: the
download clients, Audiobookshelf, Jellystat, slskdN, Apprise, and the configured
Swipe model use an administrator-configured service URL with the existing safe
URL, origin, DNS, and redirect controls; Steam uses its fixed official API
endpoint. These calls send the integration credentials or request metadata the
service expects. They do not upload arbitrary local file contents or accept an
untrusted destination from the request being handled.

## Dismissed as protocol-required

- **#499 and #501 — `js/insufficient-password-hash` and
  `js/weak-cryptographic-algorithm`** at `server/api/navidrome/index.ts:49`.
  Navidrome's Subsonic API requires `token = md5(password + salt)` for token
  authentication. SeerrNG generates a fresh random salt for each request and
  sends the token rather than the password. Replacing MD5 here would break the
  protocol; the [Subsonic API authentication specification](https://www.subsonic.org/pages/api.jsp)
  defines this calculation.
