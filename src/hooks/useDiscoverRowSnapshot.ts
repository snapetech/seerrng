import useDiscoverHomeManifest from '@app/hooks/useDiscoverHomeManifest';
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
  personalized?: boolean;
  rowKey: string;
  url: string;
}

const useDiscoverRowSnapshot = <T>({
  enabled,
  personalized = false,
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
  const { manifest } = useDiscoverHomeManifest(contextKey);
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
    const layoutChanged =
      !!manifest &&
      snapshot?.metadata.layoutRevision !== manifest.layoutRevision;
    const userStateChanged =
      personalized &&
      !!manifest &&
      snapshot?.metadata.userStateRevision !== manifest.userStateRevision;

    if (
      shouldLoad &&
      snapshot &&
      (!isDiscoverSnapshotFresh(snapshot) || layoutChanged || userStateChanged)
    ) {
      void mutate();
    }
  }, [manifest, mutate, personalized, shouldLoad, snapshot]);

  useEffect(() => {
    if (
      contextKey &&
      snapshotKey &&
      data !== undefined &&
      data !== fallbackData
    ) {
      void setDiscoverSnapshot(
        snapshotKey,
        createDiscoverSnapshot(contextKey, data, {
          freshAgeMs: (manifest?.freshness.rowMaxAgeSeconds ?? 300) * 1000,
          manifestVersion: manifest?.version,
          layoutRevision: manifest?.layoutRevision,
          userStateRevision: manifest?.userStateRevision,
        })
      );
    }
  }, [contextKey, data, fallbackData, manifest, snapshotKey]);

  return {
    data,
    error,
    isLoading: hydrated && shouldLoad && data === undefined && !error,
  };
};

export default useDiscoverRowSnapshot;
