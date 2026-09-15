import Alert from '@app/components/Common/Alert';
import CachedImage from '@app/components/Common/CachedImage';
import Modal from '@app/components/Common/Modal';
import SelectionCircle from '@app/components/Common/SelectionCircle';
import QuotaDisplay from '@app/components/RequestModal/QuotaDisplay';
import RequestMediaCard from '@app/components/RequestModal/RequestMediaCard';
import useToasts from '@app/hooks/useToasts';
import { useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import { orderCollectionPartsOldestFirst } from '@app/utils/collectionPlaybackSelection';
import {
  getCollectionPartRequestPresentation,
  getCoveredCollectionPartIds,
} from '@app/utils/collectionRequestState';
import { mapWithConcurrency } from '@app/utils/concurrency';
import defineMessages from '@app/utils/defineMessages';
import { getTmdbPosterImageUrl } from '@app/utils/imageCache';
import { MediaStatus } from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { QuotaResponse } from '@server/interfaces/api/userInterfaces';
import { Permission } from '@server/lib/permissions';
import type { Collection } from '@server/models/Collection';
import axios from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.RequestModal', {
  requestadmin: 'This request will be approved automatically.',
  requestSuccess: '<strong>{title}</strong> requested successfully!',
  requestcollectiontitle: 'Request Collection',
  requestcollection4ktitle: 'Request Collection in 4K',
  requesterror: 'Something went wrong while submitting the request.',
  requestpartial: '{created} requested; {failed} failed.',
  selectmovies: 'Select Movie(s)',
  requestmovies: 'Request {count} {count, plural, one {Movie} other {Movies}}',
  requestmovies4k:
    'Request {count} {count, plural, one {Movie} other {Movies}} in 4K',
  selection: 'Select this movie to request',
  selectAll: 'Select every movie that is ready to request',
  status: 'Status',
  readyToRequest: 'Ready to Request',
  requested: 'Requested',
  available: 'Available',
  blocklisted: 'Blocklisted',
});

const COLLECTION_REQUEST_CONCURRENCY = 5;

interface RequestModalProps extends React.HTMLAttributes<HTMLDivElement> {
  tmdbId: number;
  is4k?: boolean;
  onCancel?: () => void;
  onComplete?: (newStatus: MediaStatus, is4k?: boolean) => void;
  onUpdating?: (isUpdating: boolean) => void;
}

const CollectionRequestModal = ({
  onCancel,
  onComplete,
  tmdbId,
  onUpdating,
  is4k = false,
}: RequestModalProps) => {
  const [isUpdating, setIsUpdating] = useState(false);
  const [selectedParts, setSelectedParts] = useState<number[]>([]);
  const mountedRef = useRef(true);
  const submissionActiveRef = useRef(false);
  const { addToast } = useToasts();
  const {
    data,
    error,
    mutate: revalidateCollection,
  } = useSWR<Collection>(`/api/v1/collection/${tmdbId}`, {
    revalidateOnMount: true,
  });
  const intl = useIntl();
  const { user, hasPermission } = useUser();
  const { data: quota } = useSWR<QuotaResponse>(
    user ? `/api/v1/user/${user.id}/quota` : null
  );

  const currentlyRemaining =
    (quota?.movie.remaining ?? 0) - selectedParts.length;

  const getAllParts = (): number[] => {
    return (data?.parts ?? [])
      .filter(
        (part) =>
          part.mediaInfo?.[is4k ? 'status4k' : 'status'] !==
          MediaStatus.BLOCKLISTED
      )
      .map((part) => part.id);
  };

  const getAllRequestedParts = (): number[] =>
    getCoveredCollectionPartIds(data?.parts ?? [], is4k);

  const isSelectedPart = (tmdbId: number): boolean =>
    selectedParts.includes(tmdbId);

  const togglePart = (tmdbId: number): void => {
    // If this part already has a pending request, don't allow it to be toggled
    if (getAllRequestedParts().includes(tmdbId)) {
      return;
    }

    // If there are no more remaining requests available, block toggle
    if (
      quota?.movie.limit &&
      currentlyRemaining <= 0 &&
      !isSelectedPart(tmdbId)
    ) {
      return;
    }

    if (selectedParts.includes(tmdbId)) {
      setSelectedParts((parts) => parts.filter((partId) => partId !== tmdbId));
    } else {
      setSelectedParts((parts) => [...parts, tmdbId]);
    }
  };

  const unrequestedParts = getAllParts().filter(
    (tmdbId) => !getAllRequestedParts().includes(tmdbId)
  );

  const toggleAllParts = (): void => {
    // If the user has a quota and not enough requests for all parts, block toggleAllParts
    if (
      quota?.movie.limit &&
      (quota?.movie.remaining ?? 0) < unrequestedParts.length
    ) {
      return;
    }

    if (
      data &&
      selectedParts.length >= 0 &&
      selectedParts.length < unrequestedParts.length
    ) {
      setSelectedParts(unrequestedParts);
    } else {
      setSelectedParts([]);
    }
  };

  const isAllParts = (): boolean => {
    if (!data) {
      return false;
    }

    return (
      selectedParts.length ===
      getAllParts().filter((part) => !getAllRequestedParts().includes(part))
        .length
    );
  };

  useEffect(() => {
    if (onUpdating) {
      onUpdating(isUpdating);
    }
  }, [isUpdating, onUpdating]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const sendRequest = useCallback(async () => {
    if (submissionActiveRef.current) {
      return;
    }
    submissionActiveRef.current = true;
    setIsUpdating(true);

    try {
      const parts =
        data?.parts.filter((part) => selectedParts.includes(part.id)) ?? [];
      const outcomes = await mapWithConcurrency(
        parts,
        COLLECTION_REQUEST_CONCURRENCY,
        async (part) => {
          try {
            await axios.post<MediaRequest>('/api/v1/request', {
              mediaId: part.id,
              mediaType: 'movie',
              is4k,
            });
            return { id: part.id, succeeded: true } as const;
          } catch {
            return { id: part.id, succeeded: false } as const;
          }
        }
      );
      const succeededIds = new Set(
        outcomes
          .filter((outcome) => outcome.succeeded)
          .map((outcome) => outcome.id)
      );
      const failedIds = outcomes
        .filter((outcome) => !outcome.succeeded)
        .map((outcome) => outcome.id);
      const failedCount = outcomes.length - succeededIds.size;

      if (succeededIds.size > 0) {
        void mutate('/api/v1/request/count').catch(() => undefined);
      }

      if (succeededIds.size > 0 && failedCount > 0) {
        await revalidateCollection().catch(() => undefined);
        if (mountedRef.current) {
          setSelectedParts(failedIds);
        }
      }

      if (
        mountedRef.current &&
        onComplete &&
        succeededIds.size > 0 &&
        failedCount === 0
      ) {
        const coveredIds = new Set(
          getCoveredCollectionPartIds(data?.parts ?? [], is4k)
        );
        succeededIds.forEach((id) => coveredIds.add(id));
        const requestableCollectionIds = (data?.parts ?? [])
          .filter(
            (part) =>
              part.mediaInfo?.[is4k ? 'status4k' : 'status'] !==
              MediaStatus.BLOCKLISTED
          )
          .map((part) => part.id);
        onComplete(
          requestableCollectionIds.every((id) => coveredIds.has(id))
            ? MediaStatus.UNKNOWN
            : MediaStatus.PARTIALLY_AVAILABLE,
          is4k
        );
      }

      if (mountedRef.current) {
        if (failedCount === 0) {
          addToast(
            <span>
              {intl.formatMessage(messages.requestSuccess, {
                title: data?.name,
                strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
              })}
            </span>,
            { appearance: 'success', autoDismiss: true }
          );
        } else if (succeededIds.size > 0) {
          addToast(
            intl.formatMessage(messages.requestpartial, {
              created: succeededIds.size,
              failed: failedCount,
            }),
            { appearance: 'warning' }
          );
        } else {
          addToast(intl.formatMessage(messages.requesterror), {
            appearance: 'error',
            autoDismiss: true,
          });
        }
      }
    } catch {
      if (mountedRef.current) {
        addToast(intl.formatMessage(messages.requesterror), {
          appearance: 'error',
          autoDismiss: true,
        });
      }
    } finally {
      submissionActiveRef.current = false;
      if (mountedRef.current) {
        setIsUpdating(false);
      }
    }
  }, [
    data?.parts,
    data?.name,
    onComplete,
    addToast,
    intl,
    selectedParts,
    is4k,
    revalidateCollection,
  ]);

  const hasAutoApprove = hasPermission(
    [
      Permission.MANAGE_REQUESTS,
      is4k ? Permission.AUTO_APPROVE_4K : Permission.AUTO_APPROVE,
      is4k ? Permission.AUTO_APPROVE_4K_MOVIE : Permission.AUTO_APPROVE_MOVIE,
    ],
    { type: 'or' }
  );

  const blocklistVisibility = hasPermission(
    [Permission.MANAGE_BLOCKLIST, Permission.VIEW_BLOCKLIST],
    { type: 'or' }
  );
  const visibleParts = orderCollectionPartsOldestFirst(
    data?.parts ?? []
  ).filter(
    (part) =>
      blocklistVisibility ||
      getCollectionPartRequestPresentation(part, is4k) !== 'blocklisted'
  );
  const selectAllDisabled =
    unrequestedParts.length === 0 ||
    (!!quota?.movie.limit &&
      (quota.movie.remaining ?? 0) < unrequestedParts.length);

  return (
    <Modal
      loading={(!data && !error) || !quota}
      backgroundClickable
      onCancel={onCancel}
      onOk={sendRequest}
      title={intl.formatMessage(
        is4k
          ? messages.requestcollection4ktitle
          : messages.requestcollectiontitle
      )}
      subTitle={data?.name}
      okText={
        isUpdating
          ? intl.formatMessage(globalMessages.requesting)
          : selectedParts.length === 0
            ? intl.formatMessage(messages.selectmovies)
            : intl.formatMessage(
                is4k ? messages.requestmovies4k : messages.requestmovies,
                {
                  count: selectedParts.length,
                }
              )
      }
      okDisabled={selectedParts.length === 0 || isUpdating}
      cancelButtonType="danger"
      okButtonType="success"
      dialogClass="request-modal-site-surface sm:max-w-5xl"
    >
      {hasAutoApprove && !quota?.movie.restricted && (
        <div className="mt-6">
          <Alert
            title={intl.formatMessage(messages.requestadmin)}
            type="info"
          />
        </div>
      )}
      {(quota?.movie.limit ?? 0) > 0 && (
        <QuotaDisplay
          mediaType="movie"
          quota={quota?.movie}
          remaining={currentlyRemaining}
        />
      )}
      <RequestMediaCard
        artwork={
          data?.backdropPath
            ? `https://image.tmdb.org/t/p/original${data.backdropPath}`
            : getTmdbPosterImageUrl(data?.posterPath, 'original')
        }
        artworkType="tmdb"
      >
        <div className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)] gap-3 sm:grid-cols-[80px_minmax(0,1fr)]">
          <div className="relative h-24 w-16 overflow-hidden rounded-lg ring-1 ring-gray-600 sm:h-[120px] sm:w-20">
            <CachedImage
              type="tmdb"
              src={
                getTmdbPosterImageUrl(data?.posterPath) ||
                '/images/seerr_poster_not_found.png'
              }
              alt=""
              fill
              sizes="(min-width: 640px) 80px, 64px"
              className="object-cover"
            />
          </div>
          <div className="min-w-0">
            <h3 className="-mt-0.5 truncate text-lg leading-5 font-semibold text-white">
              {data?.name}
            </h3>
            <p className="refreshed-detail-text mt-1 text-xs">
              {intl.formatMessage(messages.requestmovies, {
                count: visibleParts.length,
              })}
            </p>
          </div>
        </div>

        <section className="refreshed-inset-surface mt-3 overflow-hidden rounded-lg border border-gray-700 p-2">
          <div className="request-divider-dark grid grid-cols-[2rem_minmax(0,1fr)_8rem] items-center gap-x-2 border-b px-1 pb-2 text-xs font-semibold text-gray-200">
            <SelectionCircle
              disabled={selectAllDisabled}
              onClick={toggleAllParts}
              selected={isAllParts() && unrequestedParts.length > 0}
              label={intl.formatMessage(messages.selectAll)}
            />
            <span>{intl.formatMessage(globalMessages.movie)}</span>
            <span>{intl.formatMessage(messages.status)}</span>
          </div>
          <div className="scrollable-card -mr-3 max-h-[312px] space-y-1 overflow-y-auto pt-1 pr-3">
            {visibleParts.map((part) => {
              const presentation = getCollectionPartRequestPresentation(
                part,
                is4k
              );
              const selected = isSelectedPart(part.id);
              const quotaBlocked =
                !!quota?.movie.limit && currentlyRemaining <= 0 && !selected;
              const selectionDisabled =
                presentation !== 'ready' || quotaBlocked;
              const statusLabel =
                presentation === 'available'
                  ? messages.available
                  : presentation === 'requested'
                    ? messages.requested
                    : presentation === 'blocklisted'
                      ? messages.blocklisted
                      : messages.readyToRequest;
              const statusTone =
                presentation === 'available'
                  ? 'text-green-400'
                  : presentation === 'ready'
                    ? 'text-yellow-300'
                    : presentation === 'blocklisted'
                      ? 'text-red-400'
                      : 'text-indigo-300';

              return (
                <div
                  key={`part-${part.id}`}
                  className="refreshed-inset-surface grid min-h-[58px] grid-cols-[2rem_40px_minmax(0,1fr)_8rem] items-center gap-x-2 rounded-lg border border-gray-700 px-2 py-1.5"
                >
                  <SelectionCircle
                    disabled={selectionDisabled}
                    onClick={() => togglePart(part.id)}
                    selected={selected}
                    label={intl.formatMessage(messages.selection)}
                  />
                  <div className="relative h-[52px] w-10 overflow-hidden rounded-md ring-1 ring-gray-700">
                    <CachedImage
                      type="tmdb"
                      src={
                        part.posterPath
                          ? getTmdbPosterImageUrl(part.posterPath)
                          : '/images/seerr_poster_not_found.png'
                      }
                      alt=""
                      fill
                      sizes="40px"
                      className="object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-gray-100">
                      {part.title}
                    </div>
                    <div className="refreshed-detail-text text-xs">
                      {part.releaseDate?.slice(0, 4) || '—'} ·{' '}
                      {is4k ? '4K' : 'HD'}
                    </div>
                  </div>
                  <dl className="grid min-w-0 grid-cols-1 text-xs leading-4">
                    <dt className="font-medium text-gray-100">
                      {intl.formatMessage(messages.status)}:
                    </dt>
                    <dd className={`m-0 truncate font-medium ${statusTone}`}>
                      {intl.formatMessage(statusLabel)}
                    </dd>
                  </dl>
                </div>
              );
            })}
          </div>
        </section>
      </RequestMediaCard>
    </Modal>
  );
};

export default CollectionRequestModal;
