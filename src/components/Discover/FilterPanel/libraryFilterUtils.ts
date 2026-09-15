export const bookSortOptions = new Set([
  'ranked',
  'ranked.asc',
  'newest',
  'oldest',
  'random',
  'rating',
  'rating.desc',
  'rating.asc',
  'editions',
  'editions.asc',
]);

export const musicSortOptions = new Set([
  'ranked',
  'ranked.asc',
  'popular.week',
  'popular.week.asc',
  'popular.month',
  'popular.month.asc',
  'popular.year',
  'popular.year.asc',
  'listen_count.desc',
  'listen_count.asc',
  'release_date.desc',
  'release_date.asc',
]);

export const BOOK_GENRES = [
  ['adventure', 'Adventure'],
  ['art', 'Art'],
  ['biography', 'Biography'],
  ['business', 'Business'],
  ['childrens_literature', "Children's Literature"],
  ['classics', 'Classics'],
  ['comics', 'Comics'],
  ['computers', 'Computers'],
  ['cooking', 'Cooking'],
  ['crime', 'Crime'],
  ['design', 'Design'],
  ['drama', 'Drama'],
  ['economics', 'Economics'],
  ['education', 'Education'],
  ['fantasy', 'Fantasy'],
  ['fiction', 'Fiction'],
  ['film', 'Film'],
  ['finance', 'Finance'],
  ['folklore', 'Folklore'],
  ['food', 'Food'],
  ['graphic_novels', 'Graphic Novels'],
  ['health', 'Health'],
  ['historical_fiction', 'Historical Fiction'],
  ['history', 'History'],
  ['horror', 'Horror'],
  ['humor', 'Humor'],
  ['law', 'Law'],
  ['literature', 'Literature'],
  ['mathematics', 'Mathematics'],
  ['memoir', 'Memoir'],
  ['music', 'Music'],
  ['mystery', 'Mystery'],
  ['nature', 'Nature'],
  ['philosophy', 'Philosophy'],
  ['plays', 'Plays'],
  ['poetry', 'Poetry'],
  ['politics', 'Politics'],
  ['psychology', 'Psychology'],
  ['religion', 'Religion'],
  ['romance', 'Romance'],
  ['science', 'Science'],
  ['science_fiction', 'Science Fiction'],
  ['self_help', 'Self Help'],
  ['short_stories', 'Short Stories'],
  ['social_sciences', 'Social Sciences'],
  ['sports', 'Sports'],
  ['technology', 'Technology'],
  ['thriller', 'Thriller'],
  ['travel', 'Travel'],
  ['true_crime', 'True Crime'],
  ['war', 'War'],
  ['western', 'Western'],
  ['young_adult', 'Young Adult'],
] as const;

export const BOOK_LANGUAGES = [
  ['eng', 'English'],
  ['spa', 'Spanish'],
  ['fre', 'French'],
  ['ger', 'German'],
  ['ita', 'Italian'],
  ['por', 'Portuguese'],
  ['dut', 'Dutch'],
  ['rus', 'Russian'],
  ['chi', 'Chinese'],
  ['jpn', 'Japanese'],
  ['kor', 'Korean'],
  ['ara', 'Arabic'],
  ['hin', 'Hindi'],
  ['pol', 'Polish'],
  ['swe', 'Swedish'],
  ['nor', 'Norwegian'],
  ['dan', 'Danish'],
  ['fin', 'Finnish'],
  ['gre', 'Greek'],
  ['heb', 'Hebrew'],
  ['tur', 'Turkish'],
  ['cze', 'Czech'],
  ['hun', 'Hungarian'],
  ['rum', 'Romanian'],
  ['ukr', 'Ukrainian'],
] as const;

export const countLibraryFilters = ({
  type,
  query,
  subject,
  firstPublishYear,
  language,
  minRating,
  days,
  genre,
  releaseType,
  sortBy,
}: {
  type: 'book' | 'music';
  query?: string;
  subject?: string;
  firstPublishYear?: string;
  language?: string;
  minRating?: string;
  days?: string;
  genre?: string;
  releaseType?: string;
  sortBy?: string;
}): number => {
  let count = 0;

  if (query) {
    count += 1;
  }

  if (type === 'book' && subject) {
    count += 1;
  }

  if (type === 'book' && firstPublishYear) {
    count += 1;
  }

  if (type === 'book' && language) {
    count += 1;
  }

  if (type === 'book' && minRating) {
    count += 1;
  }

  if (
    type === 'book' &&
    sortBy &&
    bookSortOptions.has(sortBy) &&
    sortBy !== 'ranked'
  ) {
    count += 1;
  }

  if (type === 'music' && days && days !== '14') {
    count += 1;
  }

  if (
    type === 'music' &&
    sortBy &&
    musicSortOptions.has(sortBy) &&
    sortBy !== 'ranked'
  ) {
    count += 1;
  }

  if (type === 'music' && genre) {
    count += 1;
  }

  if (type === 'music' && releaseType) {
    count += 1;
  }

  return count;
};
