import BlocklistModal from '@app/components/BlocklistModal';
import CollectionAssociationsButton from '@app/components/CollectionDetails/CollectionAssociationsButton';
import CollectionMetadataDisclosures from '@app/components/CollectionDetails/CollectionMetadataDisclosures';
import CollectionPlayOnDeviceButton from '@app/components/CollectionDetails/CollectionPlayOnDeviceButton';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import FormatRequestControl from '@app/components/Common/FormatRequestControl';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import MediaServerPlayButton from '@app/components/Common/MediaServerPlayButton';
import PageTitle from '@app/components/Common/PageTitle';
import SelectionCircle from '@app/components/Common/SelectionCircle';
import Tooltip from '@app/components/Common/Tooltip';
import AvailabilityValue from '@app/components/MediaDetails/AvailabilityValue';
import MediaDetailArtwork from '@app/components/MediaDetails/MediaDetailArtwork';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import { encodeApiPathSegment } from '@app/utils/apiPath';
import {
  orderCollectionPartsOldestFirst,
  reconcileCollectionPlaybackSelection,
} from '@app/utils/collectionPlaybackSelection';
import defineMessages from '@app/utils/defineMessages';
import {
  getTmdbPosterImageUrl,
  getTmdbPosterImageVariants,
} from '@app/utils/imageCache';
import { resolveCanonicalPlaybackSelection } from '@app/utils/playbackSelection';
import { refreshIntervalHelper } from '@app/utils/refreshIntervalHelper';
import { getSafeHref } from '@app/utils/safeUrl';
import { EyeSlashIcon } from '@heroicons/react/24/outline';
import type { RatingResponse } from '@server/api/ratings';
import { MediaStatus } from '@server/constants/media';
import type { Collection } from '@server/models/Collection';
import type { MovieResult } from '@server/models/Search';
import axios from 'axios';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useInView } from 'react-intersection-observer';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const RequestModal = dynamic(() => import('@app/components/RequestModal'), {
  ssr: false,
});

const messages = defineMessages('components.CollectionDetails', {
  overview: 'Overview',
  overviewUnavailable: 'Overview unavailable',
  collectionSize: 'Collection Size',
  genres: 'Genres',
  collection: 'Collection',
  availability: 'Availability',
  available: 'Available',
  notAvailable: 'Not Available',
  releaseDate: 'Release Date',
  userScore: 'TMDB User Score',
  tmdb: 'TMDB',
  rtCritics: 'RT Critics',
  rtAudience: 'RT Audience',
  imdb: 'IMDb',
  requestUnavailable:
    'Every movie in this collection is already available or requested.',
  request4kUnavailable:
    'Every 4K movie in this collection is already available or requested.',
  selection: 'Select this available movie for playback',
});

interface CollectionDetailsProps {
  collection?: Collection;
}

const requestableStatuses = new Set([MediaStatus.UNKNOWN, MediaStatus.DELETED]);
const availableStatuses = new Set([
  MediaStatus.AVAILABLE,
  MediaStatus.PARTIALLY_AVAILABLE,
]);

const CollectionPartRatings = ({ part }: { part: MovieResult }) => {
  const intl = useIntl();
  const { ref, inView } = useInView({
    rootMargin: '160px 0px',
    triggerOnce: true,
  });
  const { data: ratings } = useSWR<RatingResponse>(
    inView ? `/api/v1/movie/${part.id}/ratingscombined` : null
  );
  const ratingRows = [
    {
      id: 'tmdb',
      label: intl.formatMessage(messages.tmdb),
      value: part.voteAverage ? part.voteAverage.toFixed(1) : '—',
      href: `https://www.themoviedb.org/movie/${part.id}`,
    },
    {
      id: 'rt-critics',
      label: intl.formatMessage(messages.rtCritics),
      value:
        typeof ratings?.rt?.criticsScore === 'number'
          ? `${ratings.rt.criticsScore}%`
          : '—',
      href: ratings?.rt?.url,
    },
    {
      id: 'rt-audience',
      label: intl.formatMessage(messages.rtAudience),
      value:
        typeof ratings?.rt?.audienceScore === 'number'
          ? `${ratings.rt.audienceScore}%`
          : '—',
      href: ratings?.rt?.url,
    },
    {
      id: 'imdb',
      label: intl.formatMessage(messages.imdb),
      value:
        typeof ratings?.imdb?.criticsScore === 'number'
          ? ratings.imdb.criticsScore.toFixed(1)
          : '—',
      href: ratings?.imdb?.url,
    },
  ];

  return (
    <dl
      ref={ref}
      className="media-detail-column-divider grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 text-[11px] leading-4"
    >
      {ratingRows.map((rating) => {
        const safeHref = rating.href ? getSafeHref(rating.href) : undefined;

        return (
          <div className="contents" key={rating.id}>
            <dt className="font-medium text-gray-100">{rating.label}:</dt>
            <dd className="m-0 truncate">
              {safeHref && rating.value !== '—' ? (
                <a
                  href={safeHref}
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-300 hover:text-indigo-200"
                >
                  {rating.value}
                </a>
              ) : (
                rating.value
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
};

const CollectionDetails = ({ collection }: CollectionDetailsProps) => {
  const intl = useIntl();
  const router = useRouter();
  const settings = useSettings();
  const { hasPermission } = useUser();
  const { addToast } = useToasts();
  const [requestModal, setRequestModal] = useState(false);
  const [is4k, setIs4k] = useState(false);
  const [showBlocklistModal, setShowBlocklistModal] = useState(false);
  const [isBlocklistUpdating, setIsBlocklistUpdating] = useState(false);
  const [selectedMediaIds, setSelectedMediaIds] = useState<number[]>([]);
  const [hasManualPlaybackSelection, setHasManualPlaybackSelection] =
    useState(false);
  const collectionId =
    typeof router.query.collectionId === 'string'
      ? router.query.collectionId
      : (collection?.id?.toString() ?? '');

  const getDownloadItems = (value?: Collection) => ({
    downloadStatus: value?.parts.flatMap(
      (part) => part.mediaInfo?.downloadStatus ?? []
    ),
    downloadStatus4k: value?.parts.flatMap(
      (part) => part.mediaInfo?.downloadStatus4k ?? []
    ),
  });
  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<Collection>(
    collectionId
      ? `/api/v1/collection/${encodeApiPathSegment(collectionId)}`
      : null,
    {
      fallbackData: collection,
      revalidateOnMount: true,
      refreshInterval: refreshIntervalHelper(
        getDownloadItems(collection),
        15_000
      ),
    }
  );
  const { data: genres } = useSWR<{ id: number; name: string }[]>(
    '/api/v1/genres/movie'
  );

  const orderedParts = useMemo(
    () => orderCollectionPartsOldestFirst(data?.parts ?? []),
    [data?.parts]
  );
  const availableParts = useMemo(
    () =>
      orderedParts.filter(
        (part) =>
          !!part.mediaInfo?.id &&
          (availableStatuses.has(part.mediaInfo.status) ||
            availableStatuses.has(part.mediaInfo.status4k))
      ),
    [orderedParts]
  );
  const availableMediaIds = useMemo(
    () => availableParts.map((part) => part.mediaInfo!.id),
    [availableParts]
  );
  const effectivePlaybackMediaIds = resolveCanonicalPlaybackSelection(
    availableMediaIds,
    selectedMediaIds
  );
  useEffect(() => {
    setSelectedMediaIds((current) =>
      reconcileCollectionPlaybackSelection(
        current,
        availableMediaIds,
        hasManualPlaybackSelection
      )
    );
  }, [availableMediaIds, hasManualPlaybackSelection]);

  if (!data && !error) return <LoadingSpinner />;
  if (!data) return <ErrorPage statusCode={404} />;

  const blocklistedParts = data.parts.filter(
    (part) => part.mediaInfo?.status === MediaStatus.BLOCKLISTED
  );
  const isCollectionBlocklisted = blocklistedParts.length > 0;
  const canUseBlocklist = hasPermission(Permission.MANAGE_BLOCKLIST);
  const canRequest = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_MOVIE],
    { type: 'or' }
  );
  const canRequest4k =
    settings.currentSettings.movie4kEnabled &&
    hasPermission([Permission.REQUEST_4K, Permission.REQUEST_4K_MOVIE], {
      type: 'or',
    });
  const hasRequestable = data.parts.some((part) =>
    requestableStatuses.has(part.mediaInfo?.status ?? MediaStatus.UNKNOWN)
  );
  const hasRequestable4k = data.parts.some((part) =>
    requestableStatuses.has(part.mediaInfo?.status4k ?? MediaStatus.UNKNOWN)
  );
  const genreIds = [
    ...new Set(data.parts.flatMap((part) => part.genreIds ?? [])),
  ];
  const weightedVotes = data.parts.reduce(
    (sum, part) => sum + part.voteAverage * part.voteCount,
    0
  );
  const voteCount = data.parts.reduce((sum, part) => sum + part.voteCount, 0);
  const collectionScore =
    voteCount > 0 ? (weightedVotes / voteCount).toFixed(1) : undefined;
  const openRequest = (request4k: boolean) => {
    setIs4k(request4k);
    setRequestModal(true);
  };
  const togglePart = (mediaId: number) => {
    setHasManualPlaybackSelection(true);
    setSelectedMediaIds((current) =>
      current.includes(mediaId)
        ? current.filter((id) => id !== mediaId)
        : [...current, mediaId]
    );
  };
  const onBlocklist = async () => {
    setIsBlocklistUpdating(true);
    try {
      await axios.post(
        `/api/v1/blocklist/collection/${encodeApiPathSegment(data.id)}`
      );
      addToast(
        <span>
          {intl.formatMessage(globalMessages.blocklistSuccess, {
            title: data.name,
            strong: (value: ReactNode) => <strong>{value}</strong>,
          })}
        </span>,
        { appearance: 'success', autoDismiss: true }
      );
      await revalidate();
    } catch {
      addToast(intl.formatMessage(globalMessages.blocklistError), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsBlocklistUpdating(false);
      setShowBlocklistModal(false);
    }
  };

  const requestOptions = [
    ...(canRequest
      ? [
          {
            id: 'hd',
            label: 'HD',
            onClick: () => openRequest(false),
            disabled: !hasRequestable,
            disabledReason: intl.formatMessage(messages.requestUnavailable),
          },
        ]
      : []),
    ...(canRequest4k
      ? [
          {
            id: '4k',
            label: '4K',
            onClick: () => openRequest(true),
            disabled: !hasRequestable4k,
            disabledReason: intl.formatMessage(messages.request4kUnavailable),
          },
        ]
      : []),
  ];

  return (
    <div className="media-page">
      <PageTitle title={data.name} />
      {requestModal && (
        <RequestModal
          tmdbId={data.id}
          show
          type="collection"
          is4k={is4k}
          onComplete={() => {
            void revalidate();
            setRequestModal(false);
          }}
          onCancel={() => setRequestModal(false)}
        />
      )}
      {showBlocklistModal && (
        <BlocklistModal
          tmdbId={data.id}
          type="collection"
          show
          onCancel={() => setShowBlocklistModal(false)}
          onComplete={onBlocklist}
          isUpdating={isBlocklistUpdating}
        />
      )}

      <article className="media-detail-card refreshed-card-surface refreshed-detail-text relative overflow-hidden rounded-xl border border-gray-700 p-3 shadow-lg shadow-gray-950/20">
        {data.backdropPath && (
          <MediaDetailArtwork
            type="tmdb"
            src={`https://image.tmdb.org/t/p/original${data.backdropPath}`}
          />
        )}

        <div className="relative z-10">
          <div className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)] gap-3 sm:grid-cols-[80px_minmax(0,1fr)]">
            <div className="relative h-24 w-16 overflow-hidden rounded-lg ring-1 ring-gray-600 sm:h-[120px] sm:w-20">
              <CachedImage
                type="tmdb"
                src={
                  data.posterPath
                    ? getTmdbPosterImageUrl(data.posterPath)
                    : '/images/seerr_poster_not_found.png'
                }
                variants={getTmdbPosterImageVariants(data.posterPath)}
                alt=""
                fill
                priority
                sizes="(min-width: 640px) 80px, 64px"
                className="object-cover"
              />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg leading-5 font-semibold text-white">
                {data.name}
              </h1>
              <dl className="card:grid-cols-[max-content_minmax(0,1fr)_1px_max-content_minmax(0,1fr)] mt-4 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs leading-4">
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.collectionSize)}:
                </dt>
                <dd className="m-0">{data.parts.length}</dd>
                <div className="card:col-start-3 card:row-span-4 card:row-start-1 card:block hidden bg-gray-600" />
                <dt className="card:col-start-1 card:row-start-4 font-medium text-gray-100">
                  {intl.formatMessage(messages.genres)}:
                </dt>
                <dd className="card:col-start-2 card:row-start-4 m-0 min-w-0 break-words">
                  {genreIds.length > 0
                    ? genreIds.map((genreId, index) => (
                        <span key={genreId}>
                          {index > 0 && ', '}
                          <Link
                            href={`/discover/movies?genre=${genreId}`}
                            className="text-indigo-300 hover:text-indigo-200 hover:underline"
                          >
                            {genres?.find((genre) => genre.id === genreId)
                              ?.name ?? genreId}
                          </Link>
                        </span>
                      ))
                    : intl.formatMessage(messages.notAvailable)}
                </dd>
              </dl>
            </div>
          </div>

          <div className="media-rating-row">
            <MediaServerPlayButton
              collectionMediaIds={effectivePlaybackMediaIds}
              disabled={availableMediaIds.length === 0}
            />
            <CollectionPlayOnDeviceButton
              mediaIds={effectivePlaybackMediaIds}
            />
            {collectionScore && (
              <Link
                href={`https://www.themoviedb.org/collection/${data.id}`}
                target="_blank"
                rel="noreferrer"
                className="media-rating-link"
                aria-label={intl.formatMessage(messages.userScore)}
              >
                <span className="inline-flex h-6 items-center rounded bg-[#01b4e4] px-1.5 text-xs font-black text-[#0d253f]">
                  TMDB
                </span>
                <span className="media-rating-value">{collectionScore}</span>
              </Link>
            )}
          </div>

          <div className="media-primary-action-row">
            {canUseBlocklist && (
              <Tooltip
                content={intl.formatMessage(
                  isCollectionBlocklisted
                    ? globalMessages.alreadyBlocklisted
                    : globalMessages.addToBlocklist
                )}
              >
                <Button
                  buttonType="blocklist"
                  buttonSize="standard"
                  disabled={isCollectionBlocklisted}
                  disabledReason={intl.formatMessage(
                    globalMessages.alreadyBlocklisted
                  )}
                  onClick={() => setShowBlocklistModal(true)}
                  aria-label={intl.formatMessage(globalMessages.addToBlocklist)}
                >
                  <EyeSlashIcon className="!mr-0" />
                </Button>
              </Tooltip>
            )}
            <CollectionAssociationsButton parts={data.parts} />
            <FormatRequestControl options={requestOptions} />
          </div>

          <section className="refreshed-inset-surface mt-[5px] rounded-lg border border-gray-700 p-3">
            <h2 className="media-inset-heading">
              {intl.formatMessage(messages.overview)}
            </h2>
            <p className="refreshed-detail-text-muted mt-4 text-sm leading-5">
              {data.overview ||
                intl.formatMessage(messages.overviewUnavailable)}
            </p>
          </section>

          <CollectionMetadataDisclosures parts={data.parts} />

          <section className="refreshed-inset-surface mt-[5px] rounded-lg border border-gray-700 p-3">
            <h2 className="media-inset-heading">
              {intl.formatMessage(messages.collection)}
            </h2>
            <div className="scrollable-card mt-2 -mr-3 max-h-[312px] space-y-2 overflow-y-auto pr-3">
              {orderedParts.map((part) => {
                const mediaId = part.mediaInfo?.id;
                const available =
                  !!mediaId &&
                  (availableStatuses.has(
                    part.mediaInfo?.status ?? MediaStatus.UNKNOWN
                  ) ||
                    availableStatuses.has(
                      part.mediaInfo?.status4k ?? MediaStatus.UNKNOWN
                    ));
                const selected =
                  !!mediaId && selectedMediaIds.includes(mediaId);
                const partGenres = part.genreIds
                  .map((id) => ({
                    id,
                    name: genres?.find((genre) => genre.id === id)?.name,
                  }))
                  .filter(
                    (genre): genre is { id: number; name: string } =>
                      !!genre.name
                  )
                  .slice(0, 4);
                return (
                  <article
                    key={part.id}
                    className="refreshed-card-surface grid min-h-[96px] grid-cols-[56px_minmax(0,1fr)] gap-3 rounded-lg border border-gray-700 p-2"
                  >
                    <Link
                      href={`/${part.mediaType}/${part.id}`}
                      className="relative h-20 w-14 overflow-hidden rounded ring-1 ring-gray-600 transition hover:ring-indigo-400 focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                    >
                      <CachedImage
                        type="tmdb"
                        src={
                          part.posterPath
                            ? getTmdbPosterImageUrl(part.posterPath)
                            : '/images/seerr_poster_not_found.png'
                        }
                        variants={getTmdbPosterImageVariants(part.posterPath)}
                        alt={part.title}
                        fill
                        sizes="56px"
                        className="object-cover"
                      />
                    </Link>
                    <div className="min-w-0 text-[11px] leading-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <SelectionCircle
                          disabled={!available}
                          onClick={() => mediaId && togglePart(mediaId)}
                          selected={selected}
                          label={intl.formatMessage(messages.selection)}
                        />
                        <Link
                          href={`/${part.mediaType}/${part.id}`}
                          className="truncate text-sm font-semibold text-white hover:text-indigo-200"
                        >
                          {part.title}
                        </Link>
                      </div>
                      <div className="card:grid-cols-3 mt-1 grid min-w-0 grid-cols-1 items-stretch">
                        <div className="card:col-span-2 card:pr-3 min-w-0">
                          <dl className="card:grid-cols-[max-content_0.75rem_6rem_0.75rem_minmax(0,1fr)] card:gap-x-0 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5">
                            <dt className="card:col-start-1 card:row-start-1 font-medium text-gray-100">
                              {intl.formatMessage(messages.availability)}:
                            </dt>
                            <dd className="card:col-start-3 card:row-start-1 m-0">
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
                            <dt className="card:col-start-1 card:row-start-2 font-medium text-gray-100">
                              {intl.formatMessage(messages.releaseDate)}:
                            </dt>
                            <dd className="card:col-start-3 card:row-start-2 m-0 truncate">
                              {part.releaseDate || '—'}
                            </dd>
                            <div className="media-detail-column-divider card:col-start-5 card:row-span-2 card:row-start-1 col-span-2 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3">
                              <dt className="font-medium text-gray-100">
                                {intl.formatMessage(messages.genres)}:
                              </dt>
                              <dd className="m-0 line-clamp-2 min-w-0">
                                {partGenres.length > 0
                                  ? partGenres.map((genre, index) => (
                                      <span key={genre.id}>
                                        {index > 0 && ', '}
                                        <Link
                                          href={`/discover/movies?genre=${genre.id}`}
                                          className="text-indigo-300 hover:text-indigo-200"
                                        >
                                          {genre.name}
                                        </Link>
                                      </span>
                                    ))
                                  : '—'}
                              </dd>
                            </div>
                          </dl>
                        </div>
                        <CollectionPartRatings part={part} />
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </article>
      <div className="extra-bottom-space relative" />
    </div>
  );
};

export default CollectionDetails;
