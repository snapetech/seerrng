import { getFilterToggleButtonClass } from '@app/components/Discover/FilterPanel/CompactFilterSelect';
import defineMessages from '@app/utils/defineMessages';
import { parseQueryFromPath } from '@app/utils/routeQuery';
import {
  BookOpenIcon,
  SpeakerWaveIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import type { ParsedUrlQuery } from 'querystring';
import { useIntl } from 'react-intl';

export type BookDiscoveryFormat = 'all' | 'ebook' | 'audiobook';

interface BookFormatTabsProps {
  format: BookDiscoveryFormat;
  query: ParsedUrlQuery;
  currentPath?: string;
  className?: string;
  availableFormats?: readonly BookDiscoveryFormat[];
}

const getBookFormatHref = (
  pathname: string,
  query: ParsedUrlQuery,
  queryFormat?: 'ebook'
): string => {
  const queryParams = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (key === 'page' || key === 'format') {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item) {
          queryParams.append(key, item);
        }
      });
    } else if (value) {
      queryParams.append(key, value);
    }
  });

  if (queryFormat) {
    queryParams.set('format', queryFormat);
  }

  const queryString = queryParams.toString().replace(/\+/g, '%20');

  return `${pathname}${queryString ? `?${queryString}` : ''}`;
};

const messages = defineMessages('components.Discover.BookFormatTabs', {
  format: 'Book format',
  allBooks: 'All Books',
  books: 'Books',
  audiobooks: 'Audiobooks',
});

const BookFormatTabs = ({
  format,
  query,
  currentPath,
  className = '',
  availableFormats = ['all', 'ebook', 'audiobook'],
}: BookFormatTabsProps) => {
  const intl = useIntl();
  const tabs: {
    format: BookDiscoveryFormat;
    label: (typeof messages)[keyof typeof messages];
    icon: typeof BookOpenIcon;
    pathname: string;
    queryFormat?: 'ebook';
  }[] = [
    {
      format: 'all',
      label: messages.allBooks,
      icon: Squares2X2Icon,
      pathname: '/discover/books',
    },
    {
      format: 'ebook',
      label: messages.books,
      icon: BookOpenIcon,
      pathname: '/discover/books',
      queryFormat: 'ebook',
    },
    {
      format: 'audiobook',
      label: messages.audiobooks,
      icon: SpeakerWaveIcon,
      pathname: '/discover/audiobooks',
    },
  ];
  // During hydration Next.js can expose an incomplete router.query object.
  // The browser path is already the user's source of truth, so use it when it
  // contains a query string and fall back to the parsed router query otherwise.
  const pathQuery = currentPath ? parseQueryFromPath(currentPath) : {};
  const preservedQuery = Object.keys(pathQuery).length > 0 ? pathQuery : query;

  return (
    <nav
      aria-label={intl.formatMessage(messages.format)}
      className={`flex flex-wrap gap-2 ${className}`}
      data-testid="book-format-tabs"
    >
      {tabs
        .filter((tab) => availableFormats.includes(tab.format))
        .map((tab) => {
          const isSelected = tab.format === format;
          const Icon = tab.icon;

          return (
            <Link
              key={tab.format}
              href={getBookFormatHref(
                tab.pathname,
                preservedQuery,
                tab.queryFormat
              )}
              aria-current={isSelected ? 'page' : undefined}
              data-testid={`book-format-tab-${tab.format}`}
              className={getFilterToggleButtonClass(isSelected)}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span>{intl.formatMessage(tab.label)}</span>
            </Link>
          );
        })}
    </nav>
  );
};

export default BookFormatTabs;
