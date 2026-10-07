export type BookHomeSectionOption = {
  key: string;
  label: string;
  format: 'ebook' | 'audiobook';
  sortBy?: string;
  subject?: string;
};

export const BOOK_HOME_SECTION_OPTIONS = [
  {
    key: 'popular:ebook',
    label: 'Popular books',
    format: 'ebook',
    sortBy: 'ranked',
  },
  { key: 'new:ebook', label: 'New books', format: 'ebook', sortBy: 'newest' },
  {
    key: 'popular:audiobook',
    label: 'Popular audiobooks',
    format: 'audiobook',
    sortBy: 'ranked',
  },
  {
    key: 'new:audiobook',
    label: 'New audiobooks',
    format: 'audiobook',
    sortBy: 'newest',
  },
  {
    key: 'subject:fantasy:ebook',
    label: 'Fantasy books',
    format: 'ebook',
    subject: 'fantasy',
  },
  {
    key: 'subject:mystery:ebook',
    label: 'Mystery books',
    format: 'ebook',
    subject: 'mystery',
  },
  {
    key: 'subject:romance:ebook',
    label: 'Romance books',
    format: 'ebook',
    subject: 'romance',
  },
  {
    key: 'subject:science_fiction:ebook',
    label: 'Science fiction books',
    format: 'ebook',
    subject: 'science_fiction',
  },
  {
    key: 'subject:history:ebook',
    label: 'History books',
    format: 'ebook',
    subject: 'history',
  },
  {
    key: 'subject:biography:ebook',
    label: 'Biography books',
    format: 'ebook',
    subject: 'biography',
  },
  {
    key: 'subject:fantasy:audiobook',
    label: 'Fantasy audiobooks',
    format: 'audiobook',
    subject: 'fantasy',
  },
  {
    key: 'subject:mystery:audiobook',
    label: 'Mystery audiobooks',
    format: 'audiobook',
    subject: 'mystery',
  },
  {
    key: 'subject:romance:audiobook',
    label: 'Romance audiobooks',
    format: 'audiobook',
    subject: 'romance',
  },
  {
    key: 'subject:science_fiction:audiobook',
    label: 'Science fiction audiobooks',
    format: 'audiobook',
    subject: 'science_fiction',
  },
  {
    key: 'subject:history:audiobook',
    label: 'History audiobooks',
    format: 'audiobook',
    subject: 'history',
  },
  {
    key: 'subject:biography:audiobook',
    label: 'Biography audiobooks',
    format: 'audiobook',
    subject: 'biography',
  },
] as const satisfies readonly BookHomeSectionOption[];

export type BookHomeSectionKey =
  (typeof BOOK_HOME_SECTION_OPTIONS)[number]['key'];
export type BookHomeSectionPreference = {
  key: BookHomeSectionKey;
  enabled: boolean;
};

export const DEFAULT_BOOK_HOME_SECTIONS: BookHomeSectionPreference[] = [
  { key: 'popular:ebook', enabled: true },
  { key: 'popular:audiobook', enabled: true },
];

export const getBookHomeSection = (
  key: string
): BookHomeSectionOption | undefined =>
  BOOK_HOME_SECTION_OPTIONS.find((option) => option.key === key);
