import { JSDOM } from 'jsdom';
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime';
import type { NextRouter } from 'next/router';
import { strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import useSearchInput from './useSearchInput';
import {
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

describe('shouldNavigateToSearch', () => {
  it('does not navigate again when the URL already has the search query', () => {
    strictEqual(
      shouldNavigateToSearch('/search', 'alien', 'alien', true),
      false
    );
  });

  it('navigates when a new debounced query is ready', () => {
    strictEqual(
      shouldNavigateToSearch('/search', 'alien', 'aliens', true),
      true
    );
  });

  it('does not navigate for a closed or empty search', () => {
    strictEqual(shouldNavigateToSearch('/', '', 'alien', false), false);
    strictEqual(shouldNavigateToSearch('/', '', '', true), false);
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

  it('syncs a query when navigating to search externally', () => {
    strictEqual(shouldSyncSearchInput('/search', 'alien', '', '', false), true);
  });
});

describe('useSearchInput routing', () => {
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
