export const MEDIA_CATEGORY_KEYS = [
  'movie',
  'tv',
  'music',
  'ebook',
  'audiobook',
  'comic',
  'magazine',
  'retro',
  'modern',
  'game',
] as const;

export type MediaCategoryKey = (typeof MEDIA_CATEGORY_KEYS)[number];
export type EnabledMediaCategories = Record<MediaCategoryKey, boolean>;

export const DEFAULT_ENABLED_MEDIA_CATEGORIES: EnabledMediaCategories = {
  movie: true,
  tv: true,
  music: true,
  ebook: true,
  audiobook: true,
  comic: true,
  magazine: true,
  retro: true,
  modern: true,
  game: true,
};
