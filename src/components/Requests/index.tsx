import BookFormatBadge, {
  getBookFormatMessage,
  getRequestedBookFormat,
  type RequestedBookFormat,
} from '@app/components/Common/BookFormatBadge';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import { PageStatus } from '@app/components/Common/LoadingSpinner';
import MediaTypeBadge, {
  type MediaTypeBadgeType,
} from '@app/components/Common/MediaTypeBadge';
import PageTitle from '@app/components/Common/PageTitle';
import PaginationFooter from '@app/components/Common/PaginationFooter';
import Tooltip from '@app/components/Common/Tooltip';
import {
  CompactSelect,
  FilterResetButton,
  getFilterToggleButtonClass,
  type CompactSelectOption,
} from '@app/components/Discover/FilterPanel/CompactFilterSelect';
import MediaFilterOption from '@app/components/Discover/MediaFilterOption';
import { PinnedFilterSectionGroup } from '@app/components/Discover/PinnedFilterSection';
import { RequestListboxControl } from '@app/components/RequestModal/AdvancedRequester';
import SoftwareRequests from '@app/components/RequestStatus/SoftwareRequests';
import useDebouncedState from '@app/hooks/useDebouncedState';
import useMediaFilterPin from '@app/hooks/useMediaFilterPin';
import useRequestStatusScrollRestoration from '@app/hooks/useRequestStatusScrollRestoration';
import { useSearchActivityReporter } from '@app/hooks/useSearchActivity';
import useSettings from '@app/hooks/useSettings';
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
import { hasLinkedWatchAheadAccount } from '@app/utils/watchAhead';
import { Transition } from '@headlessui/react';
import {
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
  PencilIcon,
  QueueListIcon,
  ServerIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { BarsArrowDownIcon, BarsArrowUpIcon } from '@heroicons/react/24/solid';
import { MediaRequestStatus } from '@server/constants/media';
import type {
  RequestStatusDetailResponse,
  RequestStatusResultsResponse,
  RequestStatusUsersResponse,
} from '@server/interfaces/api/requestInterfaces';
import type { ServiceCommonServer } from '@server/interfaces/api/serviceInterfaces';
import type { RequestStatusSortField } from '@server/lib/requestStatusSort';
import type { BookDetails } from '@server/models/Book';
import type { ComicDetails } from '@server/models/Comic';
import type { MagazineDetails } from '@server/models/Magazine';
import type { MovieDetails } from '@server/models/Movie';
import type { MusicDetails } from '@server/models/Music';
import type { SportarrDetails } from '@server/models/Sportarr';
import type { TvDetails } from '@server/models/Tv';
import axios from 'axios';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { FormattedDate, useIntl } from 'react-intl';
import useSWR, { useSWRConfig } from 'swr';
import {
  canLoadRequestStatus,
  resolveRequestStatusUserSelection,
  type RequestStatusUserSelection,
} from './requestStatusQuery';

import {
  deleteLibraryMedia,
  deleteRequestStatus,
  RequestActionButton,
  RequestActionConfirmation,
  requestActionMessageText,
} from './destructiveActions';

const RequestModal = dynamic(() => import('@app/components/RequestModal'), {
  ssr: false,
});

const messages = defineMessages('components.Requests', {
  title: 'Requests',
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
  processing: 'Processing',
  deleted: 'Deleted',
  requested: 'Requested',
  approved: 'Approved',
  searching: 'Searching',
  downloading: 'Downloading',
  importing: 'Importing',
  library: 'Adding to Library',
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
  sports: 'Sports',
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
  sport: 'Sport',
  country: 'Country',
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
  viewAllHistoryTooltip:
    'Remove the time-period filter to include older requests. Other filters remain unchanged.',
  filter: 'Filters',
  mediaFilters: 'Media Filters',
  allMedia: 'All Media',
  movies: 'Movies',
  music: 'Music',
  ebooks: 'Books',
  audiobooks: 'Audiobooks',
  comics: 'Comics',
  magazines: 'Magazines',
  sportsLeagues: 'Sports',
  romsRetro: 'ROMs - Retro',
  romsModern: 'ROMs - Modern',
  pcGames: 'PC Games',
  mediaAndFormat: 'Media & Format',
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
  pendingImportTitle: 'ChaptarrNG is preparing this {format}.',
  pendingImportAttempt: 'Import attempt {attempt} of {maxAttempts}.',
  pendingImportRetrying:
    'Import attempt {attempt}; retries will continue automatically.',
  pendingImportNextRetry: 'Next retry: {time}.',
  history: 'History',
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
  watchAheadLabel: 'Episode Queue',
  watchAheadDescription:
    'This optional queue is Off by default for every TV request. If you turn it on, SeerrNG follows your linked Plex, Jellyfin, or Emby playback and keeps this many upcoming episodes requested in Sonarr after approval. On a new request, choose one starting episode; enabling the queue on an existing request preserves its current selections. Episodes use the parent approval and do not count against your request quota. Turning it off stops future additions but does not cancel episodes already requested.',
  watchAheadOff: 'Off',
  watchAheadOption: '{count, plural, one {# episode} other {# episodes}}',
  watchAheadUpdated: 'Requested episode queue updated.',
  watchAheadFailed: 'Unable to update the requested episode queue.',
  watchAheadEpisodeBadge: 'Auto-Queued',
  watchAheadEpisodeBadgeTooltip:
    'Automatically requested by the Episode Queue as playback progressed.',
  retryFailed: 'Unable to retry this request.',
  retrySuccess: 'Request queued for another attempt.',
  ...requestActionMessageText,
  loading: 'Loading Request Status',
  refresh: 'Refresh',
  refreshing: 'Refreshing…',
  loadError: 'Request Status Could Not Be Loaded',
  loadErrorHint: 'The request service did not respond, please try again.',
  retryLoad: 'Retry',
  retryLoadTooltip:
    'Reload request information from Seerr. This does not restart or download any media.',
  noResults: 'No requests match these filters',
  filteredEmptyTitle: 'Filters Too Restrictive',
  emptyTitle: 'No Requests Found',
  noMediaResults:
    'No movie, show, music, book, comic, or magazine requests match these filters.',
  clearFilters: 'Clear Filters',
  scrollProgressLeft: 'Scroll progress left',
  requestLifecycle: 'Request Lifecycle',
  scrollProgressRight: 'Scroll progress right',
  loadingTitle: 'Loading Title…',
  unknownTitle: 'Unknown Title',
  downloadCopy: 'Download copy',
  downloadCopies: 'Download copies',
  downloadCopyFor: 'Download {name}',
});

type MediaDetails =
  | MovieDetails
  | TvDetails
  | MusicDetails
  | BookDetails
  | ComicDetails
  | MagazineDetails
  | SportarrDetails;
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
  | 'magazine'
  | 'sports'
  | 'retro'
  | 'modern'
  | 'game';
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
  'sports',
  'retro',
  'modern',
  'game',
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

const requestStatusTone: Record<StatusStage, string> = {
  requested: 'request-status-control-pending',
  approved: 'request-status-control-warning',
  searching: 'request-status-control-warning',
  downloading: 'request-status-control-warning',
  importing: 'request-status-control-warning',
  library: 'request-status-control-warning',
  available: 'request-status-control-success',
  unavailable: 'request-status-control-danger',
  failed: 'request-status-control-danger',
  declined: 'request-status-control-danger',
  cancelled: 'request-status-control-danger',
};

const requestStatusMessageKey: Record<StatusStage, keyof typeof messages> = {
  requested: 'pending',
  approved: 'processing',
  searching: 'processing',
  downloading: 'processing',
  importing: 'processing',
  library: 'processing',
  available: 'available',
  unavailable: 'failed',
  failed: 'failed',
  declined: 'declined',
  cancelled: 'cancelled',
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

const isSports = (details: MediaDetails): details is SportarrDetails =>
  (details as SportarrDetails).mediaType === 'sports';

const getBookId = (item: RequestStatusItem): string | undefined =>
  item.request.media.identifiers?.find(
    (identifier) =>
      identifier.provider === 'openlibrary' ||
      identifier.provider === 'bookshelf'
  )?.value;

const normalizeBookRouteId = (bookId: string): string =>
  bookId.startsWith('bookshelf:') ? bookId : normalizeOpenLibraryWorkId(bookId);

const getComicId = (item: RequestStatusItem): string | undefined =>
  item.request.media.identifiers?.find(
    (identifier) => identifier.provider === 'comicvine'
  )?.value;

const getMagazineId = (item: RequestStatusItem): string | undefined =>
  item.request.media.externalServiceSlug ??
  item.request.media.identifiers?.find(
    (identifier) => identifier.provider === 'lazylibrarian'
  )?.value;

const getSportarrId = (item: RequestStatusItem): string | undefined =>
  item.request.media.identifiers?.find(
    (identifier) => identifier.provider === 'sportarr'
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
  if (request.type === 'sports') {
    const sportarrId = getSportarrId(item);
    return sportarrId
      ? `/api/v1/sportarr/${encodeApiPathSegment(sportarrId)}`
      : null;
  }
  const bookId = getBookId(item);
  return bookId
    ? `/api/v1/book/${encodeApiPathSegment(normalizeBookRouteId(bookId))}`
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
  if (request.type === 'sports') {
    const sportarrId = getSportarrId(item);
    return sportarrId ? `/sportarr/${encodeApiPathSegment(sportarrId)}` : null;
  }
  const bookId = getBookId(item);
  const bookFormat = getRequestedBookFormat(item.request.bookFormat);
  return bookId
    ? `/book/${encodeApiPathSegment(normalizeBookRouteId(bookId))}?format=${bookFormat}`
    : null;
};

const getTitle = (
  intl: ReturnType<typeof useIntl>,
  details: MediaDetails | undefined,
  item: RequestStatusItem,
  isLoading: boolean
): string => {
  if (details) {
    if (isMusic(details) || isBook(details)) {
      return details.title;
    }
    return 'title' in details ? details.title : details.name;
  }
  if (isLoading) {
    return intl.formatMessage(messages.loadingTitle);
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
  if (item.request.type === 'sports') {
    return getSportarrId(item) ?? intl.formatMessage(messages.unknownTitle);
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
  if (isSports(details)) return undefined;
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
  if (item.request.type === 'sports')
    return intl.formatMessage(messages.sports);
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
  if (item.request.type === 'sports') return 'sports';
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
  if (item.request.type === 'sports') {
    return intl.formatMessage(messages.sports);
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
  if (item.request.type === 'sports') {
    const year = (details as SportarrDetails).year;
    return year ? String(year) : undefined;
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
  if (item.request.type === 'sports') {
    return (details as SportarrDetails).country ?? notAvailable;
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
        : item.request.type === 'sports'
          ? messages.country
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
    if (item.request.type === 'sports') {
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

  if (item.request.type === 'sports') {
    const league = details as SportarrDetails;
    return league.sport
      ? [{ label: intl.formatMessage(messages.sport), name: league.sport }]
      : [];
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
  if (item.request.type === 'sports') {
    const sport = (details as SportarrDetails).sport;
    return sport
      ? [
          {
            name: sport,
            href: `/discover/sports?query=${encodeURIComponent(sport)}`,
          },
        ]
      : [];
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

interface RequestDownloadAsset {
  id: string;
  name: string;
  size?: number;
}

const RequestDownloadAction = ({
  requestId,
  enabled,
}: {
  requestId: number;
  enabled: boolean;
}) => {
  const intl = useIntl();
  const { data } = useSWR<{ results: RequestDownloadAsset[] }>(
    enabled ? `/api/v1/request/status/${requestId}/downloads` : null,
    { revalidateOnFocus: false }
  );
  const assets = data?.results ?? [];
  if (assets.length === 0) return null;

  const downloadHref = (asset: RequestDownloadAsset) =>
    `/api/v1/request/status/${requestId}/downloads/${asset.id}`;
  const buttonClassName = 'app-button app-button-primary button-sm';

  if (assets.length === 1) {
    const asset = assets[0];
    return (
      <a
        href={downloadHref(asset)}
        download
        className={buttonClassName}
        aria-label={intl.formatMessage(messages.downloadCopyFor, {
          name: asset.name,
        })}
        title={asset.name}
      >
        <ArrowDownTrayIcon className="app-action-icon" aria-hidden="true" />
        {intl.formatMessage(messages.downloadCopy)}
      </a>
    );
  }

  return (
    <details>
      <summary className={buttonClassName}>
        <ArrowDownTrayIcon className="app-action-icon" aria-hidden="true" />
        {intl.formatMessage(messages.downloadCopies)}
        <ChevronDownIcon
          className="app-disclosure-chevron"
          aria-hidden="true"
        />
      </summary>
      <ol className="app-dropdown-menu app-download-menu">
        {assets.map((asset) => (
          <li key={asset.id}>
            <a
              href={downloadHref(asset)}
              download
              className="app-dropdown-item app-download-item"
              title={asset.name}
              aria-label={intl.formatMessage(messages.downloadCopyFor, {
                name: asset.name,
              })}
            >
              {asset.name}
            </a>
          </li>
        ))}
      </ol>
    </details>
  );
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
  const { currentSettings } = useSettings();
  const { data: sonarrServers } = useSWR<ServiceCommonServer[]>(
    '/api/v1/service/sonarr'
  );
  const { mutate: mutateCache } = useSWRConfig();
  const [watchAheadEpisodeCount, setWatchAheadEpisodeCount] = useState(
    item.request.watchAheadEpisodeCount ?? 0
  );
  const [isUpdatingWatchAhead, setIsUpdatingWatchAhead] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [isModifying, setIsModifying] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [timelineHasOverflow, setTimelineHasOverflow] = useState(false);
  const detailsUrl = getDetailsUrl(item);
  const detailHref = getDetailHref(item);
  const { data: details, error: detailsError } =
    useSWR<MediaDetails>(detailsUrl);
  const { data: detail, mutate: revalidateDetail } =
    useSWR<RequestStatusDetailResponse>(
      `/api/v1/request/status/${item.request.id}`,
      {
        refreshInterval: 15000,
        revalidateOnFocus: true,
      }
    );
  const reportedCurrent = detail?.current ?? item.status;
  const matchingSonarr =
    item.request.serverId != null
      ? sonarrServers?.find(
          (server) =>
            server.id === item.request.serverId &&
            server.is4k === item.request.is4k
        )
      : sonarrServers?.find(
          (server) => server.isDefault && server.is4k === item.request.is4k
        );
  const canEnableWatchAhead =
    hasLinkedWatchAheadAccount(user, currentSettings.mediaServerType) &&
    Number.isSafeInteger(Number(item.request.media.tvdbId)) &&
    Number(item.request.media.tvdbId) > 0 &&
    Boolean(matchingSonarr) &&
    hasPermission(
      item.request.is4k
        ? [Permission.REQUEST_4K, Permission.REQUEST_4K_TV]
        : [Permission.REQUEST, Permission.REQUEST_TV],
      { type: 'or' }
    );
  useEffect(() => {
    setWatchAheadEpisodeCount(item.request.watchAheadEpisodeCount ?? 0);
  }, [item.request.id, item.request.watchAheadEpisodeCount]);
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
  const title = getTitle(
    intl,
    details,
    item,
    Boolean(detailsUrl && !detailsError)
  );
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
  const canManageWatchAhead =
    item.request.type === 'tv' &&
    !item.request.watchAheadParentRequestId &&
    item.request.requestedBy.id === user?.id &&
    (canEnableWatchAhead || watchAheadEpisodeCount > 0);
  const posterBadge = bookFormat ? (
    <BookFormatBadge format={bookFormat} variant="card" />
  ) : (
    <MediaTypeBadge mediaType={mediaBadgeType} variant="card" />
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
  const updateWatchAhead = async (episodeCount: number) => {
    setIsUpdatingWatchAhead(true);
    try {
      await axios.put(`/api/v1/request/${item.request.id}/watch-ahead`, {
        episodeCount,
      });
      setWatchAheadEpisodeCount(episodeCount);
      await refreshRequestStatus();
      addToast(intl.formatMessage(messages.watchAheadUpdated), {
        appearance: 'success',
        autoDismiss: true,
      });
    } catch {
      addToast(intl.formatMessage(messages.watchAheadFailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsUpdatingWatchAhead(false);
    }
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
  const watchAheadOptions = [
    {
      value: 0,
      label: intl.formatMessage(messages.watchAheadOff),
    },
    ...(canEnableWatchAhead
      ? [1, 2, 3, 4, 5].map((count) => ({
          value: count,
          label: intl.formatMessage(messages.watchAheadOption, { count }),
        }))
      : watchAheadEpisodeCount > 0
        ? [
            {
              value: watchAheadEpisodeCount,
              label: intl.formatMessage(messages.watchAheadOption, {
                count: watchAheadEpisodeCount,
              }),
            },
          ]
        : []),
  ];
  const episodeQueueControl = canManageWatchAhead ? (
    <Tooltip content={intl.formatMessage(messages.watchAheadDescription)}>
      <span>
        <RequestListboxControl
          id={`watch-ahead-${item.request.id}`}
          label={
            <>
              <QueueListIcon
                className="request-status-control-icon"
                aria-hidden="true"
              />
              {intl.formatMessage(messages.watchAheadLabel)}
            </>
          }
          value={watchAheadEpisodeCount}
          options={watchAheadOptions}
          disabled={isUpdatingWatchAhead}
          onChange={(episodeCount) => void updateWatchAhead(episodeCount)}
          loadingLabel={intl.formatMessage(messages.watchAheadOff)}
        />
      </span>
    </Tooltip>
  ) : null;
  const actionControls = (
    <>
      {item.request.watchAheadParentRequestId && (
        <Tooltip
          content={intl.formatMessage(messages.watchAheadEpisodeBadgeTooltip)}
        >
          <span className="request-status-control request-status-control-success">
            {intl.formatMessage(messages.watchAheadEpisodeBadge)}
          </span>
        </Tooltip>
      )}
      {canModeratePending && (
        <>
          <Tooltip content={intl.formatMessage(messages.approveTooltip)}>
            <Button
              type="button"
              buttonType="success"
              buttonSize="sm"
              disabled={isModifying}
              onClick={() => void modifyPendingRequest('approve')}
            >
              <CheckIcon className="app-action-icon" aria-hidden="true" />
              {intl.formatMessage(messages.approve)}
            </Button>
          </Tooltip>
          <Tooltip content={intl.formatMessage(messages.declineTooltip)}>
            <Button
              type="button"
              buttonType="danger"
              buttonSize="sm"
              disabled={isModifying}
              onClick={() => void modifyPendingRequest('decline')}
            >
              <XMarkIcon className="app-action-icon" aria-hidden="true" />
              {intl.formatMessage(messages.decline)}
            </Button>
          </Tooltip>
          <Tooltip content={intl.formatMessage(messages.editTooltip)}>
            <Button
              type="button"
              buttonType="warning"
              buttonSize="sm"
              disabled={isModifying}
              onClick={() => setShowEditModal(true)}
            >
              <PencilIcon className="app-action-icon" aria-hidden="true" />
              {intl.formatMessage(messages.edit)}
            </Button>
          </Tooltip>
        </>
      )}
      <Tooltip content={intl.formatMessage(messages.retryTooltip)}>
        <Button
          type="button"
          buttonType="warning"
          buttonSize="sm"
          disabled={!canRetry || isRetrying || isDeleting || isRemoving}
          buttonIcon="retry"
          aria-busy={isRetrying}
          onClick={() => void onRetry(item.request.id)}
        >
          {intl.formatMessage(messages.retry)}
        </Button>
      </Tooltip>
      {canShowDelete && (
        <RequestActionButton
          action="delete"
          busy={isDeleting}
          disabled={isDeleting || isRetrying || isRemoving}
          onClick={() => onDelete(item.request.id)}
        />
      )}
      {canShowRemove && (
        <RequestActionButton
          action="remove"
          busy={isRemoving}
          unavailable={!canRemove}
          disabled={!canRemove || isRemoving || isRetrying || isDeleting}
          onClick={() =>
            onRemove(
              item.request.id,
              displayTitle,
              getDisplayServiceName(current.service) ?? 'library service'
            )
          }
        />
      )}
    </>
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
            item.request.type === 'magazine' ||
            item.request.type === 'sports'
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
          sportarrLeagueId={
            item.request.type === 'sports' ? getSportarrId(item) : undefined
          }
          sportarrTitle={
            item.request.type === 'sports' && details && isSports(details)
              ? details.title
              : undefined
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
        className="media-detail-card app-card-main refreshed-card-surface"
        data-testid={`request-status-${item.request.id}`}
      >
        {backdrop && (
          <div className="media-detail-artwork-layer">
            <CachedImage
              type={backdrop.type}
              src={backdrop.src}
              alt=""
              fill
              sizes="100vw"
              className="media-detail-artwork-image"
            />
            <div className="refreshed-artwork-scrim" />
            <div className="refreshed-artwork-gradient" />
          </div>
        )}
        <div className="app-card-inset refreshed-inset-surface detail-summary-card app-detail-summary-grid">
          <div>
            {detailHref ? (
              <Link
                href={detailHref}
                aria-label={displayTitle}
                className="detail-card-poster app-detail-poster-link"
              >
                <CachedImage
                  src={poster.src}
                  type={poster.type}
                  alt=""
                  fill
                  sizes="(min-width: 640px) 80px, 64px"
                  className="media-detail-artwork-image"
                />
                <span>{posterBadge}</span>
              </Link>
            ) : (
              <div className="detail-card-poster app-detail-poster-frame">
                <CachedImage
                  src={poster.src}
                  type={poster.type}
                  alt=""
                  fill
                  sizes="(min-width: 640px) 80px, 64px"
                  className="media-detail-artwork-image"
                />
                <span>{posterBadge}</span>
              </div>
            )}
          </div>

          <div>
            {detailHref ? (
              <Link
                href={detailHref}
                className="detail-summary-title app-detail-title-link"
              >
                {displayTitle}
              </Link>
            ) : (
              <h3 className="detail-summary-title app-detail-title">
                {displayTitle}
              </h3>
            )}

            <div className="detail-card-heading-spacing detail-three-column-grid">
              <div className="detail-paired-column-span">
                <dl className="card-table detail-paired-columns">
                  <dt className="card-table-heading">
                    {intl.formatMessage(messages.mediaAndFormat)}:
                  </dt>
                  <dd className="card-table-value">
                    {getMediaBadge(intl, item)} · {getMediaFormat(intl, item)}
                  </dd>
                  <dt className="card-table-heading">
                    {getReleaseDateLabel(intl, item)}:
                  </dt>
                  <dd className="card-table-value">{displayReleaseDate}</dd>
                  <dt className="card-table-heading">
                    {getRuntimeLabel(intl, item)}:
                  </dt>
                  <dd className="card-table-value">
                    {getRuntimeOrPages(intl, details, item)}
                  </dd>

                  <div className="card-table media-detail-column-divider">
                    {[...featuredCredits, ...secondaryDetails].map(
                      (credit, index) => (
                        <Fragment key={`${credit.label}-${index}`}>
                          <dt className="card-table-heading">
                            {credit.label}:
                          </dt>
                          <dd className="card-table-value">
                            {credit.href ? (
                              <Link
                                href={credit.href}
                                className="app-detail-link"
                              >
                                {credit.name}
                              </Link>
                            ) : (
                              credit.name
                            )}
                          </dd>
                        </Fragment>
                      )
                    )}
                  </div>

                  <dt className="card-table-heading">
                    {intl.formatMessage(messages.genres)}:
                  </dt>
                  {genres.length > 0 ? (
                    <dd
                      className="card-table-value"
                      data-wrap="true"
                      data-lines="2"
                    >
                      {genres.map((genre, index) => (
                        <span key={`${genre.href}-${genre.name}`}>
                          {index > 0 && ', '}
                          <Link href={genre.href} className="app-detail-link">
                            {genre.name}
                          </Link>
                        </span>
                      ))}
                    </dd>
                  ) : (
                    <dd className="card-table-value">{notAvailable}</dd>
                  )}
                </dl>
              </div>

              <dl className="card-table media-detail-column-divider">
                <dt className="card-table-heading">
                  {intl.formatMessage(messages.requestedByLabel)}:
                </dt>
                <dd className="card-table-value">
                  <Link
                    href={`/users/${item.request.requestedBy.id}`}
                    className="app-detail-link"
                  >
                    {item.request.requestedBy.displayName}
                  </Link>
                </dd>
                <dt className="card-table-heading">
                  {intl.formatMessage(messages.requestedDateTime)}:
                </dt>
                <dd className="card-table-value">
                  {createdAt ? (
                    <FormattedDate value={createdAt} dateStyle="medium" />
                  ) : (
                    notAvailable
                  )}
                </dd>
                <dt aria-hidden="true" />
                <dd className="card-table-value">
                  {createdAt ? (
                    <FormattedDate value={createdAt} timeStyle="short" />
                  ) : (
                    notAvailable
                  )}
                </dd>
                <dt className="card-table-heading">
                  {intl.formatMessage(messages.serviceLabel)}:
                </dt>
                <dd className="card-table-value">
                  {getDisplayServiceName(current.service) ?? notAvailable}
                </dd>
              </dl>
            </div>
          </div>
        </div>

        <div className="app-card-inset refreshed-inset-surface app-timeline-card card-spacing-before">
          {timelineHasOverflow && (
            <button
              type="button"
              onClick={() => scrollTimeline(-1)}
              className="app-button app-button-default app-timeline-scroll-control"
              data-direction="previous"
              aria-label={intl.formatMessage(messages.scrollProgressLeft)}
            >
              <ChevronLeftIcon
                className="app-navigation-icon"
                aria-hidden="true"
              />
            </button>
          )}
          <div
            ref={timelineRef}
            className="hide-scrollbar app-timeline-scroll"
            aria-label={intl.formatMessage(messages.requestLifecycle)}
          >
            <div className="app-timeline-track">
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
                  <div key={stage} className="app-timeline-stage">
                    {index < timelineStages.length - 1 && (
                      <span
                        className={`app-timeline-connector ${
                          !terminalWithoutProgress && index < activeIndex
                            ? 'app-timeline-connector-complete'
                            : ''
                        }`}
                        aria-hidden="true"
                      />
                    )}
                    <span
                      className={`app-timeline-dot ${
                        isCurrent
                          ? 'app-timeline-dot-current'
                          : isComplete
                            ? 'app-timeline-dot-complete'
                            : 'app-timeline-dot-idle'
                      }`}
                    >
                      {isComplete ? (
                        <CheckIcon
                          className="app-timeline-dot-icon"
                          strokeWidth={3}
                          aria-hidden="true"
                        />
                      ) : isCurrent ? (
                        <StageIcon
                          className="app-timeline-dot-icon"
                          aria-hidden="true"
                        />
                      ) : null}
                    </span>
                    <span
                      className={`app-timeline-label ${
                        isCurrent
                          ? 'app-timeline-label-active'
                          : 'app-timeline-label-idle'
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
              className="app-button app-button-default app-timeline-scroll-control"
              data-direction="next"
              aria-label={intl.formatMessage(messages.scrollProgressRight)}
            >
              <ChevronRightIcon
                className="app-navigation-icon"
                aria-hidden="true"
              />
            </button>
          )}
        </div>

        {current.stage === 'downloading' && current.percent !== null && (
          <div className="app-card-inset refreshed-inset-surface app-progress-card card-spacing-before">
            <div className="app-progress-header">
              <span className="app-progress-summary">
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
              className="app-progress-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={current.percent}
              aria-valuetext={`${current.percent}%`}
            >
              <div
                className="app-progress-fill"
                style={{
                  width: `${Math.min(100, Math.max(0, current.percent))}%`,
                }}
              />
            </div>
          </div>
        )}

        {current.bookImportProgresses?.length ? (
          <div
            className="refreshed-detail-text-muted"
            role="status"
            aria-live="polite"
          >
            {current.bookImportProgresses.map((progress) => {
              const format =
                progress.format === 'audiobook' ? 'audiobook' : 'ebook';
              const nextAttemptAt = getValidDate(progress.nextAttemptAt);
              return (
                <div key={progress.format}>
                  <span>
                    {intl.formatMessage(messages.pendingImportTitle, {
                      format,
                    })}
                  </span>
                  {typeof progress.attemptCount === 'number' &&
                    progress.attemptCount > 0 &&
                    (progress.maxAttempts && progress.maxAttempts > 0 ? (
                      <span>
                        {' '}
                        {intl.formatMessage(messages.pendingImportAttempt, {
                          attempt: progress.attemptCount,
                          maxAttempts: progress.maxAttempts,
                        })}
                      </span>
                    ) : (
                      <span>
                        {' '}
                        {intl.formatMessage(messages.pendingImportRetrying, {
                          attempt: progress.attemptCount,
                        })}
                      </span>
                    ))}
                  {nextAttemptAt && (
                    <span>
                      {' '}
                      {intl.formatMessage(messages.pendingImportNextRetry, {
                        time: intl.formatDate(nextAttemptAt, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }),
                      })}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="app-action-row request-status-action-row">
          <Tooltip content={current.message}>
            <span
              className={`request-status-control ${requestStatusTone[currentStage] ?? requestStatusTone.cancelled}`}
              aria-label={`${getStageLabel(intl, currentStage)}: ${current.message}`}
              tabIndex={0}
            >
              <StageIcon className="request-status-control-icon" aria-hidden />
              {intl.formatMessage(
                messages[
                  requestStatusMessageKey[currentStage] ??
                    requestStatusMessageKey.cancelled
                ]
              )}
            </span>
          </Tooltip>
          <Button
            type="button"
            buttonType="manage"
            buttonSize="sm"
            aria-expanded={isHistoryOpen}
            aria-label={intl.formatMessage(messages.history)}
            onClick={() => onToggleHistory(item.request.id)}
          >
            <ClockIcon className="app-action-icon" aria-hidden="true" />
            {intl.formatMessage(messages.history)}
            <ChevronDownIcon
              className="app-disclosure-chevron"
              aria-hidden="true"
            />
          </Button>
          {actionControls}
          <RequestDownloadAction
            requestId={item.request.id}
            enabled={currentStage === 'available'}
          />
          {episodeQueueControl}
        </div>

        {isHistoryOpen && (
          <section className="app-card-inset refreshed-inset-surface app-history-card card-spacing-before">
            <h4 className="app-history-title">
              {intl.formatMessage(messages.history)}
            </h4>
            {chronologicalHistory.length === 0 ? (
              <p className="refreshed-detail-text-muted app-history-empty">
                {intl.formatMessage(messages.noHistory)}
              </p>
            ) : (
              <ol className="card-table app-history-grid">
                {chronologicalHistory.map((event) => {
                  const eventDate = getValidDate(event.createdAt);
                  if (!eventDate) {
                    return null;
                  }

                  return (
                    <li key={event.id} className="app-history-row">
                      <time
                        className="refreshed-detail-text-muted app-history-time"
                        dateTime={eventDate.toISOString()}
                      >
                        <FormattedDate value={eventDate} dateStyle="medium" />
                      </time>
                      <time
                        className="refreshed-detail-text-muted app-history-time"
                        dateTime={eventDate.toISOString()}
                      >
                        <FormattedDate value={eventDate} timeStyle="short" />
                      </time>
                      <span className="app-history-action">
                        {getStageLabel(intl, event.stage as StatusStage)}
                      </span>
                      <span className="refreshed-detail-text app-history-description">
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

const Requests = () => {
  const intl = useIntl();
  const router = useRouter();
  const { cache: requestCache, mutate: prefetchRequestCache } = useSWRConfig();
  const prefetchedDetails = useRef(new Set<string>());
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
  const rawFocusedRequestId = Array.isArray(router.query.requestId)
    ? router.query.requestId[0]
    : router.query.requestId;
  const rawFocusedSoftwareRequestId = Array.isArray(
    router.query.softwareRequestId
  )
    ? router.query.softwareRequestId[0]
    : router.query.softwareRequestId;
  const focusedRequestId =
    rawFocusedRequestId && /^\d+$/.test(rawFocusedRequestId)
      ? Number(rawFocusedRequestId)
      : undefined;
  const focusedSoftwareRequestId =
    rawFocusedSoftwareRequestId && /^\d+$/.test(rawFocusedSoftwareRequestId)
      ? Number(rawFocusedSoftwareRequestId)
      : undefined;
  useEffect(() => {
    if (
      ![focusedRequestId, focusedSoftwareRequestId].some(
        (requestId) => Number.isSafeInteger(requestId) && (requestId ?? 0) > 0
      )
    ) {
      return;
    }

    setFilter('all');
    setMediaFilter('all');
    setSort('added');
    setSortDirection('desc');
    setTimeFrame('all');
    setSearchFilter('');
    if (canViewOtherUsers) setSelectedUser('all');
  }, [
    canViewOtherUsers,
    focusedRequestId,
    focusedSoftwareRequestId,
    setSearchFilter,
  ]);
  const page = Math.max(Number(router.query.page) || 1, 1);
  const softwareCategory = ['retro', 'modern', 'game'].includes(mediaFilter)
    ? (mediaFilter as 'retro' | 'modern' | 'game')
    : undefined;
  const apiMediaType =
    softwareCategory !== undefined
      ? 'all'
      : mediaFilter === 'book' || mediaFilter === 'audiobook'
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

    const isFocusedRequest =
      Number.isSafeInteger(focusedRequestId) && (focusedRequestId ?? 0) > 0;
    const params = new URLSearchParams(
      isFocusedRequest
        ? {
            take: '1',
            skip: '0',
            requestId: String(focusedRequestId),
          }
        : {
            take: String(pageSize),
            skip: String((page - 1) * pageSize),
            filter,
            mediaType: apiMediaType,
            sort,
            sortDirection,
            timeFrame,
          }
    );
    if (!isFocusedRequest) {
      if (bookFormat) {
        params.set('bookFormat', bookFormat);
      }
      if (selectedOwnerId !== undefined) {
        params.set('requestedBy', String(selectedOwnerId));
      }
      if (debouncedSearchFilter.trim()) {
        params.set('search', debouncedSearchFilter.trim());
      }
    }
    return `/api/v1/request/status?${params.toString()}`;
  }, [
    apiMediaType,
    bookFormat,
    canViewOtherUsers,
    currentUser,
    debouncedSearchFilter,
    focusedRequestId,
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
  const nextQuery = useMemo(() => {
    if (!query || !data || page >= data.pageInfo.pages) return null;

    const params = new URLSearchParams(query.split('?')[1]);
    params.set('skip', String(page * pageSize));
    return `/api/v1/request/status?${params.toString()}`;
  }, [data, page, pageSize, query]);
  const { data: nextPageData } = useSWR<RequestStatusResultsResponse>(
    nextQuery,
    {
      keepPreviousData: false,
      revalidateIfStale: false,
      revalidateOnFocus: false,
    }
  );

  useEffect(() => {
    if (!nextPageData) return;

    for (const item of nextPageData.results) {
      const detailsUrl = getDetailsUrl(item);
      if (
        !detailsUrl ||
        requestCache.get(detailsUrl)?.data ||
        prefetchedDetails.current.has(detailsUrl)
      ) {
        continue;
      }
      prefetchedDetails.current.add(detailsUrl);
      void prefetchRequestCache(
        detailsUrl,
        axios.get<MediaDetails>(detailsUrl).then((response) => response.data),
        { revalidate: false, throwOnError: false }
      );
    }
  }, [nextPageData, prefetchRequestCache, requestCache]);
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

  const mediaPin = useMediaFilterPin<MediaFilter>({
    scope: 'requests',
    selected: mediaFilter,
    values: mediaTypeValues,
    ready: router.isReady,
    explicit: Boolean(router.query.mediaType),
    restore: (value) => {
      void router.replace({
        pathname: router.pathname,
        query: { ...router.query, mediaType: value, page: undefined },
      });
    },
  });

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
      await deleteRequestStatus(requestId);
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
      await deleteLibraryMedia(selection);
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

  const pageHeading = (
    <div className="page-title-row">
      <h2 className="page-title" data-testid="page-header">
        {intl.formatMessage(messages.title)}
      </h2>
      <PageStatus
        active={isValidating}
        label={intl.formatMessage(messages.loading)}
      />
    </div>
  );

  if (!data && !error) {
    return (
      <>
        <PageTitle title={intl.formatMessage(messages.title)} />
        {pageHeading}
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageTitle title={intl.formatMessage(messages.title)} />
        {pageHeading}
        <div className="page-error-message" role="alert">
          <div>
            <h3 className="card-title">
              {intl.formatMessage(messages.loadError)}
            </h3>
            <p className="page-error-message-detail">
              {intl.formatMessage(messages.loadErrorHint)}
            </p>
          </div>
          <Tooltip content={intl.formatMessage(messages.retryLoadTooltip)}>
            <Button
              buttonType="warning"
              buttonSize="sm"
              disabled={isValidating}
              aria-busy={isValidating}
              buttonIcon="retry"
              onClick={() => void mutate()}
            >
              {intl.formatMessage(messages.retryLoad)}
            </Button>
          </Tooltip>
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
    { value: 'sports', label: 'sportsLeagues' },
    { value: 'retro', label: 'romsRetro' },
    { value: 'modern', label: 'romsModern' },
    { value: 'game', label: 'pcGames' },
  ];
  const taskFilterOptions: {
    key: string;
    filter: string;
    label: keyof typeof messages;
    value: number;
  }[] = [
    {
      key: 'all',
      filter: 'all',
      label: 'all',
      value: data.counts.total,
    },
    {
      key: 'completed',
      filter: 'completed',
      label: 'completed',
      value: data.counts.completed,
    },
    {
      key: 'incomplete',
      filter: 'incomplete',
      label: 'incomplete',
      value: data.counts.incomplete,
    },
    {
      key: 'active',
      filter: 'processing',
      label: 'active',
      value: data.counts.active,
    },
    {
      key: 'attention',
      filter: 'attention',
      label: 'attention',
      value: data.counts.attention,
    },
    {
      key: 'unavailable',
      filter: 'unavailable',
      label: 'noReleaseFoundFilter',
      value: data.counts.unavailable,
    },
    {
      key: 'failed',
      filter: 'failed',
      label: 'failed',
      value: data.counts.failed,
    },
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

          show
        >
          <RequestActionConfirmation
            action="delete"
            busy={deletingRequestId !== null}
            onConfirm={() => void deleteRequest()}
            onCancel={() => setDeleteRequestId(null)}
          />
        </Transition>
      )}
      {removeSelection && (
        <Transition
          as="div"

          show
        >
          <RequestActionConfirmation
            action="remove"
            title={removeSelection.title}
            service={removeSelection.service}
            busy={removingRequestId !== null}
            onConfirm={() => void removeRequestFromLibrary()}
            onCancel={() => setRemoveSelection(null)}
          />
        </Transition>
      )}
      <PageTitle title={intl.formatMessage(messages.title)} />
      {pageHeading}
      {error && (
        <div className="page-error-message" data-severity="error" role="status">
          <div>
            <h3 className="card-title">
              {intl.formatMessage(messages.loadError)}
            </h3>
            <p className="page-error-message-detail">
              {intl.formatMessage(messages.loadErrorHint)}
            </p>
          </div>
          <Tooltip content={intl.formatMessage(messages.retryLoadTooltip)}>
            <Button
              buttonType="warning"
              buttonSize="sm"
              disabled={isValidating}
              aria-busy={isValidating}
              buttonIcon="retry"
              onClick={() => void mutate()}
            >
              {intl.formatMessage(messages.retryLoad)}
            </Button>
          </Tooltip>
        </div>
      )}

      <PinnedFilterSectionGroup
        mediaType={
          mediaFilter === 'tv'
            ? 'tv'
            : mediaFilter === 'music'
              ? 'music'
              : mediaFilter === 'book' || mediaFilter === 'audiobook'
                ? 'book'
                : mediaFilter === 'sports'
                  ? 'tv'
                  : 'movie'
        }
        sections={[
          {
            section: 'taskFilters',
            label: intl.formatMessage(messages.taskFilters),
            children: (
              <div className="app-filter-row">
                <FilterResetButton
                  label={intl.formatMessage(messages.clearFilters)}
                  selected={!hasFilters}
                  onClick={clearFilters}
                />
                {taskFilterOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => updateFilter(option.filter)}
                    className={getFilterToggleButtonClass(
                      selectedTaskFilter === option.key
                    )}
                  >
                    <span>{intl.formatMessage(messages[option.label])}</span>
                    <span className="app-filter-count">{option.value}</span>
                  </button>
                ))}
                {isAdminView && canViewOtherUsers && (
                  <CompactSelect
                    label={intl.formatMessage(messages.userFilter)}
                    value={String(selectedUser ?? currentUser?.id ?? 'all')}
                    options={requestUserOptions}
                    onChange={updateUser}
                    defaultValue="all"
                  />
                )}
              </div>
            ),
          },
          {
            section: 'mediaFilters',
            label: intl.formatMessage(messages.mediaFilters),
            children: (
              <div className="app-filter-row">
                {mediaFilters.map((option) => (
                  <MediaFilterOption
                    key={option.value}
                    pin={mediaPin}
                    value={option.value}
                    label={intl.formatMessage(messages[option.label])}
                    selected={mediaFilter === option.value}
                  >
                    <button
                      type="button"
                      aria-pressed={mediaFilter === option.value}
                      onClick={() => updateMediaFilter(option.value)}
                      className="app-control-shadow-exempt app-filter-segment-focus"
                    >
                      {intl.formatMessage(messages[option.label])}
                    </button>
                  </MediaFilterOption>
                ))}
              </div>
            ),
          },
          {
            section: 'filters',
            label: intl.formatMessage(messages.filter),
            children: (
              <>
                <div className="app-filter-row">
                  <CompactSelect
                    label={intl.formatMessage(messages.timeFrame)}
                    value={timeFrame}
                    options={timeFrameOptions}
                    onChange={(value) => updateTimeFrame(value as TimeFrame)}
                  />
                  <label className="discover-filter-control app-filter-search-control">
                    <span
                      className={`discover-filter-control-label ${
                        searchFilter.trim()
                          ? 'discover-filter-control-label-active'
                          : ''
                      }`}
                    >
                      <MagnifyingGlassIcon
                        className="app-action-icon"
                        aria-hidden="true"
                      />
                      {intl.formatMessage(messages.search)}
                    </span>
                    <input
                      type="search"
                      value={searchFilter}
                      onChange={(event) => setSearchFilter(event.target.value)}
                      placeholder={intl.formatMessage(messages.searchRequests)}
                      aria-label={intl.formatMessage(messages.searchRequests)}
                      className="app-filter-search-input"
                    />
                  </label>
                </div>
                {(mediaFilter === 'book' || mediaFilter === 'audiobook') && (
                  <div className="app-filter-context">
                    <span>{intl.formatMessage(messages.showingFormat)}</span>
                    <BookFormatBadge
                      format={mediaFilter === 'book' ? 'ebook' : 'audiobook'}
                      variant="inline"
                    />
                  </div>
                )}
              </>
            ),
          },
          {
            section: 'sortBy',
            label: intl.formatMessage(messages.sortBy),
            children: (
              <div className="app-filter-row">
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
                      <DirectionIcon
                        className="app-navigation-icon"
                        aria-hidden="true"
                      />
                    </button>
                  );
                })}
              </div>
            ),
          },
        ]}
      />

      {timeFrame !== 'all' && data.olderCount > 0 && (
        <div className="page-error-message" data-severity="info" role="status">
          <span>
            {intl.formatMessage(messages.olderRequests, {
              count: data.olderCount,
            })}
          </span>
          <Tooltip content={intl.formatMessage(messages.viewAllHistoryTooltip)}>
            <Button
              buttonType="default"
              buttonSize="sm"
              onClick={() => updateTimeFrame('all')}
            >
              <ClockIcon className="app-navigation-icon" aria-hidden="true" />
              {intl.formatMessage(messages.viewAllHistory)}
            </Button>
          </Tooltip>
        </div>
      )}

      <SoftwareRequests
        enabled={mediaFilter === 'all' || softwareCategory !== undefined}
        filter={filter}
        category={softwareCategory}
        requestedById={selectedOwnerId}
        softwareRequestId={focusedSoftwareRequestId}
      />

      {softwareCategory === undefined && (
        <div className="card-stack">
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
      )}

      {softwareCategory === undefined && data.results.length === 0 && (
        <div className="page-error-message" data-severity="empty" role="status">
          <div>
            <h3 className="card-title">
              {intl.formatMessage(
                hasFilters ? messages.filteredEmptyTitle : messages.emptyTitle
              )}
            </h3>
            <p className="page-error-message-detail">
              {intl.formatMessage(
                mediaFilter === 'all'
                  ? messages.noMediaResults
                  : messages.noResults
              )}
            </p>
          </div>
          {hasFilters && (
            <FilterResetButton
              label={intl.formatMessage(messages.clearFilters)}
              selected={false}
              onClick={clearFilters}
            />
          )}
        </div>
      )}

      {softwareCategory === undefined && (
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
      )}
    </>
  );
};

export default Requests;
