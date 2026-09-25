export interface GenreSliderItem {
  id: number;
  name: string;
  backdrops: string[];
}

export interface WatchlistItem {
  id: number;
  ratingKey: string;
  tmdbId?: number;
  mbId?: string;
  externalId?: string;
  mediaType: 'movie' | 'tv' | 'music' | 'book' | 'comic' | 'magazine';
  title: string;
}

export interface WatchlistResponse {
  page: number;
  totalPages: number;
  totalResults: number;
  results: WatchlistItem[];
}
