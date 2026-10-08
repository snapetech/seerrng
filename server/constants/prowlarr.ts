import type { MediaCategoryKey } from '@server/constants/mediaCategories';

export type ProwlarrCategoryMappings = Record<MediaCategoryKey, number[]>;

export type ProwlarrSearchType =
  'search' | 'movie' | 'tvsearch' | 'music' | 'book';

/** Use Prowlarr's format-aware search paths where Newznab defines them. */
export const PROWLARR_SEARCH_TYPE_BY_CATEGORY: Record<
  MediaCategoryKey,
  ProwlarrSearchType
> = {
  movie: 'movie',
  tv: 'tvsearch',
  sports: 'tvsearch',
  music: 'music',
  ebook: 'book',
  audiobook: 'book',
  comic: 'search',
  magazine: 'search',
  retro: 'search',
  modern: 'search',
  game: 'search',
};

/** Standard Newznab/Torznab categories used as safe defaults for manual search. */
export const DEFAULT_PROWLARR_CATEGORY_MAPPINGS: ProwlarrCategoryMappings = {
  movie: [2000],
  tv: [5000],
  sports: [5060],
  music: [3000],
  ebook: [7020],
  audiobook: [3030],
  comic: [7030],
  magazine: [7010],
  retro: [1010, 1020, 1030, 1040, 1050, 1060, 1070, 1080, 1110, 1120, 1130],
  modern: [1090, 1140, 1180],
  game: [4000],
};

/** Standard Newznab/Torznab labels exposed by Prowlarr. */
export const DEFAULT_PROWLARR_CATEGORY_LABELS: Record<number, string> = {
  1000: 'Console',
  1010: 'Console/NDS',
  1020: 'Console/PSP',
  1030: 'Console/Wii',
  1040: 'Console/Xbox',
  1050: 'Console/Xbox 360',
  1060: 'Console/WiiWare',
  1070: 'Console/Xbox 360 DLC',
  1080: 'Console/PS3',
  1090: 'Console/Other',
  1110: 'Console/3DS',
  1120: 'Console/PS Vita',
  1130: 'Console/Wii U',
  1140: 'Console/Xbox One',
  1180: 'Console/PS4',
  2000: 'Movies',
  2010: 'Movies/Foreign',
  2020: 'Movies/Other',
  2030: 'Movies/SD',
  2040: 'Movies/HD',
  2045: 'Movies/UHD',
  2050: 'Movies/BluRay',
  2060: 'Movies/3D',
  2070: 'Movies/DVD',
  2080: 'Movies/WEB-DL',
  2090: 'Movies/x265',
  3000: 'Audio',
  3010: 'Audio/MP3',
  3020: 'Audio/Video',
  3030: 'Audio/Audiobook',
  3040: 'Audio/Lossless',
  3050: 'Audio/Other',
  3060: 'Audio/Foreign',
  4000: 'PC',
  4010: 'PC/0day',
  4020: 'PC/ISO',
  4030: 'PC/Mac',
  4040: 'PC/Mobile-Other',
  4050: 'PC/Games',
  4060: 'PC/Mobile-iOS',
  4070: 'PC/Mobile-Android',
  5000: 'TV',
  5010: 'TV/WEB-DL',
  5020: 'TV/Foreign',
  5030: 'TV/SD',
  5040: 'TV/HD',
  5045: 'TV/UHD',
  5050: 'TV/Other',
  5060: 'TV/Sport',
  5070: 'TV/Anime',
  5080: 'TV/Documentary',
  5090: 'TV/x265',
  7000: 'Books',
  7010: 'Books/Magazines',
  7020: 'Books/Ebooks',
  7030: 'Books/Comics',
  7040: 'Books/Technical',
  7050: 'Books/Other',
  7060: 'Books/Foreign',
};

export const defaultProwlarrCategoryMappings = (): ProwlarrCategoryMappings =>
  Object.fromEntries(
    Object.entries(DEFAULT_PROWLARR_CATEGORY_MAPPINGS).map(
      ([category, ids]) => [category, [...ids]]
    )
  ) as ProwlarrCategoryMappings;
