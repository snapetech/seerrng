import useSearchActivity from '@app/hooks/useSearchActivity';
import useSearchInput from '@app/hooks/useSearchInput';
import defineMessages from '@app/utils/defineMessages';
import { ArrowPathIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { MagnifyingGlassIcon } from '@heroicons/react/24/solid';
import type { KeyboardEvent } from 'react';
import { useCallback } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Layout.SearchInput', {
  searchPlaceholder: 'Search movies, series, music, books, and people',
  searching: 'Searching',
});

const SearchInput = () => {
  const intl = useIntl();
  const { searchValue, setSearchValue, setIsOpen, clear } = useSearchInput();
  const isSearching = useSearchActivity();
  const hasSearchValue = searchValue.length > 0;
  const handleBlur = useCallback(() => {
    if (searchValue === '') {
      setIsOpen(false);
    }
  }, [searchValue, setIsOpen]);
  const handleKeyUp = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    }
  }, []);

  return (
    <div className="flex flex-1 items-center gap-3">
      <div className="flex w-1/2 min-w-0">
        <label htmlFor="search_field" className="sr-only">
          Search
        </label>
        <div className="relative flex w-full items-center text-white focus-within:text-gray-200">
          <div className="pointer-events-none absolute inset-y-0 left-4 flex items-center">
            <MagnifyingGlassIcon className="h-5 w-5" />
          </div>
          <input
            id="search_field"
            className={`block w-full rounded-full border border-gray-600 bg-gray-900/80 py-2 pl-10 text-white placeholder-gray-300 hover:border-gray-500 focus:border-gray-500 focus:bg-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-0 sm:text-base ${
              hasSearchValue ? 'pr-7' : ''
            }`}
            placeholder={intl.formatMessage(messages.searchPlaceholder)}
            type="search"
            autoComplete="off"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onFocus={() => setIsOpen(true)}
            onBlur={handleBlur}
            onKeyUp={handleKeyUp}
          />
          {hasSearchValue && (
            <button
              className="absolute inset-y-0 right-2 m-auto h-7 w-7 border-none p-1 text-gray-400 outline-none transition hover:text-white focus:border-none focus:outline-none"
              onClick={() => clear()}
            >
              <XCircleIcon className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
      {isSearching && (
        <div
          className="flex shrink-0 items-center gap-2 text-sm text-gray-200"
          role="status"
          aria-live="polite"
        >
          <ArrowPathIcon className="h-5 w-5 animate-spin" />
          <span>{intl.formatMessage(messages.searching)}</span>
        </div>
      )}
    </div>
  );
};

export default SearchInput;
