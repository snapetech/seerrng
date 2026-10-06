import {
  type LiveDownload,
  liveDownloadStore,
  toInfoHash,
} from '@app/utils/liveDownloadStore';
import type { DownloadingItem } from '@server/lib/downloadtracker';
import { useCallback, useSyncExternalStore } from 'react';

export type LiveDownloadingItem = DownloadingItem & { live?: LiveDownload };

const noop = () => undefined;
const subscribeNone = () => noop;
const getNone = () => undefined;

/**
 * Live torrent progress for one download ID, or undefined when the ID is not
 * a torrent, no download client reports it, or live progress is not set up.
 */
export const useLiveDownload = (
  downloadId: string | undefined
): LiveDownload | undefined => {
  const hash = toInfoHash(downloadId);
  const subscribe = useCallback(
    (listener: () => void) =>
      hash ? liveDownloadStore.subscribe(hash, listener) : noop,
    [hash]
  );
  const getSnapshot = useCallback(
    () => (hash ? liveDownloadStore.get(hash) : undefined),
    [hash]
  );
  return useSyncExternalStore(
    hash ? subscribe : subscribeNone,
    hash ? getSnapshot : getNone,
    getNone
  );
};

/**
 * Overlays live client figures on the *arr queue item. Queue-reported status
 * and identity are kept; only size, remaining bytes, and ETA change.
 */
export const applyLiveDownload = (
  item: DownloadingItem,
  live: LiveDownload | undefined
): LiveDownloadingItem => {
  if (!live || live.size <= 0) {
    return item;
  }
  const estimatedCompletionTime =
    live.etaSeconds !== null
      ? new Date(Date.parse(live.observedAt) + live.etaSeconds * 1000)
      : item.estimatedCompletionTime;

  return {
    ...item,
    size: live.size,
    sizeLeft: live.sizeLeft,
    estimatedCompletionTime,
    live,
  };
};

export const useLiveDownloadingItem = (
  item: DownloadingItem
): LiveDownloadingItem =>
  applyLiveDownload(item, useLiveDownload(item.downloadId));
