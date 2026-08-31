# Session Cookie Transport Decision

**Date:** 2026-08-01
**Status:** All browser sessions require HTTPS.

SeerrNG uses an `express-session` cookie to carry the authenticated browser
session, including the session created by Plex sign-in. The current
configuration uses `secure: true`. Browsers will only store and send the
authenticated session cookie over HTTPS, including when SeerrNG is behind a
TLS terminator that forwards `X-Forwarded-Proto: https`.

Direct HTTP browser access no longer creates a usable session cookie. This
protects Plex sign-in and other authenticated sessions from being exposed on
unencrypted networks. Operators must terminate TLS before SeerrNG and redirect
HTTP traffic to the HTTPS endpoint.
