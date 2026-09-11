import defineMessages from '@app/utils/defineMessages';
import { BookOpenIcon, SpeakerWaveIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import type { ParsedUrlQuery } from 'querystring';
import { useIntl } from 'react-intl';

export type BookDiscoveryFormat = 'ebook' | 'audiobook';

interface BookFormatTabsProps {
  format: BookDiscoveryFormat;
  query: ParsedUrlQuery;
}

const messages = defineMessages('components.Discover.BookFormatTabs', {
  format: 'Book format',
  books: 'Books',
  audiobooks: 'Audiobooks',
});

const BookFormatTabs = ({ format, query }: BookFormatTabsProps) => {
  const intl = useIntl();
  const tabs: {
    format: BookDiscoveryFormat;
    label: (typeof messages)[keyof typeof messages];
    icon: typeof BookOpenIcon;
    pathname: string;
  }[] = [
    {
      format: 'ebook',
      label: messages.books,
      icon: BookOpenIcon,
      pathname: '/discover/books',
    },
    {
      format: 'audiobook',
      label: messages.audiobooks,
      icon: SpeakerWaveIcon,
      pathname: '/discover/audiobooks',
    },
  ];
  const preservedQuery = Object.fromEntries(
    Object.entries(query).filter(([key]) => key !== 'page' && key !== 'format')
  );

  return (
    <nav
      aria-label={intl.formatMessage(messages.format)}
      className="mt-4 flex flex-wrap gap-2"
      data-testid="book-format-tabs"
    >
      {tabs.map((tab) => {
        const isSelected = tab.format === format;
        const Icon = tab.icon;

        return (
          <Link
            key={tab.format}
            href={{ pathname: tab.pathname, query: preservedQuery }}
            aria-current={isSelected ? 'page' : undefined}
            data-testid={`book-format-tab-${tab.format}`}
            className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
              isSelected
                ? 'border-indigo-500 bg-indigo-600/80 text-white'
                : 'border-gray-600 bg-gray-800/80 text-gray-200 hover:border-gray-500 hover:bg-gray-700 hover:text-white'
            }`}
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
