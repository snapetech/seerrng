import type { DiscoverHomeManifest } from '@server/interfaces/api/discoverHomeInterfaces';
import axios from 'axios';
import { useEffect, useState } from 'react';
import useSWR from 'swr';

const MANIFEST_URL = '/api/v1/discover/home/manifest';
const MANIFEST_CACHE_PREFIX = 'seerr-discover-manifest-v1:';

interface ManifestCacheRecord {
  contextKey: string;
  checkedAt: number;
  etag?: string;
  manifest: DiscoverHomeManifest;
}

const getStorage = () => {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
};

const getManifestCacheKey = (contextKey: string) =>
  `${MANIFEST_CACHE_PREFIX}${encodeURIComponent(contextKey)}`;

export const readManifestCache = (
  storage: Pick<Storage, 'getItem'>,
  contextKey: string
): ManifestCacheRecord | undefined => {
  try {
    const rawRecord = storage.getItem(getManifestCacheKey(contextKey));
    const record = rawRecord
      ? (JSON.parse(rawRecord) as Partial<ManifestCacheRecord>)
      : undefined;

    return record?.contextKey === contextKey && record.manifest?.version === 1
      ? (record as ManifestCacheRecord)
      : undefined;
  } catch {
    return undefined;
  }
};

export const isManifestCacheFresh = (
  record: ManifestCacheRecord,
  now = Date.now()
) =>
  record.checkedAt + record.manifest.freshness.manifestMaxAgeSeconds * 1000 >
  now;

const writeManifestCache = (
  storage: Pick<Storage, 'setItem'>,
  contextKey: string,
  record: ManifestCacheRecord
) => {
  try {
    storage.setItem(getManifestCacheKey(contextKey), JSON.stringify(record));
  } catch {
    // The manifest is only an optimization; SWR still retains the live value.
  }
};

const useDiscoverHomeManifest = (contextKey: string | undefined) => {
  const [cachedResponse, setCachedResponse] = useState<{
    contextKey?: string;
    record?: ManifestCacheRecord;
  }>();

  useEffect(() => {
    const storage = getStorage();
    setCachedResponse({
      contextKey,
      record:
        storage && contextKey
          ? readManifestCache(storage, contextKey)
          : undefined,
    });
  }, [contextKey]);

  const hydrated = cachedResponse?.contextKey === contextKey;
  const cachedRecord = hydrated ? cachedResponse?.record : undefined;
  const { data, error } = useSWR<DiscoverHomeManifest>(
    hydrated && contextKey ? [MANIFEST_URL, contextKey] : null,
    {
      fallbackData: cachedRecord?.manifest,
      fetcher: async () => {
        const storage = getStorage();
        const currentRecord =
          storage && contextKey
            ? readManifestCache(storage, contextKey)
            : undefined;
        const response = await axios.get<DiscoverHomeManifest>(MANIFEST_URL, {
          headers: currentRecord?.etag
            ? { 'If-None-Match': currentRecord.etag }
            : undefined,
          validateStatus: (status) => status === 200 || status === 304,
        });
        const record: ManifestCacheRecord = {
          contextKey: contextKey!,
          checkedAt: Date.now(),
          etag: response.headers.etag ?? currentRecord?.etag,
          manifest:
            response.status === 304 && currentRecord
              ? currentRecord.manifest
              : response.data,
        };

        if (storage) {
          writeManifestCache(storage, contextKey!, record);
        }

        return record.manifest;
      },
      revalidateOnFocus: false,
      revalidateOnMount: !cachedRecord || !isManifestCacheFresh(cachedRecord),
      refreshInterval: (latestManifest) =>
        (latestManifest?.freshness.manifestMaxAgeSeconds ?? 60) * 1000,
      refreshWhenHidden: false,
    }
  );

  return { manifest: data, error };
};

export default useDiscoverHomeManifest;
