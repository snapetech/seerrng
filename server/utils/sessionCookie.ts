import type { CookieOptions } from 'express-session';

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

export const getSessionTransportOptions = (
  development: boolean,
  csrfProtection: boolean,
  allowHttpAuth = false
): { cookie: CookieOptions; proxy: boolean } => ({
  cookie: {
    maxAge: SESSION_MAX_AGE_MS,
    httpOnly: true,
    sameSite: csrfProtection ? 'strict' : 'lax',
    // The explicit HTTP-auth fallback uses Express's transport-aware mode so
    // direct HTTPS and trusted HTTPS proxies still receive Secure cookies.
    // The default remains unconditionally HTTPS-only.
    secure: allowHttpAuth ? 'auto' : true,
  },
  // This option is scoped to express-session's transport check. It lets a
  // TLS terminator's X-Forwarded-Proto=https authorize a Secure cookie
  // without enabling Express client-IP proxy trust.
  proxy: !development,
});
