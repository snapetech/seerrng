export const setupConnectionAppIds = [
  'seerrng',
  'radarr',
  'sonarr',
  'lidarr',
  'bookshelf',
  'chaptarrng',
  'prowlarr',
  'qbittorrent',
  'lazylibrarian',
  'mylar3',
  'kapowarr',
  'backissue',
  'romarrng',
  'questarrng',
] as const;

export type SetupConnectionAppId = (typeof setupConnectionAppIds)[number];

const setupConnectionPrefillAppIds = [
  'radarr',
  'sonarr',
  'lidarr',
  'bookshelf',
  'chaptarrng',
  'prowlarr',
  'lazylibrarian',
  'mylar3',
  'kapowarr',
  'backissue',
  'romarrng',
  'questarrng',
] as const satisfies readonly SetupConnectionAppId[];

export type SetupConnectionSuggestion = {
  id: SetupConnectionAppId;
  hostname: string;
  port: number;
  state?: string;
};

const appIdSet = new Set<string>(setupConnectionPrefillAppIds);

export const parseSetupConnections = (
  content: string
): SetupConnectionSuggestion[] => {
  if (content.length > 256 * 1024) {
    throw new Error('The setup file is larger than 256 KB.');
  }

  let document: unknown;
  try {
    document = JSON.parse(content);
  } catch {
    throw new Error('Choose a valid SeerrNG setup connections JSON file.');
  }

  if (
    !document ||
    typeof document !== 'object' ||
    !('connections' in document) ||
    !Array.isArray(document.connections) ||
    document.connections.length > 64
  ) {
    throw new Error(
      'The setup file does not contain a valid connections list.'
    );
  }

  const parsed: SetupConnectionSuggestion[] = [];
  for (const candidate of document.connections) {
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as Record<string, unknown>;
    if (
      typeof record.id !== 'string' ||
      !appIdSet.has(record.id) ||
      typeof record.hostname !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,252}$/.test(record.hostname) ||
      !Number.isInteger(record.port) ||
      Number(record.port) < 1 ||
      Number(record.port) > 65535
    ) {
      continue;
    }

    parsed.push({
      id: record.id as SetupConnectionAppId,
      hostname: record.hostname,
      port: Number(record.port),
      ...(typeof record.state === 'string' && /^[a-z]{1,24}$/.test(record.state)
        ? { state: record.state }
        : {}),
    });
  }

  if (parsed.length === 0) {
    throw new Error('No supported app connection suggestions were found.');
  }

  return parsed;
};
