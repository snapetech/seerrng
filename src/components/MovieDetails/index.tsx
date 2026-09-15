import Spinner from '@app/assets/spinner.svg';
import AssociationBadge from '@app/components/Association/AssociationBadge';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import MediaServerPlayButton from '@app/components/Common/MediaServerPlayButton';
import PageTitle from '@app/components/Common/PageTitle';
import PlayOnDeviceButton from '@app/components/Common/PlayOnDeviceButton';
import Tooltip from '@app/components/Common/Tooltip';
import MovieDetailsLayout from '@app/components/MovieDetails/MovieDetailsLayout';
import RequestButton from '@app/components/RequestButton';
import usePlaybackCatalog from '@app/hooks/usePlaybackCatalog';
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
import type { RatingResponse } from '@server/api/ratings';
import { IssueStatus } from '@server/constants/issue';
import { MediaStatus, MediaType } from '@server/constants/media';
import type { MovieDetails as MovieDetailsType } from '@server/models/Movie';
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

const messages = defineMessages('components.MovieDetails', {
  watchtrailer: 'Watch Trailer',
  reportissue: 'Report an Issue',
  managemovie: 'Manage Movie',
  watchlistSuccess: '<strong>{title}</strong> added to watchlist successfully!',
  watchlistDeleted:
    '<strong>{title}</strong> removed from watchlist successfully!',
  watchlistError: 'Something went wrong. Please try again.',
  removefromwatchlist: 'Remove From Watchlist',
  addtowatchlist: 'Add To Watchlist',
});

interface MovieDetailsProps {
  movie?: MovieDetailsType;
}

const MovieDetails = ({ movie }: MovieDetailsProps) => {
  const settings = useSettings();
  const { user, hasPermission } = useUser();
  const router = useRouter();
  const intl = useIntl();
  const [showManager, setShowManager] = useState(false);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [toggleWatchlist, setToggleWatchlist] = useState(
    !movie?.onUserWatchlist
  );
  const [isBlocklistUpdating, setIsBlocklistUpdating] = useState(false);
  const [showBlocklistModal, setShowBlocklistModal] = useState(false);
  const { addToast } = useToasts();
  const movieId =
    typeof router.query.movieId === 'string'
      ? router.query.movieId
      : movie?.id
        ? movie.id.toString()
        : '';

  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<MovieDetailsType>(movieId ? `/api/v1/movie/${movieId}` : null, {
    fallbackData: movie,
    refreshInterval: refreshIntervalHelper(
      {
        downloadStatus: movie?.mediaInfo?.downloadStatus,
        downloadStatus4k: movie?.mediaInfo?.downloadStatus4k,
      },
      15000
    ),
  });
  const { data: ratingData } = useSWR<RatingResponse>(
    movieId ? `/api/v1/movie/${movieId}/ratingscombined` : null
  );
  const canUse4kPlayback =
    settings.currentSettings.movie4kEnabled &&
    hasPermission([Permission.REQUEST_4K, Permission.REQUEST_4K_MOVIE], {
      type: 'or',
    });
  const { data: playbackCatalog } = usePlaybackCatalog(data?.mediaInfo?.id);
  const { data: playbackCatalog4k } = usePlaybackCatalog(
    canUse4kPlayback ? data?.mediaInfo?.id : undefined,
    true
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
        query: { movieId: router.query.movieId },
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

  const discoverRegion =
    user?.settings?.discoverRegion ??
    settings.currentSettings.discoverRegion ??
    'US';
  const releases = data.releases.results.find(
    (release) => release.iso_3166_1 === discoverRegion
  )?.release_dates;
  const filteredReleases = [
    ...new Map(
      releases
        ?.filter((release) => release.type > 2 && release.type < 6)
        .map((release) => [release.type, release])
    ).values(),
  ];

  const onClickWatchlistBtn = async () => {
    setIsUpdating(true);
    try {
      const response = await axios.post('/api/v1/watchlist', {
        tmdbId: data.id,
        mediaType: MediaType.MOVIE,
        title: data.title,
      });
      if (response.data) {
        addToast(
          <span>
            {intl.formatMessage(messages.watchlistSuccess, {
              title: data.title,
              strong: (msg: ReactNode) => <strong>{msg}</strong>,
            })}
          </span>,
          { appearance: 'success', autoDismiss: true }
        );
      }
    } catch {
      addToast(intl.formatMessage(messages.watchlistError), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsUpdating(false);
      setToggleWatchlist(false);
    }
  };

  const onClickDeleteWatchlistBtn = async () => {
    setIsUpdating(true);
    try {
      await axios.delete(
        `/api/v1/watchlist/${data.id}?mediaType=${MediaType.MOVIE}`
      );
      addToast(
        <span>
          {intl.formatMessage(messages.watchlistDeleted, {
            title: data.title,
            strong: (msg: ReactNode) => <strong>{msg}</strong>,
          })}
        </span>,
        { appearance: 'info', autoDismiss: true }
      );
    } catch {
      addToast(intl.formatMessage(messages.watchlistError), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsUpdating(false);
      setToggleWatchlist(true);
    }
  };

  const onClickHideItemBtn = async () => {
    setIsBlocklistUpdating(true);
    try {
      await axios.post('/api/v1/blocklist', {
        tmdbId: data.id,
        mediaType: 'movie',
        title: data.title,
        user: user?.id,
      });
      addToast(
        <span>
          {intl.formatMessage(globalMessages.blocklistSuccess, {
            title: data.title,
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
              title: data.title,
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
    (settings.currentSettings.movie4kEnabled &&
      hasPermission([Permission.REQUEST_4K, Permission.REQUEST_4K_MOVIE], {
        type: 'or',
      }) &&
      data.mediaInfo?.status4k === MediaStatus.AVAILABLE);
  const canUseManage = hasPermission(Permission.MANAGE_REQUESTS);
  const isManageAvailable = Boolean(
    data.mediaInfo &&
    (data.mediaInfo.jellyfinMediaId ||
      data.mediaInfo.jellyfinMediaId4k ||
      data.mediaInfo.status !== MediaStatus.UNKNOWN ||
      data.mediaInfo.status4k !== MediaStatus.UNKNOWN)
  );
  const canPlayMedia = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_MOVIE],
    { type: 'or' }
  );
  const playbackActions = canPlayMedia
    ? (is4k: boolean) => {
        const selectedCatalog = is4k ? playbackCatalog4k : playbackCatalog;
        const selectedItem = selectedCatalog?.rootItem;

        return (
          <>
            <MediaServerPlayButton
              mediaUrl={is4k ? undefined : data.mediaInfo?.mediaUrl}
              mediaUrl4k={is4k ? data.mediaInfo?.mediaUrl4k : undefined}
              iOSPlexUrl={is4k ? undefined : data.mediaInfo?.iOSPlexUrl}
              iOSPlexUrl4k={is4k ? data.mediaInfo?.iOSPlexUrl4k : undefined}
              mediaId={data.mediaInfo?.id}
              itemIds={selectedItem ? [selectedItem.id] : []}
              defaultIs4k={is4k}
              include4k={is4k}
            />
            <PlayOnDeviceButton
              mediaId={data.mediaInfo?.id}
              itemIds={selectedItem ? [selectedItem.id] : []}
              is4k={is4k}
            />
          </>
        );
      }
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
              ? messages.managemovie
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
            aria-label={intl.formatMessage(messages.managemovie)}
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
      <AssociationBadge mediaType="movie" id={data.id} variant="button" />
      <RequestButton
        buttonSize="sm"
        buttonType="detailRequest"
        className="ml-0"
        mediaType="movie"
        media={data.mediaInfo}
        tmdbId={data.id}
        onUpdate={() => revalidate()}
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
      <PageTitle title={data.title} />
      {showIssueModal && (
        <IssueModal
          onCancel={() => setShowIssueModal(false)}
          show={showIssueModal}
          mediaType="movie"
          tmdbId={data.id}
        />
      )}
      {showManager && canUseManage && isManageAvailable && (
        <ManageSlideOver
          data={data}
          mediaType="movie"
          onClose={() => {
            setShowManager(false);
            void router.replace({
              pathname: router.pathname,
              query: { movieId: router.query.movieId },
            });
          }}
          revalidate={() => revalidate()}
          show={showManager}
        />
      )}
      {showBlocklistModal && (
        <BlocklistModal
          tmdbId={data.id}
          type="movie"
          show={showBlocklistModal}
          onCancel={closeBlocklistModal}
          onComplete={onClickHideItemBtn}
          isUpdating={isBlocklistUpdating}
        />
      )}
      <MovieDetailsLayout
        data={data}
        ratingData={ratingData}
        sortedCrew={sortedCrew}
        filteredReleases={filteredReleases}
        show4kAvailability={
          settings.currentSettings.movie4kEnabled &&
          hasPermission(
            [
              Permission.MANAGE_REQUESTS,
              Permission.REQUEST_4K,
              Permission.REQUEST_4K_MOVIE,
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

export default MovieDetails;
