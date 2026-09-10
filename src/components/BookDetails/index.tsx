import Spinner from '@app/assets/spinner.svg';
import AssociationBadge from '@app/components/Association/AssociationBadge';
import BookFormatBadge, {
  getBookFormatMessage,
  getRequestedBookFormat,
  type RequestedBookFormat,
} from '@app/components/Common/BookFormatBadge';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import type { PlayButtonLink } from '@app/components/Common/PlayButton';
import PlayButton from '@app/components/Common/PlayButton';
import Tooltip from '@app/components/Common/Tooltip';
import IssueBlock from '@app/components/IssueBlock';
import BulkRequestModal from '@app/components/RequestModal/BulkRequestModal';
import StatusBadge from '@app/components/StatusBadge';
import useDeepLinks from '@app/hooks/useDeepLinks';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import { getQueryParamString } from '@app/hooks/useUpdateQueryParams';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import {
  encodeApiPathSegment,
  normalizeOpenLibraryWorkId,
} from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
import { PlayIcon } from '@heroicons/react/24/outline';
import {
  ArrowDownTrayIcon,
  CogIcon,
  ExclamationTriangleIcon,
  EyeSlashIcon,
  InformationCircleIcon,
  MinusCircleIcon,
  StarIcon,
} from '@heroicons/react/24/solid';
import { IssueStatus } from '@server/constants/issue';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import { UserType } from '@server/constants/user';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { NonFunctionProperties } from '@server/interfaces/api/common';
import type { BookDetails as BookDetailsType } from '@server/models/Book';
import axios from 'axios';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const ExternalBlocklistModal = dynamic(
  () => import('@app/components/ExternalBlocklistModal'),
  { ssr: false }
);
const ExternalMediaManageSlideOver = dynamic(
  () => import('@app/components/ExternalMediaManageSlideOver'),
  { ssr: false }
);
const IssueModal = dynamic(() => import('@app/components/IssueModal'), {
  ssr: false,
});
const RequestModal = dynamic(() => import('@app/components/RequestModal'), {
  ssr: false,
});

const messages = defineMessages('components.BookDetails', {
  play: 'Listen on {mediaServerName}',
  book: 'Book',
  author: 'Author',
  firstPublished: 'First Published',
  identifiers: 'Identifiers',
  openLibrary: 'Open Library',
  isbnCandidates: 'ISBN Candidates',
  subjects: 'Subjects',
  manage: 'Manage',
  reportissue: 'Report an Issue',
  openissues: 'Open Issues',
  watchlistSuccess: '<strong>{title}</strong> added to watchlist successfully!',
  watchlistDeleted:
    '<strong>{title}</strong> Removed from watchlist successfully!',
  watchlistError: 'Something went wrong. Please try again.',
  removefromwatchlist: 'Remove From Watchlist',
  addtowatchlist: 'Add To Watchlist',
  viewrequest: 'View Request',
  viewRequestFormat: 'View {format} request',
  requestBookFormat: 'Request {format}',
  requestbibliography: 'Request Bibliography',
  formatCoverage: 'Format coverage',
  formatAvailable: 'Available',
  formatRequested: 'Requested',
  formatNotRequested: 'Not requested',
});

const BookDetails = () => {
  const router = useRouter();
  const intl = useIntl();
  const settings = useSettings();
  const { addToast } = useToasts();
  const { user, hasPermission } = useUser();
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [showBulkRequestModal, setShowBulkRequestModal] = useState(false);
  const [editRequest, setEditRequest] =
    useState<NonFunctionProperties<MediaRequest>>();
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [showManager, setShowManager] = useState(router.query.manage === '1');
  const [showBlocklistModal, setShowBlocklistModal] = useState(false);
  const [isBlocklisting, setIsBlocklisting] = useState(false);
  const [isWatchlistUpdating, setIsWatchlistUpdating] = useState(false);
  const [toggleWatchlist, setToggleWatchlist] = useState(true);
  const bookId = getQueryParamString(router.query.bookId);
  const normalizedRouteBookId = bookId
    ? normalizeOpenLibraryWorkId(bookId)
    : undefined;
  const routeBookFormat = getQueryParamString(router.query.format);
  const preferredBookFormat: RequestedBookFormat | undefined =
    routeBookFormat === 'audiobook' ||
    routeBookFormat === 'ebook' ||
    routeBookFormat === 'both'
      ? routeBookFormat
      : undefined;

  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<BookDetailsType>(
    normalizedRouteBookId
      ? `/api/v1/book/${encodeApiPathSegment(normalizedRouteBookId)}`
      : null
  );

  useEffect(() => {
    setShowManager(router.query.manage === '1');
  }, [router.query.manage]);

  useEffect(() => {
    setToggleWatchlist(!data?.onUserWatchlist);
  }, [data?.onUserWatchlist]);

  const { mediaUrl: plexUrl } = useDeepLinks({
    mediaUrl: data?.mediaInfo?.mediaUrl,
    iOSPlexUrl: data?.mediaInfo?.iOSPlexUrl,
  });

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  if (!data) {
    return <ErrorPage statusCode={404} />;
  }

  const openLibraryWorkId = normalizeOpenLibraryWorkId(data.id);

  const canRequest = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_BOOK],
    { type: 'or' }
  );

  const getAvailableMediaServerName = () => {
    if (settings.currentSettings.mediaServerType === MediaServerType.EMBY) {
      return intl.formatMessage(messages.play, { mediaServerName: 'Emby' });
    }

    if (settings.currentSettings.mediaServerType === MediaServerType.PLEX) {
      return intl.formatMessage(messages.play, { mediaServerName: 'Plex' });
    }

    return intl.formatMessage(messages.play, { mediaServerName: 'Jellyfin' });
  };

  // Plex only ever hosts the audiobook format -- a populated ratingKey
  // (and thus mediaUrl) here always means "this book is an audiobook
  // available in Plex."
  const mediaLinks: PlayButtonLink[] = [];

  if (plexUrl && canRequest) {
    mediaLinks.push({
      text: getAvailableMediaServerName(),
      url: plexUrl,
      svg: <PlayIcon />,
    });
  }
  const hasEbookServiceLink =
    data.mediaInfo?.serviceId !== null &&
    data.mediaInfo?.serviceId !== undefined &&
    data.mediaInfo.externalServiceId !== null &&
    data.mediaInfo.externalServiceId !== undefined;
  const hasAudiobookServiceLink =
    data.mediaInfo?.audiobookServiceId !== null &&
    data.mediaInfo?.audiobookServiceId !== undefined &&
    data.mediaInfo.audiobookExternalServiceId !== null &&
    data.mediaInfo.audiobookExternalServiceId !== undefined;
  const activeBookRequests =
    data.mediaInfo?.requests?.filter(
      (request) =>
        request.status !== MediaRequestStatus.DECLINED &&
        request.status !== MediaRequestStatus.FAILED &&
        request.status !== MediaRequestStatus.COMPLETED
    ) ?? [];
  const hasActiveEbookRequest = activeBookRequests.some(
    (request) =>
      (request.bookFormat ?? 'ebook') === 'ebook' ||
      request.bookFormat === 'both'
  );
  const hasActiveAudiobookRequest = activeBookRequests.some(
    (request) =>
      request.bookFormat === 'audiobook' || request.bookFormat === 'both'
  );
  const activeBookRequest =
    activeBookRequests.find(
      (request) => request.requestedBy?.id === user?.id
    ) ??
    (hasPermission(Permission.MANAGE_REQUESTS) &&
    activeBookRequests.length === 1
      ? activeBookRequests[0]
      : undefined);
  const hasMissingBookFormat =
    !!data.mediaInfo &&
    data.mediaInfo.status !== MediaStatus.BLOCKLISTED &&
    (!(hasEbookServiceLink || hasActiveEbookRequest) ||
      !(hasAudiobookServiceLink || hasActiveAudiobookRequest));
  const bookDownloadStatus = [
    ...(data.mediaInfo?.downloadStatus ?? []),
    ...(data.mediaInfo?.audiobookDownloadStatus ?? []),
  ];
  const canShowRequest =
    canRequest &&
    (!data.mediaInfo?.status ||
      data.mediaInfo.status === MediaStatus.UNKNOWN ||
      data.mediaInfo.status === MediaStatus.DELETED ||
      hasMissingBookFormat);
  const canReportIssue =
    !!data.mediaInfo?.id &&
    (data.mediaInfo.status === MediaStatus.AVAILABLE ||
      data.mediaInfo.status === MediaStatus.PARTIALLY_AVAILABLE) &&
    hasPermission([Permission.MANAGE_ISSUES, Permission.CREATE_ISSUES], {
      type: 'or',
    });
  const canBlocklist =
    hasPermission(Permission.MANAGE_BLOCKLIST) &&
    data.mediaInfo?.status !== MediaStatus.PROCESSING &&
    data.mediaInfo?.status !== MediaStatus.AVAILABLE &&
    data.mediaInfo?.status !== MediaStatus.PARTIALLY_AVAILABLE &&
    data.mediaInfo?.status !== MediaStatus.PENDING &&
    data.mediaInfo?.status !== MediaStatus.BLOCKLISTED;
  const canManage =
    hasPermission(Permission.MANAGE_REQUESTS) &&
    data.mediaInfo &&
    data.mediaInfo.status !== MediaStatus.UNKNOWN;
  const canWatchlist =
    data.mediaInfo?.status !== MediaStatus.BLOCKLISTED &&
    user?.userType !== UserType.PLEX;
  const openIssues =
    data.mediaInfo?.issues?.filter(
      (issue) => issue.status === IssueStatus.OPEN
    ) ?? [];
  const requestedBookFormat: RequestedBookFormat =
    preferredBookFormat ??
    (!hasEbookServiceLink && !hasActiveEbookRequest ? 'ebook' : 'audiobook');
  const requestLabel = intl.formatMessage(messages.requestBookFormat, {
    format: intl.formatMessage(getBookFormatMessage(requestedBookFormat)),
  });
  const activeRequestLabel = activeBookRequest
    ? intl.formatMessage(messages.viewRequestFormat, {
        format: intl.formatMessage(
          getBookFormatMessage(
            getRequestedBookFormat(activeBookRequest.bookFormat)
          )
        ),
      })
    : intl.formatMessage(messages.viewrequest);
  const formatCoverage: {
    format: 'ebook' | 'audiobook';
    available: boolean;
    requested: boolean;
  }[] = [
    {
      format: 'ebook',
      available: hasEbookServiceLink,
      requested: hasActiveEbookRequest,
    },
    {
      format: 'audiobook',
      available: hasAudiobookServiceLink,
      requested: hasActiveAudiobookRequest,
    },
  ];

  const blocklistBook = async () => {
    setIsBlocklisting(true);

    try {
      await axios.post('/api/v1/blocklist', {
        externalId: openLibraryWorkId,
        externalProvider: 'openlibrary',
        mediaType: MediaType.BOOK,
        title: data.title,
      });

      addToast(
        <span>
          {intl.formatMessage(globalMessages.blocklistSuccess, {
            title: data.title,
            strong: (msg: React.ReactNode) => (
              <strong key="strong">{msg}</strong>
            ),
          })}
        </span>,
        { appearance: 'success', autoDismiss: true }
      );
      revalidate();
    } catch {
      addToast(intl.formatMessage(globalMessages.blocklistError), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsBlocklisting(false);
      setShowBlocklistModal(false);
    }
  };

  const addToWatchlist = async (): Promise<void> => {
    setIsWatchlistUpdating(true);

    try {
      const response = await axios.post('/api/v1/watchlist', {
        externalId: openLibraryWorkId,
        mediaType: MediaType.BOOK,
        title: data.title,
      });

      if (response.data) {
        addToast(
          <span>
            {intl.formatMessage(messages.watchlistSuccess, {
              title: data.title,
              strong: (msg: React.ReactNode) => (
                <strong key="strong">{msg}</strong>
              ),
            })}
          </span>,
          { appearance: 'success', autoDismiss: true }
        );
      }

      setToggleWatchlist(false);
    } catch {
      addToast(intl.formatMessage(messages.watchlistError), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsWatchlistUpdating(false);
      revalidate();
    }
  };

  const removeFromWatchlist = async (): Promise<void> => {
    setIsWatchlistUpdating(true);

    try {
      await axios.delete(
        `/api/v1/watchlist/${encodeApiPathSegment(openLibraryWorkId)}?mediaType=book`
      );

      addToast(
        <span>
          {intl.formatMessage(messages.watchlistDeleted, {
            title: data.title,
            strong: (msg: React.ReactNode) => (
              <strong key="strong">{msg}</strong>
            ),
          })}
        </span>,
        { appearance: 'info', autoDismiss: true }
      );
      setToggleWatchlist(true);
    } catch {
      addToast(intl.formatMessage(messages.watchlistError), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsWatchlistUpdating(false);
      revalidate();
    }
  };

  return (
    <>
      <PageTitle title={data.title} />
      {showManager && canManage && (
        <ExternalMediaManageSlideOver
          data={data}
          mediaType={MediaType.BOOK}
          onClose={() => {
            setShowManager(false);
            router.push({
              pathname: router.pathname,
              query: {
                bookId,
                ...(preferredBookFormat ? { format: preferredBookFormat } : {}),
              },
            });
          }}
          revalidate={() => revalidate()}
          show={showManager}
        />
      )}
      {showBlocklistModal && (
        <ExternalBlocklistModal
          show={showBlocklistModal}
          type="book"
          title={data.title}
          backdrop={data.posterPath}
          onCancel={() => setShowBlocklistModal(false)}
          onComplete={blocklistBook}
          isUpdating={isBlocklisting}
        />
      )}
      {showIssueModal && (
        <IssueModal
          show={showIssueModal}
          mediaType="book"
          mediaId={data.mediaInfo?.id}
          title={data.title}
          backdrop={data.posterPath}
          onCancel={() => setShowIssueModal(false)}
        />
      )}
      {showRequestModal && (
        <RequestModal
          bookId={openLibraryWorkId}
          initialBookFormat={preferredBookFormat}
          editRequest={editRequest}
          show={showRequestModal}
          type="book"
          onComplete={() => {
            setEditRequest(undefined);
            setShowRequestModal(false);
            revalidate();
          }}
          onCancel={() => {
            setEditRequest(undefined);
            setShowRequestModal(false);
          }}
        />
      )}
      {showBulkRequestModal && data.authorId && (
        <BulkRequestModal
          show={showBulkRequestModal}
          mediaType="book"
          authorId={data.authorId}
          title={data.author ?? data.title}
          initialItems={[
            {
              id: openLibraryWorkId,
              title: data.title,
              year: data.firstPublishYear,
              image: data.posterPath,
              artist: data.author,
              isbn13: data.isbn13,
              editionId: data.editionId,
              authorId: data.authorId,
              mediaInfo: data.mediaInfo,
            },
          ]}
          onCancel={() => setShowBulkRequestModal(false)}
          onComplete={() => revalidate()}
        />
      )}
      <div className="relative z-10 mt-4 flex flex-col gap-6 lg:flex-row">
        <div className="w-full max-w-xs flex-shrink-0">
          <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-gray-800 ring-1 ring-gray-700">
            <CachedImage
              type="book"
              src={
                data.posterPath ?? '/images/seerr_poster_not_found_logo_top.png'
              }
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              fill
            />
          </div>
        </div>
        <div className="min-w-0 flex-1 text-gray-300">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <BookFormatBadge
              format={preferredBookFormat}
              variant="card"
              className="px-3 py-1 text-xs"
            />
            {data.mediaInfo?.status &&
              data.mediaInfo.status !== MediaStatus.UNKNOWN && (
                <StatusBadge
                  status={data.mediaInfo.status}
                  downloadItem={bookDownloadStatus}
                  inProgress={bookDownloadStatus.length > 0}
                  mediaType="book"
                  bookFormat={requestedBookFormat}
                  externalId={openLibraryWorkId}
                  serviceUrl={
                    data.mediaInfo.serviceUrl ??
                    data.mediaInfo.audiobookServiceUrl
                  }
                />
              )}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h1
              className="min-w-0 break-words text-3xl font-bold text-white lg:text-5xl"
              data-testid="media-title"
            >
              {data.title}
            </h1>
            <div className="flex-shrink-0">
              <AssociationBadge
                mediaType="book"
                id={openLibraryWorkId}
                variant="inline"
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            {data.author && (
              <span>
                {intl.formatMessage(messages.author)}:{' '}
                {data.authorId ? (
                  <Link href={`/author/${encodeApiPathSegment(data.authorId)}`}>
                    {data.author}
                  </Link>
                ) : (
                  data.author
                )}
              </span>
            )}
            {data.firstPublishYear && (
              <span>
                {intl.formatMessage(messages.firstPublished)}:{' '}
                {data.firstPublishYear}
              </span>
            )}
          </div>
          {data.description && (
            <div className="mt-6 max-w-4xl whitespace-pre-line text-sm leading-6">
              {data.description}
            </div>
          )}
          <div className="media-facts mt-6 max-w-4xl">
            {data.author && (
              <div className="media-fact">
                <span>{intl.formatMessage(messages.author)}</span>
                <span className="media-fact-value">
                  {data.authorId ? (
                    <Link
                      href={`/author/${encodeApiPathSegment(data.authorId)}`}
                    >
                      {data.author}
                    </Link>
                  ) : (
                    data.author
                  )}
                </span>
              </div>
            )}
            {data.firstPublishYear && (
              <div className="media-fact">
                <span>{intl.formatMessage(messages.firstPublished)}</span>
                <span className="media-fact-value">
                  {data.firstPublishYear}
                </span>
              </div>
            )}
            <div className="media-fact">
              <span>{intl.formatMessage(messages.identifiers)}</span>
              <span className="media-fact-value">
                <a
                  href={`https://openlibrary.org/works/${openLibraryWorkId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {intl.formatMessage(messages.openLibrary)}
                </a>
                {data.isbn13 && (
                  <span className="ml-2">ISBN {data.isbn13}</span>
                )}
                {data.editionId && (
                  <span className="ml-2">Edition {data.editionId}</span>
                )}
              </span>
            </div>
            {!!data.isbnCandidates?.length && (
              <div className="media-fact">
                <span>{intl.formatMessage(messages.isbnCandidates)}</span>
                <div className="media-fact-value max-w-full space-y-1">
                  {data.isbnCandidates.slice(0, 5).map((candidate) => (
                    <div
                      key={`${candidate.editionId ?? candidate.isbn}-${candidate.isbn}`}
                      className="truncate"
                      title={[candidate.isbn, candidate.title, candidate.format]
                        .filter(Boolean)
                        .join(' - ')}
                    >
                      {[candidate.isbn, candidate.title, candidate.format]
                        .filter(Boolean)
                        .join(' - ')}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          {data.mediaInfo && (
            <div className="mt-5 max-w-4xl rounded-lg border border-gray-700 bg-gray-800/60 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                {intl.formatMessage(messages.formatCoverage)}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {formatCoverage.map(({ format, available, requested }) => (
                  <div
                    key={format}
                    className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-gray-700 bg-gray-900/40 px-3 py-2"
                  >
                    <BookFormatBadge format={format} variant="compact" />
                    <span
                      className={`shrink-0 text-xs ${available ? 'text-emerald-300' : requested ? 'text-indigo-200' : 'text-gray-500'}`}
                    >
                      {intl.formatMessage(
                        available
                          ? messages.formatAvailable
                          : requested
                            ? messages.formatRequested
                            : messages.formatNotRequested
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {(canWatchlist ||
            canShowRequest ||
            canReportIssue ||
            canBlocklist ||
            canManage ||
            mediaLinks.length > 0) && (
            <div className="media-actions mt-6 justify-start gap-2 sm:justify-start xl:mt-6">
              {mediaLinks.length > 0 && (
                <div className="z-20">
                  <PlayButton links={mediaLinks} />
                </div>
              )}
              {canWatchlist && (
                <>
                  {toggleWatchlist ? (
                    <Tooltip
                      content={intl.formatMessage(messages.addtowatchlist)}
                    >
                      <Button buttonType="ghost" onClick={addToWatchlist}>
                        {isWatchlistUpdating ? (
                          <Spinner />
                        ) : (
                          <StarIcon className="text-amber-300" />
                        )}
                      </Button>
                    </Tooltip>
                  ) : (
                    <Tooltip
                      content={intl.formatMessage(messages.removefromwatchlist)}
                    >
                      <Button onClick={removeFromWatchlist}>
                        {isWatchlistUpdating ? (
                          <Spinner />
                        ) : (
                          <MinusCircleIcon />
                        )}
                      </Button>
                    </Tooltip>
                  )}
                </>
              )}
              {canShowRequest && (
                <Button
                  buttonType="primary"
                  onClick={() => {
                    setEditRequest(undefined);
                    setShowRequestModal(true);
                  }}
                >
                  <ArrowDownTrayIcon />
                  <span>{requestLabel}</span>
                </Button>
              )}
              {canRequest && data.authorId && (
                <Button
                  buttonType="default"
                  onClick={() => setShowBulkRequestModal(true)}
                >
                  <ArrowDownTrayIcon />
                  <span>
                    {intl.formatMessage(messages.requestbibliography)}
                  </span>
                </Button>
              )}
              {activeBookRequest && (
                <Button
                  buttonType="default"
                  onClick={() => {
                    setEditRequest(activeBookRequest);
                    setShowRequestModal(true);
                  }}
                >
                  <InformationCircleIcon />
                  <span>{activeRequestLabel}</span>
                </Button>
              )}
              {canManage && (
                <Tooltip content={intl.formatMessage(messages.manage)}>
                  <Button
                    buttonType="ghost"
                    onClick={() => setShowManager(true)}
                    className="relative"
                    aria-label={intl.formatMessage(messages.manage)}
                  >
                    <CogIcon className="!mr-0" />
                    {openIssues.length > 0 && (
                      <>
                        <div className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-red-600" />
                        <div className="absolute -right-1 -top-1 h-3 w-3 animate-ping rounded-full bg-red-600" />
                      </>
                    )}
                  </Button>
                </Tooltip>
              )}
              {canReportIssue && (
                <Tooltip content={intl.formatMessage(messages.reportissue)}>
                  <Button
                    buttonType="warning"
                    onClick={() => setShowIssueModal(true)}
                    aria-label={intl.formatMessage(messages.reportissue)}
                  >
                    <ExclamationTriangleIcon className="!mr-0" />
                  </Button>
                </Tooltip>
              )}
              {canBlocklist && (
                <Tooltip
                  content={intl.formatMessage(globalMessages.addToBlocklist)}
                >
                  <Button
                    buttonType="ghost"
                    onClick={() => setShowBlocklistModal(true)}
                    aria-label={intl.formatMessage(
                      globalMessages.addToBlocklist
                    )}
                  >
                    <EyeSlashIcon className="!mr-0" />
                  </Button>
                </Tooltip>
              )}
            </div>
          )}
          {!!data.subjects?.length && (
            <div className="mt-6">
              <h2 className="mb-2 text-lg font-semibold text-white">
                {intl.formatMessage(messages.subjects)}
              </h2>
              <div className="flex flex-wrap gap-2">
                {data.subjects.map((subject) => (
                  <span
                    key={subject}
                    className="rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-200 ring-1 ring-gray-700"
                  >
                    {subject}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      {hasPermission([Permission.MANAGE_ISSUES, Permission.VIEW_ISSUES], {
        type: 'or',
      }) &&
        openIssues.length > 0 && (
          <div className="mt-10">
            <h2 className="mb-4 text-2xl font-bold text-white">
              {intl.formatMessage(messages.openissues)}
            </h2>
            <div className="overflow-hidden rounded-lg ring-1 ring-gray-800">
              <ul>
                {openIssues.map((issue) => (
                  <li
                    key={`book-issue-${issue.id}`}
                    className="border-b border-gray-800 last:border-b-0"
                  >
                    <IssueBlock issue={issue} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
    </>
  );
};

export default BookDetails;
