import { useRouter } from 'next/router';
import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UrlObject } from 'url';
import useDebouncedState from './useDebouncedState';
import {
  getDefaultSearchFormat,
  getDefaultSearchType,
  getSearchQuery,
  shouldNavigateToSearch,
  shouldSyncSearchInput,
} from './useSearchInput.utils';

type Url = string | UrlObject;

interface SearchObject {
  searchValue: string;
  searchOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  setSearchValue: Dispatch<SetStateAction<string>>;
  clear: () => void;
}

const useSearchInput = (): SearchObject => {
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const [lastRoute, setLastRoute] = useState<Url | null>(null);
  const pendingSearchQuery = useRef<string | null>(null);
  const searchOpenedOnCurrentRoute = useRef(false);
  const closingSearch = useRef(false);
  const [searchValue, debouncedValue, setSearchValue] = useDebouncedState(
    getSearchQuery(router.query.query)
  );
  const routeQuery = getSearchQuery(router.query.query);
  const isSearchPage = router.pathname === '/search';

  const setIsOpen = useCallback((isOpen: boolean) => {
    searchOpenedOnCurrentRoute.current = isOpen;
    setSearchOpen(isOpen);
  }, []);

  useEffect(() => {
    const handleRouteChangeStart = () => {
      searchOpenedOnCurrentRoute.current = false;
    };

    router.events.on('routeChangeStart', handleRouteChangeStart);

    return () => {
      router.events.off('routeChangeStart', handleRouteChangeStart);
    };
  }, [router.events]);

  /**
   * This effect handles routing when the debounced search input
   * value changes.
   *
   * If we are not already on the /search route, then we push
   * in a new route. If we are, then we only replace the history.
   */
  useEffect(() => {
    if (
      shouldNavigateToSearch(
        router.pathname,
        routeQuery,
        debouncedValue,
        searchOpen,
        searchOpenedOnCurrentRoute.current
      ) &&
      pendingSearchQuery.current !== debouncedValue
    ) {
      pendingSearchQuery.current = debouncedValue;

      if (isSearchPage) {
        void router.replace(
          {
            pathname: router.pathname,
            query: {
              ...router.query,
              query: debouncedValue,
            },
          },
          undefined,
          { shallow: true }
        );
      } else {
        setLastRoute(router.asPath);
        const defaultSearchType = getDefaultSearchType(router.pathname);
        const defaultSearchFormat = getDefaultSearchFormat(router.pathname);
        void router
          .push({
            pathname: '/search',
            query: {
              query: debouncedValue,
              ...(defaultSearchType ? { type: defaultSearchType } : {}),
              ...(defaultSearchFormat ? { format: defaultSearchFormat } : {}),
            },
          })
          .then(() => window.scrollTo(0, 0));
      }
    }
  }, [
    debouncedValue,
    isSearchPage,
    routeQuery,
    router,
    router.pathname,
    searchOpen,
  ]);

  /**
   * This effect is handling behavior when the search input is closed.
   *
   * If we have a lastRoute, we will route back to it. If we don't
   * (in the case of a deeplink) we take the user back to the index route
   */
  useEffect(() => {
    if (
      searchValue === '' &&
      isSearchPage &&
      !searchOpen &&
      closingSearch.current
    ) {
      pendingSearchQuery.current = null;

      if (lastRoute) {
        router.push(lastRoute).then(() => window.scrollTo(0, 0));
      } else {
        router.replace('/').then(() => window.scrollTo(0, 0));
      }
    }
  }, [isSearchPage, lastRoute, router, searchOpen, searchValue]);

  /**
   * This effect handles behavior for when the route is changed.
   *
   * If after a route change, the new debounced value is not the same
   * as the query value then we will update the searchValue to either the
   * new query or to an empty string (in the case of null). This makes sure
   * that the value in the searchbox is whatever the user last entered regardless
   * of routing to something like a detail page.
   *
   * If the new route is not /search and query is null, then we will close the
   * search if it is open.
   *
   * In the final case, we want the search to always be open in the case the user
   * is on /search
   */
  useEffect(() => {
    const restoringSearchRoute =
      isSearchPage &&
      !searchOpen &&
      !closingSearch.current &&
      routeQuery !== '';

    if (!isSearchPage) {
      closingSearch.current = false;
    }

    if (pendingSearchQuery.current !== null) {
      if (routeQuery === pendingSearchQuery.current) {
        pendingSearchQuery.current = null;
      }
    } else if (
      restoringSearchRoute ||
      shouldSyncSearchInput(
        router.pathname,
        routeQuery,
        searchValue,
        debouncedValue,
        closingSearch.current
      )
    ) {
      setSearchValue(routeQuery);

      if (!isSearchPage && !routeQuery) {
        searchOpenedOnCurrentRoute.current = false;
        setSearchOpen(false);
      }
    }

    if (isSearchPage && !closingSearch.current) {
      setSearchOpen(true);
    }
  }, [
    debouncedValue,
    isSearchPage,
    routeQuery,
    router.pathname,
    searchOpen,
    searchValue,
    setSearchValue,
  ]);

  const clear = useCallback(() => {
    closingSearch.current = true;
    pendingSearchQuery.current = null;
    searchOpenedOnCurrentRoute.current = false;
    setSearchOpen(false);
    setSearchValue('');
  }, [setSearchValue]);

  return useMemo(
    () => ({
      searchValue,
      searchOpen,
      setIsOpen,
      setSearchValue,
      clear,
    }),
    [clear, searchOpen, searchValue, setIsOpen, setSearchValue]
  );
};

export default useSearchInput;
