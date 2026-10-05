import Spinner from '@app/assets/spinner.svg';
import AssociationBadge from '@app/components/Association/AssociationBadge';
import BlocklistConfirmationModal from '@app/components/BlocklistConfirmationModal';
import BookFormatBadge, {
  getBookFormatMessage,
} from '@app/components/Common/BookFormatBadge';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import MediaTypeBadge from '@app/components/Common/MediaTypeBadge';
import StatusBadgeMini from '@app/components/Common/StatusBadgeMini';
import Tooltip from '@app/components/Common/Tooltip';
import WatchedBadge from '@app/components/Common/WatchedBadge';
import ErrorCard from '@app/components/TitleCard/ErrorCard';
import Placeholder from '@app/components/TitleCard/Placeholder';
import PosterRatingPopover from '@app/components/TitleCard/PosterRatingPopover';
import { getTitleCardBookDetailQuery } from '@app/components/TitleCard/bookDetailQuery';
import {
  getTitleCardStatusBadges,
  getTitleCardStatusBadgeSlots,
} from '@app/components/TitleCard/statusBadges';
import useAlbumArtwork from '@app/hooks/useAlbumArtwork';
import { useIsTouch } from '@app/hooks/useIsTouch';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import { Permission, UserType, useUser } from '@app/hooks/useUser';
import useWatchStatus from '@app/hooks/useWatchStatus';
import globalMessages from '@app/i18n/globalMessages';
import {
  encodeApiPathSegment,
  normalizeExternalTitleId,
} from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
import {
  getTmdbPosterImageUrl,
  isResolvedImageUrl,
} from '@app/utils/imageCache';
import { withProperties } from '@app/utils/typeHelpers';
import { Transition } from '@headlessui/react';
import {
  ArrowDownTrayIcon,
  EyeIcon,
  EyeSlashIcon,
  MinusCircleIcon,
  StarIcon,
} from '@heroicons/react/24/outline';
import { StarIcon as SolidStarIcon } from '@heroicons/react/24/solid';
import { MediaStatus } from '@server/constants/media';
import type { Watchlist } from '@server/entity/Watchlist';
import type { AlbumResult, MediaType } from '@server/models/Search';
import axios from 'axios';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const RequestModal = dynamic(() => import('@app/components/RequestModal'), {
  ssr: false,
});
interface TitleCardProps {
  id: number | string;
  image?: string;
  fallbackImage?: string;
  enablePosterFallbackLookup?: boolean;
  summary?: string;
  year?: string;
  title: string;
  titleWeight?: 'regular';
  /** Development visual prototype only; never uses persisted membership. */
  watchlistPreview?: boolean;
  watchlistPreviewDisabled?: boolean;
  artist?: string;
  type?: string;
  userScore?: number;
  voteCount?: number;
  bookRatingAverage?: number;
  bookRatingCount?: number;
  mediaType: Exclude<MediaType, 'author'>;
  status?: MediaStatus;
  status4k?: MediaStatus;
  canExpand?: boolean;
  requestable?: boolean;
  providerTracked?: boolean;
  inProgress?: boolean;
  inProgress4k?: boolean;
  canRequestAdditionalFormat?: boolean;
  isAddedToWatchlist?: number | boolean;
  needsCoverArt?: boolean;
  mutateParent?: () => void;
  showText?: boolean;
  hideAssociationWhenEmpty?: boolean;
  priority?: boolean;
  preferredBookFormat?: 'ebook' | 'audiobook';
  showAllBookFormats?: boolean;
  availableQualities?: ('MP3' | 'FLAC')[];
  qualityStatuses?: AlbumResult['qualityStatuses'];
}

const messages = defineMessages('components.TitleCard', {
  addToWatchList: 'Add to watchlist',
  watchlistPreviewLabel: 'Watchlist',
  watchlistPreviewAdd: 'Add {title} to your Watchlist.',
  watchlistPreviewRemove: 'Remove {title} from your Watchlist.',
  watchlistPreviewDisabled:
    'Watchlist is disabled. Use Enable Watchlist above the posters to enable it.',
  blocklistAddDescription:
    'Add {title} to the Blocklist. Users without Blocklist management permission will not see it in browsing.',
  blocklistRemoveDescription:
    'Remove {title} from the Blocklist and restore normal browsing visibility.',
  blocklistUpdatingDescription: 'The Blocklist is updating. Please wait.',
  watchlistSuccess:
    '<strong>{title}</strong> added to watchlist  successfully!',
  watchlistDeleted:
    '<strong>{title}</strong> Removed from watchlist  successfully!',
  watchlistCancel: 'watchlist for <strong>{title}</strong> canceled.',
  watchlistError: 'Something went wrong. Please try again.',
  requestBookFormat: 'Request {format}',
  magazineTracked: 'Tracked',
  magazineTrackedReason: 'This title is already tracked by LazyLibrarian.',
  magazineRequestedReason: 'This magazine already has an active request.',
  magazineAvailableReason: 'This magazine is already available.',
  magazinePartiallyAvailableReason:
    'Some issues of this magazine are already available.',
});

const TitleCard = ({
  id,
  image,
  fallbackImage,
  enablePosterFallbackLookup = false,
  summary,
  year,
  title,
  titleWeight = 'regular',
  watchlistPreview = false,
  watchlistPreviewDisabled = false,
  artist,
  userScore,
  voteCount,
  bookRatingAverage,
  bookRatingCount,
  status,
  status4k,
  mediaType,
  isAddedToWatchlist = false,
  inProgress = false,
  inProgress4k = false,
  canRequestAdditionalFormat = false,
  requestable = true,
  providerTracked = false,
  mutateParent,
  showText = false,
  hideAssociationWhenEmpty = false,
  priority = false,
  preferredBookFormat,
  showAllBookFormats = false,
  availableQualities,
  qualityStatuses,
}: TitleCardProps) => {
  const isTouch = useIsTouch();
  const router = useRouter();
  const intl = useIntl();
  const settings = useSettings();
  const { user, hasPermission } = useUser();
  const canManageBlocklist = hasPermission(Permission.MANAGE_BLOCKLIST);
  const [isUpdating, setIsUpdating] = useState(false);
  const [posterFallbackLookupKey, setPosterFallbackLookupKey] =
    useState<string>();
  const [currentStatus, setCurrentStatus] = useState(status);
  const [currentStatus4k, setCurrentStatus4k] = useState(status4k);
  const [showDetail, setShowDetail] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [showBlocklistModal, setShowBlocklistModal] = useState(false);
  const { addToast } = useToasts();
  const [toggleWatchlist, setToggleWatchlist] =
    useState<boolean>(!isAddedToWatchlist);
  const [previewWatchlisted, setPreviewWatchlisted] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const watchlistMutationActive = useRef(false);
  const addWatchlistDescription = intl.formatMessage(
    messages.watchlistPreviewAdd,
    { title }
  );
  const removeWatchlistDescription = intl.formatMessage(
    messages.watchlistPreviewRemove,
    { title }
  );
  const statusBadges = getTitleCardStatusBadges({
    mediaType,
    status: currentStatus,
    status4k: currentStatus4k,
    inProgress,
    inProgress4k,
    availableQualities,
    qualityStatuses,
  });
  const { primary: primaryStatusBadge, secondary: secondaryStatusBadge } =
    getTitleCardStatusBadgeSlots(statusBadges);

  // Just to get the year from the date
  if (year) {
    year = year.slice(0, 4);
  }

  useEffect(() => {
    setCurrentStatus(status);
  }, [status]);

  useEffect(() => {
    setCurrentStatus4k(status4k);
  }, [status4k]);

  const requestComplete = useCallback(
    (newStatus: MediaStatus, is4k = false) => {
      if (is4k) {
        setCurrentStatus4k(newStatus);
      } else {
        setCurrentStatus(newStatus);
      }
      mutateParent?.();
      setIsUpdating(false);
      setShowRequestModal(false);
    },
    [mutateParent]
  );

  const requestUpdating = useCallback(
    (status: boolean) => setIsUpdating(status),
    []
  );

  const showDetails = useCallback(() => {
    setShowDetail((currentShowDetail) =>
      currentShowDetail ? currentShowDetail : true
    );
  }, []);
  const hideDetails = useCallback(() => {
    setShowDetail((currentShowDetail) =>
      currentShowDetail ? false : currentShowDetail
    );
  }, []);

  const onClickWatchlistBtn = async (): Promise<void> => {
    if (watchlistMutationActive.current) {
      return;
    }

    watchlistMutationActive.current = true;
    setIsUpdating(true);
    const actionId = normalizeExternalTitleId(mediaType, id);
    try {
      const response = await axios.post<Watchlist>(
        '/api/v1/watchlist',
        mediaType === 'album'
          ? {
              mbId: actionId,
              mediaType: 'music',
              title,
            }
          : mediaType === 'book' ||
              mediaType === 'comic' ||
              mediaType === 'magazine'
            ? {
                externalId: actionId,
                mediaType,
                title,
              }
            : {
                tmdbId: id,
                mediaType,
                title,
              }
      );
      if (!Number.isInteger(response.data?.id) || response.data.id <= 0) {
        addToast(intl.formatMessage(messages.watchlistError), {
          appearance: 'error',
          autoDismiss: true,
        });
        return;
      }

      mutate('/api/v1/discover/watchlist');
      addToast(
        <span>
          {intl.formatMessage(messages.watchlistSuccess, {
            title,
            strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
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
      watchlistMutationActive.current = false;
      setIsUpdating(false);
    }
  };

  const onClickDeleteWatchlistBtn = async (): Promise<void> => {
    if (watchlistMutationActive.current) {
      return;
    }

    watchlistMutationActive.current = true;
    setIsUpdating(true);
    const actionId = normalizeExternalTitleId(mediaType, id);
    try {
      const response = await axios.delete<Watchlist>(
        `/api/v1/watchlist/${encodeApiPathSegment(actionId)}?mediaType=${
          mediaType === 'album' ? 'music' : mediaType
        }`
      );

      if (response.status !== 204) {
        addToast(intl.formatMessage(messages.watchlistError), {
          appearance: 'error',
          autoDismiss: true,
        });
        return;
      }

      addToast(
        <span>
          {intl.formatMessage(messages.watchlistDeleted, {
            title,
            strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
          })}
        </span>,
        { appearance: 'info', autoDismiss: true }
      );
      mutate('/api/v1/discover/watchlist');
      mutateParent?.();
      setToggleWatchlist(true);
    } catch {
      addToast(intl.formatMessage(messages.watchlistError), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      watchlistMutationActive.current = false;
      setIsUpdating(false);
    }
  };

  const onClickHideItemBtn = async (): Promise<void> => {
    setIsUpdating(true);
    const topNode = cardRef.current;
    const actionId = normalizeExternalTitleId(mediaType, id);

    if (topNode) {
      try {
        if (mediaType === 'collection') {
          await axios.post(
            `/api/v1/blocklist/collection/${encodeApiPathSegment(id)}`
          );
        } else if (isAlbum || isBook || isComic || isMagazine) {
          await axios.post('/api/v1/blocklist', {
            externalId: actionId,
            externalProvider: isAlbum
              ? 'musicbrainz'
              : isBook
                ? 'openlibrary'
                : isComic
                  ? 'comicvine'
                  : 'lazylibrarian',
            mediaType: isAlbum ? 'music' : mediaType,
            title,
            user: user?.id,
          });
        } else {
          await axios.post('/api/v1/blocklist', {
            tmdbId: id,
            mediaType,
            title,
            user: user?.id,
          });
        }
        addToast(
          <span>
            {intl.formatMessage(globalMessages.blocklistSuccess, {
              title,
              strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
            })}
          </span>,
          { appearance: 'success', autoDismiss: true }
        );
        setCurrentStatus(MediaStatus.BLOCKLISTED);
        setCurrentStatus4k(MediaStatus.BLOCKLISTED);
        if (mutateParent) {
          mutateParent();
        }
      } catch (e) {
        if (e?.response?.status === 412) {
          addToast(
            <span>
              {intl.formatMessage(globalMessages.blocklistDuplicateError, {
                title,
                strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
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
      }

      setIsUpdating(false);
      setShowBlocklistModal(false);
    } else {
      addToast(intl.formatMessage(globalMessages.blocklistError), {
        appearance: 'error',
        autoDismiss: true,
      });
      setIsUpdating(false);
      setShowBlocklistModal(false);
    }
  };

  const onClickShowBlocklistBtn = async (): Promise<void> => {
    setIsUpdating(true);
    const topNode = cardRef.current;
    const actionId = normalizeExternalTitleId(mediaType, id);

    if (topNode) {
      try {
        if (mediaType === 'collection') {
          const res = await axios.delete(
            `/api/v1/blocklist/collection/${encodeApiPathSegment(id)}`
          );

          if (res.status === 204) {
            addToast(
              <span>
                {intl.formatMessage(globalMessages.removeFromBlocklistSuccess, {
                  title,
                  strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
                })}
              </span>,
              { appearance: 'success', autoDismiss: true }
            );
            setCurrentStatus(MediaStatus.UNKNOWN);
            setCurrentStatus4k(MediaStatus.UNKNOWN);
            if (mutateParent) {
              mutateParent();
            }
          } else {
            addToast(intl.formatMessage(globalMessages.blocklistError), {
              appearance: 'error',
              autoDismiss: true,
            });
          }
        } else {
          const res = await axios.delete(
            `/api/v1/blocklist/${encodeApiPathSegment(actionId)}?mediaType=${
              isAlbum ? 'music' : mediaType
            }`
          );

          if (res.status === 204) {
            addToast(
              <span>
                {intl.formatMessage(globalMessages.removeFromBlocklistSuccess, {
                  title,
                  strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
                })}
              </span>,
              { appearance: 'success', autoDismiss: true }
            );
            setCurrentStatus(MediaStatus.UNKNOWN);
            setCurrentStatus4k(MediaStatus.UNKNOWN);
            if (mutateParent) {
              mutateParent();
            }
          } else {
            addToast(intl.formatMessage(globalMessages.blocklistError), {
              appearance: 'error',
              autoDismiss: true,
            });
          }
        }
      } catch {
        addToast(intl.formatMessage(globalMessages.blocklistError), {
          appearance: 'error',
          autoDismiss: true,
        });
      }
    } else {
      addToast(intl.formatMessage(globalMessages.blocklistError), {
        appearance: 'error',
        autoDismiss: true,
      });
    }

    setIsUpdating(false);
  };

  const closeModal = useCallback(() => {
    setIsUpdating(false);
    setShowRequestModal(false);
  }, []);

  const isAlbum = mediaType === 'album';
  const isArtist = mediaType === 'artist';
  const isBook = mediaType === 'book';
  const isComic = mediaType === 'comic';
  const isMagazine = mediaType === 'magazine';
  const canonicalId = normalizeExternalTitleId(mediaType, id);
  const artwork = useAlbumArtwork(
    isAlbum ? String(canonicalId) : undefined,
    image,
    cardRef
  );
  const videoMediaType =
    mediaType === 'movie' || mediaType === 'collection' || mediaType === 'tv';
  const numericId = typeof id === 'number' ? id : Number(id);
  const canShowWatchedStatus =
    (mediaType === 'movie' || mediaType === 'tv') &&
    (currentStatus === MediaStatus.AVAILABLE ||
      currentStatus === MediaStatus.PARTIALLY_AVAILABLE ||
      currentStatus4k === MediaStatus.AVAILABLE ||
      currentStatus4k === MediaStatus.PARTIALLY_AVAILABLE);
  const [watchStatusInView, setWatchStatusInView] = useState(false);
  useEffect(() => {
    if (!canShowWatchedStatus || watchStatusInView) return;
    const card = cardRef.current;
    if (!card || typeof IntersectionObserver === 'undefined') {
      setWatchStatusInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setWatchStatusInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(card);
    return () => observer.disconnect();
  }, [canShowWatchedStatus, watchStatusInView]);
  const { data: watchedStatus } = useWatchStatus(
    mediaType === 'tv' ? 'tv' : 'movie',
    Number.isSafeInteger(numericId) ? numericId : undefined,
    canShowWatchedStatus && watchStatusInView
  );
  const canUseVideoActions = videoMediaType && Number.isFinite(numericId);
  const posterFallbackIdentity = `${mediaType}:${id}:${image ?? ''}:${fallbackImage ?? ''}`;
  const posterFallbackRequestUrl =
    enablePosterFallbackLookup &&
    !fallbackImage &&
    posterFallbackLookupKey === posterFallbackIdentity &&
    Number.isSafeInteger(numericId) &&
    numericId > 0 &&
    (mediaType === 'movie' || mediaType === 'tv')
      ? `/api/v1/${mediaType}/${numericId}`
      : null;
  const { data: posterFallbackDetails } = useSWR<{
    supplementalMetadata?: { posterUrl?: string };
  }>(
    posterFallbackRequestUrl,
    (requestUrl: string) =>
      axios
        .get<{ supplementalMetadata?: { posterUrl?: string } }>(requestUrl)
        .then(({ data }) => data),
    {
      dedupingInterval: 60_000,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      shouldRetryOnError: false,
    }
  );
  const canUseRequestActions =
    canUseVideoActions || isAlbum || isBook || isComic || isMagazine;
  const canUseWatchlistActions =
    canUseVideoActions || isAlbum || isBook || isComic || isMagazine;
  const detailHref =
    mediaType === 'movie'
      ? `/movie/${id}`
      : mediaType === 'collection'
        ? `/collection/${id}`
        : mediaType === 'tv'
          ? `/tv/${id}`
          : mediaType === 'album'
            ? `/music/${encodeApiPathSegment(canonicalId)}`
            : mediaType === 'book'
              ? {
                  pathname: `/book/${encodeApiPathSegment(canonicalId)}`,
                  query: getTitleCardBookDetailQuery({
                    canonicalId,
                    preferredBookFormat,
                    title,
                  }),
                }
              : mediaType === 'comic'
                ? `/comic/${encodeApiPathSegment(canonicalId)}`
                : mediaType === 'magazine'
                  ? `/magazine/${encodeApiPathSegment(canonicalId)}`
                  : `/artist/${encodeApiPathSegment(canonicalId)}`;
  const displayImage = getTmdbPosterImageUrl(artwork);
  const supplementalPoster = getTmdbPosterImageUrl(
    fallbackImage ?? posterFallbackDetails?.supplementalMetadata?.posterUrl
  );
  const posterImage = displayImage ?? supplementalPoster;
  const posterPlaceholder = '/images/seerr_poster_not_found_logo_top.png';
  const posterErrorFallback =
    displayImage && supplementalPoster && displayImage !== supplementalPoster
      ? supplementalPoster
      : posterPlaceholder;
  // Resolved provider artwork is routed by URL when image caching is enabled.
  const imageCacheType =
    isResolvedImageUrl(posterImage) && isBook
      ? 'book'
      : isResolvedImageUrl(posterImage) && isAlbum
        ? 'music'
        : 'tmdb';
  const requestPosterFallback = useCallback(() => {
    if (
      !enablePosterFallbackLookup ||
      fallbackImage ||
      posterFallbackLookupKey === posterFallbackIdentity ||
      !Number.isSafeInteger(numericId) ||
      numericId <= 0 ||
      (mediaType !== 'movie' && mediaType !== 'tv')
    ) {
      return;
    }

    setPosterFallbackLookupKey(posterFallbackIdentity);
  }, [
    enablePosterFallbackLookup,
    fallbackImage,
    mediaType,
    numericId,
    posterFallbackIdentity,
    posterFallbackLookupKey,
  ]);
  useEffect(() => {
    if (
      !enablePosterFallbackLookup ||
      displayImage ||
      supplementalPoster ||
      posterFallbackLookupKey === posterFallbackIdentity
    ) {
      return;
    }
    const card = cardRef.current;
    if (!card) return;

    if (typeof IntersectionObserver === 'undefined') {
      requestPosterFallback();
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          observer.disconnect();
          requestPosterFallback();
        }
      },
      { rootMargin: '250px' }
    );
    observer.observe(card);
    return () => observer.disconnect();
  }, [
    displayImage,
    enablePosterFallbackLookup,
    posterFallbackIdentity,
    posterFallbackLookupKey,
    requestPosterFallback,
    supplementalPoster,
  ]);
  const handlePosterImageError = useCallback(() => {
    if (displayImage) {
      requestPosterFallback();
    }
  }, [displayImage, requestPosterFallback]);

  const requestPermissions = [
    Permission.REQUEST,
    mediaType === 'movie' || mediaType === 'collection'
      ? Permission.REQUEST_MOVIE
      : mediaType === 'tv'
        ? Permission.REQUEST_TV
        : isAlbum
          ? Permission.REQUEST_MUSIC
          : isComic
            ? Permission.REQUEST_COMIC
            : isMagazine
              ? Permission.REQUEST_MAGAZINE
              : Permission.REQUEST_BOOK,
  ];

  if (mediaType === 'movie') {
    requestPermissions.push(Permission.REQUEST_4K, Permission.REQUEST_4K_MOVIE);
  } else if (mediaType === 'tv') {
    requestPermissions.push(Permission.REQUEST_4K, Permission.REQUEST_4K_TV);
  }

  const showRequestButton =
    requestable &&
    canUseRequestActions &&
    hasPermission(requestPermissions, { type: 'or' }) &&
    !isArtist;

  const showHideButton =
    canManageBlocklist &&
    (canUseVideoActions || isAlbum || isBook || isComic || isMagazine);
  const canRequest4k =
    ((mediaType === 'movie' && settings.currentSettings.movie4kEnabled) ||
      (mediaType === 'tv' && settings.currentSettings.series4kEnabled)) &&
    hasPermission(
      [
        Permission.REQUEST_4K,
        mediaType === 'movie'
          ? Permission.REQUEST_4K_MOVIE
          : Permission.REQUEST_4K_TV,
      ],
      { type: 'or' }
    ) &&
    (!currentStatus4k ||
      currentStatus4k === MediaStatus.UNKNOWN ||
      currentStatus4k === MediaStatus.DELETED);
  const canShowRequestButton =
    showRequestButton &&
    (!currentStatus ||
      currentStatus === MediaStatus.UNKNOWN ||
      currentStatus === MediaStatus.DELETED ||
      canRequestAdditionalFormat ||
      canRequest4k);
  const requestingAdditional4k =
    canRequest4k &&
    !!currentStatus &&
    currentStatus !== MediaStatus.UNKNOWN &&
    currentStatus !== MediaStatus.DELETED;
  const showTextOverlay =
    showText || !posterImage || showDetail || showRequestModal;
  const showFullDetailOverlay = !posterImage || showDetail || showRequestModal;
  const requestLabel =
    isBook && preferredBookFormat
      ? intl.formatMessage(messages.requestBookFormat, {
          format: intl.formatMessage(getBookFormatMessage(preferredBookFormat)),
        })
      : intl.formatMessage(
          requestingAdditional4k
            ? globalMessages.request4k
            : globalMessages.request
        );
  const magazineRequestState = (() => {
    if (!isMagazine) return undefined;
    if (
      currentStatus === MediaStatus.PENDING ||
      currentStatus === MediaStatus.PROCESSING
    ) {
      return {
        label: intl.formatMessage(globalMessages.requested),
        reason: intl.formatMessage(messages.magazineRequestedReason),
      };
    }
    if (currentStatus === MediaStatus.AVAILABLE) {
      return {
        label: intl.formatMessage(globalMessages.available),
        reason: intl.formatMessage(messages.magazineAvailableReason),
      };
    }
    if (currentStatus === MediaStatus.PARTIALLY_AVAILABLE) {
      return {
        label: intl.formatMessage(globalMessages.partiallyavailable),
        reason: intl.formatMessage(messages.magazinePartiallyAvailableReason),
      };
    }
    if (providerTracked) {
      return {
        label: intl.formatMessage(messages.magazineTracked),
        reason: intl.formatMessage(messages.magazineTrackedReason),
      };
    }
    return undefined;
  })();
  if (currentStatus === MediaStatus.BLOCKLISTED && !canManageBlocklist) {
    return null;
  }

  const watchedControl = watchedStatus && watchedStatus.watchedCount > 0 && (
    <div data-poster-region="watched-slot">
      <WatchedBadge
        status={watchedStatus}
        incompleteLibrary={
          mediaType === 'tv' &&
          (currentStatus === MediaStatus.PARTIALLY_AVAILABLE ||
            (currentStatus !== MediaStatus.AVAILABLE &&
              currentStatus4k === MediaStatus.PARTIALLY_AVAILABLE))
        }
      />
    </div>
  );
  const isBlocklisted = currentStatus === MediaStatus.BLOCKLISTED;
  const associationControls = (
    <div data-poster-region="association-slot">
      {!isBlocklisted && (
        <AssociationBadge
          mediaType={mediaType}
          id={id}
          variant="card"
          hideWhenEmpty={hideAssociationWhenEmpty}
        />
      )}
    </div>
  );
  const blocklistControl = showHideButton && (
    <Tooltip
      content={intl.formatMessage(
        isUpdating
          ? messages.blocklistUpdatingDescription
          : isBlocklisted
            ? messages.blocklistRemoveDescription
            : messages.blocklistAddDescription,
        { title }
      )}
    >
      <div data-poster-region="blocklist-slot">
        <button
          type="button"
          className="poster-control poster-control-blocklist app-control-shadow-exempt"
          aria-label={intl.formatMessage(
            isBlocklisted
              ? globalMessages.removefromBlocklist
              : globalMessages.addToBlocklist
          )}
          aria-pressed={isBlocklisted}
          disabled={isUpdating}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (isUpdating) return;
            if (isBlocklisted) {
              void onClickShowBlocklistBtn();
            } else {
              setShowBlocklistModal(true);
            }
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {isBlocklisted ? (
            <EyeIcon aria-hidden="true" />
          ) : (
            <EyeSlashIcon aria-hidden="true" />
          )}
        </button>
      </div>
    </Tooltip>
  );

  return (
    <div
      className="poster-layout title-card-shell"
      data-media-type={mediaType}
      data-testid="title-card"
      ref={cardRef}
    >
      {showBlocklistModal && (
        <BlocklistConfirmationModal
          show={showBlocklistModal}
          onCancel={() => setShowBlocklistModal(false)}
          onComplete={() => void onClickHideItemBtn()}
          isUpdating={isUpdating}
        />
      )}
      {canUseVideoActions && showRequestModal && (
        <RequestModal
          tmdbId={numericId}
          show={showRequestModal}
          type={
            mediaType === 'movie'
              ? 'movie'
              : mediaType === 'collection'
                ? 'collection'
                : 'tv'
          }
          onComplete={requestComplete}
          onUpdating={requestUpdating}
          onCancel={closeModal}
          initialIs4k={requestingAdditional4k}
          show4kSelector={mediaType === 'movie' || mediaType === 'tv'}
        />
      )}
      {showRequestModal && (
        <>
          {isAlbum && typeof canonicalId === 'string' && (
            <RequestModal
              mbId={canonicalId}
              show={showRequestModal}
              type="music"
              onComplete={requestComplete}
              onUpdating={requestUpdating}
              onCancel={closeModal}
            />
          )}
          {isBook && typeof canonicalId === 'string' && (
            <RequestModal
              bookId={canonicalId}
              initialBookFormat={preferredBookFormat}
              show={showRequestModal}
              type="book"
              onComplete={requestComplete}
              onUpdating={requestUpdating}
              onCancel={closeModal}
            />
          )}
          {isComic && typeof canonicalId === 'string' && (
            <RequestModal
              comicId={canonicalId}
              show={showRequestModal}
              type="comic"
              onComplete={requestComplete}
              onUpdating={requestUpdating}
              onCancel={closeModal}
            />
          )}
          {isMagazine && typeof canonicalId === 'string' && (
            <RequestModal
              magazineTitle={canonicalId}
              show={showRequestModal}
              type="magazine"
              onComplete={requestComplete}
              onUpdating={requestUpdating}
              onCancel={closeModal}
            />
          )}
        </>
      )}
      <div
        className={`app-card-poster app-card-poster-interactive ${
          showDetail ? 'app-card-poster-active' : ''
        }`}
        data-poster-region="frame"
        onMouseEnter={() => {
          if (!isTouch) {
            showDetails();
          }
        }}
        onMouseLeave={hideDetails}
        onClick={(event) => {
          if (
            event.target instanceof Element &&
            (event.target.closest('[data-poster-region="watchlist-slot"]') ||
              event.target.closest('[data-poster-region="blocklist-slot"]'))
          )
            return;
          showDetails();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            showDetails();
          }
        }}
        role="link"
        tabIndex={0}
      >
        <div data-poster-region="content">
          <CachedImage
            type={imageCacheType}
            data-poster-region="image"
            alt=""
            src={posterImage ?? posterPlaceholder}
            fallbackSrc={posterErrorFallback}
            errorFallbackSrc={posterPlaceholder}
            onError={handlePosterImageError}
            fill
            priority={priority}
          />
          <div data-poster-region="controls">
            <div data-poster-region="control-stack">
              <div data-poster-region="control-row">
                <div data-poster-region="type-slot">
                  {isBook ? (
                    showAllBookFormats ? (
                      <>
                        <BookFormatBadge format="ebook" variant="card" />
                        <BookFormatBadge format="audiobook" variant="card" />
                      </>
                    ) : (
                      <BookFormatBadge
                        format={preferredBookFormat}
                        variant="card"
                      />
                    )
                  ) : (
                    <MediaTypeBadge
                      mediaType={mediaType === 'person' ? 'artist' : mediaType}
                      variant="card"
                    />
                  )}
                </div>
                <div data-poster-region="status-slot">
                  {primaryStatusBadge && (
                    <StatusBadgeMini
                      status={primaryStatusBadge.status}
                      quality={primaryStatusBadge.quality}
                      inProgress={primaryStatusBadge.inProgress}
                      shrink
                    />
                  )}
                </div>
              </div>
              <div data-poster-region="control-row">
                {watchlistPreview ? (
                  <Tooltip
                    content={intl.formatMessage(
                      watchlistPreviewDisabled
                        ? messages.watchlistPreviewDisabled
                        : previewWatchlisted
                          ? messages.watchlistPreviewRemove
                          : messages.watchlistPreviewAdd,
                      { title }
                    )}
                  >
                    <div data-poster-region="watchlist-slot">
                      <button
                        className="poster-control poster-control-watchlist poster-control-icon"
                        type="button"
                        aria-label={intl.formatMessage(
                          messages.watchlistPreviewLabel
                        )}
                        aria-pressed={previewWatchlisted}
                        disabled={watchlistPreviewDisabled}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          if (watchlistPreviewDisabled) return;
                          // Visual prototype: deliberately no API, cache, or database mutation.
                          setPreviewWatchlisted((added) => !added);
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        {previewWatchlisted ? (
                          <SolidStarIcon aria-hidden="true" />
                        ) : (
                          <StarIcon aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </Tooltip>
                ) : (
                  associationControls
                )}
                <div data-poster-region="status-slot">
                  {secondaryStatusBadge && (
                    <StatusBadgeMini
                      status={secondaryStatusBadge.status}
                      quality={secondaryStatusBadge.quality}
                      inProgress={secondaryStatusBadge.inProgress}
                      shrink
                    />
                  )}
                </div>
              </div>
              {watchlistPreview && (
                <div data-poster-region="control-row">
                  {associationControls}
                  {watchedControl}
                </div>
              )}
              {watchlistPreview ? (
                blocklistControl
              ) : blocklistControl ? (
                <div data-poster-region="control-row">
                  {blocklistControl}
                  {watchedControl}
                </div>
              ) : (
                watchedControl
              )}
            </div>
            {showDetail && currentStatus !== MediaStatus.BLOCKLISTED && (
              <div data-poster-region="hover-actions">
                <div>
                  {canUseWatchlistActions &&
                    !watchlistPreview &&
                    user?.userType !== UserType.PLEX && (
                      <Tooltip
                        content={
                          toggleWatchlist
                            ? addWatchlistDescription
                            : removeWatchlistDescription
                        }
                      >
                        <div data-poster-region="watchlist-slot">
                          {toggleWatchlist ? (
                            <Button
                              aria-busy={isUpdating}
                              aria-label={addWatchlistDescription}
                              buttonType={'ghost'}
                              className="poster-control poster-control-icon"
                              buttonSize={'sm'}
                              disabled={isUpdating}
                              iconOnly
                              onClick={onClickWatchlistBtn}
                              onKeyDown={(event) => event.stopPropagation()}
                            >
                              <StarIcon data-icon-tone="accent" />
                            </Button>
                          ) : (
                            <Button
                              aria-busy={isUpdating}
                              aria-label={removeWatchlistDescription}
                              className="poster-control poster-control-icon"
                              buttonSize={'sm'}
                              disabled={isUpdating}
                              iconOnly
                              onClick={onClickDeleteWatchlistBtn}
                              onKeyDown={(event) => event.stopPropagation()}
                            >
                              <MinusCircleIcon />
                            </Button>
                          )}
                        </div>
                      </Tooltip>
                    )}
                </div>
              </div>
            )}
          </div>
          <Transition
            as={Fragment}
            show={isUpdating}
            enter="poster-fade"
            enterFrom="poster-fade-hidden"
            enterTo="poster-fade-visible"
            leave="poster-fade"
            leaveFrom="poster-fade-visible"
            leaveTo="poster-fade-hidden"
          >
            <div data-poster-region="busy">
              <Spinner />
            </div>
          </Transition>

          <Transition
            as={Fragment}
            show={showTextOverlay}
            enter="poster-fade"
            enterFrom="poster-fade-hidden"
            enterTo="poster-fade-visible"
            leave="poster-fade"
            leaveFrom="poster-fade-visible"
            leaveTo="poster-fade-hidden"
          >
            <div data-poster-region="overlay">
              <Link
                href={detailHref}
                prefetch={false}
                data-poster-region="detail-link"
                data-poster-detail={showFullDetailOverlay ? 'full' : 'compact'}
                data-poster-has-action={
                  canShowRequestButton && showFullDetailOverlay
                }
              >
                <div data-poster-region="copy-anchor">
                  <div data-poster-region="copy">
                    {year && <div data-poster-region="year">{year}</div>}

                    <h1
                      className="card-title"
                      data-poster-region="title"
                      data-testid="title-card-title"
                      data-title-weight={titleWeight}
                    >
                      {title}
                    </h1>
                    {artist && (
                      <div data-poster-region="subtitle">{artist}</div>
                    )}
                    {showFullDetailOverlay && (
                      <div data-poster-region="summary">{summary}</div>
                    )}
                  </div>
                </div>
              </Link>

              <div data-poster-region="actions">
                {magazineRequestState && showFullDetailOverlay ? (
                  <Button
                    buttonType="default"
                    buttonSize="sm"
                    disabled
                    disabledReason={magazineRequestState.reason}
                    aria-label={magazineRequestState.label}
                  >
                    <span>{magazineRequestState.label}</span>
                  </Button>
                ) : canShowRequestButton && showFullDetailOverlay ? (
                  <Button
                    buttonType="primary"
                    buttonSize="sm"
                    onClick={(e) => {
                      e.preventDefault();
                      if (isBook && typeof canonicalId === 'string') {
                        void router.push({
                          pathname: `/book/${encodeApiPathSegment(canonicalId)}`,
                          query: {
                            ...getTitleCardBookDetailQuery({
                              canonicalId,
                              preferredBookFormat,
                              title,
                            }),
                            format: preferredBookFormat ?? 'ebook',
                            request: '1',
                          },
                        });
                        return;
                      }
                      setShowRequestModal(true);
                    }}
                  >
                    <ArrowDownTrayIcon />
                    <span>{requestLabel}</span>
                  </Button>
                ) : null}
              </div>
            </div>
          </Transition>
        </div>
      </div>
      {showDetail &&
        !isTouch &&
        (mediaType === 'movie' ||
          mediaType === 'tv' ||
          mediaType === 'album' ||
          mediaType === 'book') && (
          <PosterRatingPopover
            anchorRef={cardRef}
            id={canonicalId}
            mediaType={mediaType}
            userScore={userScore}
            voteCount={voteCount}
            bookRatingAverage={bookRatingAverage}
            bookRatingCount={bookRatingCount}
            title={title}
            artist={artist}
          />
        )}
    </div>
  );
};

export default withProperties(TitleCard, { Placeholder, ErrorCard });
