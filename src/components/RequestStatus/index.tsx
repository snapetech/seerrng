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
  ArrowDownTrayIcon,
  ArrowPathIcon,
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
} from '@heroicons/react/24/outline';
import type {
  RequestStatusDetailResponse,
  RequestStatusResultsResponse,
} from '@server/interfaces/api/requestInterfaces';
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
  statusFilter: 'Status',
  allMedia: 'All media',
  movies: 'Movies',
  series: 'Series',
  music: 'Music',
  books: 'Books',
  showing:
    '{count, plural, =0 {No requests} one {# request} other {# requests}}',
  progressUnavailable: 'Download service did not provide progress data.',
  progressFrom: '{percent}% complete',
  sizeProgress: '{complete} of {total}',
  eta: 'Estimated completion {date}',
  history: 'History',
  hideHistory: 'Hide history',
  noHistory: 'No status history has been recorded yet.',
  requestedBy: 'Requested by {user}',
  service: 'Service: {service}',
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

const timelineStages: StatusStage[] = [
  'requested',
  'approved',
  'searching',
  'downloading',
  'importing',
  'library',
  'available',
];

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
}

const RequestStatusCard = ({
  item,
  onRetry,
  isRetrying,
}: RequestStatusCardProps) => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const [showHistory, setShowHistory] = useState(false);
  const activeStageRef = useRef<HTMLSpanElement>(null);
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
  const currentStage = current.stage as StatusStage;
  const activeIndex = getLastTimelineIndex(currentStage, history);
  const poster = getPoster(details);
  const title = getTitle(details, item);
  const StageIcon = stageIcon[currentStage] ?? InformationCircleIcon;

  useEffect(() => {
    activeStageRef.current?.scrollIntoView({
      block: 'nearest',
      inline: 'center',
    });
  }, [currentStage]);

  return (
    <article
      className="overflow-hidden rounded-2xl border border-gray-700 bg-gray-800/95 shadow-lg shadow-gray-950/20"
      data-testid={`request-status-${item.request.id}`}
    >
      <div className="flex flex-col gap-5 p-4 sm:p-5 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Link
            href={detailHref ?? '#'}
            aria-label={title}
            className="relative h-24 w-16 flex-shrink-0 overflow-hidden rounded-lg ring-1 ring-gray-600 transition duration-200 hover:ring-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 motion-reduce:transition-none"
          >
            <CachedImage
              src={poster.src}
              type={poster.type}
              alt=""
              fill
              sizes="64px"
              className="object-cover"
            />
          </Link>
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-gray-400">
              <span>{item.request.type}</span>
              {item.request.is4k && <span>4K</span>}
              {item.request.type === 'book' && item.request.bookFormat && (
                <span>{item.request.bookFormat}</span>
              )}
            </div>
            {detailHref ? (
              <Link
                href={detailHref}
                className="block truncate text-xl font-semibold text-white hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                {title}
              </Link>
            ) : (
              <h3 className="truncate text-xl font-semibold text-white">
                {title}
              </h3>
            )}
            {details && (isMusic(details) || isBook(details)) && (
              <p className="truncate text-sm text-gray-300">
                {isMusic(details) ? details.artist.name : details.author}
              </p>
            )}
            <p className="mt-1 text-xs text-gray-500">
              {intl.formatMessage(messages.requestedBy, {
                user: item.request.requestedBy.displayName,
              })}
            </p>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-2 lg:w-72 lg:items-end">
          <span
            className={`inline-flex items-center gap-1.5 self-start rounded-full border px-3 py-1 text-sm font-semibold lg:self-end ${stageTone[currentStage] ?? stageTone.cancelled}`}
          >
            <StageIcon className="h-4 w-4" aria-hidden="true" />
            {getStageLabel(intl, currentStage)}
          </span>
          <p className="text-right text-xs text-gray-400">
            <FormattedRelativeTime
              value={Math.floor(
                (new Date(current.observedAt).getTime() - Date.now()) / 1000
              )}
              numeric="auto"
              updateIntervalInSeconds={30}
            />
          </p>
        </div>
      </div>

      <div className="border-t border-gray-700/80 bg-gray-900/30 px-4 py-4 sm:px-5">
        <div
          className="hide-scrollbar -mx-2 flex overflow-x-auto px-2 pb-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          tabIndex={0}
          aria-label="Request lifecycle"
        >
          {timelineStages.map((stage, index) => {
            const isCurrent = currentStage === stage;
            const isComplete =
              index < activeIndex ||
              (current.isTerminal && index <= activeIndex && !isCurrent);
            const TimelineIcon = isComplete ? CheckIcon : stageIcon[stage];
            return (
              <div
                key={stage}
                className="flex min-w-[116px] flex-1 items-center last:min-w-[96px]"
              >
                <div className="flex min-w-0 flex-1 flex-col items-center text-center">
                  <span
                    ref={
                      isCurrent || (current.isTerminal && index === activeIndex)
                        ? activeStageRef
                        : undefined
                    }
                    className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition-colors motion-reduce:transition-none ${
                      isCurrent
                        ? 'border-indigo-300 bg-indigo-500 text-white shadow-lg shadow-indigo-900/50'
                        : isComplete
                          ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300'
                          : 'border-gray-600 bg-gray-800 text-gray-500'
                    }`}
                  >
                    <TimelineIcon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span
                    className={`mt-2 whitespace-nowrap text-xs ${
                      isCurrent ? 'font-semibold text-white' : 'text-gray-400'
                    }`}
                  >
                    {getStageLabel(intl, stage)}
                  </span>
                </div>
                {index < timelineStages.length - 1 && (
                  <span
                    className={`h-0.5 w-6 flex-shrink-0 ${index < activeIndex ? 'bg-emerald-400/80' : 'bg-gray-700'}`}
                    aria-hidden="true"
                  />
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm text-gray-200">{current.message}</p>
            {current.service && (
              <p className="mt-1 flex items-center gap-1 text-xs text-gray-400">
                <ServerIcon className="h-4 w-4" aria-hidden="true" />
                {intl.formatMessage(messages.service, {
                  service: current.service,
                })}
              </p>
            )}
          </div>
          <div className="flex flex-shrink-0 items-center gap-2 text-xs text-gray-400">
            {current.downloadCount > 0 && (
              <span>
                {current.downloadCount}{' '}
                {current.downloadCount === 1 ? 'download' : 'downloads'}
              </span>
            )}
            {current.attempt > 0 && <span>Attempt {current.attempt}</span>}
          </div>
        </div>

        {(current.stage === 'downloading' || current.stage === 'importing') && (
          <div className="mt-4 rounded-xl border border-gray-700 bg-gray-950/40 p-3">
            {current.percent !== null ? (
              <>
                <div className="mb-2 flex items-center justify-between text-xs text-gray-300">
                  <span>
                    {intl.formatMessage(messages.progressFrom, {
                      percent: current.percent.toFixed(1).replace(/\.0$/, ''),
                    })}
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
                {current.size !== null && current.sizeLeft !== null && (
                  <p className="mt-2 text-xs text-gray-400">
                    {intl.formatMessage(messages.sizeProgress, {
                      complete: formatBytes(current.size - current.sizeLeft),
                      total: formatBytes(current.size),
                    })}
                  </p>
                )}
              </>
            ) : (
              <p className="flex items-center gap-2 text-xs text-gray-400">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-700 text-sm font-semibold text-gray-200">
                  ?
                </span>
                {intl.formatMessage(messages.progressUnavailable)}
              </p>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-gray-300 transition hover:bg-gray-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
            aria-expanded={showHistory}
            onClick={() => setShowHistory((visible) => !visible)}
          >
            <ChevronDownIcon
              className={`h-4 w-4 transition-transform motion-reduce:transition-none ${showHistory ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
            {intl.formatMessage(
              showHistory ? messages.hideHistory : messages.history
            )}
          </button>
          {current.retryable && hasPermission(Permission.MANAGE_REQUESTS) && (
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
        </div>

        {showHistory && (
          <div className="mt-3 border-t border-gray-700 pt-3">
            {history.length === 0 ? (
              <p className="text-sm text-gray-500">
                {intl.formatMessage(messages.noHistory)}
              </p>
            ) : (
              <ol className="space-y-3">
                {history.map((event) => (
                  <li key={event.id} className="flex items-start gap-3 text-sm">
                    <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gray-700 text-gray-300">
                      {(() => {
                        const Icon =
                          stageIcon[event.stage as StatusStage] ??
                          InformationCircleIcon;
                        return (
                          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        );
                      })()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="font-medium text-gray-200">
                          {getStageLabel(intl, event.stage as StatusStage)}
                        </span>
                        <time
                          className="text-xs text-gray-500"
                          dateTime={new Date(event.createdAt).toISOString()}
                        >
                          <FormattedDate
                            value={new Date(event.createdAt)}
                            dateStyle="medium"
                            timeStyle="short"
                          />
                        </time>
                      </div>
                      <p className="text-xs text-gray-400">
                        {event.message ??
                          getStageLabel(intl, event.stage as StatusStage)}
                        {event.percent !== null && ` · ${event.percent}%`}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </article>
  );
};

const RequestStatus = () => {
  const intl = useIntl();
  const router = useRouter();
  const { hasPermission } = useUser();
  const { addToast } = useToasts();
  const [mediaType, setMediaType] = useState('all');
  const [filter, setFilter] = useState('all');
  const [retryingRequestId, setRetryingRequestId] = useState<number | null>(
    null
  );
  const page = Math.max(Number(router.query.page) || 1, 1);
  const pageSize = 25;
  const query = useMemo(
    () =>
      `/api/v1/request/status?take=${pageSize}&skip=${(page - 1) * pageSize}&filter=${filter}&mediaType=${mediaType}`,
    [filter, mediaType, page]
  );
  const { data, error, mutate } = useSWR<RequestStatusResultsResponse>(query, {
    refreshInterval: 15000,
    revalidateOnFocus: true,
  });

  const updateFilter = (nextFilter: string, nextMediaType = mediaType) => {
    setFilter(nextFilter);
    setMediaType(nextMediaType);
    void router.push({
      pathname: router.pathname,
      query: {
        ...(nextFilter !== 'all' ? { filter: nextFilter } : {}),
        ...(nextMediaType !== 'all' ? { mediaType: nextMediaType } : {}),
      },
    });
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
  const changePage = (nextPage: number) => {
    void router.push({
      pathname: router.pathname,
      query: {
        ...(filter !== 'all' ? { filter } : {}),
        ...(mediaType !== 'all' ? { mediaType } : {}),
        ...(nextPage > 1 ? { page: nextPage } : {}),
      },
    });
  };

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.title)} />
      <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <Header subtext={intl.formatMessage(messages.subtitle)}>
          {intl.formatMessage(messages.title)}
        </Header>
        {hasPermission(Permission.MANAGE_REQUESTS) && (
          <Link
            href="/requests"
            className="inline-flex items-center self-start rounded-md border border-gray-600 bg-gray-800 px-4 py-2 text-sm font-medium text-gray-200 transition hover:border-indigo-400 hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-400 lg:self-auto"
          >
            {intl.formatMessage(messages.manageRequests)}
          </Link>
        )}
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

      <div className="mb-5 flex flex-col gap-3 rounded-xl border border-gray-700 bg-gray-800/70 p-3 sm:flex-row">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-gray-300">
          <FilmIcon
            className="h-5 w-5 flex-shrink-0 text-gray-400"
            aria-hidden="true"
          />
          <span className="sr-only">
            {intl.formatMessage(messages.mediaType)}
          </span>
          <select
            className="w-full rounded-md border-gray-600 bg-gray-900 text-sm text-gray-100 focus:border-indigo-400 focus:ring-indigo-400"
            value={mediaType}
            onChange={(event) => updateFilter(filter, event.target.value)}
            aria-label={intl.formatMessage(messages.mediaType)}
          >
            <option value="all">{intl.formatMessage(messages.allMedia)}</option>
            <option value="movie">{intl.formatMessage(messages.movies)}</option>
            <option value="tv">{intl.formatMessage(messages.series)}</option>
            <option value="music">{intl.formatMessage(messages.music)}</option>
            <option value="book">{intl.formatMessage(messages.books)}</option>
          </select>
        </label>
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
