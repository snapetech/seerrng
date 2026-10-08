import CollectionNavigation from '@app/components/CollectionDetails/CollectionNavigation';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import MediaServerIcon from '@app/components/Common/MediaServerIcon';
import PageErrorMessage, {
  type MessageRetry,
} from '@app/components/Common/PageErrorMessage';
import PlayOnDeviceButton from '@app/components/Common/PlayOnDeviceButton';
import Tooltip from '@app/components/Common/Tooltip';
import WatchedBadge from '@app/components/Common/WatchedBadge';
import AvailabilityValue from '@app/components/MediaDetails/AvailabilityValue';
import DetailDisclosureButton from '@app/components/MediaDetails/DetailDisclosureButton';
import ExpandableCreditList from '@app/components/MediaDetails/ExpandableCreditList';
import MediaDetailArtwork from '@app/components/MediaDetails/MediaDetailArtwork';
import MediaQualitySelect from '@app/components/MediaDetails/MediaQualitySelect';
import MetadataAttribution from '@app/components/MediaDetails/MetadataAttribution';
import ReorderableDisclosureRow, {
  OrderedDisclosurePanels,
} from '@app/components/MediaDetails/ReorderableDisclosureRow';
import SeriesSeasonEpisodeBrowser from '@app/components/MediaDetails/SeriesSeasonEpisodeBrowser';
import VideoRatings from '@app/components/MediaDetails/VideoRatings';
import { subjectTagTone } from '@app/components/MediaDetails/subjectTagStyle';
import MediaSlider from '@app/components/MediaSlider';
import useDetailDisclosureOrder from '@app/hooks/useDetailDisclosureOrder';
import useDetailDisclosurePins from '@app/hooks/useDetailDisclosurePins';
import usePlaybackCatalog from '@app/hooks/usePlaybackCatalog';
import useSettings from '@app/hooks/useSettings';
import useWatchStatus from '@app/hooks/useWatchStatus';
import defineMessages from '@app/utils/defineMessages';
import { getTmdbPosterImageUrl } from '@app/utils/imageCache';
import { resolveCanonicalPlaybackSelection } from '@app/utils/playbackSelection';
import type { RatingResponse } from '@server/api/ratings';
import { MediaStatus } from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import type { TvDetails } from '@server/models/Tv';
import Link from 'next/link';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.TvDetails.Layout', {
  mediaAndFormat: 'Media & Format',
  firstAirDate: 'First Air Date',
  episodeRuntime: 'Episode Runtime',
  genres: 'Genres',
  creator: 'Creator',
  network: 'Network',
  seriesType: 'Series Type',
  director: 'Director',
  writers: 'Writers',
  hd: 'HD',
  ultraHd: '4K',
  watched: 'Watched',
  overview: 'Overview',
  overviewUnavailable: 'Overview unavailable',
  viewCast: 'Cast',
  viewCrew: 'Crew',
  subjectTags: 'Subject Tags',
  fullCastList: 'Full Cast List',
  fullCrewList: 'Full Crew List',
  noCast: 'No Cast Information Available',
  noCrew: 'No Crew Information Available',
  noTags: 'No Subject Tags Available',
  seriesDetails: 'Details',
  status: 'Status',
  airDates: 'Air Dates',
  first: 'First',
  last: 'Last',
  next: 'Next',
  language: 'Language',
  country: 'Country',
  networks: 'Networks',
  notAvailable: 'Not Available',
  minutes: '{minutes} minutes',
  recommendations: 'Recommendations',
  similar: 'Similar Series',
  rtCriticsScore: 'Rotten Tomatoes Tomatometer',
  rtAudienceScore: 'Rotten Tomatoes Audience Score',
  imdbUserScore: 'IMDb user score – votes: {formattedCount}',
  imdbScore: 'IMDb user score',
  tmdbUserScore: 'TMDB User Score',
  quality: 'Quality',
  mediaServer: 'Media Server',
  addToWatchlist: 'Add to Watchlist',
  addToWatchlistTooltip: 'Add this series to your Plex Watchlist.',
  addToFavorites: 'Add to Favorites',
  addToFavoritesTooltip: 'Add this series to your media server Favorites.',
  addToCollection: 'Add to Collection',
  addToCollectionTooltip:
    'Add this series to an existing shared collection on your media server. Collection editing permission is required.',
  mediaServerTooltip:
    'Show or hide season and episode selection and the media server action area without changing your selection.',
});

interface SeriesDetailsLayoutProps {
  metadataRetry: MessageRetry;
  onLoadingChange?: (loading: boolean) => void;
  data: TvDetails;
  ratingData?: RatingResponse;
  sortedCrew: TvDetails['credits']['crew'];
  show4kAvailability: boolean;
  visibleSeasons: TvDetails['seasons'];
  primaryActions: ReactNode;
  secondaryActions: ReactNode;
  indexerSearchAction: ReactNode;
  indexerCompanionActions: ReactNode;
  reportIssueAction: ReactNode;
  requestAction: ReactNode;
  playbackActions?: (itemIds: string[], is4k: boolean) => ReactNode;
  mediaServerWatchlistAction?: (
    is4k: boolean,
    onLoadingChange: (loading: boolean) => void
  ) => ReactNode;
  mediaServerCollectionAction?: (
    is4k: boolean,
    onLoadingChange: (loading: boolean) => void
  ) => ReactNode;
  seasonBrowser?: ReactNode;
  showRelated?: boolean;
  expandInformation?: boolean;
  collapseInformation?: boolean;
  showOverview?: boolean;
  showInformationControls?: boolean;
  embedded?: boolean;
}

const availableStatuses = new Set([
  MediaStatus.PARTIALLY_AVAILABLE,
  MediaStatus.AVAILABLE,
]);

const getAvailabilityText = (
  status: MediaStatus | undefined,
  unavailable: string
) => {
  switch (status) {
    case MediaStatus.AVAILABLE:
      return 'Available';
    case MediaStatus.PARTIALLY_AVAILABLE:
      return 'Partially Available';
    case MediaStatus.PROCESSING:
      return 'Processing';
    case MediaStatus.PENDING:
      return 'Requested';
    case MediaStatus.BLOCKLISTED:
      return 'Blocklisted';
    default:
      return unavailable;
  }
};

const SeriesDetailsLayout = ({
  metadataRetry,
  onLoadingChange,
  data,
  ratingData,
  sortedCrew,
  show4kAvailability,
  visibleSeasons,
  primaryActions,
  secondaryActions,
  indexerSearchAction,
  indexerCompanionActions,
  reportIssueAction,
  requestAction,
  playbackActions,
  mediaServerWatchlistAction,
  mediaServerCollectionAction,
  seasonBrowser,
  showRelated = true,
  expandInformation = false,
  collapseInformation = false,
  showOverview = true,
  showInformationControls = true,
  embedded = false,
}: SeriesDetailsLayoutProps) => {
  const intl = useIntl();
  const { currentSettings } = useSettings();
  const { data: watchedStatus, isValidating: watchedLoading } = useWatchStatus(
    'tv',
    data.id,
    Boolean(data.mediaInfo),
    true
  );
  const { pins, togglePinned } = useDetailDisclosurePins('tv');
  const {
    order: disclosureOrder,
    setOrder: setDisclosureOrder,
    canReorder,
    preferenceKey,
  } = useDetailDisclosureOrder(!embedded && showInformationControls);
  const [showDetails, setShowDetails] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  useEffect(() => {
    setOverviewOpen(
      showOverview &&
        (!showInformationControls ||
          (!collapseInformation && (expandInformation || pins.overview)))
    );
  }, [
    showOverview,
    showInformationControls,
    pins.overview,
    data.id,
    expandInformation,
    collapseInformation,
  ]);
  useEffect(() => {
    setShowDetails(!collapseInformation && (expandInformation || pins.details));
  }, [pins.details, data.id, expandInformation, collapseInformation]);
  const [showCast, setShowCast] = useState(false);
  const [showCrew, setShowCrew] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [showMediaServer, setShowMediaServer] = useState(false);
  useEffect(() => {
    setShowMediaServer(
      !collapseInformation && (expandInformation || pins.mediaServer)
    );
  }, [pins.mediaServer, data.id, expandInformation, collapseInformation]);
  const [selectedQuality, setSelectedQuality] = useState<'hd' | '4k'>(() =>
    show4kAvailability &&
    !availableStatuses.has(data.mediaInfo?.status as MediaStatus) &&
    availableStatuses.has(data.mediaInfo?.status4k as MediaStatus)
      ? '4k'
      : 'hd'
  );
  const effectiveSelectedQuality =
    show4kAvailability && selectedQuality === '4k' ? '4k' : 'hd';
  useEffect(() => {
    if (!show4kAvailability && selectedQuality !== 'hd') {
      setSelectedQuality('hd');
    }
  }, [selectedQuality, show4kAvailability]);
  useEffect(() => {
    setShowCast(!collapseInformation && (expandInformation || pins.cast));
  }, [pins.cast, expandInformation, collapseInformation]);
  useEffect(() => {
    setShowCrew(!collapseInformation && (expandInformation || pins.crew));
  }, [pins.crew, expandInformation, collapseInformation]);
  useEffect(() => {
    setShowTags(
      !collapseInformation && (expandInformation || pins.subjectTags)
    );
  }, [pins.subjectTags, expandInformation, collapseInformation]);
  const [selectedPlaybackItemIds, setSelectedPlaybackItemIds] = useState<
    string[]
  >([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [savedItemLoading, setSavedItemLoading] = useState(false);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const {
    data: standardPlaybackCatalog,
    isValidating: standardCatalogLoading,
  } = usePlaybackCatalog(data.mediaInfo?.id);
  const {
    data: highQualityPlaybackCatalog,
    isValidating: highQualityCatalogLoading,
  } = usePlaybackCatalog(
    show4kAvailability ? data.mediaInfo?.id : undefined,
    true
  );
  const playbackCatalog =
    effectiveSelectedQuality === '4k'
      ? highQualityPlaybackCatalog
      : standardPlaybackCatalog;
  const mediaServerType =
    watchedStatus?.serverType ??
    playbackCatalog?.serverType ??
    currentSettings.mediaServerType;
  const detailsLoading =
    watchedLoading ||
    standardCatalogLoading ||
    highQualityCatalogLoading ||
    episodesLoading ||
    (!embedded && (savedItemLoading || collectionsLoading));
  useEffect(() => {
    onLoadingChange?.(detailsLoading);
  }, [detailsLoading, onLoadingChange]);
  useEffect(() => () => onLoadingChange?.(false), [onLoadingChange]);
  useEffect(() => {
    const allowedIds = new Set(
      playbackCatalog?.groups.flatMap((group) =>
        group.items.map((item) => item.id)
      ) ?? []
    );
    setSelectedPlaybackItemIds((current) =>
      current.filter((itemId) => allowedIds.has(itemId))
    );
  }, [playbackCatalog]);
  const availablePlaybackItemIds =
    playbackCatalog?.groups.flatMap((group) =>
      group.items.map((item) => item.id)
    ) ?? [];
  const effectivePlaybackItemIds = resolveCanonicalPlaybackSelection(
    availablePlaybackItemIds,
    selectedPlaybackItemIds
  );
  const unavailable = intl.formatMessage(messages.notAvailable);
  const creators = data.createdBy;
  const featuredCrew = [
    ...creators.map((person) => ({ ...person, job: 'Creator' })),
    ...sortedCrew,
  ].slice(0, 6);
  const knownCrewNames = new Set(
    [
      ...creators.map((person) => person.name),
      ...sortedCrew.map((person) => person.name),
    ].map((name) => name.trim().toLocaleLowerCase())
  );
  const supplementalDirectors = (
    data.supplementalMetadata?.directors ?? []
  ).filter((name) => !knownCrewNames.has(name.trim().toLocaleLowerCase()));
  const supplementalWriters = (data.supplementalMetadata?.writers ?? []).filter(
    (name) => !knownCrewNames.has(name.trim().toLocaleLowerCase())
  );
  const featuredCrewGroups = [0, 1, 2].map((column) =>
    [featuredCrew[column], featuredCrew[column + 3]].filter(Boolean)
  );
  const castCredits = useMemo(
    () =>
      data.credits.cast.map((person) => ({
        id: person.id,
        name: person.name,
        role: person.character,
        profilePath: person.profilePath,
      })),
    [data.credits.cast]
  );
  const crewCredits = useMemo(
    () =>
      data.credits.crew.map((person) => ({
        id: person.id,
        name: person.name,
        role: person.job,
        profilePath: person.profilePath,
      })),
    [data.credits.crew]
  );
  const originalLanguage =
    intl.formatDisplayName(data.originalLanguage, {
      type: 'language',
      fallback: 'none',
    }) ??
    data.spokenLanguages.find(
      (language) => language.iso_639_1 === data.originalLanguage
    )?.name ??
    unavailable;
  const availableFormats = [
    availableStatuses.has(data.mediaInfo?.status as MediaStatus)
      ? 'HD'
      : undefined,
    availableStatuses.has(data.mediaInfo?.status4k as MediaStatus)
      ? '4K'
      : undefined,
  ].filter(Boolean);
  const mediaAndFormat = `Series${
    availableFormats.length > 0 ? ` · ${availableFormats.join(' + ')}` : ''
  }`;
  const airDates = [
    data.firstAirDate
      ? { label: messages.first, value: data.firstAirDate }
      : undefined,
    data.lastAirDate && data.lastAirDate !== data.firstAirDate
      ? { label: messages.last, value: data.lastAirDate }
      : undefined,
    data.nextEpisodeToAir?.airDate &&
    data.nextEpisodeToAir.airDate !== data.lastAirDate
      ? { label: messages.next, value: data.nextEpisodeToAir.airDate }
      : undefined,
  ].filter(
    (item): item is { label: typeof messages.first; value: string } => !!item
  );

  return (
    <div
      className="media-page"
      data-page-layout={embedded ? 'embedded' : undefined}
    >
      <article className="media-detail-card app-card-main card-layout refreshed-card-surface refreshed-detail-text">
        {data.backdropPath && (
          <MediaDetailArtwork
            type="tmdb"
            src={`https://image.tmdb.org/t/p/original${data.backdropPath}`}
          />
        )}

        <div data-card-part="content">
          <div className="app-card-inset refreshed-inset-surface detail-summary-card app-detail-summary-grid">
            <div
              className="app-detail-poster-frame detail-card-poster"
              data-testid="media-details-poster"
            >
              <CachedImage
                type="tmdb"
                src={
                  getTmdbPosterImageUrl(data.posterPath) ||
                  '/images/seerr_poster_not_found.png'
                }
                alt=""
                fill
                priority
                sizes="(min-width: 640px) 80px, 64px"
                className="media-detail-artwork-image"
              />
            </div>

            <div>
              <h1
                className="card-title detail-summary-title"
                data-title-weight="regular"
                data-testid="media-title"
              >
                {data.name}
                {data.firstAirDate ? ` (${data.firstAirDate.slice(0, 4)})` : ''}
              </h1>

              <div
                className="detail-card-heading-spacing detail-three-column-grid"
                data-table-layout="series-title-details-table"
              >
                <div className="detail-paired-column-span">
                  <dl className="card-table detail-paired-columns">
                    <dt className="card-table-heading">
                      {intl.formatMessage(messages.mediaAndFormat)}:
                    </dt>
                    <dd className="card-table-value">{mediaAndFormat}</dd>
                    <dt className="card-table-heading">
                      {intl.formatMessage(messages.firstAirDate)}:
                    </dt>
                    <dd className="card-table-value">
                      {data.firstAirDate
                        ? intl.formatDate(data.firstAirDate, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            timeZone: 'UTC',
                          })
                        : unavailable}
                    </dd>
                    <dt className="card-table-heading">
                      {intl.formatMessage(messages.episodeRuntime)}:
                    </dt>
                    <dd className="card-table-value">
                      {data.episodeRunTime[0]
                        ? intl.formatMessage(messages.minutes, {
                            minutes: data.episodeRunTime[0],
                          })
                        : unavailable}
                    </dd>
                    <div className="card-table media-detail-column-divider">
                      <dt className="card-table-heading">
                        {intl.formatMessage(messages.creator)}:
                      </dt>
                      <dd className="card-table-value">
                        {creators.length > 0
                          ? creators.slice(0, 2).map((person, index) => (
                              <span key={person.id}>
                                {index > 0 && ', '}
                                <Link
                                  href={`/person/${person.id}`}
                                  className="app-detail-link"
                                >
                                  {person.name}
                                </Link>
                              </span>
                            ))
                          : unavailable}
                      </dd>
                      <dt className="card-table-heading">
                        {intl.formatMessage(messages.network)}:
                      </dt>
                      <dd className="card-table-value">
                        {data.networks[0]?.id > 0 ? (
                          <Link
                            href={`/discover/tv/network/${data.networks[0].id}`}
                            className="app-detail-link"
                          >
                            {data.networks[0].name}
                          </Link>
                        ) : data.networks[0] ? (
                          data.networks[0].name
                        ) : (
                          unavailable
                        )}
                      </dd>
                      <dt className="card-table-heading">
                        {intl.formatMessage(messages.seriesType)}:
                      </dt>
                      <dd className="card-table-value">
                        {data.type || unavailable}
                      </dd>
                    </div>

                    <dt className="card-table-heading">
                      {intl.formatMessage(messages.genres)}:
                    </dt>
                    <dd
                      className="card-table-value"
                      data-wrap="true"
                      data-testid="media-details-genres"
                    >
                      {data.genres.length > 0
                        ? data.genres.map((genre, index) => (
                            <span key={`${genre.id}-${genre.name}`}>
                              {index > 0 && ', '}
                              {genre.id > 0 ? (
                                <Link
                                  href={`/discover/tv?genre=${genre.id}`}
                                  className="app-detail-link"
                                >
                                  {genre.name}
                                </Link>
                              ) : (
                                genre.name
                              )}
                            </span>
                          ))
                        : unavailable}
                    </dd>
                  </dl>
                </div>

                <div className="media-detail-column-divider">
                  <dl className="card-table" data-table-layout="availability">
                    <dt className="card-table-heading">
                      {intl.formatMessage(messages.hd)}:
                    </dt>
                    <dd className="card-table-value">
                      <AvailabilityValue status={data.mediaInfo?.status}>
                        {getAvailabilityText(
                          data.mediaInfo?.status,
                          unavailable
                        )}
                      </AvailabilityValue>
                    </dd>
                    {show4kAvailability && (
                      <>
                        <dt className="card-table-heading">
                          {intl.formatMessage(messages.ultraHd)}:
                        </dt>
                        <dd className="card-table-value">
                          <AvailabilityValue status={data.mediaInfo?.status4k}>
                            {getAvailabilityText(
                              data.mediaInfo?.status4k,
                              unavailable
                            )}
                          </AvailabilityValue>
                        </dd>
                      </>
                    )}
                    {!!watchedStatus?.availableCount && (
                      <>
                        <dt
                          className="card-table-heading"
                          data-table-slot="footer"
                        >
                          {intl.formatMessage(messages.watched)}:
                        </dt>
                        <dd
                          className="card-table-value"
                          data-table-slot="footer"
                        >
                          <WatchedBadge
                            status={watchedStatus}
                            className="detail-watched-button"
                            showUnwatched
                            incompleteLibrary={
                              data.mediaInfo?.status ===
                                MediaStatus.PARTIALLY_AVAILABLE ||
                              (data.mediaInfo?.status !==
                                MediaStatus.AVAILABLE &&
                                data.mediaInfo?.status4k ===
                                  MediaStatus.PARTIALLY_AVAILABLE)
                            }
                          />
                        </dd>
                      </>
                    )}
                  </dl>
                </div>
              </div>
            </div>
          </div>

          {showInformationControls && (
            <ReorderableDisclosureRow
              distributed
              key={preferenceKey}
              order={disclosureOrder}
              onOrderChange={setDisclosureOrder}
              disabled={!canReorder}
              leading={<CollectionNavigation kind="tv" id={String(data.id)} />}
            >
              {showOverview && (
                <DetailDisclosureButton
                  key="overview"
                  label={intl.formatMessage(messages.overview)}
                  open={overviewOpen}
                  onClick={() => setOverviewOpen((open) => !open)}
                  pinned={pins.overview}
                  onPinClick={() => void togglePinned('overview')}
                  controls="series-overview-panel"
                />
              )}
              <DetailDisclosureButton
                key="cast"
                label={intl.formatMessage(messages.viewCast)}
                open={showCast}
                onClick={() => setShowCast((open) => !open)}
                pinned={pins.cast}
                onPinClick={() => void togglePinned('cast')}
              />
              <DetailDisclosureButton
                key="crew"
                label={intl.formatMessage(messages.viewCrew)}
                open={showCrew}
                onClick={() => setShowCrew((open) => !open)}
                pinned={pins.crew}
                onPinClick={() => void togglePinned('crew')}
              />
              <DetailDisclosureButton
                key="subjectTags"
                label={intl.formatMessage(messages.subjectTags)}
                open={showTags}
                onClick={() => setShowTags((open) => !open)}
                pinned={pins.subjectTags}
                onPinClick={() => void togglePinned('subjectTags')}
              />
              <DetailDisclosureButton
                key="details"
                label={intl.formatMessage(messages.seriesDetails)}
                open={showDetails}
                onClick={() => setShowDetails((open) => !open)}
                pinned={pins.details}
                onPinClick={() => void togglePinned('details')}
                controls="tv-additional-details"
              />
              <DetailDisclosureButton
                key="mediaServer"
                label={intl.formatMessage(messages.mediaServer)}
                icon={
                  <MediaServerIcon
                    mediaServerType={mediaServerType}
                    className="watched-status-logo"
                  />
                }
                open={showMediaServer}
                onClick={() => setShowMediaServer((open) => !open)}
                pinned={pins.mediaServer}
                onPinClick={() => void togglePinned('mediaServer')}
                controls="series-media-server-panel"
                title={intl.formatMessage(messages.mediaServerTooltip)}
              />
            </ReorderableDisclosureRow>
          )}

          <OrderedDisclosurePanels order={disclosureOrder}>
            <Fragment key="overview">
              {showOverview && overviewOpen && (
                <section
                  id="series-overview-panel"
                  className="app-card-inset refreshed-inset-surface card-spacing-before"
                >
                  <h2 className="media-inset-heading">
                    {intl.formatMessage(messages.overview)}
                  </h2>
                  {data.tagline && (
                    <p className="card-subheading">{data.tagline}</p>
                  )}
                  <p className="card-body-text">
                    {data.overview ||
                      intl.formatMessage(messages.overviewUnavailable)}
                  </p>
                </section>
              )}
            </Fragment>
            <Fragment key="cast">
              {showCast && (
                <ExpandableCreditList
                  title={intl.formatMessage(messages.fullCastList)}
                  credits={castCredits}
                  emptyLabel={intl.formatMessage(messages.noCast)}
                  retry={metadataRetry}
                />
              )}
            </Fragment>
            <Fragment key="crew">
              {showCrew && (
                <ExpandableCreditList
                  title={intl.formatMessage(messages.fullCrewList)}
                  credits={crewCredits}
                  emptyLabel={intl.formatMessage(messages.noCrew)}
                  retry={metadataRetry}
                />
              )}
            </Fragment>
            <Fragment key="subjectTags">
              {showTags && (
                <section className="app-card-inset refreshed-inset-surface card-spacing-before">
                  <h2 className="media-inset-heading card-spacing-after">
                    {intl.formatMessage(messages.subjectTags)}
                  </h2>
                  {data.keywords.length === 0 ? (
                    <PageErrorMessage
                      title={intl.formatMessage(messages.noTags)}
                      severity="empty"
                      retry={metadataRetry}
                    />
                  ) : (
                    <div className="card-list" data-list-layout="tags">
                      {data.keywords.map((keyword, index) => (
                        <Link
                          key={keyword.id}
                          href={`/discover/tv/keyword?keywords=${keyword.id}`}
                          className="compact-control subject-tag"
                          data-tone={subjectTagTone(index)}
                        >
                          {keyword.name}
                        </Link>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </Fragment>

            <Fragment key="details">
              {showDetails && (
                <section
                  id="tv-additional-details"
                  className="app-card-inset refreshed-inset-surface card-spacing-before"
                >
                  <h2 className="media-inset-heading detail-card-heading-after">
                    {intl.formatMessage(messages.seriesDetails)}
                  </h2>
                  <div
                    className="detail-three-column-grid"
                    data-table-layout="series-details-table"
                  >
                    <dl className="card-table">
                      <dt className="card-table-heading">
                        {intl.formatMessage(messages.status)}:
                      </dt>
                      <dd className="card-table-value">
                        {data.status || unavailable}
                      </dd>
                      <dt className="card-table-heading">
                        {intl.formatMessage(messages.airDates)}:
                      </dt>
                      <dd
                        className="card-table-value"
                        data-value-layout="stacked"
                      >
                        {airDates.length > 0
                          ? airDates.map((airDate) => (
                              <span key={airDate.label.id}>
                                {intl.formatMessage(airDate.label)} ·{' '}
                                {intl.formatDate(airDate.value, {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                  timeZone: 'UTC',
                                })}
                              </span>
                            ))
                          : unavailable}
                      </dd>
                    </dl>

                    <dl className="card-table media-detail-column-divider">
                      <dt className="card-table-heading">
                        {intl.formatMessage(messages.seriesType)}:
                      </dt>
                      <dd className="card-table-value">
                        {data.type || unavailable}
                      </dd>
                      <dt className="card-table-heading">
                        {intl.formatMessage(messages.episodeRuntime)}:
                      </dt>
                      <dd className="card-table-value">
                        {data.episodeRunTime[0]
                          ? intl.formatMessage(messages.minutes, {
                              minutes: data.episodeRunTime[0],
                            })
                          : unavailable}
                      </dd>
                      <dt className="card-table-heading">
                        {intl.formatMessage(messages.language)}:
                      </dt>
                      <dd className="card-table-value">
                        <Link
                          href={`/discover/tv/language/${data.originalLanguage}`}
                          className="app-detail-link"
                        >
                          {originalLanguage}
                        </Link>
                      </dd>
                      <dt className="card-table-heading">
                        {intl.formatMessage(messages.country)}:
                      </dt>
                      <dd className="card-table-value">
                        {data.productionCountries.length > 0
                          ? data.productionCountries.map((country, index) => (
                              <span key={country.iso_3166_1}>
                                {index > 0 && ', '}
                                <Link
                                  href={`/discover/tv?country=${country.iso_3166_1}`}
                                  className="app-detail-link"
                                >
                                  {intl.formatDisplayName(country.iso_3166_1, {
                                    type: 'region',
                                    fallback: 'none',
                                  }) ?? country.name}
                                </Link>
                              </span>
                            ))
                          : unavailable}
                      </dd>
                    </dl>

                    <dl className="card-table media-detail-column-divider">
                      <dt className="card-table-heading">
                        {intl.formatMessage(messages.networks)}:
                      </dt>
                      <dd
                        className="card-table-value"
                        data-value-layout="stacked"
                      >
                        {data.networks.length > 0
                          ? data.networks.slice(0, 4).map((network) =>
                              network.id > 0 ? (
                                <Link
                                  key={network.id}
                                  href={`/discover/tv/network/${network.id}`}
                                  className="app-detail-link"
                                >
                                  {network.name}
                                </Link>
                              ) : (
                                <span key={network.name}>{network.name}</span>
                              )
                            )
                          : unavailable}
                      </dd>
                    </dl>
                  </div>
                  <MetadataAttribution sources={data.metadataSources} />
                  {(supplementalDirectors.length > 0 ||
                    supplementalWriters.length > 0) && (
                    <dl className="media-metadata-supplemental">
                      {supplementalDirectors.length > 0 && (
                        <div>
                          <dt>{intl.formatMessage(messages.director)}:</dt>
                          <dd>
                            {supplementalDirectors.slice(0, 4).join(', ')}
                          </dd>
                        </div>
                      )}
                      {supplementalWriters.length > 0 && (
                        <div>
                          <dt>{intl.formatMessage(messages.writers)}:</dt>
                          <dd>{supplementalWriters.slice(0, 4).join(', ')}</dd>
                        </div>
                      )}
                    </dl>
                  )}
                  {featuredCrew.length > 0 && (
                    <div
                      className="detail-three-column-grid"
                      data-details-layout="facts"
                    >
                      {featuredCrewGroups.map((group, groupIndex) => (
                        <dl
                          key={`featured-crew-${groupIndex}`}
                          className={`card-table ${groupIndex > 0 ? 'media-detail-column-divider' : ''}`}
                        >
                          {group.map((person) => (
                            <Fragment key={`${person.id}-${person.job}`}>
                              <dt className="card-table-heading">
                                {person.job}:
                              </dt>
                              <dd className="card-table-value">
                                <Link
                                  href={`/person/${person.id}`}
                                  className="app-detail-link"
                                >
                                  {person.name}
                                </Link>
                              </dd>
                            </Fragment>
                          ))}
                        </dl>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </Fragment>

            <Fragment key="mediaServer">
              {seasonBrowser !== undefined ? (
                seasonBrowser
              ) : (
                <div
                  id="series-media-server-panel"
                  className="card-layout card-spacing-before"
                  data-card-layout="media-server-panel"
                  hidden={!showMediaServer}
                >
                  <SeriesSeasonEpisodeBrowser
                    active={showMediaServer}
                    contained
                    metadataRetry={metadataRetry}
                    onLoadingChange={setEpisodesLoading}
                    tvId={data.id}
                    seasons={visibleSeasons}
                    catalog={playbackCatalog}
                    watchedStatus={watchedStatus}
                    selectedItemIds={selectedPlaybackItemIds}
                    onSelectionChange={setSelectedPlaybackItemIds}
                  />
                  <div data-card-part="actions">
                    <MediaQualitySelect
                      value={effectiveSelectedQuality}
                      options={[
                        {
                          label: 'HD',
                          value: 'hd',
                          disabled: !availableFormats.includes('HD'),
                        },
                        ...(show4kAvailability
                          ? ([
                              {
                                label: '4K',
                                value: '4k',
                                disabled: !availableFormats.includes('4K'),
                              },
                            ] as const)
                          : []),
                      ]}
                      onChange={setSelectedQuality}
                      label={intl.formatMessage(messages.quality)}
                    />
                    <div className="app-action-row">
                      {playbackActions?.(
                        effectivePlaybackItemIds,
                        effectiveSelectedQuality === '4k'
                      )}
                    </div>
                    {playbackActions && (
                      <div className="app-action-row">
                        <PlayOnDeviceButton
                          mediaId={data.mediaInfo?.id}
                          itemIds={effectivePlaybackItemIds}
                          is4k={effectiveSelectedQuality === '4k'}
                        />
                      </div>
                    )}
                    {[
                      MediaServerType.PLEX,
                      MediaServerType.JELLYFIN,
                      MediaServerType.EMBY,
                    ].includes(mediaServerType) && (
                      <>
                        <div
                          className="app-action-row"
                          data-card-part="saved-item-action"
                        >
                          {(!embedded && showMediaServer
                            ? mediaServerWatchlistAction?.(
                                effectiveSelectedQuality === '4k',
                                setSavedItemLoading
                              )
                            : undefined) ?? (
                            /* Visual review only: no handler or provider write. */
                            <Tooltip
                              content={intl.formatMessage(
                                mediaServerType === MediaServerType.PLEX
                                  ? messages.addToWatchlistTooltip
                                  : messages.addToFavoritesTooltip
                              )}
                            >
                              <Button
                                buttonType="playback"
                                buttonSize="sm"
                                type="button"
                              >
                                <span className="playback-button-label">
                                  <MediaServerIcon
                                    mediaServerType={mediaServerType}
                                    className="playback-provider-icon"
                                  />
                                  <span>
                                    {intl.formatMessage(
                                      mediaServerType === MediaServerType.PLEX
                                        ? messages.addToWatchlist
                                        : messages.addToFavorites
                                    )}
                                  </span>
                                </span>
                              </Button>
                            </Tooltip>
                          )}
                        </div>
                        <div
                          className="app-action-row"
                          data-card-part="collection-action"
                        >
                          {(!embedded && showMediaServer
                            ? mediaServerCollectionAction?.(
                                effectiveSelectedQuality === '4k',
                                setCollectionsLoading
                              )
                            : undefined) ?? (
                            <Tooltip
                              content={intl.formatMessage(
                                messages.addToCollectionTooltip
                              )}
                            >
                              <Button
                                buttonType="playback"
                                buttonSize="sm"
                                type="button"
                              >
                                <span className="playback-button-label">
                                  <MediaServerIcon
                                    mediaServerType={mediaServerType}
                                    className="playback-provider-icon"
                                  />
                                  <span>
                                    {intl.formatMessage(
                                      messages.addToCollection
                                    )}
                                  </span>
                                </span>
                              </Button>
                            </Tooltip>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </Fragment>
          </OrderedDisclosurePanels>

          <div className="media-primary-action-row">
            {primaryActions}
            {reportIssueAction}
            {secondaryActions}
            <VideoRatings
              mediaType="tv"
              id={data.id}
              voteAverage={data.voteAverage}
              voteCount={data.voteCount}
              ratings={ratingData}
            />
          </div>

          <div className="media-request-action-row">
            <div className="media-request-search-action">
              {indexerSearchAction}
              {indexerCompanionActions}
            </div>
            <div className="media-request-submit-action">{requestAction}</div>
          </div>
        </div>
      </article>

      {showRelated && (
        <>
          <MediaSlider
            sliderKey="recommendations"
            posterTitleWeight="regular"
            title={intl.formatMessage(messages.recommendations)}
            url={`/api/v1/tv/${data.id}/recommendations`}
            linkUrl={`/tv/${data.id}/recommendations`}
            hideWhenEmpty
          />
          <MediaSlider
            sliderKey="similar"
            posterTitleWeight="regular"
            title={intl.formatMessage(messages.similar)}
            url={`/api/v1/tv/${data.id}/similar`}
            linkUrl={`/tv/${data.id}/similar`}
            hideWhenEmpty
          />
          <div className="extra-bottom-space" />
        </>
      )}
    </div>
  );
};

export default SeriesDetailsLayout;
