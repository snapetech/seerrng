import type { MovieResult, TvResult } from '@server/models/Search';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filterAndSortRelatedMedia } from './relatedMediaFilters';

const movies: MovieResult[] = [
  {
    id: 1,
    mediaType: 'movie',
    title: 'Later Drama',
    originalTitle: 'Later Drama',
    releaseDate: '2024-02-01',
    adult: false,
    video: false,
    popularity: 20,
    voteCount: 200,
    voteAverage: 8,
    genreIds: [18],
    overview: '',
    originalLanguage: 'en',
  },
  {
    id: 2,
    mediaType: 'movie',
    title: 'Earlier Comedy',
    originalTitle: 'Earlier Comedy',
    releaseDate: '2020-01-01',
    adult: false,
    video: false,
    popularity: 10,
    voteCount: 100,
    voteAverage: 6,
    genreIds: [35],
    overview: '',
    originalLanguage: 'fr',
  },
];

const series: TvResult[] = [
  {
    id: 3,
    mediaType: 'tv',
    name: 'Canadian Series',
    originalName: 'Canadian Series',
    firstAirDate: '2023-01-01',
    originCountry: ['CA'],
    popularity: 15,
    voteCount: 150,
    voteAverage: 7,
    genreIds: [18],
    overview: '',
    originalLanguage: 'en',
  },
];

describe('filterAndSortRelatedMedia', () => {
  it('filters related titles by the shared discovery fields', () => {
    assert.deepEqual(
      filterAndSortRelatedMedia(movies, {
        genre: '18',
        language: 'en',
        primaryReleaseDateGte: '2024-01-01',
        voteAverageGte: '7',
      }).map((movie) => movie.id),
      [1]
    );
    assert.deepEqual(
      filterAndSortRelatedMedia(series, { country: 'CA' }).map(
        (show) => show.id
      ),
      [3]
    );
  });

  it('uses the shared discovery sort direction', () => {
    assert.deepEqual(
      filterAndSortRelatedMedia(movies, {
        sortBy: 'release_date.asc',
      }).map((movie) => movie.id),
      [2, 1]
    );
  });
});
