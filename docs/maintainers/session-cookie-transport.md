# Session Cookie Transport Decision

**Date:** 2026-09-04
**Status:** Superseded by the HTTPS-only session-cookie policy.

SeerrNG uses an `express-session` cookie to carry the authenticated browser
session, including the session created by Plex sign-in. The current
configuration uses `secure: true`:

- When SeerrNG is reached through HTTPS, or a trusted TLS terminator forwards
  `X-Forwarded-Proto: https`, the session cookie receives the `Secure`
  attribute.
- When SeerrNG is reached directly over HTTP, no session cookie is issued.

## Why `secure: true` is enabled unconditionally

The `js/clear-text-cookie` finding at `server/index.ts` was accurate: an
authenticated session sent over HTTP can be observed or modified in transit.
The compatibility path was removed so the application no longer issues that
cookie over clear-text HTTP.

## Chosen behavior

Use `secure: true` so browsers only store and return authenticated session
cookies over HTTPS. Operators must deploy TLS termination and redirect HTTP to
HTTPS before users authenticate.
