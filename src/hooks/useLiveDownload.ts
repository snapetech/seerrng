import {
  type LiveDownload,
  isLiveDownloadToken,
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
 * Selects a safe browser subscription ID. Non-admin responses carry an
 * opaque user-scoped token; only administrators may subscribe by raw hash.
 */
export const getLiveDownloadSubscriptionId = (
  item: DownloadingItem | undefined,
  allowRawHash = false
): string | undefined => {
  if (isLiveDownloadToken(item?.liveDownloadToken)) {
    return item.liveDownloadToken;
  }
  return allowRawHash ? toInfoHash(item?.downloadId) : undefined;
};

/**
 * Live torrent progress for one visible download, or undefined when no
 * download client reports it or live progress is not set up.
 */
export const useLiveDownload = (
  item: DownloadingItem | undefined,
  allowRawHash = false
): LiveDownload | undefined => {
  const id = getLiveDownloadSubscriptionId(item, allowRawHash);
  const subscribe = useCallback(
    (listener: () => void) =>
      id ? liveDownloadStore.subscribe(id, listener) : noop,
    [id]
  );
  const getSnapshot = useCallback(
    () => (id ? liveDownloadStore.get(id) : undefined),
    [id]
  );
  return useSyncExternalStore(
    id ? subscribe : subscribeNone,
    id ? getSnapshot : getNone,
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
  item: DownloadingItem,
  allowRawHash = false
): LiveDownloadingItem =>
  applyLiveDownload(item, useLiveDownload(item, allowRawHash));
