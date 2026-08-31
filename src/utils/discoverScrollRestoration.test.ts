import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';
import {
  DISCOVER_SCROLL_HISTORY_KEY,
  getDiscoverScrollEntry,
  getScrollRestorationAction,
  isMediaDetailPath,
} from './discoverScrollRestoration';

describe('discover scroll restoration', () => {
  const entry = {
    path: '/discover/movies?sortBy=popularity.desc',
    scrollY: 4200,
    itemCount: 80,
  };

  it('recognizes only the corresponding media detail route', () => {
    strictEqual(isMediaDetailPath('/movie/123', 'movie'), true);
    strictEqual(isMediaDetailPath('/tv/123', 'movie'), false);
    strictEqual(isMediaDetailPath('/book/OL123W?from=list', 'book'), true);
    strictEqual(isMediaDetailPath('/discover/books', 'book'), false);
  });

  it('reads valid restoration data only for the matching history entry', () => {
    const state = { [DISCOVER_SCROLL_HISTORY_KEY]: entry };

    deepStrictEqual(getDiscoverScrollEntry(state, entry.path), entry);
    strictEqual(getDiscoverScrollEntry(state, '/discover/movies'), undefined);
    strictEqual(
      getDiscoverScrollEntry(
        {
          [DISCOVER_SCROLL_HISTORY_KEY]: {
            ...entry,
            scrollY: Number.NaN,
          },
        },
        entry.path
      ),
      undefined
    );
  });

  it('loads enough infinite-scroll results before restoring the offset', () => {
    strictEqual(
      getScrollRestorationAction({
        entry,
        itemCount: 20,
        isLoading: false,
        isReachingEnd: false,
      }),
      'load-more'
    );
    strictEqual(
      getScrollRestorationAction({
        entry,
        itemCount: 20,
        isLoading: true,
        isReachingEnd: false,
      }),
      'none'
    );
    strictEqual(
      getScrollRestorationAction({
        entry,
        itemCount: 80,
        isLoading: false,
        isReachingEnd: false,
      }),
      'restore'
    );
  });
});
