export type SortField = 'relevance' | 'title' | 'author' | 'date' | 'publisher';
export type SortOrder = 'asc' | 'desc';

const defaultSortOrders: Record<SortField, SortOrder> = {
  date: 'desc',
  title: 'asc',
  publisher: 'asc',
  author: 'asc',
  relevance: 'desc',
};

export const getSortField = (
  value: string | string[] | undefined
): SortField =>
  value === 'relevance' ||
  value === 'title' ||
  value === 'author' ||
  value === 'date' ||
  value === 'publisher'
    ? value
    : 'date';

export const getDefaultSortOrder = (field: SortField): SortOrder =>
  defaultSortOrders[field];

export const getSortOrder = (
  value: string | string[] | undefined,
  field: SortField
): SortOrder =>
  value === 'asc' || value === 'desc' ? value : getDefaultSortOrder(field);
