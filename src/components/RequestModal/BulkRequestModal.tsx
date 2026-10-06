import AuthorSummaryCard from '@app/components/AuthorDetails/AuthorSummaryCard';
import BookSeriesSummaryCard from '@app/components/BookSeriesDetails/BookSeriesSummaryCard';
import Alert from '@app/components/Common/Alert';
import {
  getBookFormatMessage,
  type RequestedBookFormat,
} from '@app/components/Common/BookFormatBadge';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import Modal from '@app/components/Common/Modal';
import SelectionCircle from '@app/components/Common/SelectionCircle';
import ThreeItemScroll from '@app/components/Common/ThreeItemScroll';
import {
  CompactRatingSelect,
  CompactSelect,
  FilterResetButton,
  type CompactSelectOption,
  type RatingOption,
} from '@app/components/Discover/FilterPanel/CompactFilterSelect';
import {
  BOOK_GENRES,
  BOOK_LANGUAGES,
} from '@app/components/Discover/FilterPanel/libraryFilterUtils';
import AvailabilityValue from '@app/components/MediaDetails/AvailabilityValue';
import MediaQualitySelect from '@app/components/MediaDetails/MediaQualitySelect';
import AdvancedOptionsDisclosureButton from '@app/components/RequestModal/AdvancedOptionsDisclosureButton';
import type { RequestOverrides } from '@app/components/RequestModal/AdvancedRequester';
import AdvancedRequester, {
  RequestListboxControl,
} from '@app/components/RequestModal/AdvancedRequester';
import QuotaDisplay from '@app/components/RequestModal/QuotaDisplay';
import RequestMediaCard from '@app/components/RequestModal/RequestMediaCard';
import SoulseekUnmatchedTracks from '@app/components/Soulseek/SoulseekUnmatchedTracks';
import useAdvancedOptionsDisclosure from '@app/hooks/useAdvancedOptionsDisclosure';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import {
  encodeApiPathSegment,
  normalizeExternalTitleId,
} from '@app/utils/apiPath';
import {
  loadNumberedCatalog,
  loadOffsetCatalog,
} from '@app/utils/bulkCatalogPagination';
import defineMessages from '@app/utils/defineMessages';
import { Transition } from '@headlessui/react';
import { ArrowDownTrayIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import type Media from '@server/entity/Media';
import type {
  BulkMediaRequestResponse,
  BulkMediaRequestResult,
} from '@server/interfaces/api/requestInterfaces';
import type { ServiceCommonServer } from '@server/interfaces/api/serviceInterfaces';
import type { QuotaResponse } from '@server/interfaces/api/userInterfaces';
import type {
  AuthorDetails,
  BookResult,
  BookSeriesDetails,
} from '@server/models/Book';
import axios from 'axios';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';
import BulkRequestItemCard from './BulkRequestItemCard';

const messages = defineMessages('components.RequestModal.BulkRequestModal', {
  requestdiscography: 'Request Discography',
  requestitems: 'Request {count} {count, plural, one {Item} other {Items}}',
  selectitems: 'Select Items',
  largeBatch:
    'You selected {count} items. Confirm once more before submitting this batch.',
  quotaexceeded: 'Not enough request quota remaining.',
  summary: '{created} created, {skipped} skipped, {failed} failed.',
  requestitemsFormat:
    'Request {count} {count, plural, one {Item} other {Items}} as {format}',
  faileditems: 'Failed Items',
  retryfailed: 'Retry Failed',
  submittingprogress:
    'Submitting {processed} of {total} {total, plural, one {item} other {items}}.',
  close: 'Close',
  noEbookServer:
    'No Book Bookshelf service is configured. Book requests are unavailable.',
  noAudiobookServer:
    'No audiobook Bookshelf service is configured. Audiobook requests are unavailable.',
  noMusicQualityServer:
    'No matching MP3 or FLAC music destination is configured.',
  quality: 'Quality',
  format: 'Format',
  releasetype: 'Release Type',
  loadmore: 'Load More',
  available: 'Available',
  requested: 'Requested',
  blocklisted: 'Blocklisted',
  notrequested: 'Not Requested',
  unmatched: 'No confident match',
  ambiguous: 'Ambiguous match',
  sourceTrack: 'Source: {title}',
  openSource: 'Open original playlist',
  clearFilters: 'Clear Filters',
  firstPublished: 'First Published',
  genres: 'Genres',
  rating: 'Rating',
  language: 'Language',
  any: 'Any',
  loadingRatings: 'Loading book ratings…',
  ratingsUnavailable:
    'Book ratings could not be loaded. Clear the Rating filter to continue.',
});

type BulkBookFormat = Exclude<RequestedBookFormat, 'both'>;
type BulkMediaType = 'music' | 'book';

export type BulkItem = {
  id: string;
  title: string;
  year?: string | number;
  image?: string | null;
  artist?: string;
  isbn13?: string;
  editionId?: string;
  authorId?: string;
  mediaInfo?: Media;
  subjects?: string[];
  languages?: string[];
  ratingsAverage?: number;
  releaseType?: string;
  sourceTitle?: string;
  matchStatus?: 'matched' | 'unmatched' | 'ambiguous';
};

type ArtistResponse = {
  releaseGroups: {
    id: string;
    title?: string;
    posterPath?: string | null;
    'first-release-date'?: string;
    'primary-type'?: string;
    secondary_types?: string[];
    'artist-credit'?: { name: string }[];
    mediaInfo?: Media;
  }[];
  typeCounts?: Record<string, number>;
  pagination?: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    albumType?: string;
  };
};

type AuthorWorksResponse = {
  works: BookResult[];
  pagination: {
    limit: number;
    offset: number;
    totalItems: number;
    nextOffset?: number;
  };
};

type AuthorRatingsResponse = {
  docs: { key: string; ratings_average?: number }[];
  numFound: number;
};

const getBulkRequestErrorMessage = (error: unknown): string | undefined => {
  if (axios.isAxiosError(error)) {
    const responseMessage = error.response?.data?.message;

    if (typeof responseMessage === 'string' && responseMessage.trim()) {
      return responseMessage;
    }

    if (error.message) {
      return error.message;
    }
  }

  return error instanceof Error ? error.message : undefined;
};

export interface BulkRequestModalProps {
  show: boolean;
  mediaType: BulkMediaType;
  title: string;
  artistId?: string;
  authorId?: string;
  seriesId?: string;
  initialBookFormat?: BulkBookFormat;
  initialItems?: BulkItem[];
  initialTotalItems?: number;
  sourceUrl?: string;
  onCancel: () => void;
  onComplete?: () => void;
}

const releaseTypeOptions = [
  'All',
  'Album',
  'EP',
  'Single',
  'Live',
  'Compilation',
  'Remix',
  'Soundtrack',
  'Broadcast',
  'Demo',
  'Other',
];
const EMPTY_BULK_ITEMS: BulkItem[] = [];
const BULK_REQUEST_CHUNK_SIZE = 100;
const normalizeBulkTitle = (value?: string) =>
  (value ?? '')
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const getBulkItemDedupeKey = (item: BulkItem, mediaType: BulkMediaType) =>
  mediaType === 'music'
    ? [
        normalizeBulkTitle(item.title),
        normalizeBulkTitle(item.artist),
        item.year?.toString() ?? '',
        normalizeBulkTitle(item.releaseType),
      ].join('|')
    : [normalizeBulkTitle(item.title), normalizeBulkTitle(item.artist)].join(
        '|'
      );

const normalizeBulkItemId = (id: string, mediaType: BulkMediaType): string =>
  normalizeExternalTitleId(mediaType, id).toString();

const dedupeBulkItems = (
  sourceItems: BulkItem[],
  mediaType: BulkMediaType
): BulkItem[] => {
  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();

  return sourceItems
    .map((item) => ({
      ...item,
      id: normalizeBulkItemId(item.id, mediaType),
    }))
    .filter((item) => {
      const idKey = normalizeBulkItemId(item.id, mediaType);
      const titleKey = getBulkItemDedupeKey(item, mediaType);

      if (seenIds.has(idKey) || seenTitles.has(titleKey)) {
        return false;
      }

      seenIds.add(idKey);
      seenTitles.add(titleKey);
      return true;
    });
};

const mapBookWorkToBulkItem = (work: BookResult): BulkItem => ({
  id: work.id,
  title: work.title,
  year: work.firstPublishYear,
  image: work.posterPath,
  artist: work.author,
  isbn13: work.isbn13,
  editionId: work.editionId,
  authorId: work.authorId,
  mediaInfo: work.mediaInfo,
  subjects: work.subjects,
  languages: work.languages,
  ratingsAverage: work.ratingsAverage,
});

const isActiveRequest = (requestStatus?: MediaRequestStatus) =>
  requestStatus !== undefined &&
  requestStatus !== MediaRequestStatus.DECLINED &&
  requestStatus !== MediaRequestStatus.FAILED &&
  requestStatus !== MediaRequestStatus.COMPLETED;

const chunkItems = <T,>(sourceItems: T[], chunkSize: number): T[][] => {
  const chunks: T[][] = [];

  for (let index = 0; index < sourceItems.length; index += chunkSize) {
    chunks.push(sourceItems.slice(index, index + chunkSize));
  }

  return chunks;
};

const hasBookFormat = (
  media: Media | undefined,
  format: 'ebook' | 'audiobook'
) => {
  if (!media) {
    return false;
  }

  return format === 'ebook'
    ? media.externalServiceId !== null && media.externalServiceId !== undefined
    : media.audiobookExternalServiceId !== null &&
        media.audiobookExternalServiceId !== undefined;
};

const hasBookRequest = (
  media: Media | undefined,
  format: 'ebook' | 'audiobook'
) =>
  (media?.requests ?? []).some((request) => {
    if (!isActiveRequest(request.status)) {
      return false;
    }

    return (
      request.bookFormat === 'both' ||
      (request.bookFormat ?? 'ebook') === format
    );
  });

const getBookIneligibleReason = (
  item: BulkItem,
  format: BulkBookFormat
): string | undefined => {
  if (item.mediaInfo?.status === MediaStatus.BLOCKLISTED) {
    return messages.blocklisted.defaultMessage;
  }

  const ebookCovered =
    hasBookFormat(item.mediaInfo, 'ebook') ||
    hasBookRequest(item.mediaInfo, 'ebook');
  const audiobookCovered =
    hasBookFormat(item.mediaInfo, 'audiobook') ||
    hasBookRequest(item.mediaInfo, 'audiobook');

  if (format === 'ebook' && ebookCovered) {
    return messages.requested.defaultMessage;
  }

  if (format === 'audiobook' && audiobookCovered) {
    return messages.requested.defaultMessage;
  }

  return undefined;
};

const getMusicIneligibleReason = (item: BulkItem): string | undefined => {
  if (item.matchStatus === 'unmatched') {
    return messages.unmatched.defaultMessage;
  }

  if (item.matchStatus === 'ambiguous') {
    return messages.ambiguous.defaultMessage;
  }

  if (item.mediaInfo?.status === MediaStatus.BLOCKLISTED) {
    return messages.blocklisted.defaultMessage;
  }

  if (item.mediaInfo?.status === MediaStatus.AVAILABLE) {
    return messages.available.defaultMessage;
  }

  if (
    (item.mediaInfo?.requests ?? []).some((request) =>
      isActiveRequest(request.status)
    )
  ) {
    return messages.requested.defaultMessage;
  }

  return undefined;
};

const BulkRequestModal = ({
  show,
  mediaType,
  title,
  artistId,
  authorId,
  seriesId,
  initialBookFormat = 'ebook',
  initialItems = EMPTY_BULK_ITEMS,
  initialTotalItems,
  sourceUrl,
  onCancel,
  onComplete,
}: BulkRequestModalProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { user, hasPermission } = useUser();
  const [format, setFormat] = useState<BulkBookFormat>(initialBookFormat);
  const [musicQuality, setMusicQuality] = useState<'mp3' | 'flac'>('mp3');
  const [qualityRevision, setQualityRevision] = useState(0);
  const {
    open: advancedOptionsOpen,
    pinned: advancedOptionsPinned,
    toggleOpen: toggleAdvancedOptions,
    togglePin: toggleAdvancedOptionsPin,
  } = useAdvancedOptionsDisclosure(mediaType);
  const [releaseType, setReleaseType] = useState('Album');
  const [items, setItems] = useState<BulkItem[]>(
    dedupeBulkItems(initialItems, mediaType)
  );
  const [firstPublishedFilter, setFirstPublishedFilter] = useState('');
  const [genreFilter, setGenreFilter] = useState('');
  const [ratingFilter, setRatingFilter] = useState('');
  const [languageFilter, setLanguageFilter] = useState('');
  const [authorRatings, setAuthorRatings] = useState<{
    authorId: string;
    values: Record<string, number>;
  }>();
  const [isLoadingRatings, setIsLoadingRatings] = useState(false);
  const [ratingsError, setRatingsError] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [requestedByPortal, setRequestedByPortal] =
    useState<HTMLDivElement | null>(null);
  const [requestOverrides, setRequestOverrides] =
    useState<RequestOverrides | null>(null);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [confirmLargeBatch, setConfirmLargeBatch] = useState(false);
  const [summary, setSummary] = useState<BulkMediaRequestResponse>();
  const [submitProgress, setSubmitProgress] = useState<{
    processed: number;
    total: number;
  }>();
  const [authorOffset, setAuthorOffset] = useState(initialItems.length);
  const [authorTotal, setAuthorTotal] = useState<number | undefined>(
    initialTotalItems
  );
  const loadMoreAuthorControllerRef = useRef<AbortController | undefined>(
    undefined
  );

  const { data: quota } = useSWR<QuotaResponse>(
    user &&
      (!requestOverrides?.user?.id || hasPermission(Permission.MANAGE_USERS))
      ? `/api/v1/user/${requestOverrides?.user?.id ?? user.id}/quota`
      : null
  );
  const { data: authorDetails } = useSWR<AuthorDetails>(
    mediaType === 'book' && authorId
      ? `/api/v1/author/${encodeApiPathSegment(authorId)}`
      : null
  );
  const { data: seriesDetails } = useSWR<BookSeriesDetails>(
    mediaType === 'book' && seriesId
      ? `/api/v1/series/${encodeApiPathSegment(seriesId)}`
      : null
  );
  const { data: bookServices } = useSWR<ServiceCommonServer[]>(
    mediaType === 'book' ? '/api/v1/service/readarr' : null
  );
  const { data: musicServices } = useSWR<ServiceCommonServer[]>(
    mediaType === 'music' ? '/api/v1/service/lidarr' : null
  );
  const musicQualityService = musicServices?.find((server) =>
    server.name.toLowerCase().includes(musicQuality)
  );
  const selectedMusicService = musicServices?.find(
    (server) => server.id === requestOverrides?.server
  );

  const formatAvailable = useMemo(() => {
    const hasEbookServer = (bookServices ?? []).some(
      (service) => (service.serviceType ?? 'ebook') === 'ebook'
    );
    const hasAudiobookServer = (bookServices ?? []).some(
      (service) => service.serviceType === 'audiobook'
    );

    return {
      ebook: hasEbookServer,
      audiobook: hasAudiobookServer,
    };
  }, [bookServices]);

  useEffect(() => {
    setItems(dedupeBulkItems(initialItems, mediaType));
    setAuthorOffset(initialItems.length);
    setAuthorTotal(initialTotalItems);
  }, [initialItems, initialTotalItems, mediaType]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const loadCatalog = async () => {
      if (!show || (mediaType === 'book' ? !authorId : !artistId)) {
        setIsLoadingItems(false);
        return;
      }

      setIsLoadingItems(true);

      try {
        if (mediaType === 'book' && authorId) {
          const result = await loadOffsetCatalog({
            pageSize: 100,
            signal: controller.signal,
            loadPage: async (offset, limit, signal) => {
              const response = await axios.get<AuthorWorksResponse>(
                `/api/v1/author/${encodeApiPathSegment(authorId)}/works`,
                { params: { limit, offset }, signal }
              );
              return {
                items: response.data.works,
                ...response.data.pagination,
              };
            },
          });
          const worksById = new Map<string, BookResult>();
          result.items.forEach((work) =>
            worksById.set(normalizeBulkItemId(work.id, 'book'), work)
          );

          if (active) {
            setAuthorOffset(result.nextOffset);
            setAuthorTotal(result.totalItems);
            setItems(
              dedupeBulkItems(
                [...worksById.values()].map(mapBookWorkToBulkItem),
                mediaType
              )
            );
          }
        } else if (mediaType === 'music' && artistId) {
          const releaseGroups = await loadNumberedCatalog({
            pageSize: 50,
            signal: controller.signal,
            loadPage: async (page, pageSize, signal) => {
              const response = await axios.get<ArtistResponse>(
                `/api/v1/artist/${encodeApiPathSegment(artistId)}`,
                {
                  params: { albumType: releaseType, page, pageSize },
                  signal,
                }
              );
              return {
                items: response.data.releaseGroups,
                totalPages: response.data.pagination?.totalPages,
              };
            },
          });
          const releaseGroupsById = new Map<
            string,
            ArtistResponse['releaseGroups'][number]
          >();
          releaseGroups.forEach((album) =>
            releaseGroupsById.set(normalizeBulkItemId(album.id, 'music'), album)
          );

          if (active) {
            setItems(
              dedupeBulkItems(
                [...releaseGroupsById.values()].map((album) => ({
                  id: album.id,
                  title: album.title ?? 'Unknown Album',
                  year: album['first-release-date']?.slice(0, 4),
                  image: album.posterPath,
                  artist: album['artist-credit']?.[0]?.name,
                  mediaInfo: album.mediaInfo,
                  releaseType:
                    album.secondary_types?.[0] ??
                    album['primary-type'] ??
                    'Other',
                })),
                mediaType
              )
            );
          }
        }
      } catch (error) {
        if (active && !axios.isCancel(error)) {
          setItems(dedupeBulkItems(initialItems, mediaType));
        }
      } finally {
        if (active) {
          setIsLoadingItems(false);
        }
      }
    };

    void loadCatalog();

    return () => {
      active = false;
      controller.abort();
    };
  }, [artistId, authorId, initialItems, mediaType, releaseType, show]);

  useEffect(
    () => () => {
      loadMoreAuthorControllerRef.current?.abort();
      loadMoreAuthorControllerRef.current = undefined;
    },
    [authorId]
  );

  const ratingsById =
    authorRatings && authorRatings.authorId === authorId
      ? authorRatings.values
      : undefined;
  useEffect(() => {
    if (
      !show ||
      mediaType !== 'book' ||
      !authorId ||
      !ratingFilter ||
      ratingsById
    ) {
      return;
    }

    const controller = new AbortController();
    let active = true;
    setIsLoadingRatings(true);
    setRatingsError(false);

    void loadNumberedCatalog({
      pageSize: 100,
      signal: controller.signal,
      loadPage: async (page, _pageSize, signal) => {
        const response = await axios.get<AuthorRatingsResponse>(
          'https://openlibrary.org/search.json',
          {
            params: {
              q: `author_key:${authorId}`,
              fields: 'key,ratings_average',
              page,
              limit: 100,
            },
            signal,
          }
        );
        return {
          items: response.data.docs.map((doc) => ({
            id: doc.key.replace(/^\/?works\//, ''),
            rating: doc.ratings_average,
          })),
          totalPages: Math.ceil(response.data.numFound / 100),
        };
      },
    })
      .then((ratings) => {
        if (active) {
          setAuthorRatings({
            authorId,
            values: Object.fromEntries(
              ratings
                .filter((item): item is { id: string; rating: number } =>
                  Number.isFinite(item.rating)
                )
                .map((item) => [item.id, item.rating])
            ),
          });
        }
      })
      .catch((error) => {
        if (active && !axios.isCancel(error)) {
          setRatingsError(true);
        }
      })
      .finally(() => {
        if (active) setIsLoadingRatings(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [authorId, mediaType, ratingFilter, ratingsById, show]);

  const getIneligibleReason = useCallback(
    (item: BulkItem): string | undefined =>
      mediaType === 'book'
        ? getBookIneligibleReason(item, format)
        : getMusicIneligibleReason(item),
    [format, mediaType]
  );

  useEffect(() => {
    if (mediaType !== 'book' || !bookServices || formatAvailable[format]) {
      return;
    }

    if (formatAvailable.ebook) {
      setFormat('ebook');
    } else if (formatAvailable.audiobook) {
      setFormat('audiobook');
    }
  }, [bookServices, format, formatAvailable, mediaType]);

  const visibleItems = useMemo(
    () =>
      mediaType !== 'book'
        ? items
        : items.filter((item) => {
            const year = Number(item.year);
            if (
              firstPublishedFilter &&
              (firstPublishedFilter === 'before-1970'
                ? !Number.isFinite(year) || year >= 1970
                : item.year?.toString() !== firstPublishedFilter)
            ) {
              return false;
            }
            if (
              genreFilter &&
              !item.subjects?.some((subject) =>
                subject
                  .toLowerCase()
                  .replace(/[_-]/g, ' ')
                  .includes(genreFilter.replace(/_/g, ' '))
              )
            ) {
              return false;
            }
            if (languageFilter && !item.languages?.includes(languageFilter)) {
              return false;
            }
            if (
              ratingFilter &&
              (ratingsById?.[item.id] ?? item.ratingsAverage ?? 0) <
                Number(ratingFilter)
            ) {
              return false;
            }
            return true;
          }),
    [
      firstPublishedFilter,
      genreFilter,
      items,
      languageFilter,
      mediaType,
      ratingFilter,
      ratingsById,
    ]
  );
  const eligibleItems = useMemo(
    () => visibleItems.filter((item) => !getIneligibleReason(item)),
    [getIneligibleReason, visibleItems]
  );

  useEffect(() => {
    setSelectedIds(eligibleItems.map((item) => item.id));
  }, [eligibleItems]);

  const selectedItems = visibleItems.filter((item) =>
    selectedIds.includes(item.id)
  );
  const currentQuota = mediaType === 'book' ? quota?.book : quota?.music;
  const remaining =
    currentQuota?.remaining !== undefined
      ? currentQuota.remaining - selectedItems.length
      : undefined;
  const selectedExceedsQuota =
    !!currentQuota?.limit && remaining !== undefined && remaining < 0;
  const formatWarning =
    mediaType === 'book' && bookServices && !formatAvailable[format]
      ? format === 'ebook'
        ? messages.noEbookServer
        : messages.noAudiobookServer
      : mediaType === 'music' && musicServices && !musicQualityService
        ? messages.noMusicQualityServer
        : null;

  const toggleItem = (item: BulkItem) => {
    if (getIneligibleReason(item)) {
      return;
    }

    setSelectedIds((current) =>
      current.includes(item.id)
        ? current.filter((id) => id !== item.id)
        : [...current, item.id]
    );
  };

  const toggleAll = () => {
    if (selectedIds.length === eligibleItems.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(eligibleItems.map((item) => item.id));
    }
  };

  const retryFailedItems = () => {
    if (!summary?.failed.length) {
      return;
    }

    const failedIds = new Set(summary.failed.map((failure) => failure.mediaId));
    setSelectedIds(
      items
        .filter((item) => failedIds.has(item.id) && !getIneligibleReason(item))
        .map((item) => item.id)
    );
    setConfirmLargeBatch(false);
    setSubmitProgress(undefined);
    setSummary(undefined);
  };

  const loadMoreAuthorWorks = async () => {
    if (!authorId || isLoadingItems || loadMoreAuthorControllerRef.current) {
      return;
    }
    const controller = new AbortController();
    loadMoreAuthorControllerRef.current = controller;
    setIsLoadingItems(true);

    try {
      const result = await loadOffsetCatalog({
        initialOffset: authorOffset,
        maxItems: 20,
        pageSize: 20,
        signal: controller.signal,
        loadPage: async (offset, limit, signal) => {
          const response = await axios.get<AuthorWorksResponse>(
            `/api/v1/author/${encodeApiPathSegment(authorId)}/works`,
            { params: { limit, offset }, signal }
          );
          return {
            items: response.data.works,
            ...response.data.pagination,
          };
        },
      });
      if (loadMoreAuthorControllerRef.current !== controller) {
        return;
      }
      setAuthorOffset(result.nextOffset);
      setAuthorTotal(result.totalItems);
      setItems((current) =>
        dedupeBulkItems(
          [...current, ...result.items.map(mapBookWorkToBulkItem)],
          mediaType
        )
      );
    } catch (error) {
      if (
        loadMoreAuthorControllerRef.current === controller &&
        !axios.isCancel(error) &&
        !(error instanceof DOMException && error.name === 'AbortError')
      ) {
        addToast(intl.formatMessage(globalMessages.error), {
          appearance: 'error',
          autoDismiss: true,
        });
      }
    } finally {
      if (loadMoreAuthorControllerRef.current === controller) {
        loadMoreAuthorControllerRef.current = undefined;
        setIsLoadingItems(false);
      }
    }
  };

  const hasMoreAuthorWorks =
    mediaType === 'book' &&
    !!authorId &&
    (authorTotal === undefined || authorOffset < authorTotal);

  const submit = async () => {
    if (formatWarning || (mediaType === 'music' && !musicQualityService)) {
      return;
    }
    if (selectedExceedsQuota) {
      addToast(intl.formatMessage(messages.quotaexceeded), {
        appearance: 'error',
        autoDismiss: true,
      });
      return;
    }

    if (selectedItems.length > 50 && !confirmLargeBatch) {
      setConfirmLargeBatch(true);
      return;
    }

    setIsUpdating(true);
    setSubmitProgress({ processed: 0, total: selectedItems.length });

    try {
      const requestItems = selectedItems.map((item) => ({
        mediaId: item.id,
        title: item.title,
        isbn13: item.isbn13,
        editionId: item.editionId,
        authorId: item.authorId,
      }));
      const responses: BulkMediaRequestResponse[] = [];

      for (const chunk of chunkItems(requestItems, BULK_REQUEST_CHUNK_SIZE)) {
        const response = await axios.post<BulkMediaRequestResponse>(
          '/api/v1/request/bulk',
          {
            mediaType,
            format: mediaType === 'book' ? format : undefined,
            items: chunk,
            serverId:
              requestOverrides?.server ??
              (mediaType === 'music' ? musicQualityService?.id : undefined),
            profileId: requestOverrides?.profile,
            metadataProfileId: requestOverrides?.metadataProfile,
            rootFolder: requestOverrides?.folder,
            userId: requestOverrides?.user?.id,
            tags: requestOverrides?.tags,
          }
        );

        responses.push(response.data);
        setSubmitProgress((current) => ({
          processed: (current?.processed ?? 0) + chunk.length,
          total: requestItems.length,
        }));
      }

      const nextSummary = responses.reduce<BulkMediaRequestResponse>(
        (summary, response) => ({
          created: [...summary.created, ...response.created],
          skipped: [...summary.skipped, ...response.skipped],
          failed: [...summary.failed, ...response.failed],
        }),
        {
          created: [],
          skipped: [],
          failed: [],
        }
      );

      setSummary(nextSummary);
      mutate('/api/v1/request/count');
      onComplete?.();
      addToast(
        intl.formatMessage(messages.summary, {
          created: nextSummary.created.length,
          skipped: nextSummary.skipped.length,
          failed: nextSummary.failed.length,
        }),
        { appearance: nextSummary.failed.length ? 'warning' : 'success' }
      );
    } catch (error) {
      addToast(
        getBulkRequestErrorMessage(error) ??
          intl.formatMessage(globalMessages.error),
        {
          appearance: 'error',
          autoDismiss: true,
        }
      );
    } finally {
      setIsUpdating(false);
      setSubmitProgress(undefined);
    }
  };

  const renderFailures = (failures: BulkMediaRequestResult[]) => (
    <div className="scrollable-card mt-4 max-h-48 overflow-y-auto rounded-md border border-gray-700">
      {failures.map((failure) => (
        <div
          key={`${failure.mediaId}-${failure.reason}`}
          className="border-b border-gray-700 px-3 py-2 last:border-b-0"
        >
          <div className="font-medium text-white">
            {failure.title ?? failure.mediaId}
          </div>
          <div className="text-sm text-gray-300">{failure.reason}</div>
        </div>
      ))}
    </div>
  );

  const anyLabel = intl.formatMessage(messages.any);
  const bookYearOptions: CompactSelectOption[] = [
    { label: anyLabel, value: '' },
    ...Array.from({ length: new Date().getFullYear() - 1969 }, (_, index) => {
      const year = new Date().getFullYear() - index;
      return { label: year.toString(), value: year.toString() };
    }),
    { label: '<1970', value: 'before-1970' },
  ];
  const bookGenreOptions: CompactSelectOption[] = [
    { label: anyLabel, value: '' },
    ...BOOK_GENRES.map(([value, label]) => ({ value, label })),
  ];
  const bookRatingOptions: RatingOption[] = [
    { label: anyLabel, value: '' },
    ...Array.from({ length: 9 }, (_, index) => {
      const score = 1 + index * 0.5;
      return { label: `${score.toFixed(1)}+`, value: score.toFixed(1), score };
    }),
  ];
  const bookLanguageOptions: CompactSelectOption[] = [
    { label: anyLabel, value: '' },
    ...BOOK_LANGUAGES.map(([value, label]) => ({ value, label })),
  ];

  const modalContent = (
    <>
      {mediaType === 'music' && !summary && (
        <SoulseekUnmatchedTracks
          tracks={initialItems
            .filter((item) => item.matchStatus === 'unmatched')
            .map((item) => ({ title: item.title, artist: item.artist }))}
        />
      )}
      {summary ? (
        <div className="mt-6 text-gray-200">
          <Alert
            type={summary.failed.length ? 'warning' : 'info'}
            title={intl.formatMessage(messages.summary, {
              created: summary.created.length,
              skipped: summary.skipped.length,
              failed: summary.failed.length,
            })}
          />
          {summary.failed.length > 0 && (
            <>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-lg font-semibold">
                  {intl.formatMessage(messages.faileditems)}
                </div>
                <Button buttonType="primary" onClick={retryFailedItems}>
                  {intl.formatMessage(messages.retryfailed)}
                </Button>
              </div>
              {renderFailures(summary.failed)}
            </>
          )}
        </div>
      ) : (
        <>
          {confirmLargeBatch && (
            <div className="mt-6">
              <Alert
                title={intl.formatMessage(messages.largeBatch, {
                  count: selectedItems.length,
                })}
                type="warning"
              />
            </div>
          )}
          {selectedExceedsQuota && (
            <div className="mt-6">
              <Alert
                title={intl.formatMessage(messages.quotaexceeded)}
                type="warning"
              />
            </div>
          )}
          {submitProgress && (
            <div className="mt-6">
              <Alert
                title={intl.formatMessage(messages.submittingprogress, {
                  processed: submitProgress.processed,
                  total: submitProgress.total,
                })}
                type="info"
              />
            </div>
          )}
          {(currentQuota?.limit ?? 0) > 0 && (
            <QuotaDisplay
              mediaType={mediaType}
              quota={currentQuota}
              remaining={remaining}
              userOverride={
                requestOverrides?.user && requestOverrides.user.id !== user?.id
                  ? requestOverrides.user.id
                  : undefined
              }
            />
          )}
          {mediaType === 'music' && (
            <div className="mt-6">
              <RequestListboxControl
                id="bulk-release-type"
                label={intl.formatMessage(messages.releasetype)}
                value={releaseType}
                onChange={setReleaseType}
                options={releaseTypeOptions.map((type) => ({
                  value: type,
                  label: type,
                }))}
                active={releaseType !== 'Album'}
                loadingLabel={intl.formatMessage(globalMessages.loading)}
              />
            </div>
          )}
          {formatWarning && (
            <div className="mt-4">
              <Alert title={intl.formatMessage(formatWarning)} type="warning" />
            </div>
          )}
          {sourceUrl && (
            <div className="mt-4 text-sm text-gray-300">
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-indigo-300 hover:text-indigo-200"
              >
                {intl.formatMessage(messages.openSource)}
              </a>
            </div>
          )}
          {mediaType === 'book' ? (
            <div className="card-spacing-before grid grid-cols-1 items-start gap-2 sm:grid-cols-2">
              {[
                visibleItems.slice(0, Math.ceil(visibleItems.length / 2)),
                visibleItems.slice(Math.ceil(visibleItems.length / 2)),
              ].map((column, index) => (
                <section
                  key={index}
                  className="app-card-inset refreshed-inset-surface overflow-hidden rounded-lg border border-gray-700 p-2"
                >
                  <div className="media-inset-table-heading request-divider-dark grid grid-cols-[2rem_40px_minmax(0,1fr)] items-center gap-x-2 border-b px-2 pb-2">
                    {index === 0 ? (
                      <SelectionCircle
                        label={intl.formatMessage(messages.selectitems)}
                        selected={
                          selectedItems.length > 0 &&
                          selectedItems.length === eligibleItems.length
                        }
                        disabled={isUpdating}
                        onClick={toggleAll}
                      />
                    ) : (
                      <span aria-hidden="true" />
                    )}
                    <span className="media-inset-poster-column-heading text-left">
                      Book
                    </span>
                  </div>
                  <div className="scrollable-card -mr-3 max-h-[228px] space-y-0.5 overflow-y-auto pt-1 pr-3">
                    {column.map((item) => (
                      <div
                        key={item.id}
                        className="app-card-inset refreshed-inset-surface grid min-h-[54px] grid-cols-[2rem_40px_minmax(0,1fr)] items-center gap-x-2 rounded-lg border border-gray-700 px-2"
                      >
                        <SelectionCircle
                          label={item.title}
                          selected={selectedIds.includes(item.id)}
                          disabled={isUpdating || !!getIneligibleReason(item)}
                          onClick={() => toggleItem(item)}
                        />
                        <div className="relative h-[46px] w-[35px] justify-self-center overflow-hidden rounded-md ring-1 ring-gray-700">
                          <CachedImage
                            type="book"
                            src={
                              item.image || '/images/seerr_poster_not_found.png'
                            }
                            alt=""
                            fill
                            sizes="35px"
                            className="object-cover"
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm leading-5 font-semibold text-gray-100">
                            {item.title}
                          </div>
                          <dl className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-1 text-xs leading-4">
                            {(['ebook', 'audiobook'] as const).map(
                              (bookFormat) => {
                                const available = hasBookFormat(
                                  item.mediaInfo,
                                  bookFormat
                                );
                                const requested = hasBookRequest(
                                  item.mediaInfo,
                                  bookFormat
                                );
                                return (
                                  <div key={bookFormat} className="contents">
                                    <dt className="font-medium text-gray-100">
                                      {bookFormat === 'ebook'
                                        ? 'Book'
                                        : 'Audiobook'}
                                      :
                                    </dt>
                                    <dd className="m-0 truncate font-medium">
                                      <AvailabilityValue
                                        tone={
                                          available
                                            ? 'available'
                                            : requested
                                              ? 'processing'
                                              : 'unavailable'
                                        }
                                      >
                                        {available
                                          ? 'Available'
                                          : requested
                                            ? 'Requested'
                                            : 'Not Available'}
                                      </AvailabilityValue>
                                    </dd>
                                  </div>
                                );
                              }
                            )}
                          </dl>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <section className="app-card-inset refreshed-inset-surface card-spacing-before">
              <ThreeItemScroll label={intl.formatMessage(messages.selectitems)}>
                {items.map((item) => (
                  <BulkRequestItemCard
                    key={item.id}
                    item={item}
                    mediaType={mediaType}
                    format={format}
                    selected={selectedIds.includes(item.id)}
                    reason={getIneligibleReason(item)}
                    onToggle={() => toggleItem(item)}
                    onNavigate={onCancel}
                  />
                ))}
              </ThreeItemScroll>
            </section>
          )}
          {hasMoreAuthorWorks && (
            <div className="mt-4">
              <Button
                buttonType="ghost"
                disabled={isLoadingItems}
                onClick={() => void loadMoreAuthorWorks()}
              >
                {intl.formatMessage(messages.loadmore)}
              </Button>
            </div>
          )}
          {mediaType === 'book' && (
            <div className="mt-2 flex items-center">
              <MediaQualitySelect
                value={format}
                options={[
                  {
                    label: intl.formatMessage(getBookFormatMessage('ebook')),
                    value: 'ebook',
                    disabled: !formatAvailable.ebook,
                  },
                  {
                    label: intl.formatMessage(
                      getBookFormatMessage('audiobook')
                    ),
                    value: 'audiobook',
                    disabled: !formatAvailable.audiobook,
                  },
                ]}
                onChange={(value) => {
                  setRequestOverrides(null);
                  setFormat(value);
                }}
                label={intl.formatMessage(messages.format)}
                autoSelectAvailable={false}
                purpose="request"
              />
            </div>
          )}
          {mediaType === 'music' && (
            <div className="mt-2 flex items-center">
              <MediaQualitySelect
                value={
                  selectedMusicService?.name.toLowerCase().includes('flac')
                    ? 'flac'
                    : selectedMusicService?.name.toLowerCase().includes('mp3')
                      ? 'mp3'
                      : musicQuality
                }
                options={[
                  {
                    label: 'MP3',
                    value: 'mp3',
                    disabled:
                      !!musicServices &&
                      !musicServices.some((service) =>
                        service.name.toLowerCase().includes('mp3')
                      ),
                  },
                  {
                    label: 'FLAC',
                    value: 'flac',
                    disabled:
                      !!musicServices &&
                      !musicServices.some((service) =>
                        service.name.toLowerCase().includes('flac')
                      ),
                  },
                ]}
                onChange={(quality) => {
                  setMusicQuality(quality);
                  setRequestOverrides(null);
                  setQualityRevision((current) => current + 1);
                }}
                label={intl.formatMessage(messages.quality)}
                autoSelectAvailable={false}
                purpose="request"
              />
            </div>
          )}
          {(hasPermission(Permission.REQUEST_ADVANCED) ||
            hasPermission(Permission.MANAGE_REQUESTS)) && (
            <AdvancedRequester
              key={
                mediaType === 'music'
                  ? musicQuality + '-' + qualityRevision
                  : format
              }
              type={mediaType}
              is4k={false}
              bookFormat={mediaType === 'book' ? format : undefined}
              defaultOverrides={
                mediaType === 'music' && musicQualityService
                  ? { server: musicQualityService.id }
                  : undefined
              }
              onChange={(overrides) => setRequestOverrides(overrides)}
              panelOnly={mediaType === 'book'}
              expanded={mediaType === 'book' ? advancedOptionsOpen : undefined}
              rootFolderTable={mediaType === 'book'}
              requestedByPortal={
                mediaType === 'book' ? requestedByPortal : undefined
              }
            />
          )}
        </>
      )}
    </>
  );

  return (
    <Transition
      as="div"

      show={show}
    >
      <Modal
        loading={!quota || (mediaType === 'book' && !bookServices)}
        title={
          mediaType === 'book'
            ? seriesId
              ? 'Request Collection'
              : 'Request Bibliography'
            : intl.formatMessage(messages.requestdiscography)
        }
        subTitle={mediaType === 'book' ? undefined : title}
        onCancel={onCancel}
        onOk={summary ? onCancel : submit}
        okText={
          summary
            ? intl.formatMessage(messages.close)
            : isUpdating
              ? intl.formatMessage(globalMessages.requesting)
              : selectedIds.length === 0
                ? intl.formatMessage(messages.selectitems)
                : mediaType === 'book'
                  ? intl.formatMessage(messages.requestitemsFormat, {
                      count: selectedIds.length,
                      format: intl.formatMessage(getBookFormatMessage(format)),
                    })
                  : intl.formatMessage(messages.requestitems, {
                      count: selectedIds.length,
                    })
        }
        okDisabled={
          !summary &&
          (isLoadingItems ||
            isUpdating ||
            selectedIds.length === 0 ||
            selectedExceedsQuota ||
            !!formatWarning ||
            (mediaType === 'music' && !musicQualityService))
        }
        hideActions={mediaType === 'book'}
        alignTop={mediaType === 'book'}
        cancelButtonType="danger"
        okButtonType="success"
        actionButtonSize="standard"
        dialogClass="app-card-main request-modal-site-surface sm:max-w-5xl"
      >
        {mediaType === 'book' ? (
          <RequestMediaCard
            artwork={
              seriesDetails?.books.find((book) => book.posterPath)
                ?.posterPath ?? authorDetails?.posterPath
            }
            artworkType="book"
          >
            {seriesId && (
              <BookSeriesSummaryCard
                seriesId={seriesId}
                title={title}
                initialData={seriesDetails}
                selectionSize={{
                  selected: selectedItems.length,
                  visible: visibleItems.length,
                }}
              />
            )}
            {authorDetails && (
              <AuthorSummaryCard
                author={authorDetails}
                selectionSize={{
                  selected: selectedItems.length,
                  visible: visibleItems.length,
                }}
              />
            )}
            {!summary && (
              <div className="mt-4 flex flex-wrap gap-2">
                <FilterResetButton
                  label={intl.formatMessage(messages.clearFilters)}
                  selected={
                    !firstPublishedFilter &&
                    !genreFilter &&
                    !ratingFilter &&
                    !languageFilter
                  }
                  onClick={() => {
                    setFirstPublishedFilter('');
                    setGenreFilter('');
                    setRatingFilter('');
                    setLanguageFilter('');
                  }}
                />
                <CompactSelect
                  label={intl.formatMessage(messages.firstPublished)}
                  value={firstPublishedFilter}
                  options={bookYearOptions}
                  onChange={setFirstPublishedFilter}
                />
                <CompactSelect
                  label={intl.formatMessage(messages.genres)}
                  value={genreFilter}
                  options={bookGenreOptions}
                  onChange={setGenreFilter}
                />
                <CompactRatingSelect
                  label={intl.formatMessage(messages.rating)}
                  value={ratingFilter}
                  options={bookRatingOptions}
                  maxScore={5}
                  onChange={setRatingFilter}
                />
                <CompactSelect
                  label={intl.formatMessage(messages.language)}
                  value={languageFilter}
                  options={bookLanguageOptions}
                  onChange={setLanguageFilter}
                />
                {ratingFilter && isLoadingRatings && (
                  <span
                    className="self-center text-sm text-gray-300"
                    role="status"
                  >
                    {intl.formatMessage(messages.loadingRatings)}
                  </span>
                )}
                {ratingFilter && ratingsError && (
                  <span
                    className="self-center text-sm text-red-300"
                    role="alert"
                  >
                    {intl.formatMessage(messages.ratingsUnavailable)}
                  </span>
                )}
              </div>
            )}
            {modalContent}
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <div className="mr-auto flex items-center gap-2">
                {(hasPermission(Permission.REQUEST_ADVANCED) ||
                  hasPermission(Permission.MANAGE_REQUESTS)) &&
                  !summary && (
                    <AdvancedOptionsDisclosureButton
                      label="Advanced Options"
                      open={advancedOptionsOpen}
                      pinned={advancedOptionsPinned}
                      onToggle={toggleAdvancedOptions}
                      onPin={toggleAdvancedOptionsPin}
                    />
                  )}
              </div>
              <div
                className="compact-control flex items-center"
                ref={setRequestedByPortal}
              />
              <Button
                type="button"
                onClick={onCancel}
                disabled={isUpdating}
                buttonType="danger"
                buttonSize="standard"
              >
                <XMarkIcon aria-hidden="true" />
                {intl.formatMessage(globalMessages.cancel)}
              </Button>
              <Button
                type="button"
                onClick={() => void (summary ? onCancel() : submit())}
                disabled={
                  !summary &&
                  (isLoadingItems ||
                    (Boolean(ratingFilter) &&
                      (isLoadingRatings || ratingsError)) ||
                    isUpdating ||
                    selectedItems.length === 0 ||
                    selectedExceedsQuota ||
                    !!formatWarning)
                }
                buttonType="success"
                buttonSize="standard"
              >
                <ArrowDownTrayIcon aria-hidden="true" />
                {summary
                  ? intl.formatMessage(messages.close)
                  : intl.formatMessage(globalMessages.request)}
              </Button>
            </div>
          </RequestMediaCard>
        ) : (
          modalContent
        )}
      </Modal>
    </Transition>
  );
};

export default BulkRequestModal;
