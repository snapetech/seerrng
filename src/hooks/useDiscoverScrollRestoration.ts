import type { RestorableDiscoverMediaType } from '@app/utils/discoverScrollRestoration';
import {
  DISCOVER_SCROLL_HISTORY_KEY,
  getDiscoverScrollEntry,
  getScrollRestorationAction,
  isMediaDetailPath,
} from '@app/utils/discoverScrollRestoration';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';

type UseDiscoverScrollRestorationOptions = {
  mediaType: RestorableDiscoverMediaType;
  itemCount: number;
  isLoading: boolean;
  isReachingEnd: boolean;
  fetchMore: () => void;
};

const useDiscoverScrollRestoration = ({
  mediaType,
  itemCount,
  isLoading,
  isReachingEnd,
  fetchMore,
}: UseDiscoverScrollRestorationOptions): void => {
  const router = useRouter();
  const itemCountRef = useRef(itemCount);
  const loadRequestedRef = useRef(false);
  const [entry, setEntry] = useState(() =>
    typeof window === 'undefined'
      ? undefined
      : getDiscoverScrollEntry(window.history.state, router.asPath)
  );

  itemCountRef.current = itemCount;

  useEffect(() => {
    if (!router.isReady) {
      return;
    }

    setEntry(getDiscoverScrollEntry(window.history.state, router.asPath));
  }, [router.asPath, router.isReady]);

  useEffect(() => {
    const saveScrollPosition = (url: string) => {
      if (!isMediaDetailPath(url, mediaType)) {
        return;
      }

      const currentState =
        window.history.state && typeof window.history.state === 'object'
          ? window.history.state
          : {};

      window.history.replaceState(
        {
          ...currentState,
          [DISCOVER_SCROLL_HISTORY_KEY]: {
            path: router.asPath,
            scrollY: window.scrollY,
            itemCount: itemCountRef.current,
          },
        },
        '',
        window.location.href
      );
    };

    router.events.on('routeChangeStart', saveScrollPosition);

    return () => router.events.off('routeChangeStart', saveScrollPosition);
  }, [mediaType, router.asPath, router.events]);

  useEffect(() => {
    if (isLoading) {
      loadRequestedRef.current = false;
      return;
    }

    const action = getScrollRestorationAction({
      entry,
      itemCount,
      isLoading,
      isReachingEnd,
    });

    if (action === 'load-more') {
      if (!loadRequestedRef.current) {
        loadRequestedRef.current = true;
        fetchMore();
      }

      return;
    }

    if (action !== 'restore' || !entry) {
      return;
    }

    const currentState =
      window.history.state && typeof window.history.state === 'object'
        ? { ...window.history.state }
        : {};
    delete currentState[DISCOVER_SCROLL_HISTORY_KEY];
    window.history.replaceState(currentState, '', window.location.href);

    const firstFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: entry.scrollY, left: 0, behavior: 'auto' });
        setEntry(undefined);
      });
    });

    return () => window.cancelAnimationFrame(firstFrame);
  }, [entry, fetchMore, isLoading, isReachingEnd, itemCount]);
};

export default useDiscoverScrollRestoration;
