import Spinner from '@app/assets/spinner.svg';
import AssociationBadge from '@app/components/Association/AssociationBadge';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import Tooltip from '@app/components/Common/Tooltip';
import IssueBlock from '@app/components/IssueBlock';
import MediaSlider from '@app/components/MediaSlider';
import BulkRequestModal from '@app/components/RequestModal/BulkRequestModal';
import StatusBadge from '@app/components/StatusBadge';
import useToasts from '@app/hooks/useToasts';
import { getQueryParamString } from '@app/hooks/useUpdateQueryParams';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import { encodeApiPathSegment } from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
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
import { UserType } from '@server/constants/user';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { NonFunctionProperties } from '@server/interfaces/api/common';
import type { MusicDetails as MusicDetailsType } from '@server/models/Music';
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

const messages = defineMessages('components.MusicDetails', {
  album: 'Album',
  artist: 'Artist',
  releasedate: 'Release Date',
  identifiers: 'Identifiers',
  musicbrainz: 'MusicBrainz',
  tracks: 'Tracks',
  noTracks: 'No tracks available.',
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
  similarartists: 'Similar Artists',
  requestdiscography: 'Request Discography',
});

const MusicDetails = () => {
  const router = useRouter();
  const intl = useIntl();
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
  const musicId = getQueryParamString(router.query.musicId);

  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<MusicDetailsType>(
    musicId ? `/api/v1/music/${encodeApiPathSegment(musicId)}` : null
  );

  useEffect(() => {
    setShowManager(router.query.manage === '1');
  }, [router.query.manage]);

  useEffect(() => {
    setToggleWatchlist(!data?.onUserWatchlist);
  }, [data?.onUserWatchlist]);

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  if (!data) {
    return <ErrorPage statusCode={404} />;
  }

  const canRequest = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_MUSIC],
    { type: 'or' }
  );
  const canShowRequest =
    canRequest &&
    (!data.mediaInfo?.status ||
      data.mediaInfo.status === MediaStatus.UNKNOWN ||
      data.mediaInfo.status === MediaStatus.DELETED ||
      data.mediaInfo.status === MediaStatus.PROCESSING);
  const activeMusicRequests =
    data.mediaInfo?.requests?.filter(
      (request) =>
        request.status !== MediaRequestStatus.DECLINED &&
        request.status !== MediaRequestStatus.FAILED &&
        request.status !== MediaRequestStatus.COMPLETED
    ) ?? [];
  const activeMusicRequest =
    activeMusicRequests.find(
      (request) => request.requestedBy.id === user?.id
    ) ??
    (hasPermission(Permission.MANAGE_REQUESTS) &&
    activeMusicRequests.length === 1
      ? activeMusicRequests[0]
      : undefined);
  const canReportIssue =
    !!data.mediaInfo?.id &&
    data.mediaInfo.status === MediaStatus.AVAILABLE &&
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

  const blocklistAlbum = async () => {
    setIsBlocklisting(true);

    try {
      await axios.post('/api/v1/blocklist', {
        externalId: data.mbId,
        externalProvider: 'musicbrainz',
        mediaType: MediaType.MUSIC,
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
        mbId: data.mbId,
        mediaType: MediaType.MUSIC,
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
        `/api/v1/watchlist/${encodeApiPathSegment(data.mbId)}?mediaType=music`
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
      {showManager && (
        <ExternalMediaManageSlideOver
          data={data}
          mediaType={MediaType.MUSIC}
          onClose={() => {
            setShowManager(false);
            router.push({
              pathname: router.pathname,
              query: { musicId },
            });
          }}
          revalidate={() => revalidate()}
          show={showManager}
        />
      )}
      {showBlocklistModal && (
        <ExternalBlocklistModal
          show={showBlocklistModal}
          type="music"
          title={data.title}
          backdrop={data.artistBackdrop}
          onCancel={() => setShowBlocklistModal(false)}
          onComplete={blocklistAlbum}
          isUpdating={isBlocklisting}
        />
      )}
      {showIssueModal && (
        <IssueModal
          show={showIssueModal}
          mediaType="music"
          mediaId={data.mediaInfo?.id}
          title={data.title}
          backdrop={data.artistBackdrop}
          onCancel={() => setShowIssueModal(false)}
        />
      )}
      {showRequestModal && (
        <RequestModal
          editRequest={editRequest}
          show={showRequestModal}
          type="music"
          mbId={data.id}
          onCancel={() => {
            setEditRequest(undefined);
            setShowRequestModal(false);
          }}
          onComplete={() => {
            setEditRequest(undefined);
            setShowRequestModal(false);
            revalidate();
          }}
        />
      )}
      {showBulkRequestModal && data.artist.id && (
        <BulkRequestModal
          show={showBulkRequestModal}
          mediaType="music"
          artistId={data.artist.id}
          title={data.artist.name}
          onCancel={() => setShowBulkRequestModal(false)}
          onComplete={() => revalidate()}
        />
      )}
      <div className="relative z-10 mt-4 flex flex-col gap-6 lg:flex-row">
        <div className="w-full max-w-xs flex-shrink-0">
          <div className="relative aspect-square overflow-hidden rounded-xl bg-gray-800 ring-1 ring-gray-700">
            <CachedImage
              type="music"
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
            <span className="rounded-full border border-emerald-500 bg-emerald-600/80 px-3 py-1 text-xs font-medium uppercase tracking-wider text-white">
              {intl.formatMessage(messages.album)}
            </span>
            {data.mediaInfo?.status &&
              data.mediaInfo.status !== MediaStatus.UNKNOWN && (
                <StatusBadge
                  status={data.mediaInfo.status}
                  downloadItem={data.mediaInfo.downloadStatus}
                  inProgress={(data.mediaInfo.downloadStatus ?? []).length > 0}
                  mediaType="music"
                  mbId={data.mbId}
                  serviceUrl={data.mediaInfo.serviceUrl}
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
                mediaType="album"
                id={data.id}
                variant="inline"
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <Link
              href={`/artist/${encodeApiPathSegment(data.artist.id)}`}
              className="font-medium text-gray-100 transition hover:text-white"
            >
              {data.artist.name}
            </Link>
            {data.releaseDate && (
              <span>
                {intl.formatMessage(messages.releasedate)}:{' '}
                {data.releaseDate.slice(0, 4)}
              </span>
            )}
            {data.type && <span>{data.type}</span>}
          </div>
          {(canWatchlist ||
            canShowRequest ||
            canReportIssue ||
            canBlocklist ||
            canManage) && (
            <div className="media-actions mt-6 justify-start gap-2 sm:justify-start xl:mt-6">
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
                  <span>{intl.formatMessage(globalMessages.request)}</span>
                </Button>
              )}
              {canRequest && data.artist.id && (
                <Button
                  buttonType="default"
                  onClick={() => setShowBulkRequestModal(true)}
                >
                  <ArrowDownTrayIcon />
                  <span>{intl.formatMessage(messages.requestdiscography)}</span>
                </Button>
              )}
              {activeMusicRequest && (
                <Button
                  buttonType="default"
                  onClick={() => {
                    setEditRequest(activeMusicRequest);
                    setShowRequestModal(true);
                  }}
                >
                  <InformationCircleIcon />
                  <span>{intl.formatMessage(messages.viewrequest)}</span>
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
          <div className="media-facts mt-6 max-w-4xl">
            <div className="media-fact">
              <span>{intl.formatMessage(messages.artist)}</span>
              <span className="media-fact-value">
                <Link href={`/artist/${encodeApiPathSegment(data.artist.id)}`}>
                  {data.artist.name}
                </Link>
              </span>
            </div>
            {data.releaseDate && (
              <div className="media-fact">
                <span>{intl.formatMessage(messages.releasedate)}</span>
                <span className="media-fact-value">{data.releaseDate}</span>
              </div>
            )}
            {data.type && (
              <div className="media-fact">
                <span>{intl.formatMessage(messages.album)}</span>
                <span className="media-fact-value">{data.type}</span>
              </div>
            )}
            <div className="media-fact">
              <span>{intl.formatMessage(messages.identifiers)}</span>
              <span className="media-fact-value">
                <a
                  href={`https://musicbrainz.org/release-group/${data.mbId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {intl.formatMessage(messages.musicbrainz)}
                </a>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-10">
        {hasPermission([Permission.MANAGE_ISSUES, Permission.VIEW_ISSUES], {
          type: 'or',
        }) &&
          openIssues.length > 0 && (
            <div className="mb-10">
              <h2 className="mb-4 text-2xl font-bold text-white">
                {intl.formatMessage(messages.openissues)}
              </h2>
              <div className="overflow-hidden rounded-lg ring-1 ring-gray-800">
                <ul>
                  {openIssues.map((issue) => (
                    <li
                      key={`music-issue-${issue.id}`}
                      className="border-b border-gray-800 last:border-b-0"
                    >
                      <IssueBlock issue={issue} />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        <h2 className="mb-4 text-2xl font-bold text-white">
          {intl.formatMessage(messages.tracks)}
        </h2>
        {data.tracks.length ? (
          <ol className="divide-y divide-gray-800 overflow-hidden rounded-lg ring-1 ring-gray-800">
            {data.tracks.map((track) => (
              <li
                key={`${track.position}-${track.recordingMbid}`}
                className="flex items-center gap-4 bg-gray-900/40 px-4 py-3"
              >
                <span className="w-8 text-right text-sm text-gray-500">
                  {track.position}
                </span>
                <span className="min-w-0 flex-1 truncate text-gray-100">
                  {track.name}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="text-gray-400">
            {intl.formatMessage(messages.noTracks)}
          </div>
        )}
      </div>
      <MediaSlider
        sliderKey="similar-artists"
        title={intl.formatMessage(messages.similarartists)}
        url={`/api/v1/music/${encodeApiPathSegment(data.id)}/artist-similar`}
        hideWhenEmpty
      />
    </>
  );
};

export default MusicDetails;
