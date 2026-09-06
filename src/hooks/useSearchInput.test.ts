import { JSDOM } from 'jsdom';
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime';
import type { NextRouter } from 'next/router';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import useSearchInput from './useSearchInput';
import {
  getDefaultSearchFormat,
  getDefaultSearchType,
  getSearchQuery,
  shouldNavigateToSearch,
  shouldSyncSearchInput,
} from './useSearchInput.utils';

let root: Root | undefined;
let dom: JSDOM | undefined;

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = undefined;
  }
  dom?.window.close();
  dom = undefined;
});

const createRouter = (overrides: Partial<NextRouter>): NextRouter =>
  ({
    asPath: '/search?query=alien',
    basePath: '',
    beforePopState: () => undefined,
    back: () => undefined,
    defaultLocale: undefined,
    domainLocales: undefined,
    events: {
      emit: () => undefined,
      off: () => undefined,
      on: () => undefined,
    },
    isFallback: false,
    isLocaleDomain: false,
    isPreview: false,
    isReady: true,
    locale: undefined,
    locales: undefined,
    pathname: '/search',
    prefetch: async () => undefined,
    push: async () => true,
    query: { query: 'alien' },
    reload: () => undefined,
    replace: async () => true,
    route: '/search',
    ...overrides,
  }) as NextRouter;

const RouterProvider = ({
  router,
  children,
}: {
  router: NextRouter;
  children?: ReactNode;
}) => createElement(RouterContext.Provider, { value: router }, children);

describe('getSearchQuery', () => {
  it('accepts only scalar query values', () => {
    strictEqual(getSearchQuery('alien'), 'alien');
    strictEqual(getSearchQuery(['alien', 'aliens']), '');
    strictEqual(getSearchQuery(undefined), '');
  });
});

describe('getDefaultSearchType', () => {
  it('starts searches from book discovery with the book filter', () => {
    strictEqual(getDefaultSearchType('/discover/books'), 'book');
    strictEqual(getDefaultSearchType('/discover/movies'), undefined);
  });
});

describe('getDefaultSearchFormat', () => {
  it('starts searches from book discovery with the ebook format', () => {
    strictEqual(getDefaultSearchFormat('/discover/books'), 'ebook');
    strictEqual(getDefaultSearchFormat('/discover/movies'), undefined);
  });
});

describe('shouldNavigateToSearch', () => {
  it('does not navigate again when the URL already has the search query', () => {
    strictEqual(
      shouldNavigateToSearch('/search', 'alien', 'alien', true, false),
      false
    );
  });

  it('navigates when a new debounced query is ready', () => {
    strictEqual(
      shouldNavigateToSearch('/search', 'alien', 'aliens', true, false),
      true
    );
  });

  it('navigates when a new query is ready on custom search', () => {
    strictEqual(
      shouldNavigateToSearch('/custom-search', 'alien', 'aliens', true, false),
      true
    );
  });

  it('does not navigate for a closed or empty search', () => {
    strictEqual(shouldNavigateToSearch('/', '', 'alien', false, true), false);
    strictEqual(shouldNavigateToSearch('/', '', '', true, true), false);
  });

  it('navigates when search was opened on the current non-search route', () => {
    strictEqual(shouldNavigateToSearch('/', '', 'alien', true, true), true);
  });

  it('does not reopen search after navigating from a result to details', () => {
    strictEqual(
      shouldNavigateToSearch('/movie/[movieId]', '', 'alien', true, false),
      false
    );
  });
});

describe('shouldSyncSearchInput', () => {
  it('does not overwrite typing with the stale route query', () => {
    strictEqual(shouldSyncSearchInput('/', '', 'a', '', true), false);
    strictEqual(
      shouldSyncSearchInput('/search', 'alien', 'aliens', 'alien', true),
      false
    );
  });

  it('syncs a settled input after an external route change', () => {
    strictEqual(
      shouldSyncSearchInput('/search', 'aliens', 'alien', 'alien', false),
      true
    );
  });

  it('does not restore the route query while search is being closed', () => {
    strictEqual(shouldSyncSearchInput('/search', 'alien', '', '', true), false);
  });

  it('does not restore the custom route query while search is closing', () => {
    strictEqual(
      shouldSyncSearchInput('/custom-search', 'alien', '', '', true),
      false
    );
  });

  it('syncs a query when navigating to search externally', () => {
    strictEqual(shouldSyncSearchInput('/search', 'alien', '', '', false), true);
  });
});

describe('useSearchInput routing', () => {
  it('carries the book filter from book discovery into search', async () => {
    dom = new JSDOM('<div id="root"></div>', {
      url: 'http://localhost/discover/books',
    });
    dom.window.scrollTo = () => undefined;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: dom.window,
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: dom.window.document,
    });
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    const pushes: unknown[] = [];
    const router = createRouter({
      asPath: '/discover/books',
      pathname: '/discover/books',
      query: {},
      route: '/discover/books',
      push: async (...args) => {
        pushes.push(args);
        return true;
      },
    });
    let search: ReturnType<typeof useSearchInput> | undefined;
    const Probe = () => {
      search = useSearchInput();
      return null;
    };

    root = createRoot(dom.window.document.getElementById('root')!);
    await act(async () =>
      root?.render(
        createElement(RouterProvider, { router }, createElement(Probe))
      )
    );
    await act(async () => {
      search?.setIsOpen(true);
      search?.setSearchValue('linux');
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    strictEqual(pushes.length, 1);
    deepStrictEqual(pushes[0], [
      {
        pathname: '/search',
        query: { query: 'linux', type: 'book', format: 'ebook' },
      },
    ]);
  });

  it('leaves a clicked search result on top and preserves search in history', async () => {
    dom = new JSDOM('<div id="root"></div>', {
      url: 'http://localhost/search?query=alien',
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: dom.window,
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: dom.window.document,
    });
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    const pushes: unknown[] = [];
    let routeChangeStart: (() => void) | undefined;
    const router = createRouter({
      events: {
        emit: () => undefined,
        off: (event, handler) => {
          if (event === 'routeChangeStart' && routeChangeStart === handler) {
            routeChangeStart = undefined;
          }
        },
        on: (event, handler) => {
          if (event === 'routeChangeStart') {
            routeChangeStart = handler;
          }
        },
      },
      push: async (...args) => {
        pushes.push(args);
        return true;
      },
    });
    let search: ReturnType<typeof useSearchInput> | undefined;
    const Probe = () => {
      search = useSearchInput();
      return null;
    };
    const render = () =>
      root?.render(
        createElement(RouterProvider, { router }, createElement(Probe))
      );

    root = createRoot(dom.window.document.getElementById('root')!);
    await act(async () => render());

    routeChangeStart?.();
    router.pathname = '/movie/[movieId]';
    router.route = '/movie/[movieId]';
    router.asPath = '/movie/348';
    router.query = { movieId: '348' };
    await act(async () => render());

    strictEqual(pushes.length, 0);

    routeChangeStart?.();
    router.pathname = '/search';
    router.route = '/search';
    router.asPath =
      '/search?query=alien&type=book&format=ebook&sort=date&order=desc';
    router.query = {
      query: 'alien',
      type: 'book',
      format: 'ebook',
      sort: 'date',
      order: 'desc',
    };
    await act(async () => render());

    strictEqual(pushes.length, 0);
    strictEqual(search?.searchValue, 'alien');
    strictEqual(search?.searchOpen, true);
  });

  it('preserves newer typing through a stale route update and navigates once', async () => {
    dom = new JSDOM('<div id="root"></div>', {
      url: 'http://localhost/search',
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: dom.window,
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: dom.window.document,
    });
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    const replacements: unknown[] = [];
    const router = createRouter({
      replace: async (...args) => {
        replacements.push(args);
        return true;
      },
    });
    let search: ReturnType<typeof useSearchInput> | undefined;
    const Probe = () => {
      search = useSearchInput();
      return null;
    };
    const render = () =>
      root?.render(
        createElement(RouterProvider, { router }, createElement(Probe))
      );

    root = createRoot(dom.window.document.getElementById('root')!);
    await act(async () => render());
    await act(async () => search?.setSearchValue('aliens'));

    // A completed navigation can still report the previous query while the
    // user's newer value is waiting for the debounce timer.
    await act(async () => render());
    strictEqual(search?.searchValue, 'aliens');

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    strictEqual(replacements.length, 1);

    router.query = { query: 'aliens' };
    router.asPath = '/search?query=aliens';
    await act(async () => render());
    strictEqual(search?.searchValue, 'aliens');
    strictEqual(replacements.length, 1);
  });
});
