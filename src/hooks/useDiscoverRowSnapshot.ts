import useSettings from '@app/hooks/useSettings';
import { useUser } from '@app/hooks/useUser';
import {
  buildDiscoverCacheContextKey,
  buildDiscoverSnapshotKey,
  createDiscoverSnapshot,
  isDiscoverSnapshotFresh,
  setDiscoverSnapshot,
  useDiscoverSnapshot,
} from '@app/utils/discoverSnapshot';
import axios from 'axios';
import { useEffect, useMemo } from 'react';
import useSWR from 'swr';

interface DiscoverRowSnapshotOptions {
  enabled: boolean;
  rowKey: string;
  url: string;
}

const useDiscoverRowSnapshot = <T>({
  enabled,
  rowKey,
  url,
}: DiscoverRowSnapshotOptions) => {
  const settings = useSettings();
  const { user } = useUser();
  const contextKey = useMemo(
    () =>
      user
        ? buildDiscoverCacheContextKey({
            userId: user.id,
            permissions: user.permissions,
            discoverRegion:
              user.settings?.discoverRegion ??
              settings.currentSettings.discoverRegion,
            streamingRegion:
              user.settings?.streamingRegion ??
              settings.currentSettings.streamingRegion,
            originalLanguage:
              user.settings?.originalLanguage ??
              settings.currentSettings.originalLanguage,
          })
        : undefined,
    [
      settings.currentSettings.discoverRegion,
      settings.currentSettings.originalLanguage,
      settings.currentSettings.streamingRegion,
      user,
    ]
  );
  const snapshotKey = useMemo(
    () =>
      contextKey
        ? buildDiscoverSnapshotKey(contextKey, rowKey, url)
        : undefined,
    [contextKey, rowKey, url]
  );
  const { hydrated, snapshot } = useDiscoverSnapshot<T>(
    snapshotKey,
    contextKey
  );
  const fallbackData = snapshot?.data;
  const shouldLoad =
    !!user && hydrated && (fallbackData !== undefined || enabled);
  const { data, error, mutate } = useSWR<T>(
    shouldLoad && contextKey ? [url, contextKey] : null,
    {
      fallbackData,
      fetcher: ([requestUrl]: [string, string]) =>
        axios.get<T>(requestUrl).then((response) => response.data),
      revalidateOnFocus: false,
      revalidateOnMount: fallbackData === undefined,
    }
  );

  useEffect(() => {
    if (shouldLoad && snapshot && !isDiscoverSnapshotFresh(snapshot)) {
      void mutate();
    }
  }, [mutate, shouldLoad, snapshot]);

  useEffect(() => {
    if (
      contextKey &&
      snapshotKey &&
      data !== undefined &&
      data !== fallbackData
    ) {
      setDiscoverSnapshot(
        snapshotKey,
        createDiscoverSnapshot(contextKey, data)
      );
    }
  }, [contextKey, data, fallbackData, snapshotKey]);

  return {
    data,
    error,
    isLoading: hydrated && shouldLoad && data === undefined && !error,
  };
};

export default useDiscoverRowSnapshot;
