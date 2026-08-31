# Session Cookie Transport Decision

**Date:** 2026-08-01
**Status:** Compatibility decision; HTTPS migration remains follow-up work.

SeerrNG uses an `express-session` cookie to carry the authenticated browser
session, including the session created by Plex sign-in. The current
configuration uses `secure: 'auto'`:

- When SeerrNG is reached through HTTPS, or a trusted TLS terminator forwards
  `X-Forwarded-Proto: https`, the session cookie receives the `Secure`
  attribute.
- When SeerrNG is reached directly over HTTP, the browser can store and send
  the cookie over HTTP.

## Why `secure: true` is not being enabled unconditionally

The direct deployment at `http://kspls0:5055` depends on the HTTP session
cookie. Making the cookie unconditionally secure causes the browser to reject
that cookie on the HTTP origin. The Plex OAuth result then cannot be resumed
in the SeerrNG browser session, so Plex sign-in to the app fails. The same
change would break other direct-HTTP and LAN deployments.

This is a compatibility/security tradeoff, not a CodeQL false positive. The
`js/clear-text-cookie` finding at `server/index.ts:323` is accurate for direct
HTTP deployments. It must remain visible; it must not be dismissed, ignored,
or hidden with a CodeQL model or query configuration.

## Chosen behavior

Preserve `secure: 'auto'` so Plex sign-in and existing HTTP deployments keep
working, while ensuring HTTPS deployments receive secure session cookies. The
remaining risk is that an HTTP deployment exposes the authenticated session to
anyone able to observe or modify that network traffic.

## Resolution path

To remove the finding without breaking Plex sign-in, deploy SeerrNG behind a
working HTTPS endpoint and redirect HTTP to HTTPS. After that deployment is
verified, change the session cookie to `secure: true`, update the transport
tests, and remove the HTTP compatibility path. The TLS termination and
redirect must be deployed and tested first; changing the cookie setting alone
breaks authentication.
