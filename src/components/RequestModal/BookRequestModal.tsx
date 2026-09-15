import Alert from '@app/components/Common/Alert';
import { getBookFormatMessage } from '@app/components/Common/BookFormatBadge';
import BookFormatSelector from '@app/components/Common/BookFormatSelector';
import CachedImage from '@app/components/Common/CachedImage';
import Modal from '@app/components/Common/Modal';
import type { RequestOverrides } from '@app/components/RequestModal/AdvancedRequester';
import AdvancedRequester from '@app/components/RequestModal/AdvancedRequester';
import QuotaDisplay from '@app/components/RequestModal/QuotaDisplay';
import RequestFooterStatus from '@app/components/RequestModal/RequestFooterStatus';
import RequestMediaCard from '@app/components/RequestModal/RequestMediaCard';
import {
  canPromotePendingDestinationRequests,
  createRequestDestination,
  isRequestDestinationAvailable,
  isRequestDestinationRequested,
} from '@app/components/RequestModal/requestAvailability';
import useToasts from '@app/hooks/useToasts';
import { useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import {
  encodeApiPathSegment,
  normalizeOpenLibraryWorkId,
} from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
import {
  AdjustmentsHorizontalIcon,
  ArrowDownTrayIcon,
  ChevronDownIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { NonFunctionProperties } from '@server/interfaces/api/common';
import type { ServiceCommonServer } from '@server/interfaces/api/serviceInterfaces';
import type { QuotaResponse } from '@server/interfaces/api/userInterfaces';
import { Permission, hasAutoApprovePermission } from '@server/lib/permissions';
import type { BookDetails } from '@server/models/Book';
import axios from 'axios';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.RequestModal.Book', {
  requestSuccessWithFormat:
    '<strong>{title}</strong> requested successfully as {format}.',
  requestCancel: 'Request for <strong>{title}</strong> canceled.',
  requestEdited: 'Request for <strong>{title}</strong> edited successfully!',
  requestApproved: 'Request for <strong>{title}</strong> approved!',
  requestbook: 'Request Book',
  requestBookFormat: 'Request {format}',
  pendingrequest: 'Pending Book Request',
  pendingRequestFormat: 'Pending {format} Request',
  edit: 'Edit Request',
  approve: 'Approve Request',
  cancel: 'Cancel Request',
  close: 'Close',
  pendingapproval: 'Your request is pending approval.',
  requestfrom: "{username}'s request is pending approval.",
  requesterror: 'Something went wrong while submitting the request.',
  backendRequestFailed:
    'The request was submitted, but Bookshelf rejected it while processing.',
  editerror: 'Something went wrong while editing the request.',
  bothDefaultInfo:
    'Book + Audiobook uses your default Book and Audiobook Bookshelf services. Choose a single format to override server, profile, folder, or tags.',
  edition: 'Edition / ISBN',
  automaticEdition: 'Automatic best match',
  automaticEditionInfo:
    'Automatic uses the first valid ISBN from Open Library. Pick a specific edition when testers report a mismatch.',
  noIsbnCandidates:
    'No valid ISBN candidates were found. Bookshelf will fall back to title matching.',
  noEbookServer:
    'No Book Bookshelf service is configured. Book requests are unavailable.',
  noAudiobookServer:
    'No audiobook Bookshelf service is configured. Audiobook requests are unavailable.',
  noBothServers:
    'Book + Audiobook requires Book and Audiobook Bookshelf services to be configured.',
  ebook: 'Book',
  audiobook: 'Audiobook',
  ebookAndAudiobook: 'Book and Audiobook',
  mediaAndFormat: 'Media & Format',
  firstPublished: 'First Published',
  pages: 'Pages',
  genres: 'Genres',
  author: 'Author',
  publisher: 'Publisher',
  status: 'Status',
  service: 'Service',
  approval: 'Approval',
  readyToRequest: 'Ready to Request',
  requested: 'Requested',
  notAvailable: 'Not Available',
  advancedOptions: 'Advanced Options',
});

interface BookRequestModalProps {
  bookId: string;
  initialBookFormat?: 'ebook' | 'audiobook' | 'both';
  onCancel?: () => void;
  onComplete?: (newStatus: MediaStatus) => void;
  onUpdating?: (isUpdating: boolean) => void;
  editRequest?: NonFunctionProperties<MediaRequest>;
}

const BookRequestModal = ({
  bookId,
  initialBookFormat = 'ebook',
  onCancel,
  onComplete,
  onUpdating,
  editRequest,
}: BookRequestModalProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { user, hasPermission } = useUser();
  const [isUpdating, setIsUpdating] = useState(false);
  const [bookFormat, setBookFormat] = useState<'ebook' | 'audiobook' | 'both'>(
    editRequest?.bookFormat ?? initialBookFormat
  );
  const [hasUserSelectedFormat, setHasUserSelectedFormat] = useState(false);
  const [selectedIsbn, setSelectedIsbn] = useState<string>('');
  const [requestOverrides, setRequestOverrides] =
    useState<RequestOverrides | null>(null);
  const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(true);
  const [requestedByPortal, setRequestedByPortal] =
    useState<HTMLDivElement | null>(null);
  const normalizedBookId = normalizeOpenLibraryWorkId(bookId);
  const { data, error } = useSWR<BookDetails>(
    `/api/v1/book/${encodeApiPathSegment(normalizedBookId)}`,
    {
      revalidateOnMount: true,
    }
  );
  const { data: bookServices } = useSWR<ServiceCommonServer[]>(
    '/api/v1/service/readarr'
  );
  const selectedService = bookServices?.find(
    (server) => server.id === requestOverrides?.server
  );
  const defaultEbookService = bookServices?.find(
    (server) => server.isDefault && (server.serviceType ?? 'ebook') === 'ebook'
  );
  const defaultAudiobookService = bookServices?.find(
    (server) => server.isDefault && server.serviceType === 'audiobook'
  );
  const ebookDestination = createRequestDestination(
    'readarr',
    'ebook',
    bookFormat === 'ebook'
      ? (selectedService ?? defaultEbookService)
      : defaultEbookService,
    bookFormat === 'ebook' ? requestOverrides : null
  );
  const audiobookDestination = createRequestDestination(
    'readarr',
    'audiobook',
    bookFormat === 'audiobook'
      ? (selectedService ?? defaultAudiobookService)
      : defaultAudiobookService,
    bookFormat === 'audiobook' ? requestOverrides : null
  );
  const selectedDestinations =
    bookFormat === 'both'
      ? [ebookDestination, audiobookDestination]
      : bookFormat === 'audiobook'
        ? [audiobookDestination]
        : [ebookDestination];
  const destinationAvailable = (format: 'ebook' | 'audiobook') => {
    const target = format === 'ebook' ? ebookDestination : audiobookDestination;
    const externalServiceId =
      format === 'ebook'
        ? data?.mediaInfo?.externalServiceId
        : data?.mediaInfo?.audiobookExternalServiceId;
    const serviceId =
      format === 'ebook'
        ? data?.mediaInfo?.serviceId
        : data?.mediaInfo?.audiobookServiceId;

    return isRequestDestinationAvailable(
      data?.mediaInfo
        ? {
            ...data.mediaInfo,
            status:
              data.mediaInfo.status === MediaStatus.AVAILABLE &&
              externalServiceId != null
                ? MediaStatus.AVAILABLE
                : MediaStatus.UNKNOWN,
            serviceId,
          }
        : undefined,
      target
    );
  };
  const selectedDestinationAvailable =
    !editRequest &&
    selectedDestinations.length > 0 &&
    selectedDestinations.every(
      (target) =>
        !!target && destinationAvailable(target.format as 'ebook' | 'audiobook')
    );
  const selectedDestinationFullyCovered =
    !editRequest &&
    selectedDestinations.length > 0 &&
    selectedDestinations.every(
      (target) =>
        !!target &&
        (destinationAvailable(target.format as 'ebook' | 'audiobook') ||
          isRequestDestinationRequested(data?.mediaInfo?.requests, target))
    );
  const selectedDestinationRequested =
    selectedDestinationFullyCovered && !selectedDestinationAvailable;
  const requestedDestinations = selectedDestinations.filter(
    (target) =>
      !!target &&
      !destinationAvailable(target.format as 'ebook' | 'audiobook') &&
      isRequestDestinationRequested(data?.mediaInfo?.requests, target)
  );
  const selectedDestinationPromotable =
    selectedDestinationRequested &&
    canPromotePendingDestinationRequests(
      data?.mediaInfo?.requests,
      requestedDestinations,
      {
        canManageRequests: hasPermission(Permission.MANAGE_REQUESTS),
        hasAutoApprove: hasAutoApprovePermission(
          user?.permissions ?? 0,
          'book'
        ),
      }
    );
  const selectedDestinationCovered =
    selectedDestinationFullyCovered && !selectedDestinationPromotable;
  const { data: quota } = useSWR<QuotaResponse>(
    user &&
      (!requestOverrides?.user?.id ||
        hasPermission([Permission.MANAGE_REQUESTS, Permission.MANAGE_USERS], {
          type: 'or',
        }))
      ? `/api/v1/user/${requestOverrides?.user?.id ?? user.id}/quota`
      : null
  );

  useEffect(() => {
    setBookFormat(editRequest?.bookFormat ?? initialBookFormat);
    setHasUserSelectedFormat(false);
    setSelectedIsbn('');
    setRequestOverrides(null);
  }, [bookId, editRequest?.bookFormat, editRequest?.id, initialBookFormat]);

  const hasEbookServer = (bookServices ?? []).some(
    (service) => (service.serviceType ?? 'ebook') === 'ebook'
  );
  const hasAudiobookServer = (bookServices ?? []).some(
    (service) => service.serviceType === 'audiobook'
  );
  const formatAvailable = useMemo(
    () => ({
      ebook: hasEbookServer,
      audiobook: hasAudiobookServer,
      both: hasEbookServer && hasAudiobookServer,
    }),
    [hasAudiobookServer, hasEbookServer]
  );

  useEffect(() => {
    if (!bookServices) {
      return;
    }

    if (formatAvailable[bookFormat]) {
      return;
    }

    if (hasEbookServer) {
      setBookFormat('ebook');
    } else if (hasAudiobookServer) {
      setBookFormat('audiobook');
    }
  }, [
    bookFormat,
    bookServices,
    formatAvailable,
    hasAudiobookServer,
    hasEbookServer,
  ]);

  useEffect(() => {
    if (editRequest || hasUserSelectedFormat || !data?.mediaInfo) {
      return;
    }

    const hasEbookServiceLink =
      data.mediaInfo.serviceId !== null &&
      data.mediaInfo.serviceId !== undefined &&
      data.mediaInfo.externalServiceId !== null &&
      data.mediaInfo.externalServiceId !== undefined;
    const hasAudiobookServiceLink =
      data.mediaInfo.audiobookServiceId !== null &&
      data.mediaInfo.audiobookServiceId !== undefined &&
      data.mediaInfo.audiobookExternalServiceId !== null &&
      data.mediaInfo.audiobookExternalServiceId !== undefined;
    const activeRequests =
      data.mediaInfo.requests?.filter(
        (request) =>
          request.status !== MediaRequestStatus.DECLINED &&
          request.status !== MediaRequestStatus.FAILED &&
          request.status !== MediaRequestStatus.COMPLETED
      ) ?? [];
    const hasActiveEbookRequest = activeRequests.some(
      (request) =>
        (request.bookFormat ?? 'ebook') === 'ebook' ||
        request.bookFormat === 'both'
    );
    const hasActiveAudiobookRequest = activeRequests.some(
      (request) =>
        request.bookFormat === 'audiobook' || request.bookFormat === 'both'
    );
    const ebookCovered = hasEbookServiceLink || hasActiveEbookRequest;
    const audiobookCovered =
      hasAudiobookServiceLink || hasActiveAudiobookRequest;

    if (ebookCovered && !audiobookCovered) {
      setBookFormat('audiobook');
    } else if (!ebookCovered && audiobookCovered) {
      setBookFormat('ebook');
    }
  }, [data?.mediaInfo, editRequest, hasUserSelectedFormat]);

  useEffect(() => {
    onUpdating?.(isUpdating);
  }, [isUpdating, onUpdating]);

  const hasAutoApprove = hasAutoApprovePermission(
    requestOverrides?.user?.permissions ?? user?.permissions ?? 0,
    'book'
  );

  const getOverrideParams = useCallback(() => {
    if (!requestOverrides) {
      return {};
    }

    if (bookFormat === 'both') {
      return {
        userId: requestOverrides.user?.id,
      };
    }

    return {
      serverId: requestOverrides.server,
      profileId: requestOverrides.profile,
      metadataProfileId: requestOverrides.metadataProfile,
      rootFolder: requestOverrides.folder,
      userId: requestOverrides.user?.id,
      tags: requestOverrides.tags,
    };
  }, [bookFormat, requestOverrides]);

  const handleBookFormatChange = (value: 'ebook' | 'audiobook' | 'both') => {
    if (bookServices && !formatAvailable[value]) {
      return;
    }

    setHasUserSelectedFormat(true);
    setBookFormat(value);
  };

  const formatWarning =
    bookServices && !formatAvailable[bookFormat]
      ? bookFormat === 'ebook'
        ? messages.noEbookServer
        : bookFormat === 'audiobook'
          ? messages.noAudiobookServer
          : messages.noBothServers
      : bookServices &&
          bookFormat === 'both' &&
          (!hasEbookServer || !hasAudiobookServer)
        ? messages.noBothServers
        : null;
  const formatLabel = intl.formatMessage(getBookFormatMessage(bookFormat));
  const requestLabel = intl.formatMessage(messages.requestBookFormat, {
    format: formatLabel,
  });
  const canUseAdvancedOptions = hasPermission(
    [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
    { type: 'or' }
  );
  const notAvailable = intl.formatMessage(messages.notAvailable);
  const serviceLabel =
    selectedService?.name ??
    (bookFormat === 'both'
      ? [defaultEbookService?.name, defaultAudiobookService?.name]
          .filter(Boolean)
          .join(' + ')
      : bookFormat === 'audiobook'
        ? defaultAudiobookService?.name
        : defaultEbookService?.name) ??
    notAvailable;
  const genres = data?.subjects?.slice(0, 3).join(', ') || notAvailable;
  const requestButtonLabel = isUpdating
    ? intl.formatMessage(globalMessages.requesting)
    : requestLabel;

  const sendRequest = useCallback(async () => {
    if (selectedDestinationCovered) {
      return;
    }

    setIsUpdating(true);

    try {
      const response = await axios.post<MediaRequest>('/api/v1/request', {
        mediaId: data?.id
          ? normalizeOpenLibraryWorkId(data.id)
          : normalizedBookId,
        mediaType: MediaType.BOOK,
        isbn13: selectedIsbn || data?.isbn13,
        editionId:
          data?.isbnCandidates?.find(
            (candidate) => candidate.isbn === selectedIsbn
          )?.editionId ?? data?.editionId,
        authorId: data?.authorId,
        format: bookFormat,
        ...getOverrideParams(),
      });

      mutate('/api/v1/request?filter=all&take=10&sort=modified&skip=0');
      mutate('/api/v1/request/count');

      if (response.data) {
        if (response.data.status === MediaRequestStatus.FAILED) {
          addToast(intl.formatMessage(messages.backendRequestFailed), {
            appearance: 'error',
            autoDismiss: true,
          });
          return;
        }

        onComplete?.(
          response.data.status === MediaRequestStatus.APPROVED
            ? MediaStatus.PROCESSING
            : MediaStatus.PENDING
        );
        const formatLabel =
          bookFormat === 'ebook'
            ? intl.formatMessage(messages.ebook)
            : bookFormat === 'audiobook'
              ? intl.formatMessage(messages.audiobook)
              : intl.formatMessage(messages.ebookAndAudiobook);
        addToast(
          <span>
            {intl.formatMessage(messages.requestSuccessWithFormat, {
              title: data?.title,
              format: formatLabel,
              strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
            })}
          </span>,
          { appearance: 'success', autoDismiss: true }
        );
      }
    } catch {
      addToast(intl.formatMessage(messages.requesterror), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsUpdating(false);
    }
  }, [
    addToast,
    bookFormat,
    data?.authorId,
    data?.editionId,
    data?.id,
    data?.isbn13,
    data?.isbnCandidates,
    data?.title,
    intl,
    normalizedBookId,
    onComplete,
    getOverrideParams,
    selectedDestinationCovered,
    selectedIsbn,
  ]);

  const cancelRequest = async () => {
    setIsUpdating(true);

    try {
      const response = await axios.delete<MediaRequest>(
        `/api/v1/request/${editRequest?.id}`
      );
      mutate('/api/v1/request?filter=all&take=10&sort=modified&skip=0');
      mutate('/api/v1/request/count');

      if (response.status === 204) {
        onComplete?.(MediaStatus.UNKNOWN);
        addToast(
          <span>
            {intl.formatMessage(messages.requestCancel, {
              title: data?.title,
              strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
            })}
          </span>,
          { appearance: 'success', autoDismiss: true }
        );
      }
    } catch {
      addToast(intl.formatMessage(messages.editerror), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const updateRequest = async (alsoApproveRequest = false) => {
    setIsUpdating(true);

    try {
      await axios.put(`/api/v1/request/${editRequest?.id}`, {
        mediaType: MediaType.BOOK,
        format: bookFormat,
        ...getOverrideParams(),
      });

      if (alsoApproveRequest) {
        await axios.post(`/api/v1/request/${editRequest?.id}/approve`);
      }
      mutate('/api/v1/request?filter=all&take=10&sort=modified&skip=0');
      mutate('/api/v1/request/count');

      addToast(
        <span>
          {intl.formatMessage(
            alsoApproveRequest
              ? messages.requestApproved
              : messages.requestEdited,
            {
              title: data?.title,
              strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
            }
          )}
        </span>,
        { appearance: 'success', autoDismiss: true }
      );

      onComplete?.(MediaStatus.PENDING);
    } catch {
      addToast(intl.formatMessage(messages.editerror), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsUpdating(false);
    }
  };

  if (editRequest) {
    const isOwner = editRequest.requestedBy.id === user?.id;

    return (
      <Modal
        loading={!data && !error}
        backgroundClickable
        onCancel={onCancel}
        title={intl.formatMessage(messages.pendingRequestFormat, {
          format: formatLabel,
        })}
        subTitle={data?.title}
        onOk={() =>
          hasPermission(Permission.MANAGE_REQUESTS)
            ? updateRequest(true)
            : hasPermission(Permission.REQUEST_ADVANCED)
              ? updateRequest()
              : cancelRequest()
        }
        okDisabled={isUpdating || !!formatWarning}
        okText={
          hasPermission(Permission.MANAGE_REQUESTS)
            ? intl.formatMessage(messages.approve)
            : hasPermission(Permission.REQUEST_ADVANCED)
              ? intl.formatMessage(messages.edit)
              : intl.formatMessage(messages.cancel)
        }
        okButtonType={
          hasPermission(Permission.MANAGE_REQUESTS)
            ? 'success'
            : hasPermission(Permission.REQUEST_ADVANCED)
              ? 'primary'
              : 'danger'
        }
        onSecondary={
          isOwner &&
          hasPermission(
            [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
            { type: 'or' }
          )
            ? () => cancelRequest()
            : undefined
        }
        secondaryDisabled={isUpdating}
        secondaryText={
          isOwner &&
          hasPermission(
            [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
            { type: 'or' }
          )
            ? intl.formatMessage(messages.cancel)
            : undefined
        }
        secondaryButtonType="danger"
        cancelText={intl.formatMessage(messages.close)}
        cancelButtonType="danger"
        backdrop={data?.posterPath}
        backdropFull
        alignTop
        actionButtonSize="standard"
        dialogClass="refreshed-card-surface refreshed-detail-text !w-[calc(100%-2rem)] rounded-xl border border-gray-700 shadow-lg shadow-gray-950/20 sm:!max-w-5xl"
      >
        <div className="refreshed-inset-surface rounded-lg border border-gray-700 p-3">
          {isOwner
            ? intl.formatMessage(messages.pendingapproval)
            : intl.formatMessage(messages.requestfrom, {
                username: editRequest.requestedBy.displayName,
              })}
        </div>
        <BookFormatSelector
          value={bookFormat}
          available={formatAvailable}
          onChange={handleBookFormatChange}
        />
        {formatWarning && (
          <div className="mt-4">
            <Alert title={intl.formatMessage(formatWarning)} type="warning" />
          </div>
        )}
        {bookFormat === 'both' &&
          (hasPermission(Permission.REQUEST_ADVANCED) ||
            hasPermission(Permission.MANAGE_REQUESTS)) && (
            <div className="mt-4">
              <Alert
                title={intl.formatMessage(messages.bothDefaultInfo)}
                type="info"
              />
            </div>
          )}
        {(hasPermission(Permission.REQUEST_ADVANCED) ||
          hasPermission(Permission.MANAGE_REQUESTS)) && (
          <AdvancedRequester
            type="book"
            is4k={false}
            bookFormat={bookFormat}
            mediaTitle={data?.title}
            posterPath={data?.posterPath}
            requestStatus={formatLabel}
            requestUser={editRequest.requestedBy}
            defaultOverrides={{
              folder: editRequest.rootFolder,
              metadataProfile: editRequest.metadataProfileId,
              profile: editRequest.profileId,
              server: editRequest.serverId,
              tags: editRequest.tags,
            }}
            onChange={(overrides) => setRequestOverrides(overrides)}
          />
        )}
      </Modal>
    );
  }

  return (
    <Modal
      loading={(!data && !error) || !quota}
      backgroundClickable
      onCancel={onCancel}
      onOk={sendRequest}
      hideActions
      alignTop
      okDisabled={
        isUpdating ||
        selectedDestinationAvailable ||
        quota?.book?.restricted ||
        !!formatWarning
      }
      title={requestLabel}
      okText={requestButtonLabel}
      okButtonType="primary"
      dialogClass="request-modal-site-surface sm:max-w-5xl"
    >
      {(quota?.book?.limit ?? 0) > 0 && (
        <QuotaDisplay
          mediaType="book"
          quota={quota?.book}
          userOverride={
            requestOverrides?.user && requestOverrides.user.id !== user?.id
              ? requestOverrides?.user?.id
              : undefined
          }
        />
      )}
      <RequestMediaCard artwork={data?.posterPath} artworkType="book">
        <div className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)] gap-3 sm:grid-cols-[80px_minmax(0,1fr)]">
          <div className="relative h-24 w-16 overflow-hidden rounded-lg ring-1 ring-gray-600 sm:h-[120px] sm:w-20">
            <CachedImage
              type="book"
              src={data?.posterPath || '/images/seerr_poster_not_found.png'}
              alt=""
              fill
              sizes="(min-width: 640px) 80px, 64px"
              className="object-cover"
            />
          </div>

          <div className="flex min-w-0 flex-col">
            <h3 className="-mt-0.5 truncate text-lg leading-5 font-semibold text-white">
              {data?.title}
              {data?.firstPublishYear ? ` (${data.firstPublishYear})` : ''}
            </h3>

            <div className="card:grid-cols-3 mt-4 grid min-h-0 min-w-0 flex-1 grid-cols-1 items-stretch">
              <div className="card:col-span-2 card:pr-3 min-w-0">
                <dl className="card:grid-cols-[max-content_0.75rem_6rem_0.75rem_minmax(0,1fr)] card:gap-x-0 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 text-xs leading-4 text-gray-400">
                  <dt className="card:col-start-1 card:row-start-1 font-medium text-gray-100">
                    {intl.formatMessage(messages.mediaAndFormat)}:
                  </dt>
                  <dd className="card:col-start-3 card:row-start-1 m-0 truncate">
                    Book · {formatLabel}
                  </dd>
                  <dt className="card:col-start-1 card:row-start-2 font-medium text-gray-100">
                    {intl.formatMessage(messages.firstPublished)}:
                  </dt>
                  <dd className="card:col-start-3 card:row-start-2 m-0 truncate">
                    {data?.firstPublishYear ?? notAvailable}
                  </dd>
                  <dt className="card:col-start-1 card:row-start-3 font-medium text-gray-100">
                    {intl.formatMessage(messages.pages)}:
                  </dt>
                  <dd className="card:col-start-3 card:row-start-3 m-0 truncate">
                    {data?.numberOfPages
                      ? intl.formatNumber(data.numberOfPages)
                      : notAvailable}
                  </dd>

                  <div className="media-detail-column-divider card:col-span-1 card:col-start-5 card:row-span-3 card:row-start-1 col-span-2 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5">
                    <dt className="font-medium text-gray-100">
                      {intl.formatMessage(messages.author)}:
                    </dt>
                    <dd className="m-0 truncate">
                      {data?.author || notAvailable}
                    </dd>
                    <dt className="font-medium text-gray-100">
                      {intl.formatMessage(messages.publisher)}:
                    </dt>
                    <dd className="m-0 truncate">
                      {data?.publisher || notAvailable}
                    </dd>
                  </div>

                  <dt className="card:col-start-1 card:row-start-4 mt-0.5 font-medium text-gray-100">
                    {intl.formatMessage(messages.genres)}:
                  </dt>
                  <dd className="card:col-span-3 card:col-start-3 card:row-start-4 m-0 mt-0.5 line-clamp-2 min-w-0 break-words">
                    {genres}
                  </dd>
                </dl>
              </div>

              <dl className="media-detail-column-divider grid h-full min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 text-xs leading-4 text-gray-400">
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.status)}:
                </dt>
                <dd className="m-0 truncate">
                  {intl.formatMessage(
                    selectedDestinationAvailable
                      ? globalMessages.available
                      : selectedDestinationRequested
                        ? messages.requested
                        : messages.readyToRequest
                  )}
                </dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.service)}:
                </dt>
                <dd className="m-0 truncate">{serviceLabel}</dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.approval)}:
                </dt>
                <dd className="m-0 min-w-0">
                  <RequestFooterStatus
                    available={selectedDestinationAvailable}
                    requested={selectedDestinationRequested}
                    hasAutoApprove={hasAutoApprove}
                  />
                </dd>
              </dl>
            </div>
          </div>
        </div>

        <div className="mt-2">
          <BookFormatSelector
            value={bookFormat}
            available={formatAvailable}
            onChange={handleBookFormatChange}
          />
        </div>
        {formatWarning && (
          <div className="mt-2">
            <Alert title={intl.formatMessage(formatWarning)} type="warning" />
          </div>
        )}
        {!!data?.isbnCandidates?.length && (
          <div className="mt-2">
            <label className="inline-flex h-8 max-w-full overflow-hidden rounded-md border border-gray-600 bg-gray-900/70">
              <span
                className={`inline-flex flex-shrink-0 items-center justify-center rounded-l-[5px] border-r border-gray-600 px-1.5 text-xs font-semibold whitespace-nowrap text-indigo-100 transition-colors ${
                  selectedIsbn ? 'bg-indigo-500/35 text-white' : ''
                }`}
              >
                {intl.formatMessage(messages.edition)}
              </span>
              <select
                id="isbn"
                name="isbn"
                value={selectedIsbn}
                onChange={(e) => setSelectedIsbn(e.target.value)}
                aria-label={intl.formatMessage(messages.edition)}
                className="max-w-[32rem] min-w-0 border-0 bg-gray-900/70 px-1.5 py-1 text-xs font-medium text-gray-300 focus:ring-2 focus:ring-indigo-400 focus:ring-inset"
              >
                <option value="">
                  {intl.formatMessage(messages.automaticEdition)}
                </option>
                {data.isbnCandidates.slice(0, 25).map((candidate) => (
                  <option
                    key={`${candidate.editionId ?? candidate.isbn}-${candidate.isbn}`}
                    value={candidate.isbn}
                  >
                    {[candidate.isbn, candidate.title, candidate.format]
                      .filter(Boolean)
                      .join(' - ')}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {canUseAdvancedOptions && (
          <AdvancedRequester
            type="book"
            is4k={false}
            bookFormat={bookFormat}
            mediaTitle={data?.title}
            posterPath={data?.posterPath}
            requestStatus={formatLabel}
            expanded={advancedOptionsOpen}
            panelOnly
            rootFolderTable
            requestedByPortal={requestedByPortal}
            onChange={(overrides) => setRequestOverrides(overrides)}
          />
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          <div className="mr-auto flex items-center gap-2">
            {canUseAdvancedOptions && (
              <button
                type="button"
                className="request-form-control compact-control inline-flex items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition focus:ring-2 focus:ring-indigo-400 focus:outline-none focus:ring-inset"
                aria-expanded={advancedOptionsOpen}
                onClick={() => setAdvancedOptionsOpen((open) => !open)}
              >
                <AdjustmentsHorizontalIcon
                  className="h-3.5 w-3.5"
                  aria-hidden="true"
                />
                {intl.formatMessage(messages.advancedOptions)}
                <ChevronDownIcon
                  className={`h-3.5 w-3.5 transition-transform ${advancedOptionsOpen ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
              </button>
            )}
          </div>
          <div
            className="compact-control flex items-center"
            ref={setRequestedByPortal}
          />
          <button
            type="button"
            onClick={onCancel}
            data-testid="modal-cancel-button"
            className="compact-control inline-flex items-center gap-1 rounded-md border border-red-600/80 bg-red-800/25 px-2 text-[11px] leading-none font-semibold text-red-200 transition hover:border-red-500 hover:text-white focus:ring-2 focus:ring-red-500 focus:outline-none"
          >
            <XMarkIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {intl.formatMessage(globalMessages.cancel)}
          </button>
          <button
            type="button"
            onClick={() => void sendRequest()}
            data-testid="modal-ok-button"
            disabled={
              isUpdating ||
              selectedDestinationCovered ||
              quota?.book?.restricted ||
              !!formatWarning
            }
            className="compact-control inline-flex items-center gap-1 rounded-md border border-emerald-600/80 bg-emerald-800/25 px-2 text-[11px] leading-none font-semibold text-emerald-200 transition hover:border-emerald-500 hover:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowDownTrayIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {requestButtonLabel}
          </button>
        </div>
      </RequestMediaCard>
    </Modal>
  );
};

export default BookRequestModal;
