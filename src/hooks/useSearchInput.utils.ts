export const getSearchQuery = (query: string | string[] | undefined): string =>
  typeof query === 'string' ? query : '';

export const getDefaultSearchType = (pathname: string): string | undefined =>
  pathname === '/discover/books' ? 'book' : undefined;

export const getDefaultSearchFormat = (
  pathname: string
): 'ebook' | undefined =>
  pathname === '/discover/books' ? 'ebook' : undefined;

export const shouldNavigateToSearch = (
  pathname: string,
  currentQuery: string,
  nextQuery: string,
  searchOpen: boolean,
  searchOpenedOnCurrentRoute: boolean
): boolean =>
  searchOpen &&
  nextQuery !== '' &&
  (pathname.startsWith('/search')
    ? currentQuery !== nextQuery
    : searchOpenedOnCurrentRoute);

export const shouldSyncSearchInput = (
  pathname: string,
  routeQuery: string,
  searchValue: string,
  debouncedValue: string,
  closingSearch: boolean
): boolean =>
  routeQuery !== searchValue &&
  searchValue === debouncedValue &&
  !(pathname.startsWith('/search') && closingSearch);
