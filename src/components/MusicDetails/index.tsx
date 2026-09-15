import Spinner from '@app/assets/spinner.svg';
import AssociationBadge from '@app/components/Association/AssociationBadge';
import Button from '@app/components/Common/Button';
import FormatRequestControl from '@app/components/Common/FormatRequestControl';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import MediaServerPlayButton from '@app/components/Common/MediaServerPlayButton';
import PageTitle from '@app/components/Common/PageTitle';
import Tooltip from '@app/components/Common/Tooltip';
import IssueBlock from '@app/components/IssueBlock';
import MusicDetailsLayout from '@app/components/MusicDetails/MusicDetailsLayout';
import BulkRequestModal from '@app/components/RequestModal/BulkRequestModal';
import useToasts from '@app/hooks/useToasts';
import { getQueryParamString } from '@app/hooks/useUpdateQueryParams';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import {
  encodeApiPathSegment,
  normalizeMusicBrainzId,
} from '@app/utils/apiPath';
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
import type { ServiceCommonServer } from '@server/interfaces/api/serviceInterfaces';
import type {
  MusicDetails as MusicDetailsType,
  MusicRatingResponse,
} from '@server/models/Music';
import axios from 'axios';
import dynamic from 'next/dynamic';
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
  manage: 'Manage Music',
  reportissue: 'Report an Issue',
  openissues: 'Open Issues',
  watchlistSuccess: '<strong>{title}</strong> added to watchlist successfully!',
  watchlistDeleted:
    '<strong>{title}</strong> Removed from watchlist successfully!',
  watchlistError: 'Something went wrong. Please try again.',
  removefromwatchlist: 'Remove From Watchlist',
  addtowatchlist: 'Add To Watchlist',
  viewrequest: 'View Request',
  requestdiscography: 'Request Discography',
  selectToPlay: 'No playable tracks are currently available.',
  mp3Available: 'The MP3 version is already available.',
  flacAvailable: 'The FLAC version is already available.',
  mp3Pending: 'An open MP3 request already exists.',
  flacPending: 'An open FLAC request already exists.',
  mp3ServiceUnavailable: 'No MP3 music service is configured.',
  flacServiceUnavailable: 'No FLAC music service is configured.',
  blocklisted: 'This title is blocklisted.',
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
  const [requestServerId, setRequestServerId] = useState<number>();
  const [isBlocklisting, setIsBlocklisting] = useState(false);
  const [isWatchlistUpdating, setIsWatchlistUpdating] = useState(false);
  const [toggleWatchlist, setToggleWatchlist] = useState(true);
  const musicId = getQueryParamString(router.query.musicId);
  const normalizedRouteMusicId = musicId
    ? normalizeMusicBrainzId(musicId)
    : undefined;

  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<MusicDetailsType>(
    normalizedRouteMusicId
      ? `/api/v1/music/${encodeApiPathSegment(normalizedRouteMusicId)}`
      : null
  );
  const { data: ratingData } = useSWR<MusicRatingResponse>(
    normalizedRouteMusicId
      ? `/api/v1/music/${encodeApiPathSegment(normalizedRouteMusicId)}/rating`
      : null,
    { shouldRetryOnError: false }
  );
  const { data: musicServices } = useSWR<ServiceCommonServer[]>(
    '/api/v1/service/lidarr'
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

  const musicBrainzId = normalizeMusicBrainzId(data.mbId);
  const albumId = normalizeMusicBrainzId(data.id);
  const artistId = normalizeMusicBrainzId(data.artist.id);

  const canRequest = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_MUSIC],
    { type: 'or' }
  );
  const canChooseAlternateTarget = hasPermission(
    [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
    { type: 'or' }
  );
  const playbackActions = canRequest
    ? (itemIds: string[], useFlac: boolean) => (
        <MediaServerPlayButton
          mediaUrl={data.mediaInfo?.mediaUrl}
          iOSPlexUrl={data.mediaInfo?.iOSPlexUrl}
          mediaId={data.mediaInfo?.id}
          itemIds={itemIds}
          defaultIs4k={useFlac}
          disabled={itemIds.length === 0}
          disabledReason={intl.formatMessage(messages.selectToPlay)}
        />
      )
    : undefined;
  const canShowRequest = canRequest;
  const activeMusicRequests =
    data.mediaInfo?.requests?.filter(
      (request) =>
        request.status !== MediaRequestStatus.DECLINED &&
        request.status !== MediaRequestStatus.FAILED &&
        request.status !== MediaRequestStatus.COMPLETED
    ) ?? [];
  const activeMusicRequest =
    activeMusicRequests.find(
      (request) => request.requestedBy?.id === user?.id
    ) ??
    (hasPermission(Permission.MANAGE_REQUESTS) &&
    activeMusicRequests.length === 1
      ? activeMusicRequests[0]
      : undefined);
  const musicRequestOptions = (['mp3', 'flac'] as const).map((format) => {
    const service = musicServices?.find((candidate) =>
      candidate.name.toLocaleLowerCase().includes(format)
    );
    const available = data.availableServices?.some(
      (candidate) => candidate.serverId === service?.id
    );
    const requested =
      !!service &&
      activeMusicRequests.some((request) => {
        const targets = request.serviceTargets ?? [];
        return (
          targets.length === 0 ||
          targets.some(
            (target) =>
              target.serviceType === 'lidarr' && target.serverId === service.id
          )
        );
      });

    return {
      id: format,
      label: format.toLocaleUpperCase(),
      onClick: () => {
        setEditRequest(undefined);
        setRequestServerId(service?.id);
        setShowRequestModal(true);
      },
      disabled:
        !service ||
        data.mediaInfo?.status === MediaStatus.BLOCKLISTED ||
        (!canChooseAlternateTarget && (available || requested)),
      disabledReason: !service
        ? intl.formatMessage(
            format === 'mp3'
              ? messages.mp3ServiceUnavailable
              : messages.flacServiceUnavailable
          )
        : data.mediaInfo?.status === MediaStatus.BLOCKLISTED
          ? intl.formatMessage(messages.blocklisted)
          : available
            ? intl.formatMessage(
                format === 'mp3'
                  ? messages.mp3Available
                  : messages.flacAvailable
              )
            : requested
              ? intl.formatMessage(
                  format === 'mp3' ? messages.mp3Pending : messages.flacPending
                )
              : undefined,
    };
  });
  const canUseReportIssue = hasPermission(
    [Permission.MANAGE_ISSUES, Permission.CREATE_ISSUES],
    { type: 'or' }
  );
  const isReportIssueAvailable =
    !!data.mediaInfo?.id && data.mediaInfo.status === MediaStatus.AVAILABLE;
  const canUseBlocklist = hasPermission(Permission.MANAGE_BLOCKLIST);
  const isBlocklistAvailable =
    data.mediaInfo?.status !== MediaStatus.BLOCKLISTED;
  const canUseManage = hasPermission(Permission.MANAGE_REQUESTS);
  const isManageAvailable = Boolean(
    data.mediaInfo && data.mediaInfo.status !== MediaStatus.UNKNOWN
  );
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
        externalId: musicBrainzId,
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
        mbId: musicBrainzId,
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
        `/api/v1/watchlist/${encodeApiPathSegment(musicBrainzId)}?mediaType=music`
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

  const primaryActions = (
    <>
      {canUseBlocklist && (
        <Tooltip
          content={intl.formatMessage(
            isBlocklistAvailable
              ? globalMessages.addToBlocklist
              : globalMessages.alreadyBlocklisted
          )}
        >
          <Button
            buttonType="blocklist"
            buttonSize="sm"
            onClick={() => setShowBlocklistModal(true)}
            disabled={!isBlocklistAvailable}
            disabledReason={intl.formatMessage(
              globalMessages.alreadyBlocklisted
            )}
            aria-label={intl.formatMessage(globalMessages.addToBlocklist)}
          >
            <EyeSlashIcon />
          </Button>
        </Tooltip>
      )}
      {canUseManage && (
        <Tooltip
          content={intl.formatMessage(
            isManageAvailable
              ? messages.manage
              : globalMessages.manageUnavailable
          )}
        >
          <Button
            buttonType="manage"
            buttonSize="sm"
            onClick={() => setShowManager(true)}
            disabled={!isManageAvailable}
            disabledReason={intl.formatMessage(
              globalMessages.manageUnavailable
            )}
            className="relative"
            aria-label={intl.formatMessage(messages.manage)}
          >
            <CogIcon className="!mr-0" />
            {openIssues.length > 0 && (
              <>
                <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-red-600" />
                <span className="absolute -top-1 -right-1 h-3 w-3 animate-ping rounded-full bg-red-600" />
              </>
            )}
          </Button>
        </Tooltip>
      )}
      {canUseReportIssue && (
        <Tooltip
          content={intl.formatMessage(
            isReportIssueAvailable
              ? messages.reportissue
              : globalMessages.reportIssueUnavailable
          )}
        >
          <Button
            buttonType="reportIssue"
            buttonSize="sm"
            onClick={() => setShowIssueModal(true)}
            disabled={!isReportIssueAvailable}
            disabledReason={intl.formatMessage(
              globalMessages.reportIssueUnavailable
            )}
            aria-label={intl.formatMessage(messages.reportissue)}
          >
            <ExclamationTriangleIcon />
          </Button>
        </Tooltip>
      )}
      <AssociationBadge mediaType="album" id={albumId} variant="button" />
      {canRequest && artistId && (
        <Button
          buttonType="bulkRequest"
          buttonSize="sm"
          onClick={() => setShowBulkRequestModal(true)}
        >
          <ArrowDownTrayIcon />
          <span>{intl.formatMessage(messages.requestdiscography)}</span>
        </Button>
      )}
      {activeMusicRequest && (
        <Button
          buttonType="ghost"
          buttonSize="sm"
          onClick={() => {
            setEditRequest(activeMusicRequest);
            setRequestServerId(undefined);
            setShowRequestModal(true);
          }}
        >
          <InformationCircleIcon />
          <span>{intl.formatMessage(messages.viewrequest)}</span>
        </Button>
      )}
      {canShowRequest && musicRequestOptions.length > 0 && (
        <FormatRequestControl options={musicRequestOptions} />
      )}
    </>
  );

  const secondaryActions = (
    <>
      {canWatchlist && (
        <Tooltip
          content={intl.formatMessage(
            toggleWatchlist
              ? messages.addtowatchlist
              : messages.removefromwatchlist
          )}
        >
          <Button
            buttonType={toggleWatchlist ? 'ghost' : 'default'}
            buttonSize="sm"
            onClick={toggleWatchlist ? addToWatchlist : removeFromWatchlist}
            aria-label={intl.formatMessage(
              toggleWatchlist
                ? messages.addtowatchlist
                : messages.removefromwatchlist
            )}
          >
            {isWatchlistUpdating ? (
              <Spinner />
            ) : toggleWatchlist ? (
              <StarIcon className="text-amber-300" />
            ) : (
              <MinusCircleIcon />
            )}
          </Button>
        </Tooltip>
      )}
    </>
  );

  const additionalContent =
    hasPermission([Permission.MANAGE_ISSUES, Permission.VIEW_ISSUES], {
      type: 'or',
    }) && openIssues.length > 0 ? (
      <section className="refreshed-inset-surface mt-[5px] overflow-hidden rounded-lg border border-gray-700">
        <h2 className="media-inset-heading px-3 py-2">
          {intl.formatMessage(messages.openissues)}
        </h2>
        <ul className="border-t border-gray-700">
          {openIssues.map((issue) => (
            <li
              key={`music-issue-${issue.id}`}
              className="border-b border-gray-700 last:border-b-0"
            >
              <IssueBlock issue={issue} />
            </li>
          ))}
        </ul>
      </section>
    ) : undefined;

  return (
    <>
      <PageTitle title={data.title} />
      {showManager && canUseManage && isManageAvailable && (
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
          mbId={albumId}
          initialMusicServerId={requestServerId}
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
          artistId={artistId}
          title={data.artist.name}
          onCancel={() => setShowBulkRequestModal(false)}
          onComplete={() => revalidate()}
        />
      )}
      <MusicDetailsLayout
        data={data}
        primaryActions={primaryActions}
        secondaryActions={secondaryActions}
        playbackActions={playbackActions}
        ratingData={ratingData}
        additionalContent={additionalContent}
      />
    </>
  );
};

export default MusicDetails;
