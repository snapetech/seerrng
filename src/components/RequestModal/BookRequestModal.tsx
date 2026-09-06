import Alert from '@app/components/Common/Alert';
import Modal from '@app/components/Common/Modal';
import type { RequestOverrides } from '@app/components/RequestModal/AdvancedRequester';
import AdvancedRequester from '@app/components/RequestModal/AdvancedRequester';
import QuotaDisplay from '@app/components/RequestModal/QuotaDisplay';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import {
  encodeApiPathSegment,
  normalizeOpenLibraryWorkId,
} from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { NonFunctionProperties } from '@server/interfaces/api/common';
import type { ServiceCommonServer } from '@server/interfaces/api/serviceInterfaces';
import type { QuotaResponse } from '@server/interfaces/api/userInterfaces';
import type { BookDetails } from '@server/models/Book';
import axios from 'axios';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.RequestModal.Book', {
  requestadmin: 'This request will be approved automatically.',
  requestSuccessWithFormat:
    '<strong>{title}</strong> requested successfully as {format}.',
  requestCancel: 'Request for <strong>{title}</strong> canceled.',
  requestEdited: 'Request for <strong>{title}</strong> edited successfully!',
  requestApproved: 'Request for <strong>{title}</strong> approved!',
  requestbook: 'Request Book',
  pendingrequest: 'Pending Book Request',
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
  format: 'Format',
  bothDefaultInfo:
    'Both uses your default ebook and audiobook Bookshelf services. Choose a single format to override server, profile, folder, or tags.',
  edition: 'Edition / ISBN',
  automaticEdition: 'Automatic best match',
  automaticEditionInfo:
    'Automatic uses the first valid ISBN from Open Library. Pick a specific edition when testers report a mismatch.',
  noIsbnCandidates:
    'No valid ISBN candidates were found. Bookshelf will fall back to title matching.',
  noEbookServer:
    'No ebook Bookshelf service is configured. Ebook requests are unavailable.',
  noAudiobookServer:
    'No audiobook Bookshelf service is configured. Audiobook requests are unavailable.',
  noBothServers:
    'Both requires ebook and audiobook Bookshelf services to be configured.',
  ebook: 'Ebook',
  audiobook: 'Audiobook',
  both: 'Both',
  ebookAndAudiobook: 'ebook and audiobook',
});

interface BookRequestModalProps {
  bookId: string;
  initialBookFormat?: 'ebook' | 'audiobook';
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
  const { data: quota } = useSWR<QuotaResponse>(
    user &&
      (!requestOverrides?.user?.id || hasPermission(Permission.MANAGE_USERS))
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

  const hasAutoApprove = hasPermission(
    [
      Permission.MANAGE_REQUESTS,
      Permission.AUTO_APPROVE,
      Permission.AUTO_APPROVE_BOOK,
    ],
    { type: 'or' }
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

  const sendRequest = useCallback(async () => {
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
          hasAutoApprove ? MediaStatus.PROCESSING : MediaStatus.PENDING
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
    hasAutoApprove,
    intl,
    normalizedBookId,
    onComplete,
    getOverrideParams,
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
        title={intl.formatMessage(messages.pendingrequest)}
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
        backdrop={data?.posterPath}
      >
        {isOwner
          ? intl.formatMessage(messages.pendingapproval)
          : intl.formatMessage(messages.requestfrom, {
              username: editRequest.requestedBy.displayName,
            })}
        <div className="mt-6">
          <label htmlFor="bookFormat" className="text-label">
            {intl.formatMessage(messages.format)}
          </label>
          <select
            id="bookFormat"
            name="bookFormat"
            value={bookFormat}
            onChange={(e) =>
              handleBookFormatChange(
                e.target.value as 'ebook' | 'audiobook' | 'both'
              )
            }
            className="border-gray-700 bg-gray-800"
          >
            <option value="ebook" disabled={!hasEbookServer}>
              {intl.formatMessage(messages.ebook)}
            </option>
            <option value="audiobook" disabled={!hasAudiobookServer}>
              {intl.formatMessage(messages.audiobook)}
            </option>
            <option value="both" disabled={!formatAvailable.both}>
              {intl.formatMessage(messages.both)}
            </option>
          </select>
        </div>
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
      okDisabled={isUpdating || quota?.book?.restricted || !!formatWarning}
      title={intl.formatMessage(messages.requestbook)}
      subTitle={data?.title}
      okText={
        isUpdating
          ? intl.formatMessage(globalMessages.requesting)
          : intl.formatMessage(globalMessages.request)
      }
      okButtonType="primary"
      backdrop={data?.posterPath}
    >
      {hasAutoApprove && !quota?.book?.restricted && (
        <div className="mt-6">
          <Alert
            title={intl.formatMessage(messages.requestadmin)}
            type="info"
          />
        </div>
      )}
      <div className="mt-6">
        <label htmlFor="bookFormat" className="text-label">
          {intl.formatMessage(messages.format)}
        </label>
        <select
          id="bookFormat"
          name="bookFormat"
          value={bookFormat}
          onChange={(e) =>
            handleBookFormatChange(
              e.target.value as 'ebook' | 'audiobook' | 'both'
            )
          }
          className="border-gray-700 bg-gray-800"
        >
          <option value="ebook" disabled={!hasEbookServer}>
            {intl.formatMessage(messages.ebook)}
          </option>
          <option value="audiobook" disabled={!hasAudiobookServer}>
            {intl.formatMessage(messages.audiobook)}
          </option>
          <option value="both" disabled={!formatAvailable.both}>
            {intl.formatMessage(messages.both)}
          </option>
        </select>
      </div>
      {formatWarning && (
        <div className="mt-4">
          <Alert title={intl.formatMessage(formatWarning)} type="warning" />
        </div>
      )}
      {!!data?.isbnCandidates?.length && (
        <div className="mt-6">
          <label htmlFor="isbn" className="text-label">
            {intl.formatMessage(messages.edition)}
          </label>
          <select
            id="isbn"
            name="isbn"
            value={selectedIsbn}
            onChange={(e) => setSelectedIsbn(e.target.value)}
            className="border-gray-700 bg-gray-800"
          >
            <option value="">
              {intl.formatMessage(messages.automaticEdition)}
            </option>
            {data?.isbnCandidates?.slice(0, 25).map((candidate) => (
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
        </div>
      )}
      {(data?.isbnCandidates?.length ?? 0) > 1 && !selectedIsbn && (
        <div className="mt-4">
          <Alert
            title={intl.formatMessage(messages.automaticEditionInfo)}
            type="info"
          />
        </div>
      )}
      {data && (data.isbnCandidates?.length ?? 0) === 0 && (
        <div className="mt-4">
          <Alert
            title={intl.formatMessage(messages.noIsbnCandidates)}
            type="warning"
          />
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
      {(hasPermission(Permission.REQUEST_ADVANCED) ||
        hasPermission(Permission.MANAGE_REQUESTS)) && (
        <AdvancedRequester
          type="book"
          is4k={false}
          bookFormat={bookFormat}
          onChange={(overrides) => setRequestOverrides(overrides)}
        />
      )}
    </Modal>
  );
};

export default BookRequestModal;
