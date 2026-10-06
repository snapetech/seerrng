import { createDownloadClient } from '@server/api/downloadClients';
import { DownloadClientError } from '@server/api/downloadClients/types';
import liveDownloadMonitor from '@server/lib/liveDownloads';
import { Permission } from '@server/lib/permissions';
import {
  DOWNLOAD_CLIENT_TYPES,
  type DownloadClientSettings,
  type DownloadClientType,
  getSettings,
  type LiveDownloadSettings,
} from '@server/lib/settings';
import logger from '@server/logger';
import { authorizedMutation } from '@server/middleware/authorizedMutation';
import { REDACTED_SECRET } from '@server/utils/security';
import {
  normalizeServiceHostname,
  normalizeUrlBase,
} from '@server/utils/serviceUrl';
import { Router } from 'express';

export const MAX_DOWNLOAD_CLIENTS = 8;

const DEFAULT_PORTS: Record<DownloadClientType, number> = {
  qbittorrent: 8080,
  transmission: 9091,
  deluge: 8112,
  torrentng: 8080,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const isDownloadClientType = (value: unknown): value is DownloadClientType =>
  typeof value === 'string' &&
  (DOWNLOAD_CLIENT_TYPES as readonly string[]).includes(value);

const validSecret = (value: string) =>
  value.length <= 2048 && !/[\r\n\0]/.test(value);

type ParseResult<T> = { value: T } | { error: string };

/**
 * Parses one client. A missing or redacted password keeps the saved password
 * for the same client ID; `clearPassword` removes it.
 */
export const parseDownloadClient = (
  value: unknown,
  existing: DownloadClientSettings[]
): ParseResult<Omit<DownloadClientSettings, 'id'> & { id?: number }> => {
  if (!isRecord(value)) {
    return { error: 'Each download client must be an object.' };
  }

  const id =
    typeof value.id === 'number' &&
    Number.isSafeInteger(value.id) &&
    value.id >= 0
      ? value.id
      : undefined;
  const saved =
    id === undefined ? undefined : existing.find((c) => c.id === id);

  if (!isDownloadClientType(value.type)) {
    return { error: 'Choose a supported download client type.' };
  }
  const type = value.type;

  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name || name.length > 80) {
    return { error: 'Download client name must be 1–80 characters.' };
  }

  const hostname =
    typeof value.hostname === 'string' && value.hostname.length <= 255
      ? normalizeServiceHostname(value.hostname)
      : '';
  if (!hostname) {
    return { error: `${name}: hostname is invalid.` };
  }

  const port = value.port ?? DEFAULT_PORTS[type];
  if (
    typeof port !== 'number' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    return { error: `${name}: port must be between 1 and 65535.` };
  }

  const useSsl = value.useSsl ?? false;
  if (typeof useSsl !== 'boolean') {
    return { error: `${name}: HTTPS setting must be true or false.` };
  }

  const enabled = value.enabled ?? true;
  if (typeof enabled !== 'boolean') {
    return { error: `${name}: enabled setting must be true or false.` };
  }

  const baseUrlValue = value.baseUrl ?? '';
  if (typeof baseUrlValue !== 'string' || baseUrlValue.length > 512) {
    return { error: `${name}: URL base is invalid.` };
  }
  const baseUrl = normalizeUrlBase(baseUrlValue);
  if (baseUrlValue.trim() !== '' && !baseUrl) {
    return { error: `${name}: URL base is invalid.` };
  }

  const username = value.username ?? '';
  if (typeof username !== 'string' || !validSecret(username)) {
    return { error: `${name}: username is invalid.` };
  }

  let password = saved?.password ?? '';
  if (value.clearPassword === true) {
    password = '';
  } else if (
    typeof value.password === 'string' &&
    value.password !== REDACTED_SECRET &&
    value.password !== ''
  ) {
    password = value.password;
  } else if (
    value.password !== undefined &&
    typeof value.password !== 'string'
  ) {
    return { error: `${name}: password is invalid.` };
  }
  if (!validSecret(password)) {
    return { error: `${name}: password is invalid.` };
  }

  return {
    value: {
      id: saved?.id,
      name,
      type,
      enabled,
      hostname,
      port,
      useSsl,
      baseUrl,
      // Deluge and TorrentNG authenticate with a password/token only.
      username:
        type === 'qbittorrent' || type === 'transmission' ? username : '',
      password,
    },
  };
};

export const parseLiveDownloadSettings = (
  value: unknown,
  current: LiveDownloadSettings
): ParseResult<LiveDownloadSettings> => {
  if (!isRecord(value)) {
    return { error: 'Live download settings must be an object.' };
  }

  const interval = value.pollIntervalSeconds ?? current.pollIntervalSeconds;
  if (
    typeof interval !== 'number' ||
    !Number.isInteger(interval) ||
    interval < 1 ||
    interval > 60
  ) {
    return { error: 'Refresh interval must be 1–60 seconds.' };
  }

  const rawClients = value.clients ?? current.clients;
  if (!Array.isArray(rawClients)) {
    return { error: 'Download clients must be a list.' };
  }
  if (rawClients.length > MAX_DOWNLOAD_CLIENTS) {
    return {
      error: `Up to ${MAX_DOWNLOAD_CLIENTS} download clients are supported.`,
    };
  }

  const parsed: (Omit<DownloadClientSettings, 'id'> & { id?: number })[] = [];
  for (const raw of rawClients) {
    const client = parseDownloadClient(raw, current.clients);
    if ('error' in client) {
      return client;
    }
    parsed.push(client.value);
  }

  let nextId = Math.max(-1, ...current.clients.map((client) => client.id)) + 1;
  const usedIds = new Set<number>();
  const clients = parsed.map((client): DownloadClientSettings => {
    let id = client.id;
    if (id === undefined || usedIds.has(id)) {
      id = nextId++;
    }
    usedIds.add(id);
    return { ...client, id };
  });

  return { value: { pollIntervalSeconds: interval, clients } };
};

export const liveDownloadSettingsView = (settings: LiveDownloadSettings) => ({
  pollIntervalSeconds: settings.pollIntervalSeconds,
  clients: settings.clients.map((client) => ({
    ...client,
    password: client.password ? REDACTED_SECRET : '',
    passwordConfigured: Boolean(client.password),
  })),
});

const downloadClientRoutes = Router();

downloadClientRoutes.get('/', (_req, res) => {
  res.status(200).json(liveDownloadSettingsView(getSettings().liveDownloads));
});

downloadClientRoutes.get('/status', (_req, res) => {
  res.status(200).json({
    subscribers: liveDownloadMonitor.subscriberCount,
    clients: liveDownloadMonitor.getClientHealth(),
  });
});

downloadClientRoutes.put(
  '/',
  authorizedMutation(Permission.ADMIN, async (req, res) => {
    const settings = getSettings();
    const parsed = parseLiveDownloadSettings(req.body, settings.liveDownloads);
    if ('error' in parsed) {
      return res.status(400).json({ error: parsed.error });
    }

    try {
      // Re-parse against the locked current value so concurrent saves cannot
      // pair a stale redacted password with another client's ID.
      const saved = await settings.persistSection(
        'liveDownloads',
        (current) => {
          const locked = parseLiveDownloadSettings(req.body, current);
          if ('error' in locked) {
            throw new Error(locked.error);
          }
          return locked.value;
        }
      );
      return res.status(200).json(liveDownloadSettingsView(saved));
    } catch {
      return res
        .status(500)
        .json({ error: 'Download client settings could not be saved.' });
    }
  })
);

downloadClientRoutes.post(
  '/test',
  authorizedMutation(Permission.ADMIN, async (req, res) => {
    const parsed = parseDownloadClient(
      req.body,
      getSettings().liveDownloads.clients
    );
    if ('error' in parsed) {
      return res.status(400).json({ error: parsed.error });
    }

    try {
      const client = createDownloadClient({ ...parsed.value, id: -1 });
      const result = await client.testConnection();
      return res.status(200).json({ success: true, version: result.version });
    } catch (error) {
      const message =
        error instanceof DownloadClientError
          ? error.message
          : 'The download client could not be reached. Check its address.';
      logger.debug('Download client test failed', {
        label: 'Live Downloads',
        type: parsed.value.type,
        errorMessage: message,
      });
      return res.status(502).json({ success: false, error: message });
    }
  })
);

export default downloadClientRoutes;
