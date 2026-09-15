import Spinner from '@app/assets/spinner.svg';
import AssociationBadge from '@app/components/Association/AssociationBadge';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import MediaServerPlayButton from '@app/components/Common/MediaServerPlayButton';
import PageTitle from '@app/components/Common/PageTitle';
import Tooltip from '@app/components/Common/Tooltip';
import RequestButton from '@app/components/RequestButton';
import SeriesDetailsLayout from '@app/components/TvDetails/SeriesDetailsLayout';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import { Permission, UserType, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import { sortCrewPriority } from '@app/utils/creditHelpers';
import defineMessages from '@app/utils/defineMessages';
import { refreshIntervalHelper } from '@app/utils/refreshIntervalHelper';
import { getSafeHref } from '@app/utils/safeUrl';
import {
  CogIcon,
  ExclamationTriangleIcon,
  EyeSlashIcon,
  FilmIcon,
  MinusCircleIcon,
  StarIcon,
} from '@heroicons/react/24/outline';
import type { RTRating } from '@server/api/rating/rottentomatoes';
import { IssueStatus } from '@server/constants/issue';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import type { TvDetails as TvDetailsType } from '@server/models/Tv';
import axios from 'axios';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const BlocklistModal = dynamic(() => import('@app/components/BlocklistModal'), {
  ssr: false,
});
const IssueModal = dynamic(() => import('@app/components/IssueModal'), {
  ssr: false,
});
const ManageSlideOver = dynamic(
  () => import('@app/components/ManageSlideOver'),
  { ssr: false }
);

const messages = defineMessages('components.TvDetails', {
  watchtrailer: 'Watch Trailer',
  reportissue: 'Report an Issue',
  manageseries: 'Manage Series',
  watchlistSuccess: '<strong>{title}</strong> added to watchlist successfully!',
  watchlistDeleted:
    '<strong>{title}</strong> removed from watchlist successfully!',
  watchlistError: 'Something went wrong. Please try again.',
  removefromwatchlist: 'Remove From Watchlist',
  addtowatchlist: 'Add To Watchlist',
  selectToPlay: 'No playable episodes are currently available.',
});

interface TvDetailsProps {
  tv?: TvDetailsType;
}

const TvDetails = ({ tv }: TvDetailsProps) => {
  const settings = useSettings();
  const { user, hasPermission } = useUser();
  const router = useRouter();
  const intl = useIntl();
  const [showManager, setShowManager] = useState(false);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [toggleWatchlist, setToggleWatchlist] = useState(!tv?.onUserWatchlist);
  const [isBlocklistUpdating, setIsBlocklistUpdating] = useState(false);
  const [showBlocklistModal, setShowBlocklistModal] = useState(false);
  const { addToast } = useToasts();
  const tvId =
    typeof router.query.tvId === 'string'
      ? router.query.tvId
      : tv?.id
        ? tv.id.toString()
        : '';

  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<TvDetailsType>(tvId ? `/api/v1/tv/${tvId}` : null, {
    fallbackData: tv,
    refreshInterval: refreshIntervalHelper(
      {
        downloadStatus: tv?.mediaInfo?.downloadStatus,
        downloadStatus4k: tv?.mediaInfo?.downloadStatus4k,
      },
      15000
    ),
  });
  const { data: ratingData } = useSWR<RTRating>(
    tvId ? `/api/v1/tv/${tvId}/ratings` : null
  );
  const sortedCrew = useMemo(
    () => sortCrewPriority(data?.credits.crew ?? []),
    [data]
  );

  useEffect(() => {
    if (router.query.manage === '1') {
      setShowManager(true);
      void router.replace({
        pathname: router.pathname,
        query: { tvId: router.query.tvId },
      });
    }
  }, [router, router.query.manage]);

  const closeBlocklistModal = useCallback(
    () => setShowBlocklistModal(false),
    []
  );
  if (!data && !error) {
    return <LoadingSpinner />;
  }
  if (!data) {
    return <ErrorPage statusCode={404} />;
  }

  const trailerVideo = data.relatedVideos
    ?.filter((video) => video.type === 'Trailer')
    .sort((a, b) => a.size - b.size)
    .pop();
  const trailerUrl =
    trailerVideo?.site === 'YouTube' &&
    settings.currentSettings.youtubeUrl !== ''
      ? `${settings.currentSettings.youtubeUrl}${trailerVideo.key}`
      : trailerVideo?.url;
  const safeTrailerUrl = trailerUrl ? getSafeHref(trailerUrl) : undefined;

  const allRequestedSeasons = (is4k: boolean): number[] => {
    const requestedSeasons = (data.mediaInfo?.requests ?? [])
      .filter(
        (request) =>
          request.is4k === is4k &&
          request.status !== MediaRequestStatus.DECLINED &&
          request.status !== MediaRequestStatus.FAILED &&
          request.status !== MediaRequestStatus.COMPLETED
      )
      .flatMap((request) =>
        request.seasons.map((season) => season.seasonNumber)
      );
    const availableSeasons = (data.mediaInfo?.seasons ?? [])
      .filter(
        (season) =>
          [
            MediaStatus.AVAILABLE,
            MediaStatus.PARTIALLY_AVAILABLE,
            MediaStatus.PROCESSING,
          ].includes(season[is4k ? 'status4k' : 'status']) &&
          !requestedSeasons.includes(season.seasonNumber)
      )
      .map((season) => season.seasonNumber);

    return [...new Set([...requestedSeasons, ...availableSeasons])];
  };
  const visibleSeasons = data.seasons.filter(
    (season) =>
      season.episodeCount > 0 &&
      (settings.currentSettings.enableSpecialEpisodes ||
        season.seasonNumber !== 0)
  );
  const expectedSeasonNumbers = visibleSeasons.map(
    (season) => season.seasonNumber
  );
  const isComplete = expectedSeasonNumbers.every((seasonNumber) =>
    allRequestedSeasons(false).includes(seasonNumber)
  );
  const is4kComplete = expectedSeasonNumbers.every((seasonNumber) =>
    allRequestedSeasons(true).includes(seasonNumber)
  );

  const onClickWatchlistBtn = async () => {
    setIsUpdating(true);
    try {
      await axios.post('/api/v1/watchlist', {
        tmdbId: data.id,
        mediaType: MediaType.TV,
        title: data.name,
      });
      addToast(
        <span>
          {intl.formatMessage(messages.watchlistSuccess, {
            title: data.name,
            strong: (msg: ReactNode) => <strong>{msg}</strong>,
          })}
        </span>,
        { appearance: 'success', autoDismiss: true }
      );
      setToggleWatchlist(false);
    } catch {
      addToast(intl.formatMessage(messages.watchlistError), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const onClickDeleteWatchlistBtn = async () => {
    setIsUpdating(true);
    try {
      await axios.delete(
        `/api/v1/watchlist/${data.id}?mediaType=${MediaType.TV}`
      );
      addToast(
        <span>
          {intl.formatMessage(messages.watchlistDeleted, {
            title: data.name,
            strong: (msg: ReactNode) => <strong>{msg}</strong>,
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
      setIsUpdating(false);
    }
  };

  const onClickHideItemBtn = async () => {
    setIsBlocklistUpdating(true);
    try {
      await axios.post('/api/v1/blocklist', {
        tmdbId: data.id,
        mediaType: 'tv',
        title: data.name,
        user: user?.id,
      });
      addToast(
        <span>
          {intl.formatMessage(globalMessages.blocklistSuccess, {
            title: data.name,
            strong: (msg: ReactNode) => <strong>{msg}</strong>,
          })}
        </span>,
        { appearance: 'success', autoDismiss: true }
      );
      await revalidate();
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 412) {
        addToast(
          <span>
            {intl.formatMessage(globalMessages.blocklistDuplicateError, {
              title: data.name,
              strong: (msg: ReactNode) => <strong>{msg}</strong>,
            })}
          </span>,
          { appearance: 'info', autoDismiss: true }
        );
      } else {
        addToast(intl.formatMessage(globalMessages.blocklistError), {
          appearance: 'error',
          autoDismiss: true,
        });
      }
    } finally {
      setIsBlocklistUpdating(false);
      closeBlocklistModal();
    }
  };

  const canUseBlocklist = hasPermission(Permission.MANAGE_BLOCKLIST);
  const isBlocklistAvailable =
    data.mediaInfo?.status !== MediaStatus.BLOCKLISTED;
  const canUseReportIssue = hasPermission(
    [Permission.CREATE_ISSUES, Permission.MANAGE_ISSUES],
    { type: 'or' }
  );
  const isReportIssueAvailable =
    data.mediaInfo?.status === MediaStatus.AVAILABLE ||
    data.mediaInfo?.status === MediaStatus.PARTIALLY_AVAILABLE ||
    (settings.currentSettings.series4kEnabled &&
      hasPermission([Permission.REQUEST_4K, Permission.REQUEST_4K_TV], {
        type: 'or',
      }) &&
      (data.mediaInfo?.status4k === MediaStatus.AVAILABLE ||
        data.mediaInfo?.status4k === MediaStatus.PARTIALLY_AVAILABLE));
  const canUseManage = hasPermission(Permission.MANAGE_REQUESTS);
  const isManageAvailable = !!data.mediaInfo;
  const canPlayMedia = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_TV],
    { type: 'or' }
  );
  const playbackActions = canPlayMedia
    ? (itemIds: string[], is4k: boolean) => (
        <MediaServerPlayButton
          mediaUrl={data.mediaInfo?.mediaUrl}
          mediaUrl4k={data.mediaInfo?.mediaUrl4k}
          iOSPlexUrl={data.mediaInfo?.iOSPlexUrl}
          iOSPlexUrl4k={data.mediaInfo?.iOSPlexUrl4k}
          mediaId={data.mediaInfo?.id}
          itemIds={itemIds}
          defaultIs4k={is4k}
          include4k={
            settings.currentSettings.series4kEnabled &&
            hasPermission([Permission.REQUEST_4K, Permission.REQUEST_4K_TV], {
              type: 'or',
            })
          }
          disabled={itemIds.length === 0}
          disabledReason={intl.formatMessage(messages.selectToPlay)}
        />
      )
    : undefined;

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
              ? messages.manageseries
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
            aria-label={intl.formatMessage(messages.manageseries)}
          >
            <CogIcon className="!mr-0" />
            {hasPermission([Permission.MANAGE_ISSUES, Permission.VIEW_ISSUES], {
              type: 'or',
            }) &&
              (data.mediaInfo?.issues.filter(
                (issue) => issue.status === IssueStatus.OPEN
              ).length ?? 0) > 0 && (
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
      {safeTrailerUrl && (
        <Button
          as="a"
          href={safeTrailerUrl}
          target="_blank"
          rel="noopener noreferrer"
          buttonType="trailer"
          buttonSize="sm"
        >
          <FilmIcon />
          <span>{intl.formatMessage(messages.watchtrailer)}</span>
        </Button>
      )}
      <AssociationBadge mediaType="tv" id={data.id} variant="button" />
      <RequestButton
        buttonSize="sm"
        buttonType="detailRequest"
        className="ml-0"
        mediaType="tv"
        onUpdate={() => revalidate()}
        tmdbId={data.id}
        media={data.mediaInfo}
        isShowComplete={isComplete}
        is4kShowComplete={is4kComplete}
      />
    </>
  );

  const secondaryActions = (
    <>
      {data.mediaInfo?.status !== MediaStatus.BLOCKLISTED &&
        user?.userType !== UserType.PLEX && (
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
              onClick={
                toggleWatchlist
                  ? onClickWatchlistBtn
                  : onClickDeleteWatchlistBtn
              }
              aria-label={intl.formatMessage(
                toggleWatchlist
                  ? messages.addtowatchlist
                  : messages.removefromwatchlist
              )}
            >
              {isUpdating ? (
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

  return (
    <>
      <PageTitle title={data.name} />
      {showBlocklistModal && (
        <BlocklistModal
          tmdbId={data.id}
          type="tv"
          show={showBlocklistModal}
          onCancel={closeBlocklistModal}
          onComplete={onClickHideItemBtn}
          isUpdating={isBlocklistUpdating}
        />
      )}
      {showIssueModal && (
        <IssueModal
          onCancel={() => setShowIssueModal(false)}
          show={showIssueModal}
          mediaType="tv"
          tmdbId={data.id}
        />
      )}
      {showManager && canUseManage && isManageAvailable && (
        <ManageSlideOver
          data={data}
          mediaType="tv"
          onClose={() => {
            setShowManager(false);
            void router.replace({
              pathname: router.pathname,
              query: { tvId: router.query.tvId },
            });
          }}
          revalidate={() => revalidate()}
          show={showManager}
        />
      )}
      <SeriesDetailsLayout
        data={data}
        ratingData={ratingData}
        sortedCrew={sortedCrew}
        visibleSeasons={visibleSeasons}
        show4kAvailability={
          settings.currentSettings.series4kEnabled &&
          hasPermission(
            [
              Permission.MANAGE_REQUESTS,
              Permission.REQUEST_4K,
              Permission.REQUEST_4K_TV,
            ],
            { type: 'or' }
          )
        }
        primaryActions={primaryActions}
        secondaryActions={secondaryActions}
        playbackActions={playbackActions}
      />
    </>
  );
};

export default TvDetails;
