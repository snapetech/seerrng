import Spinner from '@app/assets/spinner.svg';
import AssociationBadge from '@app/components/Association/AssociationBadge';
import Button from '@app/components/Common/Button';
import IndexerSearchLink from '@app/components/Common/IndexerSearchLink';
import { PageStatus } from '@app/components/Common/LoadingSpinner';
import MediaServerPlayButton from '@app/components/Common/MediaServerPlayButton';
import PageErrorMessage from '@app/components/Common/PageErrorMessage';
import PageTitle from '@app/components/Common/PageTitle';
import Tooltip from '@app/components/Common/Tooltip';
import LiveTvButton from '@app/components/LiveTv/LiveTvButton';
import MediaServerCollectionButton from '@app/components/MediaDetails/MediaServerCollectionButton';
import MediaServerWatchlistButton from '@app/components/MediaDetails/MediaServerWatchlistButton';
import RequestButton from '@app/components/RequestButton';
import SeriesDetailsLayout from '@app/components/TvDetails/SeriesDetailsLayout';
import useSettings from '@app/hooks/useSettings';
import useTitleBlocklist from '@app/hooks/useTitleBlocklist';
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
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import type { TvDetails as TvDetailsType } from '@server/models/Tv';
import axios, { type AxiosError } from 'axios';
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
  pageHeading: 'Series Details',
  loading: 'Loading Series Details',
  loadError: 'Series Details Could Not Be Loaded',
  loadErrorHint: 'Series details could not be fetched, please try again.',
  retryMetadataTooltip:
    'Fetch the series metadata again and check for updated information.',
  watchtrailer: 'Watch Trailer',
  trailer: 'Trailer',
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
  seasonBrowser?: ReactNode;
  showRelated?: boolean;
  expandInformation?: boolean;
  collapseInformation?: boolean;
  showOverview?: boolean;
  showInformationControls?: boolean;
  showPageTitle?: boolean;
  embedded?: boolean;
  additionalLoading?: boolean;
}

const TvDetails = ({
  tv,
  seasonBrowser,
  showRelated,
  expandInformation,
  collapseInformation,
  showOverview,
  showInformationControls,
  showPageTitle = true,
  embedded = false,
  additionalLoading = false,
}: TvDetailsProps) => {
  const settings = useSettings();
  const { user, hasPermission } = useUser();
  const router = useRouter();
  const intl = useIntl();
  const [showManager, setShowManager] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
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
    isValidating: seriesLoading,
  } = useSWR<TvDetailsType, AxiosError>(tvId ? `/api/v1/tv/${tvId}` : null, {
    fallbackData: tv,
    refreshInterval: refreshIntervalHelper(
      {
        downloadStatus: tv?.mediaInfo?.downloadStatus,
        downloadStatus4k: tv?.mediaInfo?.downloadStatus4k,
      },
      15000
    ),
  });
  const { data: ratingData, isValidating: ratingsLoading } =
    useSWR<RatingResponse>(tvId ? `/api/v1/tv/${tvId}/ratingscombined` : null);
  const sortedCrew = useMemo(
    () => sortCrewPriority(data?.credits.crew ?? []),
    [data]
  );

  useEffect(() => {
    if (router.query.manage === '1') {
      setShowManager(true);
      void router.replace({
        pathname: router.pathname,
        query: {
          tvId: router.query.tvId,
          ...(router.query.issues === '1' ? { issues: '1' } : {}),
        },
      });
    }
  }, [router, router.query.manage]);

  const closeBlocklistModal = useCallback(
    () => setShowBlocklistModal(false),
    []
  );
  const {
    isBlocklisted,
    checking: checkingBlocklist,
    error: blocklistError,
    setBlocklisted,
  } = useTitleBlocklist(
    data?.id,
    MediaType.TV,
    data?.mediaInfo?.status === MediaStatus.BLOCKLISTED
  );

  const pageHeading = showPageTitle && (
    <div className="page-title-row">
      <h1 className="page-title">{intl.formatMessage(messages.pageHeading)}</h1>
      <PageStatus
        active={
          seriesLoading ||
          ratingsLoading ||
          detailsLoading ||
          checkingBlocklist ||
          additionalLoading
        }
        label={intl.formatMessage(messages.loading)}
      />
    </div>
  );
  const metadataRetry = {
    onClick: () => revalidate(),
    tooltip: intl.formatMessage(messages.retryMetadataTooltip),
    busy: seriesLoading,
  };
  const loadErrorMessage = (
    <PageErrorMessage
      title={intl.formatMessage(messages.loadError)}
      description={intl.formatMessage(messages.loadErrorHint)}
      retry={metadataRetry}
    />
  );

  if (!data && !error) {
    return (
      <>
        <PageTitle title={intl.formatMessage(messages.pageHeading)} />
        {pageHeading}
      </>
    );
  }
  if (!data) {
    return (
      <>
        <PageTitle title={intl.formatMessage(messages.pageHeading)} />
        {pageHeading}
        {error?.response?.status === 404 ? (
          <ErrorPage statusCode={404} />
        ) : (
          loadErrorMessage
        )}
      </>
    );
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
      await setBlocklisted(true);
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
        await setBlocklisted(true);
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
    !isBlocklisted && !checkingBlocklist && !blocklistError;
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

  const indexerCompanionActions = (
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
            aria-label={intl.formatMessage(messages.manageseries)}
          >
            <CogIcon />
            <span>{intl.formatMessage(globalMessages.manage)}</span>
          </Button>
        </Tooltip>
      )}
    </>
  );

  const reportIssueAction = (
    <>
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
            <span>{intl.formatMessage(globalMessages.reportIssue)}</span>
          </Button>
        </Tooltip>
      )}
    </>
  );

  const primaryActions = (
    <>
      {safeTrailerUrl && (
        <Button
          as="a"
          href={safeTrailerUrl}
          target="_blank"
          rel="noopener noreferrer"
          buttonType="trailer"
          buttonSize="sm"
          title={intl.formatMessage(messages.watchtrailer)}
          aria-label={intl.formatMessage(messages.watchtrailer)}
        >
          <FilmIcon />
          <span>{intl.formatMessage(messages.trailer)}</span>
        </Button>
      )}
      <AssociationBadge mediaType="tv" id={data.id} variant="button" />
    </>
  );

  const requestAction = (
    <RequestButton
      singleRequestEntry
      buttonSize="sm"
      buttonType="detailRequest"
      mediaType="tv"
      onUpdate={() => revalidate()}
      tmdbId={data.id}
      media={data.mediaInfo}
      isShowComplete={isComplete}
      is4kShowComplete={is4kComplete}
    />
  );

  const indexerSearchAction = (
    <IndexerSearchLink category="tv" title={data.name} />
  );

  const secondaryActions = (
    <>
      <LiveTvButton
        titles={[data.name, data.originalName]}
        mediaType="tv"
        tmdbId={data.id}
      />
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
                <StarIcon data-icon-tone="accent" />
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
      {pageHeading}
      {error && loadErrorMessage}
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
        seasonBrowser={seasonBrowser}
        showRelated={showRelated}
        expandInformation={expandInformation}
        collapseInformation={collapseInformation}
        showOverview={showOverview}
        showInformationControls={showInformationControls}
        embedded={embedded}
        metadataRetry={metadataRetry}
        onLoadingChange={setDetailsLoading}
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
        indexerSearchAction={indexerSearchAction}
        indexerCompanionActions={indexerCompanionActions}
        reportIssueAction={reportIssueAction}
        requestAction={requestAction}
        playbackActions={playbackActions}
        mediaServerWatchlistAction={
          !embedded
            ? (is4k, onLoadingChange) => (
                <MediaServerWatchlistButton
                  tvId={data.id}
                  is4k={is4k}
                  onLoadingChange={onLoadingChange}
                />
              )
            : undefined
        }
        mediaServerCollectionAction={
          !embedded
            ? (is4k, onLoadingChange) => (
                <MediaServerCollectionButton
                  tvId={data.id}
                  is4k={is4k}
                  onLoadingChange={onLoadingChange}
                />
              )
            : undefined
        }
      />
    </>
  );
};

export default TvDetails;
