import { useEffect, useState } from 'react';

export const DISCOVER_SNAPSHOT_SCHEMA_VERSION = 1;
export const DISCOVER_SNAPSHOT_FRESH_AGE = 1000 * 60 * 15;
export const DISCOVER_SNAPSHOT_MAX_AGE = 1000 * 60 * 60 * 24;

const DISCOVER_SNAPSHOT_PREFIX = 'seerr-discover-snapshot-v1:';

export interface DiscoverCacheContext {
  userId: number;
  permissions: number;
  discoverRegion: string;
  streamingRegion: string;
  originalLanguage: string;
}

export interface DiscoverSnapshotMetadata {
  schemaVersion: typeof DISCOVER_SNAPSHOT_SCHEMA_VERSION;
  contextKey: string;
  createdAt: number;
  freshUntil: number;
  expiresAt: number;
  seed?: string;
  manifestVersion?: string;
  layoutRevision?: string;
  userStateRevision?: string;
}

export interface DiscoverSnapshot<T> {
  metadata: DiscoverSnapshotMetadata;
  data: T;
}

type StorageLike = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

const getBrowserStorage = (): StorageLike | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

export const buildDiscoverCacheContextKey = (
  context: DiscoverCacheContext
): string =>
  [
    context.userId,
    context.permissions,
    context.discoverRegion,
    context.streamingRegion,
    context.originalLanguage,
  ]
    .map((value) => encodeURIComponent(String(value)))
    .join(':');

export const buildDiscoverSnapshotKey = (
  contextKey: string,
  rowKey: string,
  url: string,
  extraParams = ''
): string =>
  `${DISCOVER_SNAPSHOT_PREFIX}${encodeURIComponent(
    contextKey
  )}:${encodeURIComponent(rowKey)}:${encodeURIComponent(
    url
  )}:${encodeURIComponent(extraParams)}`;

export const createDiscoverSnapshot = <T>(
  contextKey: string,
  data: T,
  {
    now = Date.now(),
    seed,
    manifestVersion,
    layoutRevision,
    userStateRevision,
  }: Partial<
    Pick<
      DiscoverSnapshotMetadata,
      'seed' | 'manifestVersion' | 'layoutRevision' | 'userStateRevision'
    >
  > & { now?: number } = {}
): DiscoverSnapshot<T> => ({
  metadata: {
    schemaVersion: DISCOVER_SNAPSHOT_SCHEMA_VERSION,
    contextKey,
    createdAt: now,
    freshUntil: now + DISCOVER_SNAPSHOT_FRESH_AGE,
    expiresAt: now + DISCOVER_SNAPSHOT_MAX_AGE,
    seed,
    manifestVersion,
    layoutRevision,
    userStateRevision,
  },
  data,
});

const isDiscoverSnapshot = <T>(
  value: unknown
): value is DiscoverSnapshot<T> => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<DiscoverSnapshot<T>>;
  const metadata = candidate.metadata;

  return (
    !!metadata &&
    metadata.schemaVersion === DISCOVER_SNAPSHOT_SCHEMA_VERSION &&
    typeof metadata.contextKey === 'string' &&
    typeof metadata.createdAt === 'number' &&
    typeof metadata.freshUntil === 'number' &&
    typeof metadata.expiresAt === 'number' &&
    'data' in candidate
  );
};

export const readDiscoverSnapshot = <T>(
  storage: StorageLike,
  key: string,
  contextKey: string,
  now = Date.now()
): DiscoverSnapshot<T> | undefined => {
  try {
    const rawSnapshot = storage.getItem(key);

    if (!rawSnapshot) {
      return undefined;
    }

    const snapshot: unknown = JSON.parse(rawSnapshot);

    if (
      !isDiscoverSnapshot<T>(snapshot) ||
      snapshot.metadata.contextKey !== contextKey ||
      snapshot.metadata.expiresAt <= now
    ) {
      storage.removeItem(key);
      return undefined;
    }

    return snapshot;
  } catch {
    storage.removeItem(key);
    return undefined;
  }
};

export const writeDiscoverSnapshot = <T>(
  storage: StorageLike,
  key: string,
  snapshot: DiscoverSnapshot<T>
) => {
  try {
    storage.setItem(key, JSON.stringify(snapshot));
  } catch {
    storage.removeItem(key);
  }
};

export const isDiscoverSnapshotFresh = (
  snapshot: DiscoverSnapshot<unknown>,
  now = Date.now()
): boolean => snapshot.metadata.freshUntil > now;

export const setDiscoverSnapshot = <T>(
  key: string,
  snapshot: DiscoverSnapshot<T>
) => {
  const storage = getBrowserStorage();

  if (storage) {
    writeDiscoverSnapshot(storage, key, snapshot);
  }
};

export const useDiscoverSnapshot = <T>(
  key: string | undefined,
  contextKey: string | undefined
): { hydrated: boolean; snapshot?: DiscoverSnapshot<T> } => {
  const [response, setResponse] = useState<{
    key?: string;
    snapshot?: DiscoverSnapshot<T>;
  }>();

  useEffect(() => {
    const storage = getBrowserStorage();

    setResponse({
      key,
      snapshot:
        storage && key && contextKey
          ? readDiscoverSnapshot<T>(storage, key, contextKey)
          : undefined,
    });
  }, [contextKey, key]);

  const hydrated = response?.key === key;

  return {
    hydrated,
    snapshot: hydrated ? response?.snapshot : undefined,
  };
};
