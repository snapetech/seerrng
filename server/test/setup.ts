import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import http from 'node:http';
import https from 'node:https';
import { after, before } from 'node:test';

// supertest serves the app over a real loopback socket, so only external hosts
// are refused by the test network guard.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);
const blocked = new Set<string>();

function stripPort(host: string): string {
  const bracketed = host.match(/^\[(.+)\]/);
  if (bracketed) {
    return bracketed[1];
  }

  const parts = host.split(':');
  return parts.length === 2 ? parts[0] : host;
}

function hostnameOf(args: unknown[]): string {
  const [first, second] = args;
  let fromUrl: string | undefined;

  if (typeof first === 'string' || first instanceof URL) {
    try {
      fromUrl = new URL(String(first)).hostname;
    } catch {
      fromUrl = undefined;
    }
  }

  const options = (fromUrl !== undefined ? second : first) as
    { hostname?: string; host?: string } | undefined;
  const fromOptions =
    typeof options === 'object' && options !== null
      ? (options.hostname ??
        (options.host ? stripPort(options.host) : undefined))
      : undefined;

  return stripPort(fromOptions ?? fromUrl ?? 'localhost');
}

function blockOutboundRequests(
  mod: typeof http | typeof https,
  scheme: string
) {
  for (const name of ['request', 'get'] as const) {
    const original = mod[name] as (...args: unknown[]) => unknown;

    mod[name] = ((...args: unknown[]) => {
      const hostname = hostnameOf(args);

      if (!LOOPBACK.has(hostname)) {
        const target = `${scheme}//${hostname}`;
        blocked.add(target);
        throw new Error(
          `Blocked outbound request to ${target}. Stub the API client this test uses, or set ALLOW_NETWORK=true.`
        );
      }

      return original(...args);
    }) as typeof mod.request;
  }
}

if (process.env.ALLOW_NETWORK != 'true') {
  blockOutboundRequests(http, 'http:');
  blockOutboundRequests(https, 'https:');
}

Reflect.set(
  globalThis,
  Symbol.for('seerrng.test.externalRuntimeConfig'),
  () => {
    const settings = getSettings();
    return {
      clientId: settings.clientId,
      vapidPublic: settings.vapidPublic,
      vapidPrivate: settings.vapidPrivate,
      main: settings.main,
      plex: settings.plex,
      jellyfin: settings.jellyfin,
      oidc: settings.oidc,
      tautulli: settings.tautulli,
      radarr: settings.radarr,
      sonarr: settings.sonarr,
      sportarr: settings.sportarr,
      lidarr: settings.lidarr,
      readarr: settings.readarr,
      mylar: settings.mylar,
      kapowarr: settings.kapowarr,
      backissue: settings.backissue,
      lazylibrarian: settings.lazylibrarian,
      notifications: settings.notifications,
      network: settings.network,
    };
  }
);

before(() => {
  if (process.env.VERBOSE != 'true') logger.silent = true;
});

after(() => {
  if (process.env.VERBOSE != 'true') logger.silent = false;

  // callers that swallow the error would otherwise leave the suite green
  if (blocked.size && process.env.SEERR_TEST_FAIL_ON_NETWORK === 'true') {
    throw new Error(
      `Test reached the network: ${[...blocked].join(', ')}. Stub the API client this test uses.`
    );
  }
});
