import type { FilterOptions } from '@app/components/Discover/constants';
import type { MovieResult, TvResult } from '@server/models/Search';

type RelatedMediaResult = MovieResult | TvResult;

const resultTitle = (item: RelatedMediaResult) =>
  item.mediaType === 'movie' ? item.title : item.name;

const resultOriginalTitle = (item: RelatedMediaResult) =>
  item.mediaType === 'movie' ? item.originalTitle : item.originalName;

const resultDate = (item: RelatedMediaResult) =>
  item.mediaType === 'movie' ? item.releaseDate : item.firstAirDate;

const compareValues = (left: string | number, right: string | number) =>
  typeof left === 'number' && typeof right === 'number'
    ? left - right
    : String(left).localeCompare(String(right), undefined, {
        sensitivity: 'base',
      });

export const filterAndSortRelatedMedia = <T extends RelatedMediaResult>(
  items: T[],
  filters: FilterOptions
): T[] => {
  const search = filters.search?.trim().toLocaleLowerCase();
  const genre = filters.genre ? Number(filters.genre.split(',')[0]) : undefined;
  const languages = filters.language?.split('|').filter(Boolean);
  const dateGte =
    filters.primaryReleaseDateGte ?? filters.firstAirDateGte ?? undefined;
  const dateLte =
    filters.primaryReleaseDateLte ?? filters.firstAirDateLte ?? undefined;
  const voteGte = filters.voteAverageGte
    ? Number(filters.voteAverageGte)
    : undefined;
  const voteLte = filters.voteAverageLte
    ? Number(filters.voteAverageLte)
    : undefined;

  const filtered = items.filter((item) => {
    const date = resultDate(item);

    return (
      (!search ||
        resultTitle(item).toLocaleLowerCase().includes(search) ||
        resultOriginalTitle(item).toLocaleLowerCase().includes(search)) &&
      (!genre || item.genreIds.includes(genre)) &&
      (!languages?.length || languages.includes(item.originalLanguage)) &&
      (!dateGte || Boolean(date && date >= dateGte)) &&
      (!dateLte || Boolean(date && date <= dateLte)) &&
      (voteGte === undefined || item.voteAverage >= voteGte) &&
      (voteLte === undefined || item.voteAverage <= voteLte) &&
      (!filters.country ||
        item.mediaType !== 'tv' ||
        item.originCountry.includes(filters.country))
    );
  });

  const [sortField = 'popularity', direction = 'desc'] = (
    filters.sortBy ?? 'popularity.desc'
  ).split('.');
  const directionMultiplier = direction === 'asc' ? 1 : -1;

  return [...filtered].sort((left, right) => {
    let leftValue: string | number;
    let rightValue: string | number;

    switch (sortField) {
      case 'release_date':
      case 'primary_release_date':
      case 'first_air_date':
        leftValue = resultDate(left);
        rightValue = resultDate(right);
        break;
      case 'vote_average':
        leftValue = left.voteAverage;
        rightValue = right.voteAverage;
        break;
      case 'original_title':
        leftValue = resultOriginalTitle(left);
        rightValue = resultOriginalTitle(right);
        break;
      default:
        leftValue = left.popularity;
        rightValue = right.popularity;
    }

    return compareValues(leftValue, rightValue) * directionMultiplier;
  });
};
