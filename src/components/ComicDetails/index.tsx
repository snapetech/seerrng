import Spinner from '@app/assets/spinner.svg';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import Tooltip from '@app/components/Common/Tooltip';
import ExternalBlocklistModal from '@app/components/ExternalBlocklistModal';
import IssueBlock from '@app/components/IssueBlock';
import AvailabilityValue, {
  getMediaAvailabilityTone,
} from '@app/components/MediaDetails/AvailabilityValue';
import MediaDetailArtwork from '@app/components/MediaDetails/MediaDetailArtwork';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import { encodeApiPathSegment } from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
import {
  ArrowDownTrayIcon,
  ArrowTopRightOnSquareIcon,
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
import type { ComicDetails as ComicDetailsType } from '@server/models/Comic';
import axios from 'axios';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const RequestModal = dynamic(() => import('@app/components/RequestModal'), {
  ssr: false,
});
const ExternalMediaManageSlideOver = dynamic(
  () => import('@app/components/ExternalMediaManageSlideOver'),
  { ssr: false }
);
const IssueModal = dynamic(() => import('@app/components/IssueModal'), {
  ssr: false,
});

const messages = defineMessages('components.ComicDetails', {
  publisher: 'Publisher',
  issueCount: 'Issues',
  overview: 'Overview',
  overviewUnavailable: 'Overview unavailable',
  viewrequest: 'View Request',
  viewOnComicVine: 'View on ComicVine',
  notAvailable: 'Not available',
  manage: 'Manage Comic',
  reportissue: 'Report an Issue',
  openissues: 'Open Issues',
  watchlistSuccess: '<strong>{title}</strong> added to watchlist successfully!',
  watchlistDeleted:
    '<strong>{title}</strong> Removed from watchlist successfully!',
  watchlistError: 'Something went wrong. Please try again.',
  removefromwatchlist: 'Remove From Watchlist',
  addtowatchlist: 'Add To Watchlist',
});

const ComicDetails = () => {
  const router = useRouter();
  const intl = useIntl();
  const { addToast } = useToasts();
  const { user, hasPermission } = useUser();
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [editRequest, setEditRequest] =
    useState<NonFunctionProperties<MediaRequest>>();
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [showBlocklistModal, setShowBlocklistModal] = useState(false);
  const [isBlocklisting, setIsBlocklisting] = useState(false);
  const [showManager, setShowManager] = useState(router.query.manage === '1');
  const [isWatchlistUpdating, setIsWatchlistUpdating] = useState(false);
  const [toggleWatchlist, setToggleWatchlist] = useState(true);
  const comicId =
    typeof router.query.comicId === 'string' ? router.query.comicId : '';

  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<ComicDetailsType>(
    comicId ? `/api/v1/comic/${encodeApiPathSegment(comicId)}` : null
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

  const canRequest = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_COMIC],
    { type: 'or' }
  );
  const isAvailable =
    data.mediaInfo?.status === MediaStatus.AVAILABLE ||
    data.mediaInfo?.status === MediaStatus.PARTIALLY_AVAILABLE;
  const activeRequests =
    data.mediaInfo?.requests?.filter(
      (request) =>
        request.status !== MediaRequestStatus.DECLINED &&
        request.status !== MediaRequestStatus.FAILED &&
        request.status !== MediaRequestStatus.COMPLETED
    ) ?? [];
  const activeRequest =
    activeRequests.find((request) => request.requestedBy?.id === user?.id) ??
    (hasPermission(Permission.MANAGE_REQUESTS) && activeRequests.length === 1
      ? activeRequests[0]
      : undefined);
  const canShowRequestButton =
    canRequest &&
    !isAvailable &&
    data.mediaInfo?.status !== MediaStatus.BLOCKLISTED &&
    !activeRequest;
  const notAvailable = intl.formatMessage(messages.notAvailable);
  const canUseManage = hasPermission(Permission.MANAGE_REQUESTS);
  const isManageAvailable = Boolean(
    data.mediaInfo && data.mediaInfo.status !== MediaStatus.UNKNOWN
  );
  const canWatchlist =
    data.mediaInfo?.status !== MediaStatus.BLOCKLISTED &&
    user?.userType !== UserType.PLEX;
  const canUseBlocklist = hasPermission(Permission.MANAGE_BLOCKLIST);
  const isBlocklistAvailable =
    data.mediaInfo?.status !== MediaStatus.BLOCKLISTED;
  const canUseReportIssue = hasPermission(
    [Permission.MANAGE_ISSUES, Permission.CREATE_ISSUES],
    { type: 'or' }
  );
  const isReportIssueAvailable =
    !!data.mediaInfo?.id &&
    (data.mediaInfo.status === MediaStatus.AVAILABLE ||
      data.mediaInfo.status === MediaStatus.PARTIALLY_AVAILABLE);
  const openIssues =
    data.mediaInfo?.issues?.filter(
      (issue) => issue.status === IssueStatus.OPEN
    ) ?? [];

  const addToWatchlist = async (): Promise<void> => {
    setIsWatchlistUpdating(true);

    try {
      const response = await axios.post('/api/v1/watchlist', {
        externalId: data.id,
        mediaType: MediaType.COMIC,
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
        `/api/v1/watchlist/${encodeApiPathSegment(data.id)}?mediaType=comic`
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

  const blocklistComic = async (): Promise<void> => {
    setIsBlocklisting(true);

    try {
      await axios.post('/api/v1/blocklist', {
        externalId: data.id,
        externalProvider: 'comicvine',
        mediaType: MediaType.COMIC,
        title: data.title,
      });
      addToast(
        <span>
          {intl.formatMessage(globalMessages.blocklistSuccess, {
            title: data.title,
            strong: (message: React.ReactNode) => (
              <strong key="strong">{message}</strong>
            ),
          })}
        </span>,
        { appearance: 'success', autoDismiss: true }
      );
      void revalidate();
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

  return (
    <>
      <PageTitle title={data.title} />
      {showManager && canUseManage && isManageAvailable && (
        <ExternalMediaManageSlideOver
          data={data}
          mediaType={MediaType.COMIC}
          onClose={() => {
            setShowManager(false);
            router.push({
              pathname: router.pathname,
              query: { comicId },
            });
          }}
          revalidate={() => revalidate()}
          show={showManager}
        />
      )}
      {showIssueModal && (
        <IssueModal
          show={showIssueModal}
          mediaType="comic"
          mediaId={data.mediaInfo?.id}
          title={data.title}
          backdrop={data.posterPath}
          onCancel={() => setShowIssueModal(false)}
        />
      )}
      {showBlocklistModal && (
        <ExternalBlocklistModal
          show
          type="comic"
          title={data.title}
          backdrop={data.posterPath}
          onCancel={() => setShowBlocklistModal(false)}
          onComplete={() => void blocklistComic()}
          isUpdating={isBlocklisting}
        />
      )}
      {showRequestModal && (
        <RequestModal
          comicId={data.id}
          editRequest={editRequest}
          show={showRequestModal}
          type="comic"
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
      <div className="media-page">
        <article className="media-detail-card refreshed-card-surface refreshed-detail-text relative overflow-hidden rounded-xl border border-gray-700 p-3 shadow-lg shadow-gray-950/20">
          {data.posterPath && (
            <MediaDetailArtwork src={data.posterPath} type="tmdb" />
          )}
          <div className="relative z-10">
            <div className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)] gap-3 sm:grid-cols-[80px_minmax(0,1fr)]">
              <div className="relative h-24 w-16 overflow-hidden rounded-lg ring-1 ring-gray-600 sm:h-[120px] sm:w-20">
                <CachedImage
                  type="tmdb"
                  src={data.posterPath || '/images/seerr_poster_not_found.png'}
                  alt=""
                  fill
                  priority
                  sizes="(min-width: 640px) 80px, 64px"
                  className="object-cover"
                />
              </div>
              <div className="flex min-w-0 flex-col">
                <h1 className="text-lg leading-5 font-semibold text-white">
                  {data.title}
                  {data.startYear ? ` (${data.startYear})` : ''}
                </h1>
                <dl className="mt-4 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs leading-4">
                  <dt className="font-medium text-gray-100">
                    {intl.formatMessage(messages.publisher)}:
                  </dt>
                  <dd className="m-0 truncate">
                    {data.publisher || notAvailable}
                  </dd>
                  <dt className="font-medium text-gray-100">
                    {intl.formatMessage(messages.issueCount)}:
                  </dt>
                  <dd className="m-0 truncate">
                    {data.issueCount
                      ? intl.formatNumber(data.issueCount)
                      : notAvailable}
                  </dd>
                  {data.mediaInfo?.status !== undefined && (
                    <>
                      <dt className="font-medium text-gray-100">
                        {intl.formatMessage(globalMessages.request)}:
                      </dt>
                      <dd className="m-0 truncate">
                        <AvailabilityValue
                          tone={getMediaAvailabilityTone(
                            data.mediaInfo?.status
                          )}
                        >
                          {isAvailable
                            ? intl.formatMessage(globalMessages.available)
                            : activeRequest
                              ? intl.formatMessage(globalMessages.requested)
                              : intl.formatMessage(globalMessages.notrequested)}
                        </AvailabilityValue>
                      </dd>
                    </>
                  )}
                </dl>
              </div>
            </div>

            <div className="media-primary-action-row">
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
                    aria-label={intl.formatMessage(
                      globalMessages.addToBlocklist
                    )}
                  >
                    <EyeSlashIcon />
                  </Button>
                </Tooltip>
              )}
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
                    onClick={
                      toggleWatchlist ? addToWatchlist : removeFromWatchlist
                    }
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
              {data.siteDetailUrl && (
                <a
                  href={data.siteDetailUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="app-button-default inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium"
                >
                  <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                  {intl.formatMessage(messages.viewOnComicVine)}
                </a>
              )}
              {activeRequest && (
                <Button
                  buttonType="ghost"
                  buttonSize="sm"
                  onClick={() => {
                    setEditRequest(activeRequest);
                    setShowRequestModal(true);
                  }}
                >
                  <InformationCircleIcon />
                  <span>{intl.formatMessage(messages.viewrequest)}</span>
                </Button>
              )}
              {canShowRequestButton && (
                <Button
                  buttonType="primary"
                  buttonSize="sm"
                  onClick={() => {
                    setEditRequest(undefined);
                    setShowRequestModal(true);
                  }}
                >
                  <ArrowDownTrayIcon />
                  <span>{intl.formatMessage(globalMessages.request)}</span>
                </Button>
              )}
            </div>

            <section className="refreshed-inset-surface mt-[5px] rounded-lg border border-gray-700 p-3">
              <h2 className="media-inset-heading">
                {intl.formatMessage(messages.overview)}
              </h2>
              <p className="refreshed-detail-text-muted mt-4 max-w-none text-sm leading-5">
                {data.description ||
                  data.deck ||
                  intl.formatMessage(messages.overviewUnavailable)}
              </p>
            </section>
            {hasPermission([Permission.MANAGE_ISSUES, Permission.VIEW_ISSUES], {
              type: 'or',
            }) &&
              openIssues.length > 0 && (
                <section className="refreshed-inset-surface mt-[5px] overflow-hidden rounded-lg border border-gray-700">
                  <h2 className="media-inset-heading px-3 py-2">
                    {intl.formatMessage(messages.openissues)}
                  </h2>
                  <ul className="border-t border-gray-700">
                    {openIssues.map((issue) => (
                      <li
                        key={`comic-issue-${issue.id}`}
                        className="border-b border-gray-700 last:border-b-0"
                      >
                        <IssueBlock issue={issue} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
          </div>
        </article>
        <div className="extra-bottom-space relative" />
      </div>
    </>
  );
};

export default ComicDetails;
