import type { CookieOptions } from 'express-session';

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

export const getSessionTransportOptions = (
  development: boolean,
  csrfProtection: boolean
): { cookie: CookieOptions; proxy: boolean } => ({
  cookie: {
    maxAge: SESSION_MAX_AGE_MS,
    httpOnly: true,
    sameSite: csrfProtection ? 'strict' : 'lax',
    // Match the cookie transport to the request: HTTPS receives Secure while
    // trusted direct HTTP/LAN deployments can complete browser sign-in.
    secure: 'auto',
  },
  // This option is scoped to express-session's transport check. It lets a
  // TLS terminator's X-Forwarded-Proto=https authorize a Secure cookie
  // without enabling Express client-IP proxy trust.
  proxy: !development,
});
