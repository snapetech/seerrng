import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import {
  encodeApiPathSegment,
  normalizeMusicBrainzId,
  normalizeOpenLibraryWorkId,
} from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
import { getTmdbPosterImageUrl } from '@app/utils/imageCache';
import {
  ArrowDownIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowUpIcon,
  Bars3BottomLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  FilmIcon,
  InformationCircleIcon,
  MagnifyingGlassIcon,
  ServerIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import type {
  RequestStatusDetailResponse,
  RequestStatusResultsResponse,
  RequestStatusUsersResponse,
} from '@server/interfaces/api/requestInterfaces';
import type { RequestStatusSortField } from '@server/lib/requestStatusSort';
import type { BookDetails } from '@server/models/Book';
import type { MovieDetails } from '@server/models/Movie';
import type { MusicDetails } from '@server/models/Music';
import type { TvDetails } from '@server/models/Tv';
import axios from 'axios';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FormattedDate, FormattedRelativeTime, useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.RequestStatus', {
  title: 'Request Status',
  subtitle: 'Follow every request from approval through library availability.',
  manageRequests: 'Manage requests',
  selectUser: 'Select user to view requests',
  allUsers: 'All users',
  all: 'All requests',
  active: 'Active',
  attention: 'Needs attention',
  completed: 'Completed',
  requested: 'Requested',
  approved: 'Approved',
  searching: 'Searching',
  downloading: 'Downloading',
  importing: 'Importing',
  library: 'Adding to library',
  available: 'Available',
  unavailable: 'Unavailable',
  failed: 'Failed',
  declined: 'Declined',
  cancelled: 'Cancelled',
  mediaType: 'Media type',
  mediaTypeValue: 'Media Type',
  releaseDate: 'Release Date',
  runtime: 'Runtime',
  genres: 'Genres',
  requestDate: 'Date',
  requestTime: 'Time',
  statusUpdated: 'Status Updated',
  timeFrame: 'Time frame',
  last7Days: 'Last 7 Days',
  lastMonth: 'Last Month',
  last6Months: 'Last 6 Months',
  allTime: 'All Time',
  filter: 'Filter',
  statusFilter: 'Status',
  allMedia: 'All media',
  movies: 'Movies',
  series: 'Series',
  music: 'Music',
  books: 'Books',
  audiobooks: 'Audiobooks',
  sortBy: 'Sort by',
  sortAdded: 'Date',
  sortTitle: 'Title',
  sortStatus: 'Status',
  sortDirector: 'Director',
  sortWriter: 'Writer',
  sortRating: 'Rating',
  sortReleaseDate: 'Release date',
  sortArtist: 'Artist',
  sortAuthor: 'Author',
  sortPublisher: 'Publisher',
  sortAscending: 'Ascending',
  sortDescending: 'Descending',
  showing:
    '{count, plural, =0 {No requests} one {# request} other {# requests}}',
  progressUnavailable: 'Download service did not provide progress data.',
  progressFrom: '{percent}% complete',
  sizeProgress: '{complete} of {total}',
  eta: 'ETA: {date}',
  history: 'History',
  hideHistory: 'Hide history',
  noHistory: 'No status history has been recorded yet.',
  requestedBy: 'Requested by {user}',
  requestedByLabel: 'Requested by',
  requestedAt: 'Requested {date}',
  service: 'Service: {service}',
  serviceLabel: 'Service',
  retry: 'Retry request',
  retrying: 'Retrying…',
  retryFailed: 'Unable to retry this request.',
  retrySuccess: 'Request queued for another attempt.',
  loading: 'Loading request status',
  noResults: 'No requests match these filters.',
  statusExplanation:
    'Progress is shown only when the connected download service reports a usable size. A question mark means no trustworthy percentage was available.',
  previous: 'Previous',
  next: 'Next',
  page: 'Page {page} of {pages}',
  unknownTitle: 'Unknown title',
});

type MediaDetails = MovieDetails | TvDetails | MusicDetails | BookDetails;
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
type MediaFilter = 'all' | 'movie' | 'tv' | 'music' | 'book' | 'audiobook';
type UserSelection = number | 'all';
type TimeFrame = '7d' | '1m' | '6m' | 'all';

const timelineStages: StatusStage[] = [
  'requested',
  'approved',
  'searching',
  'downloading',
  'importing',
  'library',
  'available',
];

const statusFilterValues = [
  'all',
  'active',
  'attention',
  ...timelineStages,
  'unavailable',
  'failed',
  'declined',
  'cancelled',
];
const mediaTypeValues: MediaFilter[] = [
  'all',
  'movie',
  'tv',
  'music',
  'book',
  'audiobook',
];

const sortDirectionValues = ['asc', 'desc'] as const;
const timeFrameValues: TimeFrame[] = ['7d', '1m', '6m', 'all'];

const getSortOptions = (
  mediaFilter: MediaFilter
): { value: RequestStatusSortField; label: keyof typeof messages }[] => {
  const common: {
    value: RequestStatusSortField;
    label: keyof typeof messages;
  }[] = [
    { value: 'added', label: 'sortAdded' },
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
        { value: 'releaseDate', label: 'sortReleaseDate' },
      ];
    default:
      return common;
  }
};

const getSafeQueryValue = (
  value: string | string[] | undefined,
  allowedValues: readonly string[]
): string => {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && allowedValues.includes(candidate) ? candidate : 'all';
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

const getBookId = (item: RequestStatusItem): string | undefined =>
  item.request.media.identifiers?.find(
    (identifier) => identifier.provider === 'openlibrary'
  )?.value;

const getDetailsUrl = (item: RequestStatusItem): string | null => {
  const request = item.request;
  if (request.type === 'movie' || request.type === 'tv') {
    return `/api/v1/${request.type}/${request.media.tmdbId}`;
  }
  if (request.type === 'music' && request.media.mbId) {
    return `/api/v1/music/${encodeApiPathSegment(normalizeMusicBrainzId(request.media.mbId))}`;
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
  const bookId = getBookId(item);
  return bookId
    ? `/book/${encodeApiPathSegment(normalizeOpenLibraryWorkId(bookId))}`
    : null;
};

const getTitle = (
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
    return getBookId(item) ?? messages.unknownTitle.defaultMessage;
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

const getMediaBadge = (item: RequestStatusItem): string => {
  if (item.request.type === 'movie') return 'Movie';
  if (item.request.type === 'tv') return 'Series';
  if (item.request.type === 'music') return 'Album';
  if (item.request.bookFormat === 'audiobook') return 'Audiobook';
  if (item.request.bookFormat === 'both') return 'Book + Audiobook';
  return 'Book';
};

const getMediaFormat = (item: RequestStatusItem): string => {
  if (item.request.type === 'movie' || item.request.type === 'tv') {
    return item.request.is4k ? '4K' : 'HD';
  }
  if (item.request.type === 'music') return 'Music';
  if (item.request.bookFormat === 'audiobook') return 'Audiobook';
  if (item.request.bookFormat === 'both') return 'Ebook + Audiobook';
  return 'Ebook';
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
  const year = (details as BookDetails).firstPublishYear;
  return year ? String(year) : undefined;
};

const getRuntime = (
  details: MediaDetails | undefined,
  item: RequestStatusItem
): string => {
  if (!details) return '—';
  if (item.request.type === 'movie') {
    const minutes = (details as MovieDetails).runtime;
    return minutes ? `${minutes} minutes` : '—';
  }
  if (item.request.type === 'tv') {
    const minutes = (details as TvDetails).episodeRunTime.find(
      (runtime) => runtime > 0
    );
    return minutes ? `${minutes} minutes` : '—';
  }
  if (item.request.type === 'music') {
    const milliseconds = (details as MusicDetails).tracks.reduce(
      (total, track) => total + Math.max(track.length, 0),
      0
    );
    return milliseconds > 0
      ? `${Math.round(milliseconds / 60000)} minutes`
      : '—';
  }
  return '—';
};

const getGenres = (
  details: MediaDetails | undefined,
  item: RequestStatusItem
): string => {
  if (!details) return '—';
  if (item.request.type === 'movie') {
    return (
      (details as MovieDetails).genres
        .slice(0, 3)
        .map((genre) => genre.name)
        .join(', ') || '—'
    );
  }
  if (item.request.type === 'tv') {
    return (
      (details as TvDetails).genres
        .slice(0, 3)
        .map((genre) => genre.name)
        .join(', ') || '—'
    );
  }
  if (item.request.type === 'music') {
    return (
      (details as MusicDetails).tags?.releaseGroup
        .slice(0, 3)
        .map((tag) => tag.tag)
        .filter(Boolean)
        .join(', ') || '—'
    );
  }
  return (details as BookDetails).subjects?.slice(0, 3).join(', ') || '—';
};

const formatBytes = (value: number | null): string => {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return '—';
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
  onRetry: (requestId: number) => Promise<void>;
  isRetrying: boolean;
  isHistoryOpen: boolean;
  onToggleHistory: (requestId: number) => void;
}

const RequestStatusCard = ({
  item,
  onRetry,
  isRetrying,
  isHistoryOpen,
  onToggleHistory,
}: RequestStatusCardProps) => {
  const intl = useIntl();
  const { hasPermission, user } = useUser();
  const timelineRef = useRef<HTMLDivElement>(null);
  const detailsUrl = getDetailsUrl(item);
  const detailHref = getDetailHref(item);
  const { data: details } = useSWR<MediaDetails>(detailsUrl);
  const { data: detail } = useSWR<RequestStatusDetailResponse>(
    `/api/v1/request/status/${item.request.id}`,
    {
      refreshInterval: 15000,
      revalidateOnFocus: true,
    }
  );
  const current = detail?.current ?? item.status;
  const history = detail?.history.results ?? [];
  const currentStage = statusFilterValues.includes(current.stage)
    ? (current.stage as StatusStage)
    : 'approved';
  const activeIndex = getLastTimelineIndex(currentStage, history);
  const poster = getPoster(details);
  const title = getTitle(details, item);
  const StageIcon = stageIcon[currentStage] ?? InformationCircleIcon;
  const releaseDate = getReleaseDate(details, item);
  const releaseYear = releaseDate?.match(/\d{4}/)?.[0];
  const displayTitle = releaseYear ? `${title} (${releaseYear})` : title;
  const displayReleaseDate = releaseDate
    ? /^\d{4}$/.test(releaseDate)
      ? releaseDate
      : intl.formatDate(new Date(releaseDate), {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
    : '—';
  const terminalWithoutProgress =
    current.isTerminal && currentStage !== 'available';
  const chronologicalHistory = [...history].reverse();
  const statusUpdatedSeconds = Math.floor(
    (new Date(current.observedAt).getTime() - Date.now()) / 1000
  );
  const scrollTimeline = (direction: -1 | 1) => {
    timelineRef.current?.scrollBy({
      left: direction * 260,
      behavior: 'smooth',
    });
  };

  return (
    <article
      className="overflow-hidden rounded-xl border border-gray-700 bg-gray-800/95 shadow-lg shadow-gray-950/20"
      data-testid={`request-status-${item.request.id}`}
    >
      <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 p-3 sm:grid-cols-[80px_minmax(0,1fr)]">
        <div>
          {detailHref ? (
            <Link
              href={detailHref}
              aria-label={displayTitle}
              className="relative block h-24 w-16 overflow-hidden rounded-lg ring-1 ring-gray-600 transition duration-200 hover:ring-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 motion-reduce:transition-none sm:h-[120px] sm:w-20"
            >
              <CachedImage
                src={poster.src}
                type={poster.type}
                alt=""
                fill
                sizes="(min-width: 640px) 80px, 64px"
                className="object-cover"
              />
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
            </div>
          )}
        </div>
        <div className="min-w-0">
          {detailHref ? (
            <Link
              href={detailHref}
              className="block truncate text-lg font-semibold text-white hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              {displayTitle}
            </Link>
          ) : (
            <h3 className="truncate text-lg font-semibold text-white">
              {displayTitle}
            </h3>
          )}
          <div className="mt-1 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_max-content]">
            <div className="min-w-0 text-xs leading-4 text-gray-400">
              <span className="inline-flex min-h-4 items-center rounded-full bg-indigo-600 px-1.5 text-[11px] font-semibold uppercase leading-[1.3] tracking-wide text-indigo-50">
                {getMediaBadge(item)}
              </span>
              <dl className="mt-0.5 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-2 gap-y-0.5">
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.mediaTypeValue)}:
                </dt>
                <dd className="m-0 truncate">{getMediaFormat(item)}</dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.releaseDate)}:
                </dt>
                <dd className="m-0 truncate">{displayReleaseDate}</dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.runtime)}:
                </dt>
                <dd className="m-0 truncate">{getRuntime(details, item)}</dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.genres)}:
                </dt>
                <dd className="m-0 truncate">{getGenres(details, item)}</dd>
              </dl>
            </div>
            <dl className="grid w-full grid-cols-[max-content_max-content] gap-x-2 gap-y-0.5 border-t border-gray-600 pt-2 text-xs leading-4 text-gray-400 md:w-max md:border-l md:border-t-0 md:py-0 md:pl-3">
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.requestedByLabel)}
              </dt>
              <dd className="m-0 whitespace-nowrap">
                {item.request.requestedBy.displayName}
              </dd>
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.requestDate)}
              </dt>
              <dd className="m-0 whitespace-nowrap">
                <FormattedDate
                  value={new Date(item.request.createdAt)}
                  year="numeric"
                  month="short"
                  day="numeric"
                />
              </dd>
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.requestTime)}
              </dt>
              <dd className="m-0 whitespace-nowrap">
                <FormattedDate
                  value={new Date(item.request.createdAt)}
                  hour="numeric"
                  minute="2-digit"
                />
              </dd>
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.serviceLabel)}
              </dt>
              <dd className="m-0 whitespace-nowrap">
                {current.service ?? '—'}
              </dd>
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.statusUpdated)}
              </dt>
              <dd className="m-0 whitespace-nowrap">
                <FormattedRelativeTime
                  value={statusUpdatedSeconds}
                  numeric="auto"
                  updateIntervalInSeconds={5}
                />
              </dd>
            </dl>
          </div>
        </div>
      </div>

      <div className="relative mx-3 rounded-lg border border-gray-700 bg-gray-900/40 py-2">
        <button
          type="button"
          onClick={() => scrollTimeline(-1)}
          className="absolute left-1 top-1/2 z-10 flex h-10 w-7 -translate-y-1/2 items-center justify-center rounded-md border border-indigo-400/40 bg-gray-900/80 text-indigo-200 backdrop-blur-sm md:hidden"
          aria-label="Scroll progress left"
        >
          <ChevronLeftIcon className="h-4 w-4" aria-hidden="true" />
        </button>
        <div
          ref={timelineRef}
          className="hide-scrollbar flex overflow-x-auto px-2"
          aria-label="Request lifecycle"
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
                      className={`absolute left-1/2 right-[-50%] top-[6px] h-0.5 ${
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
                          : 'border-gray-600 bg-gray-800 text-gray-500'
                    }`}
                  >
                    {isComplete ? (
                      <CheckIcon className="h-2.5 w-2.5" aria-hidden="true" />
                    ) : isCurrent ? (
                      <StageIcon className="h-2.5 w-2.5" aria-hidden="true" />
                    ) : null}
                  </span>
                  <span
                    className={`mt-1 whitespace-nowrap text-[11px] leading-4 ${
                      isCurrent ? 'font-semibold text-white' : 'text-gray-400'
                    }`}
                  >
                    {getStageLabel(intl, stage)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <button
          type="button"
          onClick={() => scrollTimeline(1)}
          className="absolute right-1 top-1/2 z-10 flex h-10 w-7 -translate-y-1/2 items-center justify-center rounded-md border border-indigo-400/40 bg-gray-900/80 text-indigo-200 backdrop-blur-sm md:hidden"
          aria-label="Scroll progress right"
        >
          <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {current.stage === 'downloading' && current.percent !== null && (
        <div className="mx-3 mt-2 rounded-lg border border-gray-700 bg-gray-900/40 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-indigo-200">
            <span className="inline-flex items-center gap-2">
              <span>
                {intl.formatMessage(messages.progressFrom, {
                  percent: current.percent.toFixed(1).replace(/\.0$/, ''),
                })}
              </span>
              {current.size !== null && current.sizeLeft !== null && (
                <>
                  <span className="text-gray-500" aria-hidden="true">
                    |
                  </span>
                  <span>
                    {intl.formatMessage(messages.sizeProgress, {
                      complete: formatBytes(current.size - current.sizeLeft),
                      total: formatBytes(current.size),
                    })}
                  </span>
                </>
              )}
            </span>
            {current.estimatedCompletionTime && (
              <span>
                {intl.formatMessage(messages.eta, {
                  date: (
                    <FormattedDate
                      value={new Date(current.estimatedCompletionTime)}
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

      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <span
          className={`inline-flex h-6 w-32 flex-shrink-0 items-center justify-center gap-1.5 rounded-full border px-2 text-[11px] font-semibold ${stageTone[currentStage] ?? stageTone.cancelled}`}
        >
          <StageIcon className="h-3 w-3" aria-hidden="true" />
          {getStageLabel(intl, currentStage)}
        </span>
        <span className="min-w-0 flex-1 text-xs text-gray-400">
          {current.message}
        </span>
        {current.retryable &&
          (hasPermission(Permission.MANAGE_REQUESTS) ||
            item.request.requestedBy.id === user?.id) && (
            <Button
              buttonType="warning"
              buttonSize="sm"
              disabled={isRetrying}
              onClick={() => void onRetry(item.request.id)}
            >
              <ArrowPathIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {intl.formatMessage(
                isRetrying ? messages.retrying : messages.retry
              )}
            </Button>
          )}
        <button
          type="button"
          className="inline-flex h-6 items-center gap-1.5 rounded-md border border-gray-600 bg-gray-900 px-2.5 text-xs font-medium text-gray-300 transition hover:border-indigo-400 hover:bg-indigo-500/20 hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
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
        <section className="mx-3 mb-3 rounded-lg border border-gray-700 bg-gray-900/40 p-3">
          <h4 className="mb-2 text-xs font-semibold text-gray-200">
            {intl.formatMessage(messages.history)}
          </h4>
          {chronologicalHistory.length === 0 ? (
            <p className="text-xs text-gray-500">
              {intl.formatMessage(messages.noHistory)}
            </p>
          ) : (
            <ol className="grid grid-cols-[7rem_7.5rem_minmax(0,1fr)] gap-x-3 gap-y-2">
              {chronologicalHistory.map((event) => (
                <li key={event.id} className="contents text-xs">
                  <time
                    className="whitespace-nowrap text-gray-500"
                    dateTime={new Date(event.createdAt).toISOString()}
                  >
                    <FormattedDate
                      value={new Date(event.createdAt)}
                      hour="numeric"
                      minute="2-digit"
                      second="2-digit"
                    />
                  </time>
                  <span className="font-medium text-gray-200">
                    {getStageLabel(intl, event.stage as StatusStage)}
                  </span>
                  <span className="min-w-0 text-gray-400">
                    {event.message ??
                      getStageLabel(intl, event.stage as StatusStage)}
                    {event.percent !== null && ` · ${event.percent}%`}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </article>
  );
};

const RequestStatus = () => {
  const intl = useIntl();
  const router = useRouter();
  const { user: currentUser, hasPermission } = useUser();
  const { addToast } = useToasts();
  const canViewOtherUsers = hasPermission(
    [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
    { type: 'or' }
  );
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState<RequestStatusSortField>('added');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [timeFrame, setTimeFrame] = useState<TimeFrame>('all');
  const [selectedUser, setSelectedUser] = useState<UserSelection | null>(null);
  const [expandedRequestId, setExpandedRequestId] = useState<number | null>(
    null
  );
  const [retryingRequestId, setRetryingRequestId] = useState<number | null>(
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

    setFilter(getSafeQueryValue(router.query.filter, statusFilterValues));
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
    const rawTimeFrame = Array.isArray(router.query.timeFrame)
      ? router.query.timeFrame[0]
      : router.query.timeFrame;
    setTimeFrame(
      rawTimeFrame && timeFrameValues.includes(rawTimeFrame as TimeFrame)
        ? (rawTimeFrame as TimeFrame)
        : 'all'
    );

    const rawUserId = Array.isArray(router.query.userId)
      ? router.query.userId[0]
      : router.query.userId;
    if (canViewOtherUsers) {
      if (rawUserId === 'all') {
        setSelectedUser('all');
      } else if (rawUserId && /^\d+$/.test(rawUserId)) {
        const userId = Number(rawUserId);
        setSelectedUser(userId > 0 ? userId : (currentUser?.id ?? null));
      } else {
        setSelectedUser(currentUser?.id ?? null);
      }
    } else {
      setSelectedUser(null);
    }
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
  const pageSize = 25;
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
    if (!currentUser || (canViewOtherUsers && selectedOwnerId === undefined)) {
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
    return `/api/v1/request/status?${params.toString()}`;
  }, [
    apiMediaType,
    bookFormat,
    canViewOtherUsers,
    currentUser,
    filter,
    page,
    selectedOwnerId,
    sort,
    sortDirection,
    timeFrame,
  ]);
  const { data, error, mutate } = useSWR<RequestStatusResultsResponse>(query, {
    refreshInterval: 15000,
    revalidateOnFocus: true,
  });

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
    ...(canViewOtherUsers && nextUser !== null
      ? { userId: nextUser === 'all' ? 'all' : String(nextUser) }
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
      sort === nextSort ? (sortDirection === 'asc' ? 'desc' : 'asc') : 'desc';
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
        <div className="mt-8 rounded-xl border border-red-500/50 bg-red-500/10 p-6 text-red-100">
          {intl.formatMessage(messages.noResults)}
        </div>
      </>
    );
  }

  const totalPages = Math.max(data.pageInfo.pages, 1);
  const sortOptions = getSortOptions(mediaFilter);
  const mediaFilters: {
    value: MediaFilter;
    label: keyof typeof messages;
  }[] = [
    { value: 'all', label: 'allMedia' },
    { value: 'movie', label: 'movies' },
    { value: 'tv', label: 'series' },
    { value: 'music', label: 'music' },
    { value: 'book', label: 'books' },
    { value: 'audiobook', label: 'audiobooks' },
  ];
  const changePage = (nextPage: number) => {
    pushRouteQuery(routeQuery({ nextPage }));
  };

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.title)} />
      <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <Header subtext={intl.formatMessage(messages.subtitle)}>
          {intl.formatMessage(messages.title)}
        </Header>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          {canViewOtherUsers && (
            <label className="flex min-w-56 flex-col gap-1 text-xs font-medium uppercase tracking-wide text-gray-400">
              <span className="flex items-center gap-1.5">
                <UserIcon className="h-4 w-4" aria-hidden="true" />
                {intl.formatMessage(messages.selectUser)}
              </span>
              <select
                className="rounded-md border-gray-600 bg-gray-800 px-3 py-2 text-sm font-normal normal-case tracking-normal text-gray-100 focus:border-indigo-400 focus:ring-indigo-400"
                value={
                  selectedUser === 'all'
                    ? 'all'
                    : String(selectedUser ?? currentUser?.id ?? '')
                }
                onChange={(event) => updateUser(event.target.value)}
                aria-label={intl.formatMessage(messages.selectUser)}
              >
                <option value="all">
                  {intl.formatMessage(messages.allUsers)}
                </option>
                {userOptions.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.displayName}
                  </option>
                ))}
              </select>
            </label>
          )}
          {hasPermission(Permission.MANAGE_REQUESTS) && (
            <Link
              href="/requests"
              className="inline-flex items-center self-start rounded-md border border-gray-600 bg-gray-800 px-4 py-2 text-sm font-medium text-gray-200 transition hover:border-indigo-400 hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-400 sm:self-auto"
            >
              {intl.formatMessage(messages.manageRequests)}
            </Link>
          )}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { key: 'active', label: messages.active, value: data.counts.active },
          {
            key: 'attention',
            label: messages.attention,
            value: data.counts.attention,
          },
          {
            key: 'completed',
            label: messages.completed,
            value: data.counts.completed,
          },
          { key: 'all', label: messages.all, value: data.counts.total },
        ].map((summary) => (
          <button
            key={summary.key}
            type="button"
            onClick={() => updateFilter(summary.key)}
            className={`rounded-xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-indigo-400 ${filter === summary.key ? 'border-indigo-400 bg-indigo-500/15' : 'border-gray-700 bg-gray-800/80 hover:border-gray-500'}`}
          >
            <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
              {intl.formatMessage(summary.label)}
            </div>
            <div className="mt-1 text-2xl font-semibold text-white">
              {summary.value}
            </div>
          </button>
        ))}
      </div>

      <section
        className="mb-5 rounded-xl border border-gray-700 bg-gray-800/70 p-3"
        aria-label={intl.formatMessage(messages.mediaType)}
      >
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          <FilmIcon className="h-4 w-4" aria-hidden="true" />
          {intl.formatMessage(messages.filter)}
        </div>
        <div className="hide-scrollbar flex gap-2 overflow-x-auto pb-1">
          {mediaFilters.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={mediaFilter === option.value}
              onClick={() => updateMediaFilter(option.value)}
              className={`whitespace-nowrap rounded-md border px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-400 ${mediaFilter === option.value ? 'border-indigo-400 bg-indigo-500 text-white' : 'border-gray-600 bg-gray-900/70 text-gray-300 hover:border-gray-400 hover:text-white'}`}
            >
              {intl.formatMessage(messages[option.label])}
            </button>
          ))}
          <select
            className="min-w-[124px] whitespace-nowrap rounded-md border border-gray-600 bg-gray-900/70 px-3 py-2 text-sm font-medium text-gray-300 focus:border-indigo-400 focus:ring-indigo-400"
            value={timeFrame}
            onChange={(event) =>
              updateTimeFrame(event.target.value as TimeFrame)
            }
            aria-label={intl.formatMessage(messages.timeFrame)}
          >
            <option value="7d">{intl.formatMessage(messages.last7Days)}</option>
            <option value="1m">{intl.formatMessage(messages.lastMonth)}</option>
            <option value="6m">
              {intl.formatMessage(messages.last6Months)}
            </option>
            <option value="all">{intl.formatMessage(messages.allTime)}</option>
          </select>
        </div>
      </section>

      <section className="mb-5 rounded-xl border border-gray-700 bg-gray-800/70 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          <Bars3BottomLeftIcon className="h-4 w-4" aria-hidden="true" />
          {intl.formatMessage(messages.sortBy)}
        </div>
        <div className="hide-scrollbar flex gap-2 overflow-x-auto pb-1">
          {sortOptions.map((option) => {
            const active = sort === option.value;
            const DirectionIcon =
              active && sortDirection === 'asc' ? ArrowUpIcon : ArrowDownIcon;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                aria-label={`${intl.formatMessage(messages[option.label])} (${intl.formatMessage(active && sortDirection === 'asc' ? messages.sortAscending : messages.sortDescending)})`}
                onClick={() => updateSort(option.value)}
                className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-400 ${active ? 'border-indigo-400 bg-indigo-500 text-white' : 'border-gray-600 bg-gray-900/70 text-gray-300 hover:border-gray-400 hover:text-white'}`}
              >
                {intl.formatMessage(messages[option.label])}
                <DirectionIcon className="h-4 w-4" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </section>

      <div className="mb-5 flex flex-col gap-3 rounded-xl border border-gray-700 bg-gray-800/70 p-3 sm:flex-row sm:items-center">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-gray-300">
          <ClockIcon
            className="h-5 w-5 flex-shrink-0 text-gray-400"
            aria-hidden="true"
          />
          <span className="sr-only">
            {intl.formatMessage(messages.statusFilter)}
          </span>
          <select
            className="w-full rounded-md border-gray-600 bg-gray-900 text-sm text-gray-100 focus:border-indigo-400 focus:ring-indigo-400"
            value={filter}
            onChange={(event) => updateFilter(event.target.value)}
            aria-label={intl.formatMessage(messages.statusFilter)}
          >
            <option value="all">{intl.formatMessage(messages.all)}</option>
            <option value="active">
              {intl.formatMessage(messages.active)}
            </option>
            <option value="attention">
              {intl.formatMessage(messages.attention)}
            </option>
            <option value="requested">
              {intl.formatMessage(messages.requested)}
            </option>
            <option value="approved">
              {intl.formatMessage(messages.approved)}
            </option>
            <option value="searching">
              {intl.formatMessage(messages.searching)}
            </option>
            <option value="downloading">
              {intl.formatMessage(messages.downloading)}
            </option>
            <option value="importing">
              {intl.formatMessage(messages.importing)}
            </option>
            <option value="library">
              {intl.formatMessage(messages.library)}
            </option>
            <option value="available">
              {intl.formatMessage(messages.available)}
            </option>
            <option value="unavailable">
              {intl.formatMessage(messages.unavailable)}
            </option>
            <option value="failed">
              {intl.formatMessage(messages.failed)}
            </option>
            <option value="declined">
              {intl.formatMessage(messages.declined)}
            </option>
            <option value="cancelled">
              {intl.formatMessage(messages.cancelled)}
            </option>
          </select>
        </label>
      </div>

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-3 text-sm text-indigo-100">
        <InformationCircleIcon
          className="mt-0.5 h-5 w-5 flex-shrink-0"
          aria-hidden="true"
        />
        <span>{intl.formatMessage(messages.statusExplanation)}</span>
      </div>

      <div className="mb-4 text-sm text-gray-400">
        {intl.formatMessage(messages.showing, { count: data.pageInfo.results })}
      </div>

      <div className="space-y-4">
        {data.results.map((item) => (
          <RequestStatusCard
            key={item.request.id}
            item={item}
            onRetry={retryRequest}
            isRetrying={retryingRequestId === item.request.id}
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
        <div className="flex min-h-48 items-center justify-center rounded-xl border border-dashed border-gray-700 bg-gray-800/40 p-6 text-center text-gray-400">
          {intl.formatMessage(messages.noResults)}
        </div>
      )}

      <nav
        className="mt-6 flex items-center justify-between"
        aria-label="Pagination"
      >
        <Button
          disabled={page <= 1}
          onClick={() => changePage(page - 1)}
          buttonSize="sm"
        >
          <ChevronLeftIcon className="mr-1 h-4 w-4" aria-hidden="true" />
          {intl.formatMessage(messages.previous)}
        </Button>
        <span className="text-sm text-gray-400">
          {intl.formatMessage(messages.page, { page, pages: totalPages })}
        </span>
        <Button
          disabled={page >= totalPages}
          onClick={() => changePage(page + 1)}
          buttonSize="sm"
        >
          {intl.formatMessage(messages.next)}
          <ChevronRightIcon className="ml-1 h-4 w-4" aria-hidden="true" />
        </Button>
      </nav>
    </>
  );
};

export default RequestStatus;
