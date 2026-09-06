# Session Cookie Transport Decision

**Date:** 2026-09-04
**Status:** Current transport policy.

SeerrNG uses an `express-session` cookie to carry the authenticated browser
session, including the session created by Plex sign-in.

- The default `SEERR_TLS_MODE=disabled` policy marks session cookies `Secure`
  and does not issue them over direct HTTP.
- `SEERR_TLS_MODE=self-signed` generates persistent local CA/server material,
  serves HTTPS on `SEERR_HTTPS_PORT` (5056 by default), and redirects the HTTP
  `PORT` (5055 by default) listener.
- `SEERR_TLS_MODE=provided` uses operator-supplied PEM certificate/key files
  with the same two-listener model.
- `SEERR_ALLOW_HTTP_AUTH=true` is an explicit, warning-bearing fallback. It
  uses transport-aware cookies so direct HTTP can authenticate, while direct
  HTTPS and trusted HTTPS proxies still receive `Secure` cookies.
- TLS modes and the HTTP fallback cannot be enabled together.

These rules are enforced in `server/utils/sessionCookie.ts`,
`server/utils/tls.ts`, and the Express listener/session setup in
`server/index.ts`. CSRF cookies use the request's secure transport state
independently and continue to preserve `HttpOnly` and SameSite protections.

The public `/api/v1/status/tls` endpoint and setup/login notice expose the
active mode, HTTPS port, certificate fingerprint, and local-CA download link.
The local CA endpoint returns only the public CA certificate.

## Operator rules

1. Use HTTPS for every authenticated browser session when possible.
2. If HTTPS is terminated by a reverse proxy, enable SeerrNG's **Enable Proxy
   Support** setting and forward `X-Forwarded-Proto: https`.
3. Do not infer LAN trust from a client IP or forwarded header.
4. For self-signed TLS, verify and install the generated `ca.crt` on every
   trusted client.
5. Treat `SEERR_ALLOW_HTTP_AUTH=true` as an intentional security tradeoff for
   an isolated LAN only.
