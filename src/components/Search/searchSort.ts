export type SortField =
  | 'title'
  | 'author'
  | 'artist'
  | 'date'
  | 'publisher'
  | 'rating'
  | 'writer'
  | 'director';
export type SortOrder = 'asc' | 'desc';

const defaultSortOrders: Record<SortField, SortOrder> = {
  date: 'desc',
  title: 'asc',
  publisher: 'asc',
  author: 'asc',
  artist: 'asc',
  rating: 'desc',
  writer: 'asc',
  director: 'asc',
};

export const getSortField = (
  value: string | string[] | undefined
): SortField =>
  value === 'title' ||
  value === 'author' ||
  value === 'artist' ||
  value === 'date' ||
  value === 'publisher' ||
  value === 'rating' ||
  value === 'writer' ||
  value === 'director'
    ? value
    : 'date';

export const getDefaultSortOrder = (field: SortField): SortOrder =>
  defaultSortOrders[field];

export const getSortOrder = (
  value: string | string[] | undefined,
  field: SortField
): SortOrder =>
  value === 'asc' || value === 'desc' ? value : getDefaultSortOrder(field);
