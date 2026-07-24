import Spinner from '@app/assets/spinner.svg';
import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import Tooltip from '@app/components/Common/Tooltip';
import StatusBadge from '@app/components/StatusBadge';
import useDeepLinks from '@app/hooks/useDeepLinks';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import {
  encodeApiPathSegment,
  normalizeMusicBrainzId,
  normalizeOpenLibraryWorkId,
} from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
import { refreshIntervalHelper } from '@app/utils/refreshIntervalHelper';
import { withProperties } from '@app/utils/typeHelpers';
import {
  ArrowPathIcon,
  CheckIcon,
  PencilIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { NonFunctionProperties } from '@server/interfaces/api/common';
import type { BookDetails } from '@server/models/Book';
import type { MovieDetails } from '@server/models/Movie';
import type { MusicDetails } from '@server/models/Music';
import type { TvDetails } from '@server/models/Tv';
import axios from 'axios';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const RequestModal = dynamic(() => import('@app/components/RequestModal'), {
  ssr: false,
});

const messages = defineMessages('components.RequestCard', {
  seasons: '{seasonCount, plural, one {Season} other {Seasons}}',
  failedretry: 'Something went wrong while retrying the request.',
  failedmodify: 'Something went wrong while modifying the request.',
  mediaerror: '{mediaType} Not Found',
  tmdbid: 'TMDB ID',
  tvdbid: 'TheTVDB ID',
  approverequest: 'Approve Request',
  declinerequest: 'Decline Request',
  editrequest: 'Edit Request',
  cancelrequest: 'Cancel Request',
  deleterequest: 'Delete Request',
  unknowntitle: 'Unknown Title',
  bookFormat: 'Format',
  ebook: 'Ebook',
  audiobook: 'Audiobook',
  both: 'Both',
  partialBookService: 'Partial Bookshelf link',
});

const isMovie = (
  media: MovieDetails | TvDetails | MusicDetails | BookDetails
): media is MovieDetails => {
  return (
    (media as MovieDetails).title !== undefined &&
    (media as MusicDetails).artist === undefined
  );
};

const isMusic = (
  media: MovieDetails | TvDetails | MusicDetails | BookDetails
): media is MusicDetails => {
  return (media as MusicDetails).artist !== undefined;
};

const isBook = (
  media: MovieDetails | TvDetails | MusicDetails | BookDetails
): media is BookDetails => {
  return (media as BookDetails).mediaType === 'book';
};

const getBookId = (request: NonFunctionProperties<MediaRequest>) =>
  request.media.identifiers?.find(
    (identifier) => identifier.provider === 'openlibrary'
  )?.value;

const getNormalizedBookId = (request: NonFunctionProperties<MediaRequest>) => {
  const bookId = getBookId(request);
  return bookId ? normalizeOpenLibraryWorkId(bookId) : undefined;
};

const getNormalizedMusicId = (request: NonFunctionProperties<MediaRequest>) =>
  request.media.mbId ? normalizeMusicBrainzId(request.media.mbId) : undefined;

const getRequestDetailHref = (
  request: NonFunctionProperties<MediaRequest>,
  manage = false
) => {
  const suffix = manage ? '?manage=1' : '';
  const bookId = getNormalizedBookId(request);
  const musicId = getNormalizedMusicId(request);

  if (request.type === 'music' && musicId) {
    return `/music/${encodeApiPathSegment(musicId)}${suffix}`;
  }

  if (request.type === 'book' && bookId) {
    return `/book/${encodeApiPathSegment(bookId)}${suffix}`;
  }

  return `/${request.type}/${request.media.tmdbId}${suffix}`;
};

const getRequestDownloadStatus = (
  request: NonFunctionProperties<MediaRequest>
) => {
  if (request.type === 'book') {
    if (request.bookFormat === 'audiobook') {
      return request.media.audiobookDownloadStatus;
    }

    if (request.bookFormat === 'both') {
      return [
        ...(request.media.downloadStatus ?? []),
        ...(request.media.audiobookDownloadStatus ?? []),
      ];
    }
  }

  return request.media[request.is4k ? 'downloadStatus4k' : 'downloadStatus'];
};

const getRequestServiceUrl = (request: NonFunctionProperties<MediaRequest>) => {
  if (request.type === 'book') {
    if (request.bookFormat === 'audiobook') {
      return request.media.audiobookServiceUrl;
    }

    if (request.bookFormat === 'both') {
      return request.media.serviceUrl ?? request.media.audiobookServiceUrl;
    }
  }

  return request.is4k ? request.media.serviceUrl4k : request.media.serviceUrl;
};

const hasBookFormat = (
  request: NonFunctionProperties<MediaRequest>,
  format: 'ebook' | 'audiobook'
) => {
  if (format === 'audiobook') {
    return (
      request.media.audiobookExternalServiceId !== null &&
      request.media.audiobookExternalServiceId !== undefined
    );
  }

  return (
    request.media.externalServiceId !== null &&
    request.media.externalServiceId !== undefined
  );
};

const getRequestMediaStatus = (
  request: NonFunctionProperties<MediaRequest>
) => {
  if (request.type !== 'book') {
    return request.media[request.is4k ? 'status4k' : 'status'];
  }

  if (request.bookFormat === 'audiobook') {
    return hasBookFormat(request, 'audiobook')
      ? MediaStatus.AVAILABLE
      : request.media.status;
  }

  if (request.bookFormat === 'both') {
    const hasEbook = hasBookFormat(request, 'ebook');
    const hasAudiobook = hasBookFormat(request, 'audiobook');

    if (hasEbook && hasAudiobook) {
      return MediaStatus.AVAILABLE;
    }

    if (hasEbook || hasAudiobook) {
      return MediaStatus.PARTIALLY_AVAILABLE;
    }

    return request.media.status;
  }

  return hasBookFormat(request, 'ebook')
    ? MediaStatus.AVAILABLE
    : request.media.status;
};

const RequestCardPlaceholder = () => {
  return (
    <div className="relative min-h-[17rem] w-72 animate-pulse rounded-xl bg-gray-700 p-4 sm:w-96">
      <div className="w-20 sm:w-28">
        <div className="w-full" style={{ paddingBottom: '150%' }} />
      </div>
    </div>
  );
};

interface RequestCardErrorProps {
  requestData?: NonFunctionProperties<MediaRequest>;
}

const RequestCardError = ({ requestData }: RequestCardErrorProps) => {
  const { hasPermission } = useUser();
  const intl = useIntl();

  const { mediaUrl: plexUrl, mediaUrl4k: plexUrl4k } = useDeepLinks({
    mediaUrl: requestData?.media?.mediaUrl,
    mediaUrl4k: requestData?.media?.mediaUrl4k,
    iOSPlexUrl: requestData?.media?.iOSPlexUrl,
    iOSPlexUrl4k: requestData?.media?.iOSPlexUrl4k,
  });

  const deleteRequest = async () => {
    await axios.delete(`/api/v1/media/${requestData?.media.id}`);
    mutate('/api/v1/media?filter=allavailable&take=20&sort=mediaAdded');
    mutate('/api/v1/request?filter=all&take=10&sort=modified&skip=0');
    mutate('/api/v1/request/count');
  };

  return (
    <div
      className="relative flex w-72 overflow-hidden rounded-xl bg-gray-800 p-4 text-gray-400 shadow ring-1 ring-red-500 sm:w-96"
      data-testid="request-card"
    >
      <div className="w-20 sm:w-28">
        <div className="w-full" style={{ paddingBottom: '150%' }}>
          <div className="absolute inset-0 z-10 flex min-w-0 flex-1 flex-col p-4">
            <div
              className="whitespace-normal text-base font-bold text-white sm:text-lg"
              data-testid="request-card-title"
            >
              {intl.formatMessage(messages.mediaerror, {
                mediaType: intl.formatMessage(
                  requestData?.type
                    ? requestData?.type === 'movie'
                      ? globalMessages.movie
                      : requestData?.type === 'tv'
                        ? globalMessages.tvshow
                        : requestData?.type === 'music'
                          ? globalMessages.music
                          : globalMessages.book
                    : globalMessages.request
                ),
              })}
            </div>
            {requestData && (
              <>
                {hasPermission(
                  [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
                  { type: 'or' }
                ) && (
                  <div className="card-field !hidden sm:!block">
                    <Link
                      href={`/users/${requestData.requestedBy.id}`}
                      className="group flex items-center"
                    >
                      <span className="avatar-sm">
                        <CachedImage
                          type="avatar"
                          src={requestData.requestedBy.avatar}
                          alt=""
                          className="avatar-sm object-cover"
                          width={20}
                          height={20}
                        />
                      </span>
                      <span className="truncate group-hover:underline">
                        {requestData.requestedBy.displayName}
                      </span>
                    </Link>
                  </div>
                )}
                <div className="mt-2 flex items-center text-sm sm:mt-1">
                  <span className="mr-2 hidden font-bold sm:block">
                    {intl.formatMessage(globalMessages.status)}
                  </span>
                  {requestData.status === MediaRequestStatus.DECLINED ||
                  requestData.status === MediaRequestStatus.FAILED ? (
                    <Badge badgeType="danger">
                      {requestData.status === MediaRequestStatus.DECLINED
                        ? intl.formatMessage(globalMessages.declined)
                        : intl.formatMessage(globalMessages.failed)}
                    </Badge>
                  ) : (
                    <StatusBadge
                      status={getRequestMediaStatus(requestData)}
                      downloadItem={getRequestDownloadStatus(requestData)}
                      title={intl.formatMessage(messages.unknowntitle)}
                      inProgress={
                        (getRequestDownloadStatus(requestData) ?? []).length > 0
                      }
                      is4k={requestData.is4k}
                      externalId={
                        requestData.type === 'book'
                          ? getBookId(requestData)
                          : undefined
                      }
                      mediaType={
                        requestData.type === 'music'
                          ? 'music'
                          : requestData.type === 'book'
                            ? 'book'
                            : requestData.type === 'tv'
                              ? 'tv'
                              : 'movie'
                      }
                      plexUrl={requestData.is4k ? plexUrl4k : plexUrl}
                      serviceUrl={getRequestServiceUrl(requestData)}
                    />
                  )}
                </div>
              </>
            )}
            <div className="flex flex-1 items-end space-x-2">
              {hasPermission(Permission.MANAGE_REQUESTS) &&
                requestData?.media.id && (
                  <>
                    <Button
                      buttonType="danger"
                      buttonSize="sm"
                      className="mt-4 hidden sm:block"
                      onClick={() => deleteRequest()}
                    >
                      <TrashIcon />
                      <span>{intl.formatMessage(globalMessages.delete)}</span>
                    </Button>
                    <Tooltip
                      content={intl.formatMessage(messages.deleterequest)}
                    >
                      <Button
                        buttonType="danger"
                        buttonSize="sm"
                        className="mt-4 sm:hidden"
                        onClick={() => deleteRequest()}
                      >
                        <TrashIcon />
                      </Button>
                    </Tooltip>
                  </>
                )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface RequestCardProps {
  request: NonFunctionProperties<MediaRequest>;
  onTitleData?: (
    requestId: number,
    title: MovieDetails | TvDetails | MusicDetails | BookDetails
  ) => void;
}

const RequestCard = ({ request, onTitleData }: RequestCardProps) => {
  const { ref, inView } = useInView({
    triggerOnce: true,
  });
  const intl = useIntl();
  const { user, hasPermission } = useUser();
  const { addToast } = useToasts();
  const [isRetrying, setRetrying] = useState(false);
  const [updatingType, setUpdatingType] = useState<
    'approve' | 'decline' | null
  >(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const bookId =
    request.type === 'book' ? getNormalizedBookId(request) : undefined;
  const musicId =
    request.type === 'music' ? getNormalizedMusicId(request) : undefined;
  const url =
    request.type === 'movie'
      ? `/api/v1/movie/${request.media.tmdbId}`
      : request.type === 'tv'
        ? `/api/v1/tv/${request.media.tmdbId}`
        : request.type === 'music' && musicId
          ? `/api/v1/music/${encodeApiPathSegment(musicId)}`
          : request.type === 'book' && bookId
            ? `/api/v1/book/${encodeApiPathSegment(bookId)}`
            : null;

  const { data: title, error } = useSWR<
    MovieDetails | TvDetails | MusicDetails | BookDetails
  >(inView ? url : null);
  const {
    data: requestData,
    error: requestError,
    mutate: revalidate,
  } = useSWR<NonFunctionProperties<MediaRequest>>(
    `/api/v1/request/${request.id}`,
    {
      fallbackData: request,
      refreshInterval: refreshIntervalHelper(
        {
          downloadStatus: request.media.downloadStatus,
          downloadStatus4k: request.media.downloadStatus4k,
          audiobookDownloadStatus: request.media.audiobookDownloadStatus,
        },
        15000
      ),
    }
  );
  const hasPartialBookService =
    requestData?.type === 'book' &&
    requestData.bookFormat === 'both' &&
    !!(
      requestData.media.serviceId !== requestData.media.audiobookServiceId &&
      (requestData.media.serviceId || requestData.media.audiobookServiceId)
    );

  const { mediaUrl: plexUrl, mediaUrl4k: plexUrl4k } = useDeepLinks({
    mediaUrl: requestData?.media?.mediaUrl,
    mediaUrl4k: requestData?.media?.mediaUrl4k,
    iOSPlexUrl: requestData?.media?.iOSPlexUrl,
    iOSPlexUrl4k: requestData?.media?.iOSPlexUrl4k,
  });

  const modifyRequest = async (type: 'approve' | 'decline') => {
    setUpdatingType(type);
    try {
      await axios.post(`/api/v1/request/${request.id}/${type}`);
      revalidate();
      mutate('/api/v1/request/count');
    } catch {
      addToast(intl.formatMessage(messages.failedmodify), {
        autoDismiss: true,
        appearance: 'error',
      });
    } finally {
      setUpdatingType(null);
    }
  };

  const deleteRequest = async () => {
    await axios.delete(`/api/v1/request/${request.id}`);
    mutate('/api/v1/request?filter=all&take=10&sort=modified&skip=0');
    mutate('/api/v1/request/count');
  };

  const retryRequest = async () => {
    setRetrying(true);

    try {
      const response = await axios.post(`/api/v1/request/${request.id}/retry`);

      if (response) {
        revalidate();
      }
    } catch {
      addToast(intl.formatMessage(messages.failedretry), {
        autoDismiss: true,
        appearance: 'error',
      });
    } finally {
      setRetrying(false);
    }
  };

  useEffect(() => {
    if (title && onTitleData) {
      onTitleData(request.id, title);
    }
  }, [title, onTitleData, request]);

  if (!title && !error) {
    return (
      <div ref={ref}>
        <RequestCardPlaceholder />
      </div>
    );
  }

  if (!requestData && !requestError) {
    return <RequestCardError />;
  }

  if (!title || !requestData) {
    return <RequestCardError requestData={requestData} />;
  }

  return (
    <>
      {showEditModal && (
        <RequestModal
          show={showEditModal}
          tmdbId={
            request.type === 'music' || request.type === 'book'
              ? undefined
              : request.media.tmdbId
          }
          mbId={request.type === 'music' ? musicId : undefined}
          bookId={request.type === 'book' ? bookId : undefined}
          type={
            request.type === 'music'
              ? 'music'
              : request.type === 'book'
                ? 'book'
                : request.type === 'tv'
                  ? 'tv'
                  : 'movie'
          }
          is4k={request.is4k}
          editRequest={request}
          onCancel={() => setShowEditModal(false)}
          onComplete={() => {
            revalidate();
            setShowEditModal(false);
          }}
        />
      )}
      <div
        className="relative flex min-h-[17rem] w-72 overflow-hidden rounded-xl bg-gray-800 bg-cover bg-center p-4 text-gray-400 shadow ring-1 ring-gray-700 sm:w-96"
        data-testid="request-card"
      >
        {!isMusic(title) && !isBook(title) && title.backdropPath && (
          <div className="absolute inset-0 z-0">
            <CachedImage
              type="tmdb"
              alt=""
              src={`https://image.tmdb.org/t/p/w1920_and_h800_multi_faces/${title.backdropPath}`}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              fill
            />
            <div
              className="absolute inset-0"
              style={{
                backgroundImage:
                  'linear-gradient(135deg, rgba(17, 24, 39, 0.47) 0%, rgba(17, 24, 39, 1) 75%)',
              }}
            />
          </div>
        )}
        <div
          className="relative z-10 flex min-w-0 flex-1 flex-col pr-4"
          data-testid="request-card-title"
        >
          <div className="hidden text-xs font-medium text-white sm:flex">
            {(isMovie(title)
              ? title.releaseDate
              : isMusic(title)
                ? title.releaseDate
                : isBook(title)
                  ? title.firstPublishYear?.toString()
                  : title.firstAirDate
            )?.slice(0, 4)}
            {isMusic(title) && (
              <>
                <span className="mx-2">-</span>
                <span className="truncate">{title.artist.name}</span>
              </>
            )}
            {isBook(title) && title.author && (
              <>
                <span className="mx-2">-</span>
                <span className="truncate">{title.author}</span>
              </>
            )}
          </div>
          <Link
            href={getRequestDetailHref(requestData)}
            className="overflow-hidden overflow-ellipsis whitespace-nowrap text-base font-bold text-white hover:underline sm:text-lg"
          >
            {isMovie(title)
              ? title.title
              : isMusic(title)
                ? title.title
                : isBook(title)
                  ? title.title
                  : title.name}
          </Link>
          {hasPermission(
            [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
            { type: 'or' }
          ) && (
            <div className="card-field">
              <Link
                href={`/users/${requestData.requestedBy.id}`}
                className="group flex items-center"
              >
                <span className="avatar-sm">
                  <CachedImage
                    type="avatar"
                    src={requestData.requestedBy.avatar}
                    alt=""
                    className="avatar-sm object-cover"
                    width={20}
                    height={20}
                  />
                </span>
                <span className="truncate font-semibold group-hover:text-white group-hover:underline">
                  {requestData.requestedBy.displayName}
                </span>
              </Link>
            </div>
          )}
          {!isMovie(title) &&
            !isMusic(title) &&
            !isBook(title) &&
            request.seasons.length > 0 && (
              <div className="my-0.5 hidden items-center text-sm sm:my-1 sm:flex">
                <span className="mr-2 font-bold">
                  {intl.formatMessage(messages.seasons, {
                    seasonCount: request.seasons.length,
                  })}
                </span>
                <div className="hide-scrollbar overflow-x-scroll">
                  {request.seasons.map((season) => (
                    <span key={`season-${season.id}`} className="mr-2">
                      <Badge>
                        {season.seasonNumber === 0
                          ? intl.formatMessage(globalMessages.specials)
                          : season.seasonNumber}
                      </Badge>
                    </span>
                  ))}
                </div>
              </div>
            )}
          {requestData.type === 'book' && requestData.bookFormat && (
            <div className="card-field">
              <span className="card-field-name">
                {intl.formatMessage(messages.bookFormat)}
              </span>
              <span className="flex truncate text-sm text-gray-300">
                {intl.formatMessage(
                  requestData.bookFormat === 'audiobook'
                    ? messages.audiobook
                    : requestData.bookFormat === 'both'
                      ? messages.both
                      : messages.ebook
                )}
              </span>
            </div>
          )}
          {hasPartialBookService && (
            <div className="card-field">
              <span className="card-field-name">
                {intl.formatMessage(messages.partialBookService)}
              </span>
              <span className="flex truncate text-sm text-gray-300">
                {requestData.media.serviceId
                  ? intl.formatMessage(messages.ebook)
                  : intl.formatMessage(messages.audiobook)}
              </span>
            </div>
          )}
          <div className="mt-2 flex items-center text-sm sm:mt-1">
            <span className="mr-2 hidden font-bold sm:block">
              {intl.formatMessage(globalMessages.status)}
            </span>
            {requestData.status === MediaRequestStatus.DECLINED ? (
              <Badge badgeType="danger">
                {intl.formatMessage(globalMessages.declined)}
              </Badge>
            ) : requestData.status === MediaRequestStatus.FAILED ? (
              <Badge
                badgeType="danger"
                href={getRequestDetailHref(requestData, true)}
              >
                {intl.formatMessage(globalMessages.failed)}
              </Badge>
            ) : requestData.status === MediaRequestStatus.PENDING &&
              getRequestMediaStatus(requestData) === MediaStatus.DELETED ? (
              <Badge
                badgeType="warning"
                href={getRequestDetailHref(requestData, true)}
              >
                {intl.formatMessage(globalMessages.pending)}
              </Badge>
            ) : (
              <StatusBadge
                status={getRequestMediaStatus(requestData)}
                downloadItem={getRequestDownloadStatus(requestData)}
                title={
                  isMovie(title)
                    ? title.title
                    : isMusic(title)
                      ? title.title
                      : isBook(title)
                        ? title.title
                        : title.name
                }
                inProgress={
                  (getRequestDownloadStatus(requestData) ?? []).length > 0
                }
                is4k={requestData.is4k}
                tmdbId={
                  requestData.type === 'music'
                    ? undefined
                    : requestData.type === 'book'
                      ? undefined
                      : requestData.media.tmdbId
                }
                mbId={
                  requestData.type === 'music'
                    ? (requestData.media.mbId ?? undefined)
                    : undefined
                }
                externalId={
                  requestData.type === 'book'
                    ? getBookId(requestData)
                    : undefined
                }
                mediaType={
                  requestData.type === 'music'
                    ? 'music'
                    : requestData.type === 'book'
                      ? 'book'
                      : requestData.type === 'tv'
                        ? 'tv'
                        : 'movie'
                }
                plexUrl={requestData.is4k ? plexUrl4k : plexUrl}
                serviceUrl={getRequestServiceUrl(requestData)}
              />
            )}
          </div>
          <div className="flex flex-1 items-end space-x-2">
            {requestData.status === MediaRequestStatus.FAILED &&
              hasPermission(Permission.MANAGE_REQUESTS) && (
                <Button
                  buttonType="primary"
                  buttonSize="sm"
                  disabled={isRetrying}
                  onClick={() => retryRequest()}
                >
                  <ArrowPathIcon
                    className={isRetrying ? 'animate-spin' : ''}
                    style={{ marginRight: '0', animationDirection: 'reverse' }}
                  />
                  <span className="ml-1.5 hidden sm:block">
                    {intl.formatMessage(globalMessages.retry)}
                  </span>
                </Button>
              )}
            {requestData.status === MediaRequestStatus.PENDING &&
              hasPermission(Permission.MANAGE_REQUESTS) && (
                <>
                  <div>
                    <Button
                      buttonType="success"
                      buttonSize="sm"
                      className="hidden sm:block"
                      onClick={() => modifyRequest('approve')}
                      disabled={updatingType !== null}
                    >
                      {updatingType === 'approve' ? <Spinner /> : <CheckIcon />}
                      <span>{intl.formatMessage(globalMessages.approve)}</span>
                    </Button>
                    <Tooltip
                      content={intl.formatMessage(messages.approverequest)}
                    >
                      <Button
                        buttonType="success"
                        buttonSize="sm"
                        className="sm:hidden"
                        onClick={() => modifyRequest('approve')}
                        disabled={updatingType !== null}
                      >
                        {updatingType === 'approve' ? (
                          <Spinner />
                        ) : (
                          <CheckIcon />
                        )}
                      </Button>
                    </Tooltip>
                  </div>
                  <div>
                    <Button
                      buttonType="danger"
                      buttonSize="sm"
                      className="hidden sm:block"
                      onClick={() => modifyRequest('decline')}
                      disabled={updatingType !== null}
                    >
                      {updatingType === 'decline' ? <Spinner /> : <XMarkIcon />}
                      <span>{intl.formatMessage(globalMessages.decline)}</span>
                    </Button>
                    <Tooltip
                      content={intl.formatMessage(messages.declinerequest)}
                    >
                      <Button
                        buttonType="danger"
                        buttonSize="sm"
                        className="sm:hidden"
                        onClick={() => modifyRequest('decline')}
                        disabled={updatingType !== null}
                      >
                        {updatingType === 'decline' ? (
                          <Spinner />
                        ) : (
                          <XMarkIcon />
                        )}
                      </Button>
                    </Tooltip>
                  </div>
                </>
              )}
            {requestData.status === MediaRequestStatus.PENDING &&
              !hasPermission(Permission.MANAGE_REQUESTS) &&
              requestData.requestedBy.id === user?.id &&
              (requestData.type === 'tv' ||
                hasPermission(Permission.REQUEST_ADVANCED)) && (
                <div>
                  {!hasPermission(Permission.MANAGE_REQUESTS) && (
                    <Button
                      buttonType="primary"
                      buttonSize="sm"
                      className="hidden sm:block"
                      onClick={() => setShowEditModal(true)}
                      disabled={updatingType !== null}
                    >
                      <PencilIcon />
                      <span>{intl.formatMessage(globalMessages.edit)}</span>
                    </Button>
                  )}
                  <Tooltip content={intl.formatMessage(messages.editrequest)}>
                    <Button
                      buttonType="primary"
                      buttonSize="sm"
                      className="sm:hidden"
                      onClick={() => setShowEditModal(true)}
                      disabled={updatingType !== null}
                    >
                      <PencilIcon />
                    </Button>
                  </Tooltip>
                </div>
              )}
            {requestData.status === MediaRequestStatus.PENDING &&
              !hasPermission(Permission.MANAGE_REQUESTS) &&
              requestData.requestedBy.id === user?.id && (
                <div>
                  <Button
                    buttonType="danger"
                    buttonSize="sm"
                    className="hidden sm:block"
                    onClick={() => deleteRequest()}
                  >
                    <XMarkIcon />
                    <span>{intl.formatMessage(globalMessages.cancel)}</span>
                  </Button>
                  <Tooltip content={intl.formatMessage(messages.cancelrequest)}>
                    <Button
                      buttonType="danger"
                      buttonSize="sm"
                      className="sm:hidden"
                      onClick={() => deleteRequest()}
                    >
                      <XMarkIcon />
                    </Button>
                  </Tooltip>
                </div>
              )}
          </div>
        </div>
        <Link
          href={getRequestDetailHref(requestData)}
          className="w-20 flex-shrink-0 scale-100 transform-gpu cursor-pointer overflow-hidden rounded-md shadow-sm transition duration-300 hover:scale-105 hover:shadow-md sm:w-28"
        >
          <CachedImage
            type={isBook(title) ? 'book' : isMusic(title) ? 'music' : 'tmdb'}
            src={
              (isMusic(title) || isBook(title)) && title.posterPath
                ? title.posterPath
                : !isMusic(title) && !isBook(title) && title.posterPath
                  ? `https://image.tmdb.org/t/p/w600_and_h900_bestv2${title.posterPath}`
                  : '/images/seerr_poster_not_found.png'
            }
            alt=""
            sizes="100vw"
            style={{ width: '100%', height: 'auto' }}
            width={600}
            height={900}
          />
        </Link>
      </div>
    </>
  );
};

export default withProperties(RequestCard, {
  Placeholder: RequestCardPlaceholder,
});
