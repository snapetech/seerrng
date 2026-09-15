import MusicBrainzLogo from '@app/assets/musicbrainz.svg';
import LidarrLogo from '@app/assets/services/lidarr.svg';
import CachedImage from '@app/components/Common/CachedImage';
import PlayOnDeviceButton from '@app/components/Common/PlayOnDeviceButton';
import Tooltip from '@app/components/Common/Tooltip';
import AlbumTrackList from '@app/components/MediaDetails/AlbumTrackList';
import AvailabilityValue from '@app/components/MediaDetails/AvailabilityValue';
import DetailDisclosureButton from '@app/components/MediaDetails/DetailDisclosureButton';
import MediaDetailArtwork from '@app/components/MediaDetails/MediaDetailArtwork';
import MediaQualitySelect from '@app/components/MediaDetails/MediaQualitySelect';
import MediaSlider from '@app/components/MediaSlider';
import useDetailDisclosurePins from '@app/hooks/useDetailDisclosurePins';
import usePlaybackCatalog from '@app/hooks/usePlaybackCatalog';
import { encodeApiPathSegment } from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
import { resolveCanonicalPlaybackSelection } from '@app/utils/playbackSelection';
import { getSafeHref } from '@app/utils/safeUrl';
import { MediaStatus } from '@server/constants/media';
import type { MusicDetails, MusicRatingResponse } from '@server/models/Music';
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.MusicDetails.Layout', {
  mediaAndFormat: 'Media & Format',
  releaseDate: 'Release Date',
  runtime: 'Runtime',
  genres: 'Genres',
  artist: 'Artist',
  albumType: 'Album Type',
  trackCount: 'Track Count',
  status: 'Status',
  viewArtists: 'View Artists',
  subjectTags: 'Subject Tags',
  fullArtistList: 'Full Artist List',
  noArtists: 'No artist information available',
  noTags: 'No subject tags available',
  albumDetails: 'Album Details',
  artistType: 'Artist Type',
  origin: 'Origin',
  musicBrainz: 'MusicBrainz',
  similarArtists: 'Similar Artists',
  notAvailable: 'Not available',
  minutes: '{minutes} minutes',
  available: 'Available',
  albumArtist: 'Album Artist',
  trackArtist: 'Track Artist',
  musicBrainzRating: 'MusicBrainz rating: {score} from {votes} votes',
  lidarrRating: 'Lidarr rating: {score} from {votes} votes',
  quality: 'Quality',
});

interface MusicDetailsLayoutProps {
  data: MusicDetails;
  primaryActions: ReactNode;
  secondaryActions: ReactNode;
  playbackActions?: (itemIds: string[], useFlac: boolean) => ReactNode;
  ratingData?: MusicRatingResponse;
  additionalContent?: ReactNode;
}

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

const subjectTagTones = [
  'border-indigo-400/80 bg-indigo-500/20 text-indigo-100 hover:bg-indigo-500/35',
  'border-purple-400/80 bg-purple-500/20 text-purple-100 hover:bg-purple-500/35',
  'border-emerald-400/80 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/35',
  'border-amber-400/80 bg-amber-500/20 text-amber-100 hover:bg-amber-500/35',
  'border-sky-400/80 bg-sky-500/20 text-sky-100 hover:bg-sky-500/35',
  'border-rose-400/80 bg-rose-500/20 text-rose-100 hover:bg-rose-500/35',
] as const;

const MusicDetailsLayout = ({
  data,
  primaryActions,
  secondaryActions,
  playbackActions,
  ratingData,
  additionalContent,
}: MusicDetailsLayoutProps) => {
  const intl = useIntl();
  const { pins, togglePinned } = useDetailDisclosurePins('music');
  const [showArtists, setShowArtists] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [selectedPlaybackItemIds, setSelectedPlaybackItemIds] = useState<
    string[]
  >([]);
  const qualityLabels = [
    ...new Set(
      (data.availableServices ?? [])
        .map((service) => service.quality.trim().toLocaleUpperCase())
        .filter(Boolean)
    ),
  ];
  const qualityAvailability = (['MP3', 'FLAC'] as const).map((quality) => ({
    quality,
    available: qualityLabels.some((label) => label.includes(quality)),
  }));
  const [selectedQuality, setSelectedQuality] = useState<'mp3' | 'flac'>(() =>
    !qualityAvailability.some(
      ({ quality, available }) => quality === 'MP3' && available
    ) &&
    qualityAvailability.some(
      ({ quality, available }) => quality === 'FLAC' && available
    )
      ? 'flac'
      : 'mp3'
  );
  const { data: mp3PlaybackCatalog } = usePlaybackCatalog(
    data.mediaInfo?.id,
    false
  );
  const { data: flacPlaybackCatalog } = usePlaybackCatalog(
    data.mediaInfo?.id,
    true
  );
  const playbackCatalog =
    selectedQuality === 'flac' ? flacPlaybackCatalog : mp3PlaybackCatalog;
  const safeRatingUrl = getSafeHref(ratingData?.rating?.url);
  useEffect(() => {
    setShowArtists(pins.artists);
  }, [pins.artists]);
  useEffect(() => {
    setShowTags(pins.subjectTags);
  }, [pins.subjectTags]);
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
  const albumId = encodeApiPathSegment(data.id);
  const artistId = encodeApiPathSegment(data.artist.id);
  const formattedReleaseDate = (() => {
    if (!data.releaseDate) {
      return unavailable;
    }
    if (/^\d{4}$/.test(data.releaseDate)) {
      return data.releaseDate;
    }
    const normalizedDate = /^\d{4}-\d{2}$/.test(data.releaseDate)
      ? `${data.releaseDate}-01`
      : data.releaseDate;
    const parsedDate = new Date(`${normalizedDate}T00:00:00Z`);

    return Number.isNaN(parsedDate.getTime())
      ? data.releaseDate
      : intl.formatDate(parsedDate, {
          year: 'numeric',
          month: 'short',
          day: /^\d{4}-\d{2}-\d{2}$/.test(data.releaseDate)
            ? 'numeric'
            : undefined,
          timeZone: 'UTC',
        });
  })();
  const runtimeMinutes = Math.round(
    data.tracks.reduce((total, track) => total + track.length, 0) / 60000
  );
  const mediaAndFormat = `Music · Album${
    qualityLabels.length > 0 ? ` · ${qualityLabels.join(' + ')}` : ''
  }`;
  const tags = useMemo(() => {
    const uniqueTags = new Map<string, { name: string; count: number }>();
    for (const tag of [
      ...(data.tags?.releaseGroup ?? []),
      ...(data.tags?.artist ?? []),
    ]) {
      const name = tag.tag.trim();
      if (!name) {
        continue;
      }
      const key = name.toLocaleLowerCase();
      const count = Number.isFinite(tag.count) ? tag.count : 0;
      const existing = uniqueTags.get(key);
      if (!existing || count > existing.count) {
        uniqueTags.set(key, { name, count });
      }
    }
    return [...uniqueTags.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 50);
  }, [data.tags]);
  const artists = useMemo(() => {
    const uniqueArtists = new Map<
      string,
      {
        id: string;
        name: string;
        role: string;
        image?: string;
        imageType: 'music' | 'tmdb';
      }
    >();

    if (data.artist.id && data.artist.name) {
      uniqueArtists.set(data.artist.id, {
        id: data.artist.id,
        name: data.artist.name,
        role: intl.formatMessage(messages.albumArtist),
        image: data.artistThumb,
        imageType: 'music',
      });
    }
    for (const track of data.tracks) {
      for (const artist of track.artists) {
        if (!artist.mbid || !artist.name || uniqueArtists.has(artist.mbid)) {
          continue;
        }
        uniqueArtists.set(artist.mbid, {
          id: artist.mbid,
          name: artist.name,
          role: intl.formatMessage(messages.trackArtist),
          image: artist.tmdbMapping?.profilePath,
          imageType: 'tmdb',
        });
      }
    }
    return [...uniqueArtists.values()];
  }, [data.artist, data.artistThumb, data.tracks, intl]);
  const backdrop = data.artistBackdrop ?? data.artistThumb ?? data.posterPath;

  return (
    <div className="media-page">
      <article className="media-detail-card refreshed-card-surface refreshed-detail-text relative overflow-hidden rounded-xl border border-gray-700 p-3 shadow-lg shadow-gray-950/20">
        {backdrop && <MediaDetailArtwork type="music" src={backdrop} />}

        <div className="relative z-10">
          <div className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)] gap-3 sm:grid-cols-[80px_minmax(0,1fr)]">
            <div
              className="relative h-24 w-16 overflow-hidden rounded-lg ring-1 ring-gray-600 sm:h-[120px] sm:w-20"
              data-testid="media-details-poster"
            >
              <CachedImage
                type="music"
                src={data.posterPath || '/images/seerr_poster_not_found.png'}
                alt=""
                fill
                priority
                sizes="(min-width: 640px) 80px, 64px"
                className="object-cover"
              />
            </div>

            <div className="flex min-w-0 flex-col">
              <h1
                className="text-lg leading-5 font-semibold text-white"
                data-testid="media-title"
              >
                {data.title}
                {data.releaseDate ? ` (${data.releaseDate.slice(0, 4)})` : ''}
              </h1>

              <div className="card:grid-cols-3 mt-4 grid min-w-0 flex-1 grid-cols-1">
                <div className="card:col-span-2 card:grid card:grid-cols-2 card:pr-3 min-w-0">
                  <dl className="card:pr-3 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 text-xs leading-4">
                    <dt className="font-medium text-gray-100">
                      {intl.formatMessage(messages.mediaAndFormat)}:
                    </dt>
                    <dd className="m-0 truncate">{mediaAndFormat}</dd>
                    <dt className="font-medium text-gray-100">
                      {intl.formatMessage(messages.releaseDate)}:
                    </dt>
                    <dd className="m-0 truncate">{formattedReleaseDate}</dd>
                    <dt className="font-medium text-gray-100">
                      {intl.formatMessage(messages.runtime)}:
                    </dt>
                    <dd className="m-0 truncate">
                      {runtimeMinutes > 0
                        ? intl.formatMessage(messages.minutes, {
                            minutes: runtimeMinutes,
                          })
                        : unavailable}
                    </dd>
                  </dl>

                  <dl className="media-detail-column-divider grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 text-xs leading-4">
                    <dt className="font-medium text-gray-100">
                      {intl.formatMessage(messages.artist)}:
                    </dt>
                    <dd className="m-0 truncate">
                      <Link
                        href={`/artist/${artistId}`}
                        className="text-indigo-300 hover:text-indigo-200 hover:underline focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                      >
                        {data.artist.name || unavailable}
                      </Link>
                    </dd>
                    <dt className="font-medium text-gray-100">
                      {intl.formatMessage(messages.albumType)}:
                    </dt>
                    <dd className="m-0 truncate">{data.type || unavailable}</dd>
                    <dt className="font-medium text-gray-100">
                      {intl.formatMessage(messages.trackCount)}:
                    </dt>
                    <dd className="m-0 truncate">
                      {intl.formatNumber(data.tracks.length)}
                    </dd>
                  </dl>

                  <dl className="card:col-span-2 mt-0.5 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 text-xs leading-4">
                    <dt className="font-medium text-gray-100">
                      {intl.formatMessage(messages.genres)}:
                    </dt>
                    <dd
                      className="m-0 min-w-0 break-words"
                      data-testid="media-details-genres"
                    >
                      {tags.length > 0
                        ? tags.slice(0, 4).map((tag, index) => (
                            <span key={tag.name}>
                              {index > 0 && ', '}
                              <Link
                                href={`/discover/music?genre=${encodeURIComponent(tag.name)}`}
                                className="text-indigo-300 hover:text-indigo-200 hover:underline focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                              >
                                {tag.name}
                              </Link>
                            </span>
                          ))
                        : unavailable}
                    </dd>
                  </dl>
                </div>

                <div className="media-detail-column-divider flex min-w-0 flex-col text-xs leading-4">
                  <dl className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5">
                    {qualityAvailability.map(({ quality, available }) => (
                      <div className="contents" key={quality}>
                        <dt className="font-medium text-gray-100 uppercase">
                          {quality}:
                        </dt>
                        <dd className="m-0 truncate font-medium">
                          <AvailabilityValue
                            tone={available ? 'available' : 'unavailable'}
                          >
                            {intl.formatMessage(
                              available
                                ? messages.available
                                : messages.notAvailable
                            )}
                          </AvailabilityValue>
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <AlbumTrackList
            tracks={data.tracks}
            twoColumnsOnly
            catalog={playbackCatalog}
            availableRecordingIds={data.trackAvailability?.[selectedQuality]}
            selectedItemIds={selectedPlaybackItemIds}
            onSelectionChange={setSelectedPlaybackItemIds}
          />

          {(playbackActions || ratingData?.rating) && (
            <div
              className="media-rating-row"
              data-testid="music-playback-rating-row"
            >
              <MediaQualitySelect
                value={selectedQuality}
                options={[
                  { label: 'MP3', value: 'mp3' },
                  { label: 'FLAC', value: 'flac' },
                ]}
                onChange={setSelectedQuality}
                label={intl.formatMessage(messages.quality)}
              />
              {playbackActions?.(
                effectivePlaybackItemIds,
                selectedQuality === 'flac'
              )}
              {playbackActions && (
                <PlayOnDeviceButton
                  mediaId={data.mediaInfo?.id}
                  itemIds={effectivePlaybackItemIds}
                  is4k={selectedQuality === 'flac'}
                />
              )}
              {ratingData?.rating && safeRatingUrl && (
                <Tooltip
                  content={intl.formatMessage(
                    ratingData.rating.source === 'lidarr'
                      ? messages.lidarrRating
                      : messages.musicBrainzRating,
                    {
                      score: intl.formatNumber(ratingData.rating.score, {
                        maximumFractionDigits: 1,
                      }),
                      votes: intl.formatNumber(ratingData.rating.votes),
                    }
                  )}
                >
                  <a
                    href={safeRatingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="media-rating-link"
                    aria-label={intl.formatMessage(
                      ratingData.rating.source === 'lidarr'
                        ? messages.lidarrRating
                        : messages.musicBrainzRating,
                      {
                        score: intl.formatNumber(ratingData.rating.score, {
                          maximumFractionDigits: 1,
                        }),
                        votes: intl.formatNumber(ratingData.rating.votes),
                      }
                    )}
                  >
                    {ratingData.rating.source === 'lidarr' ? (
                      <LidarrLogo className="media-rating-icon" />
                    ) : (
                      <MusicBrainzLogo className="media-rating-icon" />
                    )}
                    <span className="media-rating-value">
                      {intl.formatNumber(ratingData.rating.score, {
                        maximumFractionDigits: 1,
                      })}
                    </span>
                  </a>
                </Tooltip>
              )}
            </div>
          )}

          <div className="media-primary-action-row">
            {primaryActions}
            {secondaryActions}
          </div>

          <div className="mt-[5px] flex flex-wrap items-center gap-2">
            <DetailDisclosureButton
              label={intl.formatMessage(messages.viewArtists)}
              open={showArtists}
              onClick={() => setShowArtists((open) => !open)}
              pinned={pins.artists}
              onPinClick={() => void togglePinned('artists')}
            />
            <DetailDisclosureButton
              label={intl.formatMessage(messages.subjectTags)}
              open={showTags}
              onClick={() => setShowTags((open) => !open)}
              pinned={pins.subjectTags}
              onPinClick={() => void togglePinned('subjectTags')}
            />
          </div>

          {showArtists && (
            <section className="refreshed-inset-surface mt-[5px] rounded-lg border border-gray-700 p-3">
              <h2 className="media-inset-heading mb-2">
                {intl.formatMessage(messages.fullArtistList)}
              </h2>
              {artists.length === 0 ? (
                <p className="refreshed-detail-text-muted text-xs">
                  {intl.formatMessage(messages.noArtists)}
                </p>
              ) : (
                <div className="scrollable-card -mr-3 grid max-h-[252px] grid-cols-3 gap-1.5 overflow-y-auto pr-3">
                  {artists.map((artist) => (
                    <Link
                      key={artist.id}
                      href={`/artist/${encodeApiPathSegment(artist.id)}`}
                      prefetch={false}
                      className="group flex h-20 min-w-0 overflow-hidden rounded-lg border border-gray-700 bg-gray-900/30 transition hover:border-indigo-400 hover:bg-indigo-500/15 focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                    >
                      <span className="relative h-full w-[54px] flex-shrink-0 overflow-hidden border-r border-gray-700 bg-white">
                        <CachedImage
                          type={artist.imageType}
                          src={
                            artist.image
                              ? artist.imageType === 'tmdb' &&
                                artist.image.startsWith('/')
                                ? `https://image.tmdb.org/t/p/w185${artist.image}`
                                : artist.image
                              : '/images/camera-shy-profile-placeholder.png'
                          }
                          alt=""
                          fill
                          sizes="54px"
                          className="object-cover object-top"
                        />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col justify-center px-2 py-1.5">
                        <span className="truncate text-xs font-semibold text-gray-200 group-hover:text-white">
                          {artist.name}
                        </span>
                        <span className="refreshed-detail-text-muted mt-0.5 line-clamp-2 text-xs leading-4">
                          {artist.role}
                        </span>
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}

          {showTags && (
            <section className="refreshed-inset-surface mt-[5px] rounded-lg border border-gray-700 p-3">
              <h2 className="media-inset-heading mb-2">
                {intl.formatMessage(messages.subjectTags)}
              </h2>
              {tags.length === 0 ? (
                <p className="refreshed-detail-text-muted text-xs">
                  {intl.formatMessage(messages.noTags)}
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag, index) => (
                    <Link
                      key={tag.name}
                      href={`/discover/music?genre=${encodeURIComponent(tag.name)}`}
                      className={`compact-control inline-flex items-center rounded-full border px-2 text-[11px] font-medium transition focus:ring-2 focus:ring-indigo-400 focus:outline-none ${
                        subjectTagTones[index % subjectTagTones.length]
                      }`}
                    >
                      {tag.name}
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="refreshed-inset-surface mt-[5px] rounded-lg border border-gray-700 p-3">
            <h2 className="media-inset-heading mb-3">
              {intl.formatMessage(messages.albumDetails)}
            </h2>
            <div className="card:grid-cols-3 grid grid-cols-1">
              <dl className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-1 text-xs leading-4">
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.status)}:
                </dt>
                <dd className="m-0">
                  <AvailabilityValue status={data.mediaInfo?.status}>
                    {getAvailabilityText(data.mediaInfo?.status, unavailable)}
                  </AvailabilityValue>
                </dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.releaseDate)}:
                </dt>
                <dd className="m-0 truncate">{formattedReleaseDate}</dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.musicBrainz)}:
                </dt>
                <dd className="m-0 truncate">
                  <a
                    href={`https://musicbrainz.org/release-group/${albumId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-300 hover:text-indigo-200 hover:underline focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                  >
                    {data.mbId}
                  </a>
                </dd>
              </dl>

              <dl className="media-detail-column-divider card:pr-3 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-1 text-xs leading-4">
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.albumType)}:
                </dt>
                <dd className="m-0 truncate">{data.type || unavailable}</dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.runtime)}:
                </dt>
                <dd className="m-0 truncate">
                  {runtimeMinutes > 0
                    ? intl.formatMessage(messages.minutes, {
                        minutes: runtimeMinutes,
                      })
                    : unavailable}
                </dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.trackCount)}:
                </dt>
                <dd className="m-0 truncate">
                  {intl.formatNumber(data.tracks.length)}
                </dd>
              </dl>

              <dl className="media-detail-column-divider grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-1 text-xs leading-4">
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.artist)}:
                </dt>
                <dd className="m-0 truncate">
                  <Link
                    href={`/artist/${artistId}`}
                    className="text-indigo-300 hover:text-indigo-200 hover:underline focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                  >
                    {data.artist.name || unavailable}
                  </Link>
                </dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.artistType)}:
                </dt>
                <dd className="m-0 truncate">
                  {data.artist.type || unavailable}
                </dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.origin)}:
                </dt>
                <dd className="m-0 truncate">
                  {data.artist.area ? (
                    <a
                      href={`https://musicbrainz.org/search?query=${encodeURIComponent(
                        data.artist.area
                      )}&type=area&method=indexed`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-300 hover:text-indigo-200 hover:underline focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                    >
                      {data.artist.area}
                    </a>
                  ) : (
                    unavailable
                  )}
                </dd>
              </dl>
            </div>
          </section>
          {additionalContent}
        </div>
      </article>

      <MediaSlider
        sliderKey="similar-artists"
        title={intl.formatMessage(messages.similarArtists)}
        url={`/api/v1/music/${albumId}/artist-similar`}
        hideWhenEmpty
      />
      <div className="extra-bottom-space relative" />
    </div>
  );
};

export default MusicDetailsLayout;
