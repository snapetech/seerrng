#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const settingsPath =
  process.argv[2] ??
  (process.env.CONFIG_DIRECTORY
    ? path.join(process.env.CONFIG_DIRECTORY, 'settings.json')
    : path.join(process.cwd(), 'config', 'settings.json'));

const raw = await readFile(settingsPath, 'utf8');
const settings = JSON.parse(raw);

const requiredSections = [
  'main',
  'network',
  'plex',
  'jellyfin',
  'tautulli',
  'radarr',
  'sonarr',
  'notifications',
];
for (const section of requiredSections) {
  if (!(section in settings)) {
    throw new Error(`Missing settings section: ${section}`);
  }
}

const externalConfig = {
  clientId: settings.clientId,
  vapidPublic: settings.vapidPublic,
  vapidPrivate: settings.vapidPrivate,
  main: settings.main,
  plex: settings.plex,
  jellyfin: settings.jellyfin,
  oidc: settings.oidc ?? { providers: [] },
  tautulli: settings.tautulli,
  radarr: settings.radarr,
  sonarr: settings.sonarr,
  lidarr: settings.lidarr ?? [],
  readarr: settings.readarr ?? [],
  notifications: settings.notifications,
  network: settings.network,
};

process.stdout.write(`${JSON.stringify(externalConfig)}\n`);
