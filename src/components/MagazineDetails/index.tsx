import Spinner from '@app/assets/spinner.svg';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import Tooltip from '@app/components/Common/Tooltip';
import ExternalBlocklistModal from '@app/components/ExternalBlocklistModal';
import IssueBlock from '@app/components/IssueBlock';
import AvailabilityValue, {
  getMediaAvailabilityTone,
} from '@app/components/MediaDetails/AvailabilityValue';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import { encodeApiPathSegment } from '@app/utils/apiPath';
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
import type { MagazineDetails as MagazineDetailsType } from '@server/models/Magazine';
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

const messages = defineMessages('components.MagazineDetails', {
  status: 'Request status',
  issueCount: 'Issues',
  issueList: 'Known issues',
  issueDate: 'Issue date',
  issueAvailable: 'Available',
  issueMissing: 'Not available',
  noIssues: 'LazyLibrarian has no issue details for this title yet.',
  viewRequest: 'View Request',
  requestMagazine: 'Request Magazine',
  manageMagazine: 'Manage Magazine',
  notAvailable: 'Not available',
  watchlistSuccess: '<strong>{title}</strong> added to watchlist successfully!',
  watchlistDeleted:
    '<strong>{title}</strong> Removed from watchlist successfully!',
  watchlistError: 'Something went wrong. Please try again.',
  addToWatchlist: 'Add To Watchlist',
  removeFromWatchlist: 'Remove From Watchlist',
  reportIssue: 'Report an Issue',
  openIssues: 'Open Issues',
});

const MagazineDetails = () => {
  const router = useRouter();
  const intl = useIntl();
  const { addToast } = useToasts();
  const { user, hasPermission } = useUser();
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [showManager, setShowManager] = useState(router.query.manage === '1');
  const [showBlocklistModal, setShowBlocklistModal] = useState(false);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [isBlocklisting, setIsBlocklisting] = useState(false);
  const [isWatchlistUpdating, setIsWatchlistUpdating] = useState(false);
  const [toggleWatchlist, setToggleWatchlist] = useState(true);
  const [editRequest, setEditRequest] =
    useState<NonFunctionProperties<MediaRequest>>();
  const title =
    typeof router.query.title === 'string' ? router.query.title : '';
  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<MagazineDetailsType>(
    title ? `/api/v1/magazine/${encodeApiPathSegment(title)}` : null
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
    [Permission.REQUEST, Permission.REQUEST_MAGAZINE],
    { type: 'or' }
  );
  const isAvailable =
    data.mediaInfo?.status === MediaStatus.AVAILABLE ||
    data.mediaInfo?.status === MediaStatus.PARTIALLY_AVAILABLE;
  const isProcessing = data.mediaInfo?.status === MediaStatus.PROCESSING;
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
    !isProcessing &&
    data.mediaInfo?.status !== MediaStatus.BLOCKLISTED &&
    !activeRequest;
  const canUseManage = hasPermission(Permission.MANAGE_REQUESTS);
  const canUseBlocklist = hasPermission(Permission.MANAGE_BLOCKLIST);
  const isBlocklistAvailable =
    data.mediaInfo?.status !== MediaStatus.BLOCKLISTED;
  const canWatchlist =
    data.mediaInfo?.status !== MediaStatus.BLOCKLISTED &&
    user?.userType !== UserType.PLEX;
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
  const isManageAvailable = Boolean(
    data.mediaInfo && data.mediaInfo.status !== MediaStatus.UNKNOWN
  );
  const notAvailable = intl.formatMessage(messages.notAvailable);

  const blocklistMagazine = async (): Promise<void> => {
    setIsBlocklisting(true);
    try {
      await axios.post('/api/v1/blocklist', {
        externalId: data.id,
        externalProvider: 'lazylibrarian',
        mediaType: MediaType.MAGAZINE,
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

  const addToWatchlist = async (): Promise<void> => {
    setIsWatchlistUpdating(true);
    try {
      await axios.post('/api/v1/watchlist', {
        externalId: data.id,
        mediaType: MediaType.MAGAZINE,
        title: data.title,
      });
      setToggleWatchlist(false);
      addToast(
        <span>
          {intl.formatMessage(messages.watchlistSuccess, {
            title: data.title,
            strong: (message: React.ReactNode) => <strong>{message}</strong>,
          })}
        </span>,
        { appearance: 'success', autoDismiss: true }
      );
    } catch {
      addToast(intl.formatMessage(messages.watchlistError), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsWatchlistUpdating(false);
      void revalidate();
    }
  };

  const removeFromWatchlist = async (): Promise<void> => {
    setIsWatchlistUpdating(true);
    try {
      await axios.delete(
        `/api/v1/watchlist/${encodeApiPathSegment(data.id)}?mediaType=magazine`
      );
      setToggleWatchlist(true);
      addToast(
        <span>
          {intl.formatMessage(messages.watchlistDeleted, {
            title: data.title,
            strong: (message: React.ReactNode) => <strong>{message}</strong>,
          })}
        </span>,
        { appearance: 'info', autoDismiss: true }
      );
    } catch {
      addToast(intl.formatMessage(messages.watchlistError), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsWatchlistUpdating(false);
      void revalidate();
    }
  };

  return (
    <>
      <PageTitle title={data.title} />
      {showManager && canUseManage && isManageAvailable && (
        <ExternalMediaManageSlideOver
          data={data}
          mediaType={MediaType.MAGAZINE}
          onClose={() => {
            setShowManager(false);
            void router.push({
              pathname: router.pathname,
              query: { title },
            });
          }}
          revalidate={() => revalidate()}
          show={showManager}
        />
      )}
      {showRequestModal && (
        <RequestModal
          magazineTitle={data.title}
          editRequest={editRequest}
          show
          type="magazine"
          onComplete={() => {
            setEditRequest(undefined);
            setShowRequestModal(false);
            void revalidate();
          }}
          onCancel={() => {
            setEditRequest(undefined);
            setShowRequestModal(false);
          }}
        />
      )}
      {showBlocklistModal && (
        <ExternalBlocklistModal
          show
          type="magazine"
          title={data.title}
          onCancel={() => setShowBlocklistModal(false)}
          onComplete={() => void blocklistMagazine()}
          isUpdating={isBlocklisting}
        />
      )}
      {showIssueModal && (
        <IssueModal
          show={showIssueModal}
          mediaType="magazine"
          mediaId={data.mediaInfo?.id}
          title={data.title}
          backdrop={data.posterPath}
          onCancel={() => setShowIssueModal(false)}
        />
      )}
      <div className="media-page">
        <article className="media-detail-card refreshed-card-surface refreshed-detail-text relative overflow-hidden rounded-xl border border-gray-700 p-3 shadow-lg shadow-gray-950/20">
          <div className="relative z-10">
            <h1 className="text-lg leading-5 font-semibold text-white">
              {data.title}
            </h1>
            <dl className="mt-4 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs leading-4">
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.issueCount)}:
              </dt>
              <dd className="m-0 truncate">
                {data.issueCount !== undefined
                  ? intl.formatNumber(data.issueCount)
                  : notAvailable}
              </dd>
              {data.mediaInfo?.status !== undefined && (
                <>
                  <dt className="font-medium text-gray-100">
                    {intl.formatMessage(messages.status)}:
                  </dt>
                  <dd className="m-0 truncate">
                    <AvailabilityValue
                      tone={getMediaAvailabilityTone(data.mediaInfo.status)}
                    >
                      {data.mediaInfo.status === MediaStatus.BLOCKLISTED
                        ? intl.formatMessage(globalMessages.blocklisted)
                        : isAvailable
                          ? intl.formatMessage(globalMessages.available)
                          : activeRequest || isProcessing
                            ? intl.formatMessage(globalMessages.requested)
                            : intl.formatMessage(globalMessages.notrequested)}
                    </AvailabilityValue>
                  </dd>
                </>
              )}
            </dl>

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
                      ? messages.addToWatchlist
                      : messages.removeFromWatchlist
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
                        ? messages.addToWatchlist
                        : messages.removeFromWatchlist
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
              {canUseManage && isManageAvailable && (
                <Button
                  buttonType="ghost"
                  buttonSize="sm"
                  onClick={() => setShowManager(true)}
                >
                  <CogIcon />
                  <span>{intl.formatMessage(messages.manageMagazine)}</span>
                  {openIssues.length > 0 && (
                    <span className="ml-1 rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white">
                      {intl.formatNumber(openIssues.length)}
                    </span>
                  )}
                </Button>
              )}
              {canUseReportIssue && (
                <Tooltip
                  content={intl.formatMessage(
                    isReportIssueAvailable
                      ? messages.reportIssue
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
                    aria-label={intl.formatMessage(messages.reportIssue)}
                  >
                    <ExclamationTriangleIcon />
                  </Button>
                </Tooltip>
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
                  <span>{intl.formatMessage(messages.viewRequest)}</span>
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
                  <span>{intl.formatMessage(messages.requestMagazine)}</span>
                </Button>
              )}
            </div>

            {hasPermission([Permission.MANAGE_ISSUES, Permission.VIEW_ISSUES], {
              type: 'or',
            }) &&
              openIssues.length > 0 && (
                <section className="refreshed-inset-surface mt-[5px] overflow-hidden rounded-lg border border-gray-700">
                  <h2 className="media-inset-heading px-3 py-2">
                    {intl.formatMessage(messages.openIssues)}
                  </h2>
                  <ul className="border-t border-gray-700">
                    {openIssues.map((issue) => (
                      <li
                        key={`magazine-issue-${issue.id}`}
                        className="border-b border-gray-700 last:border-b-0"
                      >
                        <IssueBlock issue={issue} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}

            <section className="refreshed-inset-surface mt-[5px] rounded-lg border border-gray-700 p-3">
              <h2 className="media-inset-heading">
                {intl.formatMessage(messages.issueList)}
              </h2>
              {data.issues.length > 0 ? (
                <ul className="mt-3 divide-y divide-gray-700">
                  {data.issues.map((issue, index) => (
                    <li
                      key={`${issue.id}-${index}`}
                      className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium text-white">
                          {issue.id}
                        </div>
                        {issue.date && (
                          <div className="refreshed-detail-text-muted text-xs">
                            {intl.formatMessage(messages.issueDate)}:{' '}
                            {issue.date}
                          </div>
                        )}
                      </div>
                      <AvailabilityValue
                        tone={
                          issue.available
                            ? getMediaAvailabilityTone(MediaStatus.AVAILABLE)
                            : getMediaAvailabilityTone(MediaStatus.UNKNOWN)
                        }
                      >
                        {intl.formatMessage(
                          issue.available
                            ? messages.issueAvailable
                            : messages.issueMissing
                        )}
                      </AvailabilityValue>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="refreshed-detail-text-muted mt-3 text-sm">
                  {intl.formatMessage(messages.noIssues)}
                </p>
              )}
            </section>
          </div>
        </article>
        <div className="extra-bottom-space relative" />
      </div>
    </>
  );
};

export default MagazineDetails;
