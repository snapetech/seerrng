import Spinner from '@app/assets/spinner.svg';
import AssociationBadge from '@app/components/Association/AssociationBadge';
import BookDetailsLayout from '@app/components/BookDetails/BookDetailsLayout';
import {
  getBookFormatMessage,
  getRequestedBookFormat,
  type RequestedBookFormat,
} from '@app/components/Common/BookFormatBadge';
import Button from '@app/components/Common/Button';
import FormatRequestControl from '@app/components/Common/FormatRequestControl';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import MediaServerPlayButton from '@app/components/Common/MediaServerPlayButton';
import PageTitle from '@app/components/Common/PageTitle';
import Tooltip from '@app/components/Common/Tooltip';
import IssueBlock from '@app/components/IssueBlock';
import BulkRequestModal from '@app/components/RequestModal/BulkRequestModal';
import {
  createRequestDestination,
  isRequestDestinationAvailable,
  isRequestDestinationRequested,
} from '@app/components/RequestModal/requestAvailability';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import { getQueryParamString } from '@app/hooks/useUpdateQueryParams';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import {
  encodeApiPathSegment,
  normalizeOpenLibraryWorkId,
} from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
import {
  ArrowDownTrayIcon,
  CogIcon,
  ExclamationTriangleIcon,
  EyeSlashIcon,
  InformationCircleIcon,
  MinusCircleIcon,
  StarIcon,
} from '@heroicons/react/24/solid';
import { IssueStatus } from '@server/constants/issue';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { UserType } from '@server/constants/user';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { NonFunctionProperties } from '@server/interfaces/api/common';
import type { ServiceCommonServer } from '@server/interfaces/api/serviceInterfaces';
import type { BookDetails as BookDetailsType } from '@server/models/Book';
import axios from 'axios';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const ExternalBlocklistModal = dynamic(
  () => import('@app/components/ExternalBlocklistModal'),
  { ssr: false }
);
const ExternalMediaManageSlideOver = dynamic(
  () => import('@app/components/ExternalMediaManageSlideOver'),
  { ssr: false }
);
const IssueModal = dynamic(() => import('@app/components/IssueModal'), {
  ssr: false,
});
const RequestModal = dynamic(() => import('@app/components/RequestModal'), {
  ssr: false,
});

const messages = defineMessages('components.BookDetails', {
  manage: 'Manage Book',
  reportissue: 'Report an Issue',
  openissues: 'Open Issues',
  watchlistSuccess: '<strong>{title}</strong> added to watchlist successfully!',
  watchlistDeleted:
    '<strong>{title}</strong> Removed from watchlist successfully!',
  watchlistError: 'Something went wrong. Please try again.',
  removefromwatchlist: 'Remove From Watchlist',
  addtowatchlist: 'Add To Watchlist',
  viewrequest: 'View Request',
  viewRequestFormat: 'View {format} request',
  requestBookFormat: 'Request {format}',
  requestbibliography: 'Request Bibliography',
  selectToPlay: 'No playable audiobook tracks are currently available.',
  bookAvailable: 'The Book format is already available.',
  audiobookAvailable: 'The Audiobook format is already available.',
  bookPending: 'An open Book request already exists.',
  audiobookPending: 'An open Audiobook request already exists.',
  noBookService: 'No Book Bookshelf service is configured.',
  noAudiobookService: 'No Audiobook Bookshelf service is configured.',
  blocklisted: 'This title is blocklisted.',
});

const BookDetails = () => {
  const router = useRouter();
  const intl = useIntl();
  const { addToast } = useToasts();
  const { user, hasPermission } = useUser();
  const { currentSettings } = useSettings();
  const ebookCategoryEnabled =
    currentSettings.enabledMediaCategories?.ebook !== false;
  const audiobookCategoryEnabled =
    currentSettings.enabledMediaCategories?.audiobook !== false;
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [showBulkRequestModal, setShowBulkRequestModal] = useState(false);
  const [editRequest, setEditRequest] =
    useState<NonFunctionProperties<MediaRequest>>();
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [showManager, setShowManager] = useState(router.query.manage === '1');
  const [showBlocklistModal, setShowBlocklistModal] = useState(false);
  const [isBlocklisting, setIsBlocklisting] = useState(false);
  const [isWatchlistUpdating, setIsWatchlistUpdating] = useState(false);
  const [toggleWatchlist, setToggleWatchlist] = useState(true);
  const bookId = getQueryParamString(router.query.bookId);
  const normalizedRouteBookId = bookId
    ? normalizeOpenLibraryWorkId(bookId)
    : undefined;
  const routeBookFormat = getQueryParamString(router.query.format);
  const preferredBookFormat: RequestedBookFormat | undefined =
    routeBookFormat === 'audiobook' ||
    routeBookFormat === 'ebook' ||
    routeBookFormat === 'both'
      ? routeBookFormat
      : undefined;
  const [requestModalFormat, setRequestModalFormat] =
    useState<RequestedBookFormat>(preferredBookFormat ?? 'ebook');

  useEffect(() => {
    if (
      !router.isReady ||
      router.query.request !== '1' ||
      !normalizedRouteBookId
    ) {
      return;
    }

    setEditRequest(undefined);
    setRequestModalFormat(preferredBookFormat ?? 'ebook');
    setShowRequestModal(true);

    const remainingQuery = { ...router.query };
    delete remainingQuery.request;
    void router.replace(
      { pathname: router.pathname, query: remainingQuery },
      undefined,
      { shallow: true }
    );
  }, [normalizedRouteBookId, preferredBookFormat, router]);

  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<BookDetailsType>(
    normalizedRouteBookId
      ? `/api/v1/book/${encodeApiPathSegment(normalizedRouteBookId)}`
      : null
  );
  const { data: bookServices } = useSWR<ServiceCommonServer[]>(
    '/api/v1/service/readarr'
  );

  useEffect(() => {
    setShowManager(router.query.manage === '1');
  }, [router.query.manage]);

  useEffect(() => {
    setToggleWatchlist(!data?.onUserWatchlist);
  }, [data?.onUserWatchlist]);

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  if (!data) {
    return <ErrorPage statusCode={404} />;
  }

  const openLibraryWorkId = normalizeOpenLibraryWorkId(data.id);

  const canRequest = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_BOOK],
    { type: 'or' }
  );
  const canChooseAlternateTarget = hasPermission(
    [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
    { type: 'or' }
  );
  const playbackActions = canRequest
    ? (itemIds: string[]) => (
        <MediaServerPlayButton
          mediaUrl={data.mediaInfo?.mediaUrl}
          iOSPlexUrl={data.mediaInfo?.iOSPlexUrl}
          mediaId={data.mediaInfo?.id}
          itemIds={itemIds}
          disabled={itemIds.length === 0}
          disabledReason={intl.formatMessage(messages.selectToPlay)}
        />
      )
    : undefined;
  const hasEbookServiceLink =
    data.mediaInfo?.serviceId !== null &&
    data.mediaInfo?.serviceId !== undefined &&
    data.mediaInfo.externalServiceId !== null &&
    data.mediaInfo.externalServiceId !== undefined;
  const hasAudiobookServiceLink =
    data.mediaInfo?.audiobookServiceId !== null &&
    data.mediaInfo?.audiobookServiceId !== undefined &&
    data.mediaInfo.audiobookExternalServiceId !== null &&
    data.mediaInfo.audiobookExternalServiceId !== undefined;
  const activeBookRequests =
    data.mediaInfo?.requests?.filter(
      (request) =>
        request.status !== MediaRequestStatus.DECLINED &&
        request.status !== MediaRequestStatus.FAILED &&
        request.status !== MediaRequestStatus.COMPLETED
    ) ?? [];
  const hasActiveEbookRequest = activeBookRequests.some(
    (request) =>
      (request.bookFormat ?? 'ebook') === 'ebook' ||
      request.bookFormat === 'both'
  );
  const hasActiveAudiobookRequest = activeBookRequests.some(
    (request) =>
      request.bookFormat === 'audiobook' || request.bookFormat === 'both'
  );
  const defaultEbookService =
    bookServices?.find(
      (service) =>
        service.isDefault && (service.serviceType ?? 'ebook') === 'ebook'
    ) ??
    bookServices?.find(
      (service) => (service.serviceType ?? 'ebook') === 'ebook'
    );
  const defaultAudiobookService =
    bookServices?.find(
      (service) => service.isDefault && service.serviceType === 'audiobook'
    ) ?? bookServices?.find((service) => service.serviceType === 'audiobook');
  const hasEbookService =
    bookServices === undefined ||
    bookServices.some(
      (service) => (service.serviceType ?? 'ebook') === 'ebook'
    );
  const hasAudiobookService =
    bookServices === undefined ||
    bookServices.some((service) => service.serviceType === 'audiobook');
  const ebookDestination = createRequestDestination(
    'readarr',
    'ebook',
    defaultEbookService,
    null
  );
  const audiobookDestination = createRequestDestination(
    'readarr',
    'audiobook',
    defaultAudiobookService,
    null
  );
  const destinationAvailable = (
    format: 'ebook' | 'audiobook',
    destination: typeof ebookDestination
  ) => {
    const externalServiceId =
      format === 'ebook'
        ? data.mediaInfo?.externalServiceId
        : data.mediaInfo?.audiobookExternalServiceId;
    const serviceId =
      format === 'ebook'
        ? data.mediaInfo?.serviceId
        : data.mediaInfo?.audiobookServiceId;

    return isRequestDestinationAvailable(
      data.mediaInfo
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
      destination
    );
  };
  const defaultEbookCovered =
    destinationAvailable('ebook', ebookDestination) ||
    isRequestDestinationRequested(data.mediaInfo?.requests, ebookDestination);
  const defaultAudiobookCovered =
    destinationAvailable('audiobook', audiobookDestination) ||
    isRequestDestinationRequested(
      data.mediaInfo?.requests,
      audiobookDestination
    );
  const activeBookRequest =
    activeBookRequests.find(
      (request) => request.requestedBy?.id === user?.id
    ) ??
    (hasPermission(Permission.MANAGE_REQUESTS) &&
    activeBookRequests.length === 1
      ? activeBookRequests[0]
      : undefined);
  const canRequestEbook =
    canRequest &&
    ebookCategoryEnabled &&
    data.mediaInfo?.status !== MediaStatus.BLOCKLISTED &&
    hasEbookService &&
    (canChooseAlternateTarget || !defaultEbookCovered);
  const canRequestAudiobook =
    canRequest &&
    audiobookCategoryEnabled &&
    data.mediaInfo?.status !== MediaStatus.BLOCKLISTED &&
    hasAudiobookService &&
    (canChooseAlternateTarget || !defaultAudiobookCovered);
  const canUseReportIssue = hasPermission(
    [Permission.MANAGE_ISSUES, Permission.CREATE_ISSUES],
    { type: 'or' }
  );
  const isReportIssueAvailable =
    !!data.mediaInfo?.id &&
    (data.mediaInfo.status === MediaStatus.AVAILABLE ||
      data.mediaInfo.status === MediaStatus.PARTIALLY_AVAILABLE);
  const canUseBlocklist = hasPermission(Permission.MANAGE_BLOCKLIST);
  const isBlocklistAvailable =
    data.mediaInfo?.status !== MediaStatus.BLOCKLISTED;
  const canUseManage = hasPermission(Permission.MANAGE_REQUESTS);
  const isManageAvailable = Boolean(
    data.mediaInfo && data.mediaInfo.status !== MediaStatus.UNKNOWN
  );
  const canWatchlist =
    data.mediaInfo?.status !== MediaStatus.BLOCKLISTED &&
    user?.userType !== UserType.PLEX;
  const openIssues =
    data.mediaInfo?.issues?.filter(
      (issue) => issue.status === IssueStatus.OPEN
    ) ?? [];
  const openRequestModal = (format: RequestedBookFormat) => {
    setEditRequest(undefined);
    setRequestModalFormat(format);
    setShowRequestModal(true);
  };
  const activeRequestLabel = activeBookRequest
    ? intl.formatMessage(messages.viewRequestFormat, {
        format: intl.formatMessage(
          getBookFormatMessage(
            getRequestedBookFormat(activeBookRequest.bookFormat)
          )
        ),
      })
    : intl.formatMessage(messages.viewrequest);
  const formatCoverage: {
    format: 'ebook' | 'audiobook';
    available: boolean;
    requested: boolean;
  }[] = [
    {
      format: 'ebook',
      available: hasEbookServiceLink,
      requested: hasActiveEbookRequest,
    },
    {
      format: 'audiobook',
      available: hasAudiobookServiceLink,
      requested: hasActiveAudiobookRequest,
    },
  ];

  const blocklistBook = async () => {
    setIsBlocklisting(true);

    try {
      await axios.post('/api/v1/blocklist', {
        externalId: openLibraryWorkId,
        externalProvider: 'openlibrary',
        mediaType: MediaType.BOOK,
        title: data.title,
      });

      addToast(
        <span>
          {intl.formatMessage(globalMessages.blocklistSuccess, {
            title: data.title,
            strong: (msg: React.ReactNode) => (
              <strong key="strong">{msg}</strong>
            ),
          })}
        </span>,
        { appearance: 'success', autoDismiss: true }
      );
      revalidate();
    } catch {
      addToast(intl.formatMessage(globalMessages.blocklistError), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsBlocklisting(false);
      setShowBlocklistModal(false);
    }
  };

  const addToWatchlist = async (): Promise<void> => {
    setIsWatchlistUpdating(true);

    try {
      const response = await axios.post('/api/v1/watchlist', {
        externalId: openLibraryWorkId,
        mediaType: MediaType.BOOK,
        title: data.title,
      });

      if (response.data) {
        addToast(
          <span>
            {intl.formatMessage(messages.watchlistSuccess, {
              title: data.title,
              strong: (msg: React.ReactNode) => (
                <strong key="strong">{msg}</strong>
              ),
            })}
          </span>,
          { appearance: 'success', autoDismiss: true }
        );
      }

      setToggleWatchlist(false);
    } catch {
      addToast(intl.formatMessage(messages.watchlistError), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsWatchlistUpdating(false);
      revalidate();
    }
  };

  const removeFromWatchlist = async (): Promise<void> => {
    setIsWatchlistUpdating(true);

    try {
      await axios.delete(
        `/api/v1/watchlist/${encodeApiPathSegment(openLibraryWorkId)}?mediaType=book`
      );

      addToast(
        <span>
          {intl.formatMessage(messages.watchlistDeleted, {
            title: data.title,
            strong: (msg: React.ReactNode) => (
              <strong key="strong">{msg}</strong>
            ),
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
      setIsWatchlistUpdating(false);
      revalidate();
    }
  };

  const primaryActions = (
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
              ? messages.manage
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
            className="relative"
            aria-label={intl.formatMessage(messages.manage)}
          >
            <CogIcon className="!mr-0" />
            {openIssues.length > 0 && (
              <>
                <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-red-600" />
                <span className="absolute -top-1 -right-1 h-3 w-3 animate-ping rounded-full bg-red-600" />
              </>
            )}
          </Button>
        </Tooltip>
      )}
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
          </Button>
        </Tooltip>
      )}
      <AssociationBadge
        mediaType="book"
        id={openLibraryWorkId}
        variant="button"
      />
      {canRequest && data.authorId && (
        <Button
          buttonType="bulkRequest"
          buttonSize="sm"
          onClick={() => setShowBulkRequestModal(true)}
        >
          <ArrowDownTrayIcon />
          <span>{intl.formatMessage(messages.requestbibliography)}</span>
        </Button>
      )}
      {activeBookRequest && (
        <Button
          buttonType="ghost"
          buttonSize="sm"
          onClick={() => {
            setEditRequest(activeBookRequest);
            setShowRequestModal(true);
          }}
        >
          <InformationCircleIcon />
          <span>{activeRequestLabel}</span>
        </Button>
      )}
      {canRequest && (
        <FormatRequestControl
          options={[
            ...(ebookCategoryEnabled
              ? [
                  {
                    id: 'ebook',
                    label: intl.formatMessage(getBookFormatMessage('ebook')),
                    onClick: () => openRequestModal('ebook'),
                    disabled: !canRequestEbook,
                    disabledReason:
                      data.mediaInfo?.status === MediaStatus.BLOCKLISTED
                        ? intl.formatMessage(messages.blocklisted)
                        : !hasEbookService
                          ? intl.formatMessage(messages.noBookService)
                          : hasEbookServiceLink
                            ? intl.formatMessage(messages.bookAvailable)
                            : hasActiveEbookRequest
                              ? intl.formatMessage(messages.bookPending)
                              : undefined,
                  },
                ]
              : []),
            ...(audiobookCategoryEnabled
              ? [
                  {
                    id: 'audiobook',
                    label: intl.formatMessage(
                      getBookFormatMessage('audiobook')
                    ),
                    onClick: () => openRequestModal('audiobook'),
                    disabled: !canRequestAudiobook,
                    disabledReason:
                      data.mediaInfo?.status === MediaStatus.BLOCKLISTED
                        ? intl.formatMessage(messages.blocklisted)
                        : !hasAudiobookService
                          ? intl.formatMessage(messages.noAudiobookService)
                          : hasAudiobookServiceLink
                            ? intl.formatMessage(messages.audiobookAvailable)
                            : hasActiveAudiobookRequest
                              ? intl.formatMessage(messages.audiobookPending)
                              : undefined,
                  },
                ]
              : []),
          ]}
        />
      )}
    </>
  );

  const secondaryActions = (
    <>
      {canWatchlist && (
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
            onClick={toggleWatchlist ? addToWatchlist : removeFromWatchlist}
            aria-label={intl.formatMessage(
              toggleWatchlist
                ? messages.addtowatchlist
                : messages.removefromwatchlist
            )}
          >
            {isWatchlistUpdating ? (
              <Spinner />
            ) : toggleWatchlist ? (
              <StarIcon className="text-amber-300" />
            ) : (
              <MinusCircleIcon />
            )}
          </Button>
        </Tooltip>
      )}
    </>
  );

  const additionalContent =
    hasPermission([Permission.MANAGE_ISSUES, Permission.VIEW_ISSUES], {
      type: 'or',
    }) && openIssues.length > 0 ? (
      <section className="refreshed-inset-surface mt-[5px] overflow-hidden rounded-lg border border-gray-700">
        <h2 className="media-inset-heading px-3 py-2">
          {intl.formatMessage(messages.openissues)}
        </h2>
        <ul className="border-t border-gray-700">
          {openIssues.map((issue) => (
            <li
              key={`book-issue-${issue.id}`}
              className="border-b border-gray-700 last:border-b-0"
            >
              <IssueBlock issue={issue} />
            </li>
          ))}
        </ul>
      </section>
    ) : undefined;

  return (
    <>
      <PageTitle title={data.title} />
      {showManager && canUseManage && isManageAvailable && (
        <ExternalMediaManageSlideOver
          data={data}
          mediaType={MediaType.BOOK}
          onClose={() => {
            setShowManager(false);
            router.push({
              pathname: router.pathname,
              query: {
                bookId,
                ...(preferredBookFormat ? { format: preferredBookFormat } : {}),
              },
            });
          }}
          revalidate={() => revalidate()}
          show={showManager}
        />
      )}
      {showBlocklistModal && (
        <ExternalBlocklistModal
          show={showBlocklistModal}
          type="book"
          title={data.title}
          backdrop={data.posterPath}
          onCancel={() => setShowBlocklistModal(false)}
          onComplete={blocklistBook}
          isUpdating={isBlocklisting}
        />
      )}
      {showIssueModal && (
        <IssueModal
          show={showIssueModal}
          mediaType="book"
          mediaId={data.mediaInfo?.id}
          title={data.title}
          backdrop={data.posterPath}
          onCancel={() => setShowIssueModal(false)}
        />
      )}
      {showRequestModal && (
        <RequestModal
          bookId={openLibraryWorkId}
          initialBookFormat={requestModalFormat}
          editRequest={editRequest}
          show={showRequestModal}
          type="book"
          onComplete={() => {
            setEditRequest(undefined);
            setShowRequestModal(false);
            revalidate();
          }}
          onCancel={() => {
            setEditRequest(undefined);
            setShowRequestModal(false);
          }}
        />
      )}
      {showBulkRequestModal && data.authorId && (
        <BulkRequestModal
          show={showBulkRequestModal}
          mediaType="book"
          authorId={data.authorId}
          title={data.author ?? data.title}
          initialItems={[
            {
              id: openLibraryWorkId,
              title: data.title,
              year: data.firstPublishYear,
              image: data.posterPath,
              artist: data.author,
              isbn13: data.isbn13,
              editionId: data.editionId,
              authorId: data.authorId,
              mediaInfo: data.mediaInfo,
            },
          ]}
          onCancel={() => setShowBulkRequestModal(false)}
          onComplete={() => revalidate()}
        />
      )}
      <BookDetailsLayout
        data={data}
        formatCoverage={formatCoverage}
        primaryActions={primaryActions}
        secondaryActions={secondaryActions}
        playbackActions={playbackActions}
        additionalContent={additionalContent}
      />
    </>
  );
};

export default BookDetails;
