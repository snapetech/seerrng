import BookFormatBadge, {
  getBookFormatMessage,
  getRequestedBookFormat,
  type RequestedBookFormat,
} from '@app/components/Common/BookFormatBadge';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import MediaTypeBadge, {
  type MediaTypeBadgeType,
} from '@app/components/Common/MediaTypeBadge';
import Modal from '@app/components/Common/Modal';
import PageTitle from '@app/components/Common/PageTitle';
import PaginationFooter from '@app/components/Common/PaginationFooter';
import Tooltip from '@app/components/Common/Tooltip';
import {
  CompactSelect,
  getFilterResetButtonClass,
  getFilterToggleButtonClass,
  type CompactSelectOption,
} from '@app/components/Discover/FilterPanel/CompactFilterSelect';
import useDebouncedState from '@app/hooks/useDebouncedState';
import useRequestStatusScrollRestoration from '@app/hooks/useRequestStatusScrollRestoration';
import { useSearchActivityReporter } from '@app/hooks/useSearchActivity';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import {
  encodeApiPathSegment,
  normalizeMusicBrainzId,
  normalizeOpenLibraryWorkId,
} from '@app/utils/apiPath';
import { sortCrewPriority } from '@app/utils/creditHelpers';
import defineMessages from '@app/utils/defineMessages';
import { getTmdbPosterImageUrl } from '@app/utils/imageCache';
import { Transition } from '@headlessui/react';
import {
  ArchiveBoxXMarkIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  MagnifyingGlassIcon,
  NoSymbolIcon,
  PencilIcon,
  ServerIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { BarsArrowDownIcon, BarsArrowUpIcon } from '@heroicons/react/24/solid';
import { MediaRequestStatus } from '@server/constants/media';
import type {
  RequestStatusDetailResponse,
  RequestStatusResultsResponse,
  RequestStatusUsersResponse,
} from '@server/interfaces/api/requestInterfaces';
import type { RequestStatusSortField } from '@server/lib/requestStatusSort';
import type { BookDetails } from '@server/models/Book';
import type { ComicDetails } from '@server/models/Comic';
import type { MagazineDetails } from '@server/models/Magazine';
import type { MovieDetails } from '@server/models/Movie';
import type { MusicDetails } from '@server/models/Music';
import type { TvDetails } from '@server/models/Tv';
import axios from 'axios';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FormattedDate, useIntl } from 'react-intl';
import useSWR, { useSWRConfig } from 'swr';
import {
  canLoadRequestStatus,
  resolveRequestStatusUserSelection,
  type RequestStatusUserSelection,
} from './requestStatusQuery';

const RequestModal = dynamic(() => import('@app/components/RequestModal'), {
  ssr: false,
});

const messages = defineMessages('components.RequestStatus', {
  title: 'Request Status',
  manageRequests: 'Manage Requests',
  selectUser: 'Select User to View Requests',
  search: 'Keyword Search',
  searchRequests: 'Search Requests',
  userFilter: 'Select User',
  allUsers: 'All Users',
  taskFilters: 'Task Filters',
  all: 'All Requests',
  active: 'Active',
  attention: 'Needs Attention',
  completed: 'Completed',
  incomplete: 'Incomplete',
  pending: 'Pending',
  processing: 'Active',
  deleted: 'Deleted',
  requested: 'Requested',
  approved: 'Approved',
  searching: 'Searching',
  downloading: 'Downloading',
  importing: 'Importing',
  library: 'Adding to library',
  available: 'Available',
  unavailable: 'Unavailable',
  noReleaseFoundFilter: 'No Release Found',
  failed: 'Failed',
  declined: 'Declined',
  cancelled: 'Cancelled',
  mediaType: 'Media Type',
  mediaTypeValue: 'Media Type',
  movie: 'Movie',
  series: 'Series',
  album: 'Album',
  comic: 'Comic',
  magazine: 'Magazine',
  bookAndAudiobook: 'Book + Audiobook',
  book: 'Book',
  fourK: '4K',
  hd: 'HD',
  musicFormat: 'Music',
  ebookAndAudiobook: 'Book + Audiobook',
  ebook: 'Book',
  minutes: '{count} minutes',
  notAvailable: 'Not available',
  releaseDate: 'Release Date',
  latestIssue: 'Latest Issue',
  firstPublished: 'First Published',
  runtime: 'Runtime',
  pages: 'Pages',
  issues: 'Issues',
  genres: 'Genres',
  author: 'Author',
  artist: 'Artist',
  albumType: 'Album Type',
  trackCount: 'Track Count',
  director: 'Director',
  writer: 'Writer',
  creator: 'Creator',
  publisher: 'Publisher',
  network: 'Network',
  studio: 'Studio',
  requestDate: 'Date',
  requestTime: 'Time',
  statusUpdated: 'Status Updated',
  timeFrame: 'Time Period',
  last7Days: 'Last 7 days',
  last14Days: 'Last 14 days',
  last30Days: 'Last 30 days',
  last6Months: 'Last 6 months',
  allTime: 'All time',
  olderRequests:
    '{count, plural, =1 {# older request is outside this window.} other {# older requests are outside this window.}}',
  viewAllHistory: 'View All History',
  filter: 'Filters',
  mediaFilters: 'Media Filters',
  allMedia: 'All Media',
  movies: 'Movies',
  music: 'Music',
  ebooks: 'Books',
  audiobooks: 'Audiobooks',
  comics: 'Comics',
  magazines: 'Magazines',
  mediaAndFormat: 'Media & format',
  showingFormat: 'Showing requests for',
  format: 'Format',
  sortBy: 'Sort By',
  sortAdded: 'Date',
  sortModified: 'Last Modified',
  sortTitle: 'Title',
  sortStatus: 'Status',
  sortDirector: 'Director',
  sortWriter: 'Writer',
  sortRating: 'Rating',
  sortReleaseDate: 'Release Date',
  sortFirstPublished: 'First Published',
  sortArtist: 'Artist',
  sortAuthor: 'Author',
  sortPublisher: 'Publisher',
  sortAscending: 'Ascending',
  sortDescending: 'Descending',
  progressUnavailable: 'Download service did not provide progress data.',
  progressFrom: '{percent}% complete',
  sizeProgress: '{complete} of {total}',
  eta: 'ETA: {date}',
  history: 'History',
  hideHistory: 'Hide History',
  noHistory: 'No status history has been recorded yet',
  requestedBy: 'Requested by {user}',
  requestedByLabel: 'Requested By',
  requestedAt: 'Requested {date}',
  requestedDateTime: 'Requested On',
  service: 'Service: {service}',
  serviceLabel: 'Service',
  retry: 'Retry',
  retrying: 'Retrying…',
  retryTooltip: 'Restart this failed request from approval.',
  approve: 'Approve',
  approveTooltip: 'Approve this pending request.',
  decline: 'Decline',
  declineTooltip: 'Decline this pending request.',
  edit: 'Edit',
  editTooltip: 'Edit this pending request.',
  modifyFailed: 'Unable to update this request.',
  retryFailed: 'Unable to retry this request.',
  retrySuccess: 'Request queued for another attempt.',
  delete: 'Delete',
  deleting: 'Deleting…',
  deleteTooltip: 'Delete this request and its status history.',
  deleteTitle: 'Delete request status entry?',
  deleteDescription:
    'Seerr will cancel any active work it can identify, clean up temporary request records, and permanently remove this entry and its history.',
  deleteFailed: 'Unable to delete this request entry.',
  deleteSuccess: 'Request entry deleted.',
  remove: 'Delete From Library',
  removing: 'Deleting…',
  removeTooltip: 'The media and the library entry will both be deleted.',
  removeUnavailableTooltip: 'No linked library item is available to delete.',
  removeTitle: 'Delete item from {service}?',
  removeDescription:
    'Delete {title} and its media files from {service}. Seerr will preserve an author or artist that still has other books or albums.',
  removeFailed: 'Unable to delete this item from its library service.',
  removeSuccess: 'Item deleted from its library service.',
  loading: 'Loading request status',
  refresh: 'Refresh',
  refreshing: 'Refreshing…',
  loadError: 'Request status could not be loaded.',
  loadErrorHint: 'The request service did not respond. Try again.',
  retryLoad: 'Try Again',
  noResults: 'No requests match these filters',
  clearFilters: 'Clear Filters',
  scrollProgressLeft: 'Scroll progress left',
  requestLifecycle: 'Request lifecycle',
  scrollProgressRight: 'Scroll progress right',
  unknownTitle: 'Unknown title',
});

type MediaDetails =
  | MovieDetails
  | TvDetails
  | MusicDetails
  | BookDetails
  | ComicDetails
  | MagazineDetails;
type StatusStage =
  | 'requested'
  | 'approved'
  | 'searching'
  | 'downloading'
  | 'importing'
  | 'library'
  | 'available'
  | 'unavailable'
  | 'failed'
  | 'declined'
  | 'cancelled';
type RequestStatusItem = RequestStatusResultsResponse['results'][number];
type MediaFilter =
  | 'all'
  | 'movie'
  | 'tv'
  | 'music'
  | 'book'
  | 'audiobook'
  | 'comic'
  | 'magazine';
type UserSelection = Exclude<RequestStatusUserSelection, null>;
type TimeFrame = '7d' | '14d' | '30d' | '6m' | 'all';
type RemoveSelection = {
  requestId: number;
  mediaId: number;
  title: string;
  service: string;
  is4k: boolean;
  format?: RequestedBookFormat;
};

const timelineStages: StatusStage[] = [
  'requested',
  'approved',
  'searching',
  'downloading',
  'importing',
  'library',
  'available',
];
const statusStageValues: string[] = [
  ...timelineStages,
  'unavailable',
  'failed',
  'declined',
  'cancelled',
];

const requestTypeFilterValues = [
  'all',
  'pending',
  'completed',
  'incomplete',
  'processing',
  'attention',
  ...statusStageValues,
];
const mediaTypeValues: MediaFilter[] = [
  'all',
  'movie',
  'tv',
  'music',
  'book',
  'audiobook',
  'comic',
  'magazine',
];

const sortDirectionValues = ['asc', 'desc'] as const;
const timeFrameValues: TimeFrame[] = ['all', '7d', '14d', '30d', '6m'];

const getSortOptions = (
  mediaFilter: MediaFilter
): { value: RequestStatusSortField; label: keyof typeof messages }[] => {
  const common: {
    value: RequestStatusSortField;
    label: keyof typeof messages;
  }[] = [
    { value: 'added', label: 'sortAdded' },
    { value: 'modified', label: 'sortModified' },
    { value: 'title', label: 'sortTitle' },
    { value: 'status', label: 'sortStatus' },
  ];

  switch (mediaFilter) {
    case 'movie':
      return [
        ...common,
        { value: 'director', label: 'sortDirector' },
        { value: 'rating', label: 'sortRating' },
        { value: 'releaseDate', label: 'sortReleaseDate' },
      ];
    case 'tv':
      return [
        ...common,
        { value: 'writer', label: 'sortWriter' },
        { value: 'director', label: 'sortDirector' },
        { value: 'rating', label: 'sortRating' },
        { value: 'releaseDate', label: 'sortReleaseDate' },
      ];
    case 'music':
      return [
        ...common,
        { value: 'artist', label: 'sortArtist' },
        { value: 'releaseDate', label: 'sortReleaseDate' },
      ];
    case 'book':
    case 'audiobook':
      return [
        ...common,
        { value: 'author', label: 'sortAuthor' },
        { value: 'publisher', label: 'sortPublisher' },
        { value: 'releaseDate', label: 'sortFirstPublished' },
      ];
    case 'comic':
      return [
        ...common,
        { value: 'publisher', label: 'sortPublisher' },
        { value: 'releaseDate', label: 'sortFirstPublished' },
      ];
    default:
      return common;
  }
};

const getDefaultSortDirection = (
  field: RequestStatusSortField
): 'asc' | 'desc' =>
  ['title', 'director', 'writer', 'artist', 'author', 'publisher'].includes(
    field
  )
    ? 'asc'
    : 'desc';

const getSafeQueryValue = (
  value: string | string[] | undefined,
  allowedValues: readonly string[]
): string => {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && allowedValues.includes(candidate) ? candidate : 'all';
};

const getTimeFrameFromQuery = (
  value: string | string[] | undefined
): TimeFrame => {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === '1m') {
    return '30d';
  }
  return candidate && timeFrameValues.includes(candidate as TimeFrame)
    ? (candidate as TimeFrame)
    : 'all';
};

const fetchStatusUsers = async (
  url: string
): Promise<RequestStatusUsersResponse> => {
  const firstResponse = await axios.get<RequestStatusUsersResponse>(url);
  const firstPage = firstResponse.data;
  const pageSize = firstPage.pageInfo.pageSize || 100;
  const remainingPages = Math.max(firstPage.pageInfo.pages - 1, 0);
  if (remainingPages === 0) {
    return firstPage;
  }

  const pages = await Promise.all(
    Array.from({ length: remainingPages }, (_, index) => {
      const pageUrl = new URL(url, 'http://seerrng.local');
      pageUrl.searchParams.set('skip', String((index + 1) * pageSize));
      return axios.get<RequestStatusUsersResponse>(
        `${pageUrl.pathname}${pageUrl.search}`
      );
    })
  );

  return {
    ...firstPage,
    results: [
      ...firstPage.results,
      ...pages.flatMap((response) => response.data.results),
    ],
  };
};

const stageMessageKeys: Record<StatusStage, keyof typeof messages> = {
  requested: 'requested',
  approved: 'approved',
  searching: 'searching',
  downloading: 'downloading',
  importing: 'importing',
  library: 'library',
  available: 'available',
  unavailable: 'unavailable',
  failed: 'failed',
  declined: 'declined',
  cancelled: 'cancelled',
};

const stageTone: Record<StatusStage, string> = {
  requested: 'border-gray-500 bg-gray-700/70 text-gray-100',
  approved: 'border-indigo-400 bg-indigo-500/20 text-indigo-100',
  searching: 'border-violet-400 bg-violet-500/20 text-violet-100',
  downloading: 'border-blue-400 bg-blue-500/20 text-blue-100',
  importing: 'border-cyan-400 bg-cyan-500/20 text-cyan-100',
  library: 'border-fuchsia-400 bg-fuchsia-500/20 text-fuchsia-100',
  available: 'border-emerald-400 bg-emerald-500/20 text-emerald-100',
  unavailable: 'border-amber-400 bg-amber-500/20 text-amber-100',
  failed: 'border-red-400 bg-red-500/20 text-red-100',
  declined: 'border-red-400 bg-red-500/20 text-red-100',
  cancelled: 'border-gray-500 bg-gray-700/70 text-gray-200',
};

const stageIcon: Record<StatusStage, typeof InformationCircleIcon> = {
  requested: ClockIcon,
  approved: CheckIcon,
  searching: MagnifyingGlassIcon,
  downloading: ArrowDownTrayIcon,
  importing: ArrowPathIcon,
  library: ServerIcon,
  available: CheckIcon,
  unavailable: InformationCircleIcon,
  failed: ExclamationTriangleIcon,
  declined: ExclamationTriangleIcon,
  cancelled: InformationCircleIcon,
};

const isMusic = (details: MediaDetails): details is MusicDetails =>
  (details as MusicDetails).artist !== undefined;

const isBook = (details: MediaDetails): details is BookDetails =>
  (details as BookDetails).mediaType === 'book';

const isComic = (details: MediaDetails): details is ComicDetails =>
  (details as ComicDetails).mediaType === 'comic';

const isMagazine = (details: MediaDetails): details is MagazineDetails =>
  (details as MagazineDetails).mediaType === 'magazine';

const getBookId = (item: RequestStatusItem): string | undefined =>
  item.request.media.identifiers?.find(
    (identifier) => identifier.provider === 'openlibrary'
  )?.value;

const getComicId = (item: RequestStatusItem): string | undefined =>
  item.request.media.identifiers?.find(
    (identifier) => identifier.provider === 'comicvine'
  )?.value;

const getMagazineId = (item: RequestStatusItem): string | undefined =>
  item.request.media.externalServiceSlug ??
  item.request.media.identifiers?.find(
    (identifier) => identifier.provider === 'lazylibrarian'
  )?.value;

const getDetailsUrl = (item: RequestStatusItem): string | null => {
  const request = item.request;
  if (request.type === 'movie' || request.type === 'tv') {
    return `/api/v1/${request.type}/${request.media.tmdbId}`;
  }
  if (request.type === 'music' && request.media.mbId) {
    return `/api/v1/music/${encodeApiPathSegment(normalizeMusicBrainzId(request.media.mbId))}`;
  }
  if (request.type === 'comic') {
    const comicId = getComicId(item);
    return comicId ? `/api/v1/comic/${encodeApiPathSegment(comicId)}` : null;
  }
  if (request.type === 'magazine') {
    const magazineId = getMagazineId(item);
    return magazineId
      ? `/api/v1/magazine/${encodeApiPathSegment(magazineId)}`
      : null;
  }
  const bookId = getBookId(item);
  return bookId
    ? `/api/v1/book/${encodeApiPathSegment(normalizeOpenLibraryWorkId(bookId))}`
    : null;
};

const getDetailHref = (item: RequestStatusItem): string | null => {
  const request = item.request;
  if (request.type === 'movie' || request.type === 'tv') {
    return `/${request.type}/${request.media.tmdbId}`;
  }
  if (request.type === 'music' && request.media.mbId) {
    return `/music/${encodeApiPathSegment(normalizeMusicBrainzId(request.media.mbId))}`;
  }
  if (request.type === 'comic') {
    const comicId = getComicId(item);
    return comicId ? `/comic/${encodeApiPathSegment(comicId)}` : null;
  }
  if (request.type === 'magazine') {
    const magazineId = getMagazineId(item);
    return magazineId ? `/magazine/${encodeApiPathSegment(magazineId)}` : null;
  }
  const bookId = getBookId(item);
  const bookFormat = getRequestedBookFormat(item.request.bookFormat);
  return bookId
    ? `/book/${encodeApiPathSegment(normalizeOpenLibraryWorkId(bookId))}?format=${bookFormat}`
    : null;
};

const getTitle = (
  intl: ReturnType<typeof useIntl>,
  details: MediaDetails | undefined,
  item: RequestStatusItem
): string => {
  if (details) {
    if (isMusic(details) || isBook(details)) {
      return details.title;
    }
    return 'title' in details ? details.title : details.name;
  }
  if (item.request.type === 'music' && item.request.media.mbId) {
    return item.request.media.mbId;
  }
  if (item.request.type === 'book') {
    return getBookId(item) ?? intl.formatMessage(messages.unknownTitle);
  }
  if (item.request.type === 'comic') {
    return getComicId(item) ?? intl.formatMessage(messages.unknownTitle);
  }
  if (item.request.type === 'magazine') {
    return getMagazineId(item) ?? intl.formatMessage(messages.unknownTitle);
  }
  return `${item.request.type.toUpperCase()} #${item.request.media.tmdbId}`;
};

const getPoster = (
  details: MediaDetails | undefined
): { src: string; type: 'tmdb' | 'music' | 'book' } => {
  if (!details?.posterPath) {
    return { src: '/images/seerr_poster_not_found.png', type: 'tmdb' };
  }
  if (isMusic(details)) {
    return { src: details.posterPath, type: 'music' };
  }
  if (isBook(details)) {
    return { src: details.posterPath, type: 'book' };
  }
  return { src: getTmdbPosterImageUrl(details.posterPath), type: 'tmdb' };
};

const getBackdrop = (
  details: MediaDetails | undefined
): { src: string; type: 'tmdb' | 'music' | 'book' } | undefined => {
  if (!details) return undefined;
  if (isMusic(details)) {
    const src =
      details.artistBackdrop ?? details.artistThumb ?? details.posterPath;
    return src ? { src, type: 'music' } : undefined;
  }
  if (isBook(details) || isComic(details) || isMagazine(details)) {
    return details.posterPath
      ? { src: details.posterPath, type: 'book' }
      : undefined;
  }
  if (details.backdropPath) {
    return {
      src: `https://image.tmdb.org/t/p/w1920_and_h800_multi_faces/${details.backdropPath}`,
      type: 'tmdb',
    };
  }
  return details.posterPath
    ? { src: getTmdbPosterImageUrl(details.posterPath), type: 'tmdb' }
    : undefined;
};

const getDisplayServiceName = (service?: string | null): string | undefined => {
  if (/^bookshelfng-ebooks$/i.test(service ?? '')) return 'Bookshelf-Ebook';
  if (/^bookshelfng-audiobooks$/i.test(service ?? '')) {
    return 'Bookshelf-Audio';
  }
  return service ?? undefined;
};

const getMediaBadge = (
  intl: ReturnType<typeof useIntl>,
  item: RequestStatusItem
): string => {
  if (item.request.type === 'movie') return intl.formatMessage(messages.movie);
  if (item.request.type === 'tv') return intl.formatMessage(messages.series);
  if (item.request.type === 'music') return intl.formatMessage(messages.album);
  if (item.request.type === 'comic') return intl.formatMessage(messages.comic);
  if (item.request.type === 'magazine')
    return intl.formatMessage(messages.magazine);
  return intl.formatMessage(messages.book);
};

const getMediaBadgeType = (
  item: RequestStatusItem
): MediaTypeBadgeType | undefined => {
  if (item.request.type === 'movie') return 'movie';
  if (item.request.type === 'tv') return 'tv';
  if (item.request.type === 'music') return 'album';
  if (item.request.type === 'comic') return 'comic';
  if (item.request.type === 'magazine') return 'magazine';
  return undefined;
};

const getMediaFormat = (
  intl: ReturnType<typeof useIntl>,
  item: RequestStatusItem
): string => {
  if (item.request.type === 'movie' || item.request.type === 'tv') {
    return intl.formatMessage(item.request.is4k ? messages.fourK : messages.hd);
  }
  if (item.request.type === 'music') {
    return intl.formatMessage(messages.musicFormat);
  }
  if (item.request.type === 'comic') {
    return intl.formatMessage(messages.comic);
  }
  if (item.request.type === 'magazine') {
    return intl.formatMessage(messages.magazine);
  }
  return intl.formatMessage(
    getBookFormatMessage(getRequestedBookFormat(item.request.bookFormat))
  );
};

const getReleaseDate = (
  details: MediaDetails | undefined,
  item: RequestStatusItem
): string | undefined => {
  if (!details) return undefined;
  if (item.request.type === 'movie') {
    return (details as MovieDetails).releaseDate;
  }
  if (item.request.type === 'tv') {
    return (details as TvDetails).firstAirDate;
  }
  if (item.request.type === 'music') {
    return (details as MusicDetails).releaseDate;
  }
  if (item.request.type === 'comic') {
    return (details as ComicDetails).startYear;
  }
  if (item.request.type === 'magazine') {
    return (details as MagazineDetails).latestIssue;
  }
  const year = (details as BookDetails).firstPublishYear;
  return year ? String(year) : undefined;
};

const getReleaseDateLabel = (
  intl: ReturnType<typeof useIntl>,
  item: RequestStatusItem
): string =>
  intl.formatMessage(
    item.request.type === 'book'
      ? messages.firstPublished
      : item.request.type === 'magazine'
        ? messages.latestIssue
        : messages.releaseDate
  );

const getRuntime = (
  intl: ReturnType<typeof useIntl>,
  details: MediaDetails | undefined,
  item: RequestStatusItem
): string => {
  const notAvailable = intl.formatMessage(messages.notAvailable);
  if (!details) return notAvailable;
  if (item.request.type === 'movie') {
    const minutes = (details as MovieDetails).runtime;
    return minutes && Number.isFinite(minutes)
      ? intl.formatMessage(messages.minutes, { count: minutes })
      : notAvailable;
  }
  if (item.request.type === 'tv') {
    const minutes = (details as TvDetails).episodeRunTime.find(
      (runtime) => runtime > 0 && Number.isFinite(runtime)
    );
    return minutes
      ? intl.formatMessage(messages.minutes, { count: minutes })
      : notAvailable;
  }
  if (item.request.type === 'music') {
    const milliseconds = (details as MusicDetails).tracks.reduce(
      (total, track) => total + Math.max(track.length, 0),
      0
    );
    return milliseconds > 0
      ? intl.formatMessage(messages.minutes, {
          count: Math.round(milliseconds / 60000),
        })
      : notAvailable;
  }

  if (item.request.type === 'magazine') {
    const issueCount = (details as MagazineDetails).issueCount;
    return issueCount !== undefined
      ? intl.formatNumber(issueCount)
      : notAvailable;
  }
  if (item.request.type === 'comic') {
    const issueCount = (details as ComicDetails).issueCount;
    return issueCount !== undefined
      ? intl.formatNumber(issueCount)
      : notAvailable;
  }
  return notAvailable;
};

const getRuntimeLabel = (
  intl: ReturnType<typeof useIntl>,
  item: RequestStatusItem
): string =>
  intl.formatMessage(
    item.request.type === 'book'
      ? messages.pages
      : item.request.type === 'magazine' || item.request.type === 'comic'
        ? messages.issues
        : messages.runtime
  );

const getRuntimeOrPages = (
  intl: ReturnType<typeof useIntl>,
  details: MediaDetails | undefined,
  item: RequestStatusItem
): string => {
  if (item.request.type !== 'book') {
    return getRuntime(intl, details, item);
  }

  const pages = details ? (details as BookDetails).numberOfPages : undefined;
  return pages && Number.isFinite(pages)
    ? intl.formatNumber(pages)
    : intl.formatMessage(messages.notAvailable);
};

type FeaturedCredit = {
  label: string;
  name: string;
  href?: string;
};

const getFeaturedCredits = (
  intl: ReturnType<typeof useIntl>,
  details: MediaDetails | undefined,
  item: RequestStatusItem
): FeaturedCredit[] => {
  const notAvailable = intl.formatMessage(messages.notAvailable);

  if (!details) {
    if (item.request.type === 'book' || item.request.type === 'music') {
      return [
        {
          label: intl.formatMessage(
            item.request.type === 'book' ? messages.author : messages.artist
          ),
          name: notAvailable,
        },
      ];
    }

    if (item.request.type === 'comic') {
      return [];
    }

    return [
      {
        label: intl.formatMessage(
          item.request.type === 'tv' ? messages.creator : messages.director
        ),
        name: notAvailable,
      },
      {
        label: intl.formatMessage(messages.writer),
        name: notAvailable,
      },
    ];
  }

  if (item.request.type === 'book') {
    const book = details as BookDetails;
    return [
      {
        label: intl.formatMessage(messages.author),
        name: book.author || notAvailable,
        href: book.authorId
          ? `/author/${encodeApiPathSegment(book.authorId)}`
          : undefined,
      },
    ];
  }

  if (item.request.type === 'music') {
    const music = details as MusicDetails;
    return [
      {
        label: intl.formatMessage(messages.artist),
        name: music.artist?.name || notAvailable,
        href: music.artist?.id
          ? `/artist/${encodeApiPathSegment(music.artist.id)}`
          : undefined,
      },
    ];
  }

  if (item.request.type === 'magazine') {
    const magazine = details as MagazineDetails;
    return [
      {
        label: intl.formatMessage(messages.latestIssue),
        name: magazine.latestIssue ?? notAvailable,
      },
    ];
  }

  if (item.request.type === 'comic') {
    // ComicVine's basic volume data has no creator/writer/artist credit.
    return [];
  }

  const mediaDetails = details as MovieDetails | TvDetails;
  const sortedCrew = sortCrewPriority(mediaDetails.credits?.crew ?? []);
  const featuredCrew =
    item.request.type === 'tv' && (details as TvDetails).createdBy.length > 0
      ? [
          ...(details as TvDetails).createdBy.map((person) => ({
            id: person.id,
            job: intl.formatMessage(messages.creator),
            name: person.name,
          })),
          ...sortedCrew,
        ]
      : sortedCrew;

  return featuredCrew.slice(0, 2).map((person) => ({
    label: person.job,
    name: person.name,
    href: `/person/${person.id}`,
  }));
};

const getSecondaryDetails = (
  intl: ReturnType<typeof useIntl>,
  details: MediaDetails | undefined,
  item: RequestStatusItem
): FeaturedCredit[] => {
  const notAvailable = intl.formatMessage(messages.notAvailable);

  if (item.request.type === 'book') {
    return [
      {
        label: intl.formatMessage(messages.publisher),
        name: (details as BookDetails | undefined)?.publisher ?? notAvailable,
      },
    ];
  }

  if (item.request.type === 'comic') {
    return [
      {
        label: intl.formatMessage(messages.publisher),
        name: (details as ComicDetails | undefined)?.publisher ?? notAvailable,
      },
    ];
  }

  if (item.request.type === 'music') {
    const music = details as MusicDetails | undefined;
    return [
      {
        label: intl.formatMessage(messages.albumType),
        name: music?.type || notAvailable,
      },
      {
        label: intl.formatMessage(messages.trackCount),
        name: music ? intl.formatNumber(music.tracks.length) : notAvailable,
      },
    ];
  }

  if (item.request.type === 'tv') {
    const tv = details as TvDetails | undefined;
    const network = tv?.networks?.[0];
    return [
      {
        label: intl.formatMessage(messages.network),
        name:
          network?.name ?? tv?.productionCompanies?.[0]?.name ?? notAvailable,
        href: network?.id ? `/discover/tv/network/${network.id}` : undefined,
      },
    ];
  }

  const studio = (details as MovieDetails | undefined)
    ?.productionCompanies?.[0];
  return [
    {
      label: intl.formatMessage(messages.studio),
      name: studio?.name ?? notAvailable,
      href: studio?.id ? `/discover/movies/studio/${studio.id}` : undefined,
    },
  ];
};

type GenreLink = {
  name: string;
  href: string;
};

const getGenres = (
  details: MediaDetails | undefined,
  item: RequestStatusItem
): GenreLink[] => {
  if (!details) return [];
  if (item.request.type === 'movie') {
    return (details as MovieDetails).genres.slice(0, 3).map((genre) => ({
      name: genre.name,
      href: `/discover/movies/genre/${genre.id}`,
    }));
  }
  if (item.request.type === 'tv') {
    return (details as TvDetails).genres.slice(0, 3).map((genre) => ({
      name: genre.name,
      href: `/discover/tv/genre/${genre.id}`,
    }));
  }
  if (item.request.type === 'music') {
    return (
      (details as MusicDetails).tags?.releaseGroup
        .map((tag) => tag.tag.trim())
        .filter(Boolean)
        .slice(0, 3)
        .map((name) => ({
          name,
          href: `/discover/music?genre=${encodeURIComponent(name)}`,
        })) ?? []
    );
  }
  if (item.request.type === 'comic') {
    // ComicVine has no genre-equivalent field.
    return [];
  }
  return (
    (details as BookDetails).subjects
      ?.map((subject) => subject.trim())
      .filter(
        (subject) =>
          !!subject &&
          !/^(?:collection|work|edition|record)id\s*:/i.test(subject)
      )
      .slice(0, 3)
      .map((name) => ({
        name,
        href: `/discover/books?subject=${encodeURIComponent(name)}`,
      })) ?? []
  );
};

const formatBytes = (
  intl: ReturnType<typeof useIntl>,
  value: number | null
): string => {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return intl.formatMessage(messages.notAvailable);
  }
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = -1;
  do {
    size /= 1024;
    unit += 1;
  } while (size >= 1024 && unit < units.length - 1);
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unit]}`;
};

const getStageLabel = (intl: ReturnType<typeof useIntl>, stage: StatusStage) =>
  intl.formatMessage(messages[stageMessageKeys[stage]]);

const getValidDate = (
  value: string | number | Date | null | undefined
): Date | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
};

const getLastTimelineIndex = (
  stage: StatusStage,
  history: RequestStatusDetailResponse['history']['results']
): number => {
  const directIndex = timelineStages.indexOf(stage);
  if (directIndex >= 0) return directIndex;
  for (const event of history) {
    const eventIndex = timelineStages.indexOf(event.stage);
    if (eventIndex >= 0) return eventIndex;
  }
  return 0;
};

interface RequestStatusCardProps {
  item: RequestStatusItem;
  isAdminView: boolean;
  onRetry: (requestId: number) => Promise<void>;
  isRetrying: boolean;
  onDelete: (requestId: number) => void;
  isDeleting: boolean;
  onRemove: (requestId: number, title: string, service: string) => void;
  isRemoving: boolean;
  isHistoryOpen: boolean;
  onToggleHistory: (requestId: number) => void;
}

const RequestStatusCard = ({
  item,
  isAdminView,
  onRetry,
  isRetrying,
  onDelete,
  isDeleting,
  onRemove,
  isRemoving,
  isHistoryOpen,
  onToggleHistory,
}: RequestStatusCardProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { hasPermission, user } = useUser();
  const { mutate: mutateCache } = useSWRConfig();
  const [showEditModal, setShowEditModal] = useState(false);
  const [isModifying, setIsModifying] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [timelineHasOverflow, setTimelineHasOverflow] = useState(false);
  const detailsUrl = getDetailsUrl(item);
  const detailHref = getDetailHref(item);
  const { data: details } = useSWR<MediaDetails>(detailsUrl);
  const { data: detail, mutate: revalidateDetail } =
    useSWR<RequestStatusDetailResponse>(
      `/api/v1/request/status/${item.request.id}`,
      {
        refreshInterval: 15000,
        revalidateOnFocus: true,
      }
    );
  const reportedCurrent = detail?.current ?? item.status;
  const observedCurrent =
    item.request.rootFolder === '__preview_downloading__'
      ? {
          ...reportedCurrent,
          stage: 'downloading' as const,
          percent: 63.4,
          size: 21_474_836_480,
          sizeLeft: 7_859_790_152,
          estimatedCompletionTime: null,
          downloadCount: 1,
          downloadId: null,
          service: 'Radarr-HD',
          message: 'A usable release is downloading.',
          isTerminal: false,
          needsAttention: false,
          retryable: false,
        }
      : reportedCurrent;
  const current = isRetrying
    ? {
        ...observedCurrent,
        stage: 'approved' as const,
        percent: null,
        size: null,
        sizeLeft: null,
        estimatedCompletionTime: null,
        downloadCount: 0,
        downloadId: null,
        message: 'Approved for processing.',
        observedAt: new Date(),
        isTerminal: false,
        needsAttention: false,
        retryable: false,
      }
    : observedCurrent;
  const history = detail?.history.results ?? [];
  const currentStage = statusStageValues.includes(current.stage)
    ? (current.stage as StatusStage)
    : 'approved';
  const activeIndex = getLastTimelineIndex(currentStage, history);
  const poster = getPoster(details);
  const backdrop = getBackdrop(details);
  const title = getTitle(intl, details, item);
  const mediaBadgeType = getMediaBadgeType(item) ?? 'movie';
  const StageIcon = stageIcon[currentStage] ?? InformationCircleIcon;
  const releaseDate = getReleaseDate(details, item);
  const releaseYear = releaseDate?.match(/\d{4}/)?.[0];
  const displayTitle = releaseYear ? `${title} (${releaseYear})` : title;
  const displayReleaseDate = releaseDate
    ? /^\d{4}$/.test(releaseDate)
      ? releaseDate
      : (() => {
          const parsedReleaseDate = getValidDate(releaseDate);
          return parsedReleaseDate
            ? intl.formatDate(parsedReleaseDate, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })
            : intl.formatMessage(messages.notAvailable);
        })()
    : intl.formatMessage(messages.notAvailable);
  const bookFormat: RequestedBookFormat | undefined =
    item.request.type === 'book'
      ? getRequestedBookFormat(item.request.bookFormat)
      : undefined;
  const terminalWithoutProgress =
    current.isTerminal && currentStage !== 'available';
  const chronologicalHistory = [...history].reverse();
  const estimatedCompletionTime = getValidDate(current.estimatedCompletionTime);
  const createdAt = getValidDate(item.request.createdAt);
  const notAvailable = intl.formatMessage(messages.notAvailable);
  const featuredCredits = getFeaturedCredits(intl, details, item);
  const secondaryDetails = getSecondaryDetails(intl, details, item);
  const genres = getGenres(details, item);
  const canShowDelete =
    isAdminView && hasPermission(Permission.MANAGE_REQUESTS);
  const canRetry =
    (observedCurrent.stage === 'failed' ||
      observedCurrent.stage === 'unavailable') &&
    ((isAdminView && hasPermission(Permission.MANAGE_REQUESTS)) ||
      item.request.requestedBy.id === user?.id);
  const canShowRemove =
    isAdminView && hasPermission(Permission.MANAGE_REQUESTS);
  const canRemove = canShowRemove && item.canRemove === true;
  const canModeratePending =
    isAdminView &&
    hasPermission(Permission.MANAGE_REQUESTS) &&
    item.request.status === MediaRequestStatus.PENDING;
  const posterBadgeClassName =
    'h-[18px] w-full justify-center gap-0.5 px-1 py-0 text-[9px] shadow-sm backdrop-blur-[1px] [&_svg]:h-2.5 [&_svg]:w-2.5 [&_svg]:-translate-y-px';
  const posterBadge = bookFormat ? (
    <BookFormatBadge
      format={bookFormat}
      variant="compact"
      className={`bg-amber-700/70 text-amber-50 ${posterBadgeClassName}`}
    />
  ) : (
    <MediaTypeBadge
      mediaType={mediaBadgeType}
      variant="compact"
      className={posterBadgeClassName}
    />
  );
  const refreshRequestStatus = async () => {
    await Promise.all([
      revalidateDetail(),
      mutateCache(
        (key) =>
          typeof key === 'string' && key.startsWith('/api/v1/request/status')
      ),
      mutateCache('/api/v1/request/count'),
    ]);
  };
  const modifyPendingRequest = async (action: 'approve' | 'decline') => {
    setIsModifying(true);
    try {
      await axios.post(`/api/v1/request/${item.request.id}/${action}`);
      await refreshRequestStatus();
    } catch {
      addToast(intl.formatMessage(messages.modifyFailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsModifying(false);
    }
  };
  const scrollTimeline = (direction: -1 | 1) => {
    timelineRef.current?.scrollBy({
      left: direction * 260,
      behavior: 'smooth',
    });
  };
  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) {
      return;
    }

    const updateTimelineOverflow = () => {
      setTimelineHasOverflow(timeline.scrollWidth > timeline.clientWidth + 1);
    };

    updateTimelineOverflow();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateTimelineOverflow);
      return () => window.removeEventListener('resize', updateTimelineOverflow);
    }

    const resizeObserver = new ResizeObserver(updateTimelineOverflow);
    resizeObserver.observe(timeline);
    const content = timeline.firstElementChild;
    if (content) {
      resizeObserver.observe(content);
    }

    return () => resizeObserver.disconnect();
  }, []);
  const actionControls = (
    <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
      {canModeratePending && (
        <>
          <Tooltip content={intl.formatMessage(messages.approveTooltip)}>
            <button
              type="button"
              className="compact-control inline-flex items-center gap-1 rounded-md border border-emerald-600/80 bg-emerald-800/25 px-2 text-[11px] leading-none font-semibold text-emerald-200 transition hover:border-emerald-500 hover:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none disabled:opacity-40"
              disabled={isModifying}
              onClick={() => void modifyPendingRequest('approve')}
            >
              <CheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {intl.formatMessage(messages.approve)}
            </button>
          </Tooltip>
          <Tooltip content={intl.formatMessage(messages.declineTooltip)}>
            <button
              type="button"
              className="compact-control inline-flex items-center gap-1 rounded-md border border-red-600/80 bg-red-800/25 px-2 text-[11px] leading-none font-semibold text-red-200 transition hover:border-red-500 hover:text-white focus:ring-2 focus:ring-red-500 focus:outline-none disabled:opacity-40"
              disabled={isModifying}
              onClick={() => void modifyPendingRequest('decline')}
            >
              <XMarkIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {intl.formatMessage(messages.decline)}
            </button>
          </Tooltip>
          <Tooltip content={intl.formatMessage(messages.editTooltip)}>
            <button
              type="button"
              className="compact-control inline-flex items-center gap-1 rounded-md border border-amber-600/80 bg-amber-800/25 px-2 text-[11px] leading-none font-semibold text-amber-200 transition hover:border-amber-500 hover:text-white focus:ring-2 focus:ring-amber-500 focus:outline-none disabled:opacity-40"
              disabled={isModifying}
              onClick={() => setShowEditModal(true)}
            >
              <PencilIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {intl.formatMessage(messages.edit)}
            </button>
          </Tooltip>
        </>
      )}
      <Tooltip content={intl.formatMessage(messages.retryTooltip)}>
        <button
          type="button"
          className="compact-control inline-flex items-center gap-1 rounded-md border border-amber-600/80 bg-amber-800/25 px-2 text-[11px] leading-none font-semibold whitespace-nowrap text-amber-300 transition hover:border-amber-400 hover:text-white focus:ring-2 focus:ring-amber-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!canRetry || isRetrying || isDeleting || isRemoving}
          onClick={() => void onRetry(item.request.id)}
        >
          <ArrowPathIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {intl.formatMessage(isRetrying ? messages.retrying : messages.retry)}
        </button>
      </Tooltip>
      {canShowDelete && (
        <Tooltip content={intl.formatMessage(messages.deleteTooltip)}>
          <button
            type="button"
            className="compact-control inline-flex items-center gap-1 rounded-md border border-red-600/80 bg-red-800/25 px-2 text-[11px] leading-none font-semibold whitespace-nowrap text-red-200 transition hover:border-red-500 hover:text-white focus:ring-2 focus:ring-red-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
            disabled={isDeleting || isRetrying || isRemoving}
            onClick={() => onDelete(item.request.id)}
          >
            <TrashIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {intl.formatMessage(
              isDeleting ? messages.deleting : messages.delete
            )}
          </button>
        </Tooltip>
      )}
      {canShowRemove && (
        <Tooltip
          content={intl.formatMessage(
            canRemove
              ? messages.removeTooltip
              : messages.removeUnavailableTooltip
          )}
        >
          <button
            type="button"
            className="compact-control inline-flex items-center gap-1 rounded-md border border-rose-400 bg-rose-500/25 px-2 text-[11px] leading-none font-semibold whitespace-nowrap text-rose-100 transition hover:border-rose-200 hover:bg-rose-500/45 hover:text-white focus:ring-2 focus:ring-rose-300 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!canRemove || isRemoving || isRetrying || isDeleting}
            onClick={() =>
              onRemove(
                item.request.id,
                displayTitle,
                getDisplayServiceName(current.service) ?? 'library service'
              )
            }
          >
            <ArchiveBoxXMarkIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {intl.formatMessage(
              isRemoving ? messages.removing : messages.remove
            )}
          </button>
        </Tooltip>
      )}
    </div>
  );

  return (
    <>
      {showEditModal && (
        <RequestModal
          show
          tmdbId={
            item.request.type === 'music' ||
            item.request.type === 'book' ||
            item.request.type === 'comic' ||
            item.request.type === 'magazine'
              ? undefined
              : item.request.media.tmdbId
          }
          mbId={
            item.request.type === 'music'
              ? (item.request.media.mbId ?? undefined)
              : undefined
          }
          bookId={item.request.type === 'book' ? getBookId(item) : undefined}
          comicId={item.request.type === 'comic' ? getComicId(item) : undefined}
          magazineTitle={
            item.request.type === 'magazine' ? getMagazineId(item) : undefined
          }
          type={item.request.type}
          is4k={item.request.is4k}
          editRequest={item.request}
          onCancel={() => setShowEditModal(false)}
          onComplete={() => {
            setShowEditModal(false);
            void refreshRequestStatus();
          }}
        />
      )}
      <article
        className="media-detail-card refreshed-card-surface relative overflow-hidden rounded-xl border border-gray-700 p-3 shadow-lg shadow-gray-950/20"
        data-testid={`request-status-${item.request.id}`}
      >
        {backdrop && (
          <div className="absolute inset-0 z-0">
            <CachedImage
              type={backdrop.type}
              src={backdrop.src}
              alt=""
              fill
              sizes="100vw"
              className="object-cover object-center"
            />
            <div className="refreshed-artwork-scrim" />
            <div className="refreshed-artwork-gradient" />
          </div>
        )}
        <div className="relative z-10 grid min-w-0 grid-cols-[64px_minmax(0,1fr)] gap-3 sm:grid-cols-[80px_minmax(0,1fr)]">
          <div className="min-w-0 self-start">
            {detailHref ? (
              <Link
                href={detailHref}
                aria-label={displayTitle}
                className="relative block h-24 w-16 overflow-hidden rounded-lg ring-1 ring-gray-600 transition duration-200 hover:ring-indigo-400 focus:ring-2 focus:ring-indigo-400 focus:outline-none motion-reduce:transition-none sm:h-[120px] sm:w-20"
              >
                <CachedImage
                  src={poster.src}
                  type={poster.type}
                  alt=""
                  fill
                  sizes="(min-width: 640px) 80px, 64px"
                  className="object-cover"
                />
                <span className="pointer-events-none absolute top-1 left-1/2 z-10 w-[calc(100%-0.375rem)] -translate-x-1/2">
                  {posterBadge}
                </span>
              </Link>
            ) : (
              <div className="relative h-24 w-16 overflow-hidden rounded-lg ring-1 ring-gray-600 sm:h-[120px] sm:w-20">
                <CachedImage
                  src={poster.src}
                  type={poster.type}
                  alt=""
                  fill
                  sizes="(min-width: 640px) 80px, 64px"
                  className="object-cover"
                />
                <span className="pointer-events-none absolute top-1 left-1/2 z-10 w-[calc(100%-0.375rem)] -translate-x-1/2">
                  {posterBadge}
                </span>
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-col">
            {detailHref ? (
              <Link
                href={detailHref}
                className="-mt-0.5 block truncate text-lg leading-5 font-semibold text-white hover:underline focus:ring-2 focus:ring-indigo-400 focus:outline-none"
              >
                {displayTitle}
              </Link>
            ) : (
              <h3 className="-mt-0.5 truncate text-lg leading-5 font-semibold text-white">
                {displayTitle}
              </h3>
            )}

            <div className="card:grid-cols-3 mt-4 grid min-h-0 min-w-0 flex-1 grid-cols-1 items-stretch">
              <div className="card:col-span-2 card:pr-3 min-w-0">
                <dl className="refreshed-detail-text card:grid-cols-[max-content_0.75rem_6rem_0.75rem_1px_0.75rem_minmax(0,1fr)] card:gap-x-0 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 text-xs leading-4">
                  <dt className="card:col-start-1 card:row-start-1 font-medium text-gray-100">
                    {intl.formatMessage(messages.mediaAndFormat)}:
                  </dt>
                  <dd className="card:col-start-3 card:row-start-1 m-0 truncate">
                    {getMediaBadge(intl, item)} · {getMediaFormat(intl, item)}
                  </dd>
                  <dt className="card:col-start-1 card:row-start-2 font-medium text-gray-100">
                    {getReleaseDateLabel(intl, item)}:
                  </dt>
                  <dd className="card:col-start-3 card:row-start-2 m-0 truncate">
                    {displayReleaseDate}
                  </dd>
                  <dt className="card:col-start-1 card:row-start-3 font-medium text-gray-100">
                    {getRuntimeLabel(intl, item)}:
                  </dt>
                  <dd className="card:col-start-3 card:row-start-3 m-0 truncate">
                    {getRuntimeOrPages(intl, details, item)}
                  </dd>

                  <div className="card:col-start-5 card:row-span-3 card:row-start-1 card:block hidden bg-gray-600" />

                  <div className="card:col-span-1 card:col-start-7 card:row-span-3 card:row-start-1 card:mt-0 card:border-t-0 card:pt-0 col-span-2 mt-2 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 border-t border-gray-600 pt-2">
                    {[...featuredCredits, ...secondaryDetails].map(
                      (credit, index) => (
                        <div
                          className="contents"
                          key={`${credit.label}-${index}`}
                        >
                          <dt className="font-medium text-gray-100">
                            {credit.label}:
                          </dt>
                          <dd className="m-0 truncate">
                            {credit.href ? (
                              <Link
                                href={credit.href}
                                className="text-indigo-300 hover:text-indigo-200 hover:underline focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                              >
                                {credit.name}
                              </Link>
                            ) : (
                              credit.name
                            )}
                          </dd>
                        </div>
                      )
                    )}
                  </div>

                  <dt className="card:col-start-1 card:row-start-4 mt-0.5 font-medium text-gray-100">
                    {intl.formatMessage(messages.genres)}:
                  </dt>
                  {genres.length > 0 ? (
                    <dd className="card:col-span-5 card:col-start-3 card:row-start-4 m-0 mt-0.5 line-clamp-2 min-w-0 break-words">
                      {genres.map((genre, index) => (
                        <span key={`${genre.href}-${genre.name}`}>
                          {index > 0 && ', '}
                          <Link
                            href={genre.href}
                            className="text-indigo-300 hover:text-indigo-200 hover:underline focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                          >
                            {genre.name}
                          </Link>
                        </span>
                      ))}
                    </dd>
                  ) : (
                    <dd className="card:col-span-5 card:col-start-3 card:row-start-4 m-0 mt-0.5">
                      {notAvailable}
                    </dd>
                  )}
                </dl>
              </div>

              <dl className="refreshed-detail-text media-detail-column-divider grid h-full min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 text-xs leading-4">
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.requestedByLabel)}:
                </dt>
                <dd className="m-0 truncate">
                  <Link
                    href={`/users/${item.request.requestedBy.id}`}
                    className="text-indigo-300 hover:text-indigo-200 hover:underline focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                  >
                    {item.request.requestedBy.displayName}
                  </Link>
                </dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.requestedDateTime)}:
                </dt>
                <dd className="m-0 truncate">
                  {createdAt ? (
                    <FormattedDate value={createdAt} dateStyle="medium" />
                  ) : (
                    notAvailable
                  )}
                </dd>
                <dt aria-hidden="true" />
                <dd className="m-0 truncate">
                  {createdAt ? (
                    <FormattedDate value={createdAt} timeStyle="short" />
                  ) : (
                    notAvailable
                  )}
                </dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.serviceLabel)}:
                </dt>
                <dd className="m-0 truncate">
                  {getDisplayServiceName(current.service) ?? notAvailable}
                </dd>
              </dl>
            </div>
          </div>
        </div>

        <div className="refreshed-inset-surface relative z-10 mt-[5px] rounded-lg border border-gray-700 py-[5px]">
          {timelineHasOverflow && (
            <button
              type="button"
              onClick={() => scrollTimeline(-1)}
              className="app-button app-button-default absolute top-1/2 left-1 z-10 h-10 w-7 -translate-y-1/2 p-0 backdrop-blur-sm"
              aria-label={intl.formatMessage(messages.scrollProgressLeft)}
            >
              <ChevronLeftIcon className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <div
            ref={timelineRef}
            className="hide-scrollbar flex overflow-x-auto px-2"
            aria-label={intl.formatMessage(messages.requestLifecycle)}
          >
            <div className="mx-auto flex min-w-[640px] flex-1 items-start justify-center">
              {timelineStages.map((stage, index) => {
                const isAvailable = currentStage === 'available';
                const isCurrent =
                  !terminalWithoutProgress &&
                  !isAvailable &&
                  currentStage === stage;
                const isComplete =
                  !terminalWithoutProgress &&
                  (isAvailable ? index <= activeIndex : index < activeIndex);
                return (
                  <div
                    key={stage}
                    className="relative flex min-w-[80px] flex-1 flex-col items-center text-center"
                  >
                    {index < timelineStages.length - 1 && (
                      <span
                        className={`absolute top-[6px] right-[-50%] left-1/2 h-0.5 ${
                          !terminalWithoutProgress && index < activeIndex
                            ? 'bg-emerald-400'
                            : 'bg-gray-700'
                        }`}
                        aria-hidden="true"
                      />
                    )}
                    <span
                      className={`relative z-[1] flex h-[14px] w-[14px] items-center justify-center rounded-full border ${
                        isCurrent
                          ? 'border-indigo-300 bg-indigo-500 text-white shadow-sm shadow-indigo-900/50'
                          : isComplete
                            ? 'border-emerald-400 bg-emerald-500 text-white'
                            : 'border-gray-600 bg-gray-800 text-transparent'
                      }`}
                    >
                      {isComplete ? (
                        <CheckIcon className="h-2.5 w-2.5" aria-hidden="true" />
                      ) : isCurrent ? (
                        <StageIcon className="h-2.5 w-2.5" aria-hidden="true" />
                      ) : null}
                    </span>
                    <span
                      className={`mt-1 text-[11px] leading-4 whitespace-nowrap ${
                        isCurrent
                          ? 'font-semibold text-white'
                          : 'refreshed-detail-text-muted'
                      }`}
                    >
                      {getStageLabel(intl, stage)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          {timelineHasOverflow && (
            <button
              type="button"
              onClick={() => scrollTimeline(1)}
              className="app-button app-button-default absolute top-1/2 right-1 z-10 h-10 w-7 -translate-y-1/2 p-0 backdrop-blur-sm"
              aria-label={intl.formatMessage(messages.scrollProgressRight)}
            >
              <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {current.stage === 'downloading' && current.percent !== null && (
          <div className="refreshed-inset-surface relative z-10 mt-2 rounded-lg border border-gray-700 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-indigo-200">
              <span className="inline-flex items-center gap-2">
                <span>
                  {intl.formatMessage(messages.progressFrom, {
                    percent: current.percent.toFixed(1).replace(/\.0$/, ''),
                  })}
                </span>
                {current.size !== null && current.sizeLeft !== null && (
                  <>
                    <span
                      className="refreshed-detail-text-muted"
                      aria-hidden="true"
                    >
                      |
                    </span>
                    <span>
                      {intl.formatMessage(messages.sizeProgress, {
                        complete: formatBytes(
                          intl,
                          current.size - current.sizeLeft
                        ),
                        total: formatBytes(intl, current.size),
                      })}
                    </span>
                  </>
                )}
              </span>
              {estimatedCompletionTime && (
                <span>
                  {intl.formatMessage(messages.eta, {
                    date: (
                      <FormattedDate
                        value={estimatedCompletionTime}
                        dateStyle="short"
                        timeStyle="short"
                      />
                    ),
                  })}
                </span>
              )}
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-gray-700"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={current.percent}
              aria-valuetext={`${current.percent}%`}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-[width] duration-500 motion-reduce:transition-none"
                style={{
                  width: `${Math.min(100, Math.max(0, current.percent))}%`,
                }}
              />
            </div>
          </div>
        )}

        <div className="request-status-action-row">
          <Tooltip content={current.message}>
            <span
              className={`compact-control inline-flex w-32 flex-shrink-0 items-center justify-center gap-1.5 rounded-full border px-2 text-[11px] font-semibold ${stageTone[currentStage] ?? stageTone.cancelled}`}
              aria-label={`${getStageLabel(intl, currentStage)}: ${current.message}`}
              tabIndex={0}
            >
              <StageIcon className="h-3 w-3" aria-hidden="true" />
              {getStageLabel(intl, currentStage)}
            </span>
          </Tooltip>
          {actionControls}
          <button
            type="button"
            className="compact-control inline-flex items-center gap-1 rounded-md border border-emerald-600/80 bg-emerald-800/25 px-2 text-[11px] leading-none font-semibold whitespace-nowrap text-emerald-200 transition hover:border-emerald-500 hover:bg-emerald-800/45 hover:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            aria-expanded={isHistoryOpen}
            onClick={() => onToggleHistory(item.request.id)}
          >
            <ClockIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {intl.formatMessage(
              isHistoryOpen ? messages.hideHistory : messages.history
            )}
            <ChevronDownIcon
              className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${isHistoryOpen ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>
        </div>

        {isHistoryOpen && (
          <section className="refreshed-inset-surface relative z-10 mt-2 rounded-lg border border-gray-700 p-3">
            <h4 className="mb-2 text-xs font-semibold text-gray-200">
              {intl.formatMessage(messages.history)}
            </h4>
            {chronologicalHistory.length === 0 ? (
              <p className="refreshed-detail-text-muted text-xs">
                {intl.formatMessage(messages.noHistory)}
              </p>
            ) : (
              <ol className="grid grid-cols-[7rem_6rem_7.5rem_minmax(0,1fr)] gap-x-3 gap-y-2">
                {chronologicalHistory.map((event) => {
                  const eventDate = getValidDate(event.createdAt);
                  if (!eventDate) {
                    return null;
                  }

                  return (
                    <li key={event.id} className="contents text-xs">
                      <time
                        className="refreshed-detail-text-muted whitespace-nowrap"
                        dateTime={eventDate.toISOString()}
                      >
                        <FormattedDate value={eventDate} dateStyle="medium" />
                      </time>
                      <time
                        className="refreshed-detail-text-muted whitespace-nowrap"
                        dateTime={eventDate.toISOString()}
                      >
                        <FormattedDate value={eventDate} timeStyle="medium" />
                      </time>
                      <span className="font-medium text-gray-200">
                        {getStageLabel(intl, event.stage as StatusStage)}
                      </span>
                      <span className="refreshed-detail-text min-w-0">
                        {event.message ??
                          getStageLabel(intl, event.stage as StatusStage)}
                        {event.percent !== null && ` · ${event.percent}%`}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        )}
      </article>
    </>
  );
};

const RequestStatus = () => {
  const intl = useIntl();
  const router = useRouter();
  const { user: currentUser, hasPermission } = useUser();
  const { addToast } = useToasts();
  const isAdminView = hasPermission(Permission.MANAGE_REQUESTS);
  const canViewOtherUsers =
    isAdminView &&
    hasPermission([Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW], {
      type: 'or',
    });
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [searchFilter, debouncedSearchFilter, setSearchFilter] =
    useDebouncedState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState<RequestStatusSortField>('added');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [pageSize, setPageSize] = useState(10);
  const [timeFrame, setTimeFrame] = useState<TimeFrame>('all');
  const [selectedUser, setSelectedUser] = useState<UserSelection | null>(null);
  const [expandedRequestId, setExpandedRequestId] = useState<number | null>(
    null
  );
  const [retryingRequestId, setRetryingRequestId] = useState<number | null>(
    null
  );
  const [deleteRequestId, setDeleteRequestId] = useState<number | null>(null);
  const [deletingRequestId, setDeletingRequestId] = useState<number | null>(
    null
  );
  const [removeSelection, setRemoveSelection] =
    useState<RemoveSelection | null>(null);
  const [removingRequestId, setRemovingRequestId] = useState<number | null>(
    null
  );

  const { data: statusUsers } = useSWR<RequestStatusUsersResponse>(
    canViewOtherUsers ? '/api/v1/request/status/users?take=100&skip=0' : null,
    fetchStatusUsers
  );

  useEffect(() => {
    if (!router.isReady) {
      return;
    }

    setFilter(getSafeQueryValue(router.query.filter, requestTypeFilterValues));
    setMediaFilter(
      getSafeQueryValue(router.query.mediaType, mediaTypeValues) as MediaFilter
    );
    const queryMediaFilter = getSafeQueryValue(
      router.query.mediaType,
      mediaTypeValues
    ) as MediaFilter;
    const querySort = getSafeQueryValue(
      router.query.sort,
      getSortOptions(queryMediaFilter).map((option) => option.value)
    );
    setSort(
      querySort === 'all' ? 'added' : (querySort as RequestStatusSortField)
    );
    const querySortDirection = getSafeQueryValue(
      router.query.sortDirection,
      sortDirectionValues
    );
    setSortDirection(querySortDirection === 'asc' ? 'asc' : 'desc');
    setTimeFrame(getTimeFrameFromQuery(router.query.timeFrame));

    const rawUserId = Array.isArray(router.query.userId)
      ? router.query.userId[0]
      : router.query.userId;
    setSelectedUser(
      resolveRequestStatusUserSelection({
        canViewOtherUsers,
        queryUserId: rawUserId,
      })
    );
  }, [
    canViewOtherUsers,
    currentUser?.id,
    router.isReady,
    router.query.filter,
    router.query.mediaType,
    router.query.sort,
    router.query.sortDirection,
    router.query.timeFrame,
    router.query.userId,
  ]);

  const userOptions = useMemo(() => {
    const users = new Map<
      number,
      RequestStatusUsersResponse['results'][number]
    >();
    for (const user of statusUsers?.results ?? []) {
      users.set(user.id, user);
    }
    if (currentUser) {
      users.set(currentUser.id, {
        id: currentUser.id,
        displayName: currentUser.displayName,
        avatar: currentUser.avatar,
      });
    }
    return [...users.values()].sort((left, right) =>
      left.displayName.localeCompare(right.displayName, undefined, {
        sensitivity: 'base',
      })
    );
  }, [currentUser, statusUsers]);

  const selectedOwnerId = canViewOtherUsers
    ? selectedUser === 'all'
      ? undefined
      : (selectedUser ?? currentUser?.id)
    : currentUser?.id;
  const page = Math.max(Number(router.query.page) || 1, 1);
  const apiMediaType =
    mediaFilter === 'book' || mediaFilter === 'audiobook'
      ? 'book'
      : mediaFilter;
  const bookFormat =
    mediaFilter === 'book'
      ? 'ebook'
      : mediaFilter === 'audiobook'
        ? 'audiobook'
        : undefined;
  const query = useMemo(() => {
    if (
      !canLoadRequestStatus({
        currentUserId: currentUser?.id,
        canViewOtherUsers,
        selectedUser,
      })
    ) {
      return null;
    }

    const params = new URLSearchParams({
      take: String(pageSize),
      skip: String((page - 1) * pageSize),
      filter,
      mediaType: apiMediaType,
      sort,
      sortDirection,
      timeFrame,
    });
    if (bookFormat) {
      params.set('bookFormat', bookFormat);
    }
    if (selectedOwnerId !== undefined) {
      params.set('requestedBy', String(selectedOwnerId));
    }
    if (debouncedSearchFilter.trim()) {
      params.set('search', debouncedSearchFilter.trim());
    }
    return `/api/v1/request/status?${params.toString()}`;
  }, [
    apiMediaType,
    bookFormat,
    canViewOtherUsers,
    currentUser,
    debouncedSearchFilter,
    filter,
    page,
    pageSize,
    selectedOwnerId,
    selectedUser,
    sort,
    sortDirection,
    timeFrame,
  ]);
  const { data, error, isValidating, mutate } =
    useSWR<RequestStatusResultsResponse>(query, {
      refreshInterval: 15000,
      revalidateOnFocus: true,
    });
  useSearchActivityReporter(
    Boolean(searchFilter.trim()) &&
      (searchFilter.trim() !== debouncedSearchFilter.trim() || isValidating),
    'request-status-keyword'
  );
  useRequestStatusScrollRestoration(Boolean(data));

  const routeQuery = ({
    nextFilter = filter,
    nextMediaFilter = mediaFilter,
    nextSort = sort,
    nextSortDirection = sortDirection,
    nextTimeFrame = timeFrame,
    nextUser = selectedUser,
    nextPage = 1,
  }: {
    nextFilter?: string;
    nextMediaFilter?: MediaFilter;
    nextSort?: RequestStatusSortField;
    nextSortDirection?: 'asc' | 'desc';
    nextTimeFrame?: TimeFrame;
    nextUser?: UserSelection | null;
    nextPage?: number;
  } = {}) => ({
    ...(nextFilter !== 'all' ? { filter: nextFilter } : {}),
    ...(nextMediaFilter !== 'all' ? { mediaType: nextMediaFilter } : {}),
    ...(nextSort !== 'added' ? { sort: nextSort } : {}),
    ...(nextSortDirection !== 'desc'
      ? { sortDirection: nextSortDirection }
      : {}),
    ...(nextTimeFrame !== 'all' ? { timeFrame: nextTimeFrame } : {}),
    ...(canViewOtherUsers && nextUser !== null && nextUser !== 'all'
      ? { userId: String(nextUser) }
      : {}),
    ...(nextPage > 1 ? { page: String(nextPage) } : {}),
  });

  const pushRouteQuery = (queryParams: Record<string, string>) => {
    void router.push({ pathname: router.pathname, query: queryParams });
  };

  const updateFilter = (nextFilter: string) => {
    setFilter(nextFilter);
    pushRouteQuery(routeQuery({ nextFilter }));
  };

  const updateMediaFilter = (nextMediaFilter: MediaFilter) => {
    const options = getSortOptions(nextMediaFilter);
    const keepsSort = options.some((option) => option.value === sort);
    const nextSort = keepsSort ? sort : 'added';
    const nextSortDirection = keepsSort ? sortDirection : 'desc';
    setMediaFilter(nextMediaFilter);
    setSort(nextSort);
    setSortDirection(nextSortDirection);
    pushRouteQuery(
      routeQuery({ nextMediaFilter, nextSort, nextSortDirection })
    );
  };

  const updateSort = (nextSort: RequestStatusSortField) => {
    const nextSortDirection =
      sort === nextSort
        ? sortDirection === 'asc'
          ? 'desc'
          : 'asc'
        : getDefaultSortDirection(nextSort);
    setSort(nextSort);
    setSortDirection(nextSortDirection);
    pushRouteQuery(routeQuery({ nextSort, nextSortDirection }));
  };

  const updateUser = (value: string) => {
    const nextUser: UserSelection = value === 'all' ? 'all' : Number(value);
    setSelectedUser(nextUser);
    pushRouteQuery(routeQuery({ nextUser }));
  };

  const updateTimeFrame = (nextTimeFrame: TimeFrame) => {
    setTimeFrame(nextTimeFrame);
    pushRouteQuery(routeQuery({ nextTimeFrame }));
  };

  const retryRequest = async (requestId: number) => {
    setRetryingRequestId(requestId);
    try {
      await axios.post(`/api/v1/request/${requestId}/retry`);
      addToast(intl.formatMessage(messages.retrySuccess), {
        appearance: 'success',
        autoDismiss: true,
      });
      await mutate();
    } catch {
      addToast(intl.formatMessage(messages.retryFailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setRetryingRequestId(null);
    }
  };

  const deleteRequest = async () => {
    if (deleteRequestId === null) return;
    const requestId = deleteRequestId;
    setDeletingRequestId(requestId);
    try {
      await axios.delete(`/api/v1/request/${requestId}/status`);
      addToast(intl.formatMessage(messages.deleteSuccess), {
        appearance: 'success',
        autoDismiss: true,
      });
      setExpandedRequestId((currentId) =>
        currentId === requestId ? null : currentId
      );
      setDeleteRequestId(null);
      await mutate();
    } catch (error) {
      const detail = axios.isAxiosError(error)
        ? error.response?.data?.message
        : undefined;
      addToast(
        detail
          ? `${intl.formatMessage(messages.deleteFailed)} ${detail}`
          : intl.formatMessage(messages.deleteFailed),
        {
          appearance: 'error',
          autoDismiss: true,
        }
      );
    } finally {
      setDeletingRequestId(null);
    }
  };

  const openRemoveRequest = (
    requestId: number,
    title: string,
    service: string
  ) => {
    const item = data?.results.find(
      (result) => result.request.id === requestId
    );
    const mediaId = item?.request.media?.id;

    if (!item || !mediaId) {
      addToast(intl.formatMessage(messages.removeFailed), {
        appearance: 'error',
        autoDismiss: true,
      });
      return;
    }

    setRemoveSelection({
      requestId,
      mediaId,
      title,
      service,
      is4k: item.request.is4k,
      format:
        item.request.type === 'book'
          ? getRequestedBookFormat(item.request.bookFormat)
          : undefined,
    });
  };

  const removeRequestFromLibrary = async () => {
    if (!removeSelection) return;

    const selection = removeSelection;
    setRemovingRequestId(selection.requestId);
    try {
      const params = new URLSearchParams({
        is4k: String(selection.is4k),
      });
      if (selection.format) {
        params.set('format', selection.format);
      }

      await axios.delete(
        `/api/v1/media/${selection.mediaId}/file?${params.toString()}`
      );
      addToast(intl.formatMessage(messages.removeSuccess), {
        appearance: 'success',
        autoDismiss: true,
      });
      setRemoveSelection(null);
      await mutate();
    } catch (error) {
      const detail = axios.isAxiosError(error)
        ? error.response?.data?.message
        : undefined;
      addToast(
        detail
          ? `${intl.formatMessage(messages.removeFailed)} ${detail}`
          : intl.formatMessage(messages.removeFailed),
        {
          appearance: 'error',
          autoDismiss: true,
        }
      );
    } finally {
      setRemovingRequestId(null);
    }
  };

  if (!data && !error) {
    return (
      <>
        <PageTitle title={intl.formatMessage(messages.title)} />
        <LoadingSpinner />
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageTitle title={intl.formatMessage(messages.title)} />
        <div
          className="mt-8 flex flex-col items-start gap-4 rounded-xl border border-red-500/50 bg-red-500/10 p-6 text-red-100 sm:flex-row sm:items-center sm:justify-between"
          role="alert"
        >
          <div>
            <p className="font-medium">
              {intl.formatMessage(messages.loadError)}
            </p>
            <p className="mt-1 text-sm text-red-100/80">
              {intl.formatMessage(messages.loadErrorHint)}
            </p>
          </div>
          <Button
            buttonType="warning"
            buttonSize="sm"
            disabled={isValidating}
            onClick={() => void mutate()}
          >
            <ArrowPathIcon
              className={`mr-1.5 h-4 w-4 ${isValidating ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            {intl.formatMessage(
              isValidating ? messages.refreshing : messages.retryLoad
            )}
          </Button>
        </div>
      </>
    );
  }

  const totalPages = Math.max(data.pageInfo.pages, 1);
  const sortOptions = getSortOptions(mediaFilter);
  const timeFrameOptions: CompactSelectOption[] = [
    { label: intl.formatMessage(messages.allTime), value: 'all' },
    { label: intl.formatMessage(messages.last7Days), value: '7d' },
    { label: intl.formatMessage(messages.last14Days), value: '14d' },
    { label: intl.formatMessage(messages.last30Days), value: '30d' },
    { label: intl.formatMessage(messages.last6Months), value: '6m' },
  ];
  const requestUserOptions: CompactSelectOption[] = [
    { label: intl.formatMessage(messages.allUsers), value: 'all' },
    ...userOptions.map((user) => ({
      label: user.displayName,
      value: String(user.id),
    })),
  ];
  const mediaFilters: {
    value: MediaFilter;
    label: keyof typeof messages;
  }[] = [
    { value: 'all', label: 'allMedia' },
    { value: 'movie', label: 'movies' },
    { value: 'tv', label: 'series' },
    { value: 'music', label: 'music' },
    { value: 'book', label: 'ebooks' },
    { value: 'audiobook', label: 'audiobooks' },
    { value: 'comic', label: 'comics' },
    { value: 'magazine', label: 'magazines' },
  ];
  const changePage = (nextPage: number) => {
    pushRouteQuery(routeQuery({ nextPage }));
  };
  const selectedTaskFilter =
    filter === 'processing'
      ? 'active'
      : [
            'all',
            'completed',
            'incomplete',
            'attention',
            'unavailable',
            'failed',
          ].includes(filter)
        ? filter
        : null;
  const hasFilters =
    searchFilter.trim() !== '' ||
    filter !== 'all' ||
    mediaFilter !== 'all' ||
    sort !== 'added' ||
    sortDirection !== 'desc' ||
    timeFrame !== 'all' ||
    (canViewOtherUsers && selectedUser !== 'all');
  const clearFilters = () => {
    setSearchFilter('');
    setFilter('all');
    setMediaFilter('all');
    setSort('added');
    setSortDirection('desc');
    setTimeFrame('all');
    setSelectedUser(canViewOtherUsers ? 'all' : null);
    pushRouteQuery({});
  };

  return (
    <>
      {deleteRequestId !== null && (
        <Transition
          as="div"
          enter="transition-opacity duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="transition-opacity duration-300"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
          show
        >
          <Modal
            title={intl.formatMessage(messages.deleteTitle)}
            okText={intl.formatMessage(messages.delete)}
            okButtonType="danger"
            loading={deletingRequestId !== null}
            onOk={() => void deleteRequest()}
            onCancel={() => setDeleteRequestId(null)}
            actionButtonSize="standard"
            dialogClass="request-modal-site-surface refreshed-detail-text !w-[calc(100%-2rem)] rounded-xl border border-gray-700 shadow-lg shadow-gray-950/20 sm:!max-w-lg"
          >
            <p className="refreshed-inset-surface rounded-lg border border-gray-700 p-3">
              {intl.formatMessage(messages.deleteDescription)}
            </p>
          </Modal>
        </Transition>
      )}
      {removeSelection && (
        <Transition
          as="div"
          enter="transition-opacity duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="transition-opacity duration-300"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
          show
        >
          <Modal
            title={intl.formatMessage(messages.removeTitle, {
              service: removeSelection.service,
            })}
            okText={intl.formatMessage(messages.remove)}
            okButtonType="danger"
            loading={removingRequestId !== null}
            onOk={() => void removeRequestFromLibrary()}
            onCancel={() => setRemoveSelection(null)}
            actionButtonSize="standard"
            dialogClass="request-modal-site-surface refreshed-detail-text !w-[calc(100%-2rem)] rounded-xl border border-gray-700 shadow-lg shadow-gray-950/20 sm:!max-w-lg"
          >
            <p className="refreshed-inset-surface rounded-lg border border-gray-700 p-3">
              {intl.formatMessage(messages.removeDescription, {
                title: removeSelection.title,
                service: removeSelection.service,
              })}
            </p>
          </Modal>
        </Transition>
      )}
      <PageTitle title={intl.formatMessage(messages.title)} />
      <div className="mt-8 flex items-center justify-between gap-4">
        <h2
          className="min-w-0 flex-1 truncate text-2xl leading-7 font-bold text-gray-100 sm:overflow-visible sm:text-4xl sm:leading-9"
          data-testid="page-header"
        >
          <span className="text-overseerr">
            {intl.formatMessage(messages.title)}
          </span>
        </h2>
        {isAdminView && canViewOtherUsers && (
          <CompactSelect
            label={intl.formatMessage(messages.userFilter)}
            value={String(selectedUser ?? currentUser?.id ?? 'all')}
            options={requestUserOptions}
            onChange={updateUser}
            className="flex-shrink-0 self-center"
            defaultValue="all"
          />
        )}
      </div>
      {error && (
        <div
          className="mb-5 flex flex-col items-start gap-3 rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-100 sm:flex-row sm:items-center sm:justify-between"
          role="status"
        >
          <span>{intl.formatMessage(messages.loadErrorHint)}</span>
          <Button
            buttonType="default"
            buttonSize="sm"
            disabled={isValidating}
            onClick={() => void mutate()}
          >
            {intl.formatMessage(
              isValidating ? messages.refreshing : messages.retryLoad
            )}
          </Button>
        </div>
      )}

      <section
        className="app-filter-section-gap mt-4"
        aria-label={intl.formatMessage(messages.taskFilters)}
      >
        <div className="mb-2 text-sm text-gray-300">
          {intl.formatMessage(messages.taskFilters)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={clearFilters}
            className={getFilterResetButtonClass(false)}
          >
            <NoSymbolIcon className="h-4 w-4" aria-hidden="true" />
            {intl.formatMessage(messages.clearFilters)}
          </button>
          {[
            {
              key: 'all',
              filter: 'all',
              label: messages.all,
              value: data.counts.total,
            },
            {
              key: 'completed',
              filter: 'completed',
              label: messages.completed,
              value: data.counts.completed,
            },
            {
              key: 'incomplete',
              filter: 'incomplete',
              label: messages.incomplete,
              value: data.counts.incomplete,
            },
            {
              key: 'active',
              filter: 'processing',
              label: messages.active,
              value: data.counts.active,
            },
            {
              key: 'attention',
              filter: 'attention',
              label: messages.attention,
              value: data.counts.attention,
            },
            {
              key: 'unavailable',
              filter: 'unavailable',
              label: messages.noReleaseFoundFilter,
              value: data.counts.unavailable,
            },
            {
              key: 'failed',
              filter: 'failed',
              label: messages.failed,
              value: data.counts.failed,
            },
          ].map((summary) => (
            <button
              key={summary.key}
              type="button"
              onClick={() => updateFilter(summary.filter)}
              className={getFilterToggleButtonClass(
                selectedTaskFilter === summary.key
              )}
            >
              <span>{intl.formatMessage(summary.label)}</span>
              <span className="rounded-full bg-gray-950/40 px-1.5 py-0.5 text-[10px] leading-none font-semibold text-gray-100">
                {summary.value}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section
        className="app-filter-section-gap"
        aria-label={intl.formatMessage(messages.mediaFilters)}
      >
        <div className="mb-2 text-sm text-gray-300">
          {intl.formatMessage(messages.mediaFilters)}
        </div>
        <div className="flex flex-wrap items-center gap-2 align-middle">
          {mediaFilters.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={mediaFilter === option.value}
              onClick={() => updateMediaFilter(option.value)}
              className={getFilterToggleButtonClass(
                mediaFilter === option.value
              )}
            >
              {intl.formatMessage(messages[option.label])}
            </button>
          ))}
        </div>
      </section>

      <section
        className="app-filter-section-gap"
        aria-label={intl.formatMessage(messages.filter)}
      >
        <div className="mb-2 text-sm text-gray-300">
          {intl.formatMessage(messages.filter)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CompactSelect
            label={intl.formatMessage(messages.timeFrame)}
            value={timeFrame}
            options={timeFrameOptions}
            onChange={(value) => updateTimeFrame(value as TimeFrame)}
          />
          <label className="discover-filter-control w-72 flex-none self-center">
            <span
              className={`discover-filter-control-label gap-1 ${
                searchFilter.trim()
                  ? 'discover-filter-control-label-active'
                  : ''
              }`}
            >
              <MagnifyingGlassIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {intl.formatMessage(messages.search)}
            </span>
            <input
              type="search"
              value={searchFilter}
              onChange={(event) => setSearchFilter(event.target.value)}
              placeholder={intl.formatMessage(messages.searchRequests)}
              aria-label={intl.formatMessage(messages.searchRequests)}
              className="min-w-0 flex-1 border-0 bg-transparent px-2 py-0 text-xs font-medium text-gray-200 placeholder:text-gray-500 focus:ring-0"
            />
          </label>
        </div>
        {(mediaFilter === 'book' || mediaFilter === 'audiobook') && (
          <div className="mt-2 flex items-center gap-2 text-xs text-gray-400">
            <span>{intl.formatMessage(messages.showingFormat)}</span>
            <BookFormatBadge
              format={mediaFilter === 'book' ? 'ebook' : 'audiobook'}
              variant="inline"
            />
          </div>
        )}
      </section>

      {timeFrame !== 'all' && data.olderCount > 0 && (
        <div className="mb-5 flex flex-col gap-3 rounded-lg border border-indigo-400/40 bg-indigo-500/10 p-3 text-sm text-indigo-100 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2">
            <ClockIcon
              className="mt-0.5 h-5 w-5 flex-shrink-0 text-indigo-300"
              aria-hidden="true"
            />
            <span>
              {intl.formatMessage(messages.olderRequests, {
                count: data.olderCount,
              })}
            </span>
          </div>
          <Button
            buttonType="default"
            buttonSize="sm"
            onClick={() => updateTimeFrame('all')}
          >
            {intl.formatMessage(messages.viewAllHistory)}
          </Button>
        </div>
      )}

      <section className="app-filter-section-gap">
        <div className="mb-2 text-sm text-gray-300">
          {intl.formatMessage(messages.sortBy)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sortOptions.map((option) => {
            const active = sort === option.value;
            const displayedDirection = active
              ? sortDirection
              : getDefaultSortDirection(option.value);
            const DirectionIcon =
              displayedDirection === 'asc'
                ? BarsArrowUpIcon
                : BarsArrowDownIcon;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                aria-label={`${intl.formatMessage(messages[option.label])} (${intl.formatMessage(active && sortDirection === 'asc' ? messages.sortAscending : messages.sortDescending)})`}
                onClick={() => updateSort(option.value)}
                className={getFilterToggleButtonClass(active)}
              >
                {intl.formatMessage(messages[option.label])}
                <DirectionIcon className="h-4 w-4" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </section>

      <div className="space-y-4">
        {data.results.map((item) => (
          <RequestStatusCard
            key={item.request.id}
            item={item}
            isAdminView={isAdminView}
            onRetry={retryRequest}
            isRetrying={retryingRequestId === item.request.id}
            onDelete={setDeleteRequestId}
            isDeleting={deletingRequestId === item.request.id}
            onRemove={openRemoveRequest}
            isRemoving={removingRequestId === item.request.id}
            isHistoryOpen={expandedRequestId === item.request.id}
            onToggleHistory={(requestId) =>
              setExpandedRequestId((currentId) =>
                currentId === requestId ? null : requestId
              )
            }
          />
        ))}
      </div>

      {data.results.length === 0 && (
        <div className="refreshed-card-surface flex min-h-12 flex-row flex-wrap items-center justify-center gap-2 rounded-xl border border-dashed border-gray-700 p-2 text-center">
          <span>{intl.formatMessage(messages.noResults)}</span>
          {hasFilters && (
            <Button buttonType="default" buttonSize="sm" onClick={clearFilters}>
              {intl.formatMessage(messages.clearFilters)}
            </Button>
          )}
        </div>
      )}

      <PaginationFooter
        page={page}
        pageSize={pageSize}
        totalPages={totalPages}
        onPageChange={changePage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          changePage(1);
        }}
      />
    </>
  );
};

export default RequestStatus;
