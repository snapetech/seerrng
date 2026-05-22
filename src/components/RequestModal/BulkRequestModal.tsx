import Alert from '@app/components/Common/Alert';
import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import Modal from '@app/components/Common/Modal';
import type { RequestOverrides } from '@app/components/RequestModal/AdvancedRequester';
import AdvancedRequester from '@app/components/RequestModal/AdvancedRequester';
import QuotaDisplay from '@app/components/RequestModal/QuotaDisplay';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import { encodeApiPathSegment } from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
import { Transition } from '@headlessui/react';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import type Media from '@server/entity/Media';
import type {
  BulkMediaRequestResponse,
  BulkMediaRequestResult,
} from '@server/interfaces/api/requestInterfaces';
import type { QuotaResponse } from '@server/interfaces/api/userInterfaces';
import type { BookResult } from '@server/models/Book';
import axios from 'axios';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.RequestModal.BulkRequestModal', {
  requestbibliography: 'Request Bibliography',
  requestdiscography: 'Request Discography',
  requestitems: 'Request {count} {count, plural, one {Item} other {Items}}',
  selectitems: 'Select Items',
  requestadmin: 'This request will be approved automatically.',
  largeBatch:
    'You selected {count} items. Confirm once more before submitting this batch.',
  quotaexceeded: 'Not enough request quota remaining.',
  summary: '{created} created, {skipped} skipped, {failed} failed.',
  faileditems: 'Failed Items',
  retryfailed: 'Retry Failed',
  submittingprogress:
    'Submitting {processed} of {total} {total, plural, one {item} other {items}}.',
  close: 'Close',
  format: 'Format',
  ebook: 'Ebook',
  audiobook: 'Audiobook',
  both: 'Both',
  releasetype: 'Release Type',
  loadmore: 'Load More',
  available: 'Available',
  requested: 'Requested',
  blocklisted: 'Blocklisted',
  notrequested: 'Not Requested',
});

type BulkBookFormat = 'ebook' | 'audiobook' | 'both';
type BulkMediaType = 'music' | 'book';

type BulkItem = {
  id: string;
  title: string;
  year?: string | number;
  image?: string | null;
  artist?: string;
  isbn13?: string;
  editionId?: string;
  authorId?: string;
  mediaInfo?: Media;
  releaseType?: string;
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

interface BulkRequestModalProps {
  show: boolean;
  mediaType: BulkMediaType;
  title: string;
  artistId?: string;
  authorId?: string;
  initialItems?: BulkItem[];
  initialTotalItems?: number;
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

const dedupeBulkItems = (
  sourceItems: BulkItem[],
  mediaType: BulkMediaType
): BulkItem[] => {
  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();

  return sourceItems.filter((item) => {
    const idKey = item.id;
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

  if (format === 'both' && (ebookCovered || audiobookCovered)) {
    return messages.requested.defaultMessage;
  }

  return undefined;
};

const getMusicIneligibleReason = (item: BulkItem): string | undefined => {
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
  initialItems = EMPTY_BULK_ITEMS,
  initialTotalItems,
  onCancel,
  onComplete,
}: BulkRequestModalProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { user, hasPermission } = useUser();
  const [format, setFormat] = useState<BulkBookFormat>('ebook');
  const [releaseType, setReleaseType] = useState('Album');
  const [items, setItems] = useState<BulkItem[]>(
    dedupeBulkItems(initialItems, mediaType)
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
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

  const { data: quota } = useSWR<QuotaResponse>(
    user &&
      (!requestOverrides?.user?.id || hasPermission(Permission.MANAGE_USERS))
      ? `/api/v1/user/${requestOverrides?.user?.id ?? user.id}/quota`
      : null
  );

  useEffect(() => {
    setItems(dedupeBulkItems(initialItems, mediaType));
    setAuthorOffset(initialItems.length);
    setAuthorTotal(initialTotalItems);
  }, [initialItems, initialTotalItems, mediaType]);

  useEffect(() => {
    let canceled = false;

    const loadInitialAuthorWorks = async () => {
      if (!show || mediaType !== 'book' || !authorId) {
        return;
      }

      setIsLoadingItems(true);

      try {
        const works: BookResult[] = [];
        const limit = 100;
        let offset = 0;
        let totalItems = 0;
        let nextOffset = 0;

        do {
          const response = await axios.get<AuthorWorksResponse>(
            `/api/v1/author/${encodeApiPathSegment(authorId)}/works`,
            { params: { limit, offset } }
          );

          works.push(...response.data.works);
          totalItems = response.data.pagination.totalItems;
          nextOffset =
            response.data.pagination.nextOffset ??
            offset + response.data.pagination.limit;
          offset = nextOffset;
        } while (offset < totalItems && nextOffset > 0);

        const worksById = new Map<string, BookResult>();
        works.forEach((work) => worksById.set(work.id, work));

        if (canceled) {
          return;
        }

        setAuthorOffset(totalItems);
        setAuthorTotal(totalItems);
        setItems(
          dedupeBulkItems(
            [...worksById.values()].map(mapBookWorkToBulkItem),
            mediaType
          )
        );
      } catch {
        if (!canceled) {
          setItems(dedupeBulkItems(initialItems, mediaType));
        }
      } finally {
        if (!canceled) {
          setIsLoadingItems(false);
        }
      }
    };

    loadInitialAuthorWorks();

    return () => {
      canceled = true;
    };
  }, [authorId, initialItems, mediaType, show]);

  useEffect(() => {
    let canceled = false;

    const loadArtistType = async () => {
      if (!show || mediaType !== 'music' || !artistId) {
        return;
      }

      setIsLoadingItems(true);

      try {
        const releaseGroups: ArtistResponse['releaseGroups'] = [];
        let page = 1;
        let totalPages = 1;

        do {
          const response = await axios.get<ArtistResponse>(
            `/api/v1/artist/${encodeApiPathSegment(artistId)}`,
            {
              params: { albumType: releaseType, page, pageSize: 50 },
            }
          );

          releaseGroups.push(...response.data.releaseGroups);
          totalPages = response.data.pagination?.totalPages ?? 1;
          page += 1;
        } while (page <= totalPages);

        const releaseGroupsById = new Map<
          string,
          ArtistResponse['releaseGroups'][number]
        >();
        releaseGroups.forEach((album) =>
          releaseGroupsById.set(album.id, album)
        );

        if (canceled) {
          return;
        }

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
                album.secondary_types?.[0] ?? album['primary-type'] ?? 'Other',
            })),
            mediaType
          )
        );
      } catch {
        if (!canceled) {
          setItems(dedupeBulkItems(initialItems, mediaType));
        }
      } finally {
        if (!canceled) {
          setIsLoadingItems(false);
        }
      }
    };

    loadArtistType();

    return () => {
      canceled = true;
    };
  }, [artistId, initialItems, mediaType, releaseType, show]);

  const getIneligibleReason = useCallback(
    (item: BulkItem): string | undefined =>
      mediaType === 'book'
        ? getBookIneligibleReason(item, format)
        : getMusicIneligibleReason(item),
    [format, mediaType]
  );

  const eligibleItems = useMemo(
    () => items.filter((item) => !getIneligibleReason(item)),
    [getIneligibleReason, items]
  );

  useEffect(() => {
    setSelectedIds(eligibleItems.map((item) => item.id));
  }, [eligibleItems]);

  const selectedItems = items.filter((item) => selectedIds.includes(item.id));
  const currentQuota = mediaType === 'book' ? quota?.book : quota?.music;
  const remaining =
    currentQuota?.remaining !== undefined
      ? currentQuota.remaining - selectedIds.length
      : undefined;
  const selectedExceedsQuota =
    !!currentQuota?.limit && remaining !== undefined && remaining < 0;
  const hasAutoApprove = hasPermission(
    [
      Permission.MANAGE_REQUESTS,
      Permission.AUTO_APPROVE,
      mediaType === 'book'
        ? Permission.AUTO_APPROVE_BOOK
        : Permission.AUTO_APPROVE_MUSIC,
    ],
    { type: 'or' }
  );

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
    if (!authorId || isLoadingItems) {
      return;
    }

    const response = await axios.get<AuthorWorksResponse>(
      `/api/v1/author/${encodeApiPathSegment(authorId)}/works`,
      { params: { limit: 20, offset: authorOffset } }
    );

    const nextOffset =
      response.data.pagination.nextOffset ??
      authorOffset + response.data.pagination.limit;
    setAuthorOffset(nextOffset);
    setAuthorTotal(response.data.pagination.totalItems);
    setItems((current) => {
      return dedupeBulkItems(
        [...current, ...response.data.works.map(mapBookWorkToBulkItem)],
        mediaType
      );
    });
  };

  const hasMoreAuthorWorks =
    mediaType === 'book' &&
    !!authorId &&
    (authorTotal === undefined || authorOffset < authorTotal);

  const submit = async () => {
    if (selectedExceedsQuota) {
      addToast(intl.formatMessage(messages.quotaexceeded), {
        appearance: 'error',
        autoDismiss: true,
      });
      return;
    }

    if (selectedIds.length > 50 && !confirmLargeBatch) {
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
            serverId: requestOverrides?.server,
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
    <div className="mt-4 max-h-48 overflow-y-auto rounded-md border border-gray-700">
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

  return (
    <Transition
      as="div"
      enter="transition-opacity duration-300"
      enterFrom="opacity-0"
      enterTo="opacity-100"
      leave="transition-opacity duration-300"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
      show={show}
    >
      <Modal
        loading={!quota}
        title={intl.formatMessage(
          mediaType === 'book'
            ? messages.requestbibliography
            : messages.requestdiscography
        )}
        subTitle={title}
        onCancel={onCancel}
        onOk={summary ? onCancel : submit}
        okText={
          summary
            ? intl.formatMessage(messages.close)
            : isUpdating
              ? intl.formatMessage(globalMessages.requesting)
              : selectedIds.length === 0
                ? intl.formatMessage(messages.selectitems)
                : intl.formatMessage(messages.requestitems, {
                    count: selectedIds.length,
                  })
        }
        okDisabled={
          !summary &&
          (isUpdating || selectedIds.length === 0 || selectedExceedsQuota)
        }
        dialogClass="sm:max-w-5xl"
      >
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
            {hasAutoApprove && !currentQuota?.restricted && (
              <div className="mt-6">
                <Alert
                  title={intl.formatMessage(messages.requestadmin)}
                  type="info"
                />
              </div>
            )}
            {confirmLargeBatch && (
              <div className="mt-6">
                <Alert
                  title={intl.formatMessage(messages.largeBatch, {
                    count: selectedIds.length,
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
                  requestOverrides?.user &&
                  requestOverrides.user.id !== user?.id
                    ? requestOverrides.user.id
                    : undefined
                }
              />
            )}
            <div className="mt-6 flex flex-wrap items-end gap-4">
              {mediaType === 'book' ? (
                <label className="w-48">
                  <span>{intl.formatMessage(messages.format)}</span>
                  <select
                    className="mt-1 border-gray-700 bg-gray-800"
                    value={format}
                    onChange={(e) =>
                      setFormat(e.target.value as BulkBookFormat)
                    }
                  >
                    <option value="ebook">
                      {intl.formatMessage(messages.ebook)}
                    </option>
                    <option value="audiobook">
                      {intl.formatMessage(messages.audiobook)}
                    </option>
                    <option value="both">
                      {intl.formatMessage(messages.both)}
                    </option>
                  </select>
                </label>
              ) : (
                <label className="w-48">
                  <span>{intl.formatMessage(messages.releasetype)}</span>
                  <select
                    className="mt-1 border-gray-700 bg-gray-800"
                    value={releaseType}
                    onChange={(e) => setReleaseType(e.target.value)}
                  >
                    {releaseTypeOptions.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <Button buttonType="ghost" onClick={toggleAll}>
                {intl.formatMessage(messages.selectitems)}
              </Button>
            </div>
            <div className="mt-4 overflow-hidden border border-gray-700 sm:rounded-lg">
              <table className="min-w-full">
                <tbody className="divide-y divide-gray-700">
                  {items.map((item) => {
                    const reason = getIneligibleReason(item);
                    const selected = selectedIds.includes(item.id);

                    return (
                      <tr
                        key={item.id}
                        className={reason ? 'opacity-60' : 'cursor-pointer'}
                        onClick={() => toggleItem(item)}
                      >
                        <td className="w-16 px-4 py-3">
                          <span
                            role="checkbox"
                            aria-checked={selected}
                            className={`relative inline-flex h-5 w-10 items-center pt-2 ${
                              reason ? 'opacity-50' : ''
                            }`}
                          >
                            <span
                              className={`absolute h-4 w-9 rounded-full ${
                                selected ? 'bg-indigo-500' : 'bg-gray-700'
                              }`}
                            />
                            <span
                              className={`absolute left-0 h-5 w-5 rounded-full border border-gray-200 bg-white transition-transform ${
                                selected ? 'translate-x-5' : 'translate-x-0'
                              }`}
                            />
                          </span>
                        </td>
                        <td className="flex items-center px-2 py-3">
                          <div className="relative h-16 w-11 flex-shrink-0 overflow-hidden rounded-md bg-gray-900">
                            <CachedImage
                              type={mediaType === 'book' ? 'book' : 'music'}
                              src={
                                item.image ??
                                '/images/seerr_poster_not_found.png'
                              }
                              alt=""
                              fill
                              style={{ objectFit: 'cover' }}
                            />
                          </div>
                          <div className="min-w-0 pl-3">
                            <div className="truncate font-semibold text-white">
                              {item.title}
                            </div>
                            <div className="truncate text-sm text-gray-300">
                              {[item.artist, item.year]
                                .filter(Boolean)
                                .join(' - ')}
                            </div>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          {reason ? (
                            <Badge badgeType="warning">{reason}</Badge>
                          ) : (
                            <Badge>
                              {intl.formatMessage(messages.notrequested)}
                            </Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {hasMoreAuthorWorks && (
              <div className="mt-4">
                <Button buttonType="ghost" onClick={loadMoreAuthorWorks}>
                  {intl.formatMessage(messages.loadmore)}
                </Button>
              </div>
            )}
            {(hasPermission(Permission.REQUEST_ADVANCED) ||
              hasPermission(Permission.MANAGE_REQUESTS)) && (
              <AdvancedRequester
                type={mediaType}
                is4k={false}
                bookFormat={mediaType === 'book' ? format : undefined}
                onChange={(overrides) => setRequestOverrides(overrides)}
              />
            )}
          </>
        )}
      </Modal>
    </Transition>
  );
};

export default BulkRequestModal;
