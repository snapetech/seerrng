import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import Modal from '@app/components/Common/Modal';
import Tooltip from '@app/components/Common/Tooltip';
import DownloadBlock from '@app/components/DownloadBlock';
import IssueMediaSummary from '@app/components/IssueDetails/IssueMediaSummary';
import JellystatWatchSummary from '@app/components/Media/JellystatWatchSummary';
import AvailabilityValue from '@app/components/MediaDetails/AvailabilityValue';
import RequestBlock from '@app/components/RequestBlock';
import SelectableDownloadList from '@app/components/SelectableDownloadList';
import useSettings from '@app/hooks/useSettings';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { getSafeHref } from '@app/utils/safeUrl';
import { Transition } from '@headlessui/react';
import { Bars4Icon } from '@heroicons/react/24/outline';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import type { MediaWatchDataResponse } from '@server/interfaces/api/mediaInterfaces';
import type { DownloadingItem } from '@server/lib/downloadtracker';
import type { MovieDetails } from '@server/models/Movie';
import type { TvDetails } from '@server/models/Tv';
import Link from 'next/link';
import { useIntl } from 'react-intl';
import useSWR from 'swr';
import ManageMediaActions from './ManageMediaActions';

import { Fragment, useState, type JSX } from 'react';

const filterDuplicateDownloads = (
  items: DownloadingItem[] = []
): DownloadingItem[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.downloadId)) return false;
    seen.add(item.downloadId);
    return true;
  });
};

const messages = defineMessages('components.ManageSlideOver', {
  manageModalTitle: 'Manage {mediaType}',
  manageModalIssues: 'Open Issues',
  manageModalRequests: 'Requests',
  manageModalNoRequests: 'No requests',
  openarr: 'Open in {arr}',
  openarr4k: 'Open in 4K {arr}',
  downloadstatus: 'Downloads',
  opentautulli: 'Open in Tautulli',
  plays:
    '<strong>{playCount, number}</strong> {playCount, plural, one {play} other {plays}}',
  pastdays: 'Past {days, number} Days',
  alltime: 'All Time',
  playedby: 'Played By',
  movie: 'movie',
  tvshow: 'series',
});

interface ManageSlideOverProps {
  // mediaType: 'movie' | 'tv';
  show?: boolean;
  onClose: () => void;
  revalidate: () => void;
}

interface ManageSlideOverMovieProps extends ManageSlideOverProps {
  mediaType: 'movie';
  data: MovieDetails;
}

interface ManageSlideOverTvProps extends ManageSlideOverProps {
  mediaType: 'tv';
  data: TvDetails;
}

const ManageSlideOver = ({
  show,
  mediaType,
  onClose,
  data,
  revalidate,
}: ManageSlideOverMovieProps | ManageSlideOverTvProps) => {
  const { user: currentUser, hasPermission } = useUser();
  const intl = useIntl();
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const settings = useSettings();
  const { data: watchData } = useSWR<MediaWatchDataResponse>(
    settings.currentSettings.mediaServerType === MediaServerType.PLEX &&
      data.mediaInfo &&
      hasPermission(Permission.ADMIN)
      ? `/api/v1/media/${data.mediaInfo.id}/watch_data`
      : null
  );
  const safeServiceUrl = getSafeHref(data.mediaInfo?.serviceUrl);
  const safeServiceUrl4k = getSafeHref(data.mediaInfo?.serviceUrl4k);
  const safeTautulliUrl = getSafeHref(data.mediaInfo?.tautulliUrl);
  const safeTautulliUrl4k = getSafeHref(data.mediaInfo?.tautulliUrl4k);
  const manageBackdrop = data.backdropPath
    ? `https://image.tmdb.org/t/p/original${data.backdropPath}`
    : undefined;

  const requests =
    data.mediaInfo?.requests?.filter(
      (request) => request.status !== MediaRequestStatus.DECLINED
    ) ?? [];

  const getManageStatus = (status: MediaStatus | undefined) => {
    switch (status) {
      case MediaStatus.AVAILABLE:
        return intl.formatMessage(globalMessages.available);
      case MediaStatus.PARTIALLY_AVAILABLE:
        return intl.formatMessage(globalMessages.partiallyavailable);
      case MediaStatus.PROCESSING:
        return intl.formatMessage(globalMessages.processing);
      case MediaStatus.PENDING:
        return intl.formatMessage(globalMessages.requested);
      case MediaStatus.BLOCKLISTED:
        return intl.formatMessage(globalMessages.blocklisted);
      default:
        return intl.formatMessage(globalMessages.unavailable);
    }
  };

  const styledPlayCount = (playCount: number): JSX.Element => {
    return (
      <>
        {intl.formatMessage(messages.plays, {
          playCount,
          strong: (msg: React.ReactNode) => (
            <strong className="text-2xl font-semibold">{msg}</strong>
          ),
        })}
      </>
    );
  };

  return (
    <Transition appear show={Boolean(show)} as={Fragment}>
      <Modal
        ariaLabel={intl.formatMessage(messages.manageModalTitle, {
          mediaType: intl.formatMessage(
            mediaType === 'movie' ? globalMessages.movie : globalMessages.tvshow
          ),
        })}
        onCancel={onClose}
        backgroundClickable={!confirmationOpen}
        cancelButtonType="danger"
        actionButtonSize="standard"
        actionsClass="!justify-start"
        backdrop={manageBackdrop}
        backdropFull
        dialogClass="app-card-main refreshed-card-surface refreshed-detail-text manage-media-dialog"
        contentClass="manage-dialog-content"
      >
        <div className="manage-media-stack">
          <IssueMediaSummary
            data={data}
            mediaType={mediaType}
            embedded
            rightDetails={[
              {
                label: 'HD',
                value: (
                  <AvailabilityValue status={data.mediaInfo?.status}>
                    {getManageStatus(data.mediaInfo?.status)}
                  </AvailabilityValue>
                ),
              },
              {
                label: '4K',
                value: (
                  <AvailabilityValue status={data.mediaInfo?.status4k}>
                    {getManageStatus(data.mediaInfo?.status4k)}
                  </AvailabilityValue>
                ),
              },
            ]}
          />
          <div className="manage-media-card-sections card-stack">
            {((data?.mediaInfo?.downloadStatus ?? []).length > 0 ||
              (data?.mediaInfo?.downloadStatus4k ?? []).length > 0) && (
              <div>
                <h3 className="manage-media-section-title">
                  {intl.formatMessage(messages.downloadstatus)}
                </h3>
                <div className="overflow-hidden rounded-md border border-gray-700 shadow">
                  <SelectableDownloadList
                    items={[
                      ...filterDuplicateDownloads(
                        data.mediaInfo?.downloadStatus
                      ).map((status, index) => ({
                        id: `standard-${status.downloadId ?? status.externalId ?? index}`,
                        tooltip: status.title,
                        content: <DownloadBlock downloadItem={status} />,
                      })),
                      ...filterDuplicateDownloads(
                        data.mediaInfo?.downloadStatus4k
                      ).map((status, index) => ({
                        id: `4k-${status.downloadId ?? status.externalId ?? index}`,
                        tooltip: status.title,
                        content: <DownloadBlock downloadItem={status} is4k />,
                      })),
                    ]}
                  />
                </div>
              </div>
            )}
            {requests.length > 0 && (
              <div>
                <h3 className="manage-media-section-title">
                  {intl.formatMessage(messages.manageModalRequests)}
                </h3>
                <div className="overflow-hidden rounded-md border border-gray-700 shadow">
                  <ul>
                    {requests.map((request) => (
                      <li
                        key={`manage-request-${request.id}`}
                        className="border-b border-gray-700 last:border-b-0"
                      >
                        <RequestBlock
                          hideDeleteAction
                          request={request}
                          mediaType={
                            mediaType === 'movie'
                              ? MediaType.MOVIE
                              : MediaType.TV
                          }
                          tmdbId={data.id}
                          onUpdate={() => revalidate()}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {hasPermission(Permission.ADMIN) &&
              (safeServiceUrl ||
                safeTautulliUrl ||
                watchData?.data ||
                safeServiceUrl4k ||
                safeTautulliUrl4k ||
                watchData?.data4k ||
                data.mediaInfo) && (
                <div>
                  <div
                    className="card-stack"
                    data-testid="manage-advanced-actions"
                  >
                    {data.mediaInfo && (
                      <ManageMediaActions
                        media={data.mediaInfo}
                        mediaType={
                          mediaType === 'movie' ? MediaType.MOVIE : MediaType.TV
                        }
                        title={mediaType === 'movie' ? data.title : data.name}
                        year={(mediaType === 'movie'
                          ? data.releaseDate
                          : data.firstAirDate
                        )?.slice(0, 4)}
                        onUpdate={revalidate}
                        onDialogChange={setConfirmationOpen}
                      />
                    )}
                    {data.mediaInfo && hasPermission(Permission.ADMIN) && (
                      <JellystatWatchSummary mediaId={data.mediaInfo.id} />
                    )}
                    {(safeTautulliUrl || watchData?.data) && (
                      <div className="flex flex-wrap items-start gap-2">
                        {(watchData?.data || safeTautulliUrl) && (
                          <div className="basis-full">
                            {!!watchData?.data && (
                              <div
                                className={`grid grid-cols-1 divide-y divide-gray-700 overflow-hidden border-gray-700 text-sm text-gray-300 shadow ${
                                  safeTautulliUrl
                                    ? 'rounded-t-md border-x border-t'
                                    : 'rounded-md border'
                                }`}
                              >
                                <div className="grid grid-cols-3 divide-x divide-gray-700">
                                  <div className="px-4 py-3">
                                    <div className="font-bold">
                                      {intl.formatMessage(messages.pastdays, {
                                        days: 7,
                                      })}
                                    </div>
                                    <div className="text-white">
                                      {styledPlayCount(
                                        watchData.data.playCount7Days
                                      )}
                                    </div>
                                  </div>
                                  <div className="px-4 py-3">
                                    <div className="font-bold">
                                      {intl.formatMessage(messages.pastdays, {
                                        days: 30,
                                      })}
                                    </div>
                                    <div className="text-white">
                                      {styledPlayCount(
                                        watchData.data.playCount30Days
                                      )}
                                    </div>
                                  </div>
                                  <div className="px-4 py-3">
                                    <div className="font-bold">
                                      {intl.formatMessage(messages.alltime)}
                                    </div>
                                    <div className="text-white">
                                      {styledPlayCount(
                                        watchData.data.playCount
                                      )}
                                    </div>
                                  </div>
                                </div>
                                {!!watchData.data.users.length && (
                                  <div className="flex flex-row space-x-2 px-4 pt-3 pb-2">
                                    <span className="shrink-0 leading-8 font-bold">
                                      {intl.formatMessage(messages.playedby)}
                                    </span>
                                    <span className="flex flex-row flex-wrap">
                                      {watchData.data.users.map((user) => (
                                        <Link
                                          href={
                                            currentUser?.id === user.id
                                              ? '/profile'
                                              : `/users/${user.id}`
                                          }
                                          key={`watch-user-${user.id}`}
                                          className="z-0 -mr-2 mb-1 shrink-0 hover:z-50"
                                        >
                                          <Tooltip
                                            key={`watch-user-${user.id}`}
                                            content={user.displayName}
                                          >
                                            <CachedImage
                                              type="avatar"
                                              src={user.avatar}
                                              alt={user.displayName}
                                              className="h-8 w-8 scale-100 transform-gpu rounded-full object-cover ring-1 ring-gray-500 transition duration-300 hover:scale-105"
                                              width={32}
                                              height={32}
                                            />
                                          </Tooltip>
                                        </Link>
                                      ))}
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}
                            {safeTautulliUrl && (
                              <a
                                href={safeTautulliUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <Button
                                  buttonType="ghost"
                                  buttonSize="standard"
                                >
                                  <Bars4Icon />
                                  <span>
                                    {intl.formatMessage(messages.opentautulli)}
                                  </span>
                                </Button>
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {(safeTautulliUrl4k || watchData?.data4k) && (
                      <div className="flex flex-wrap items-start gap-2">
                        {(watchData?.data4k || safeTautulliUrl4k) && (
                          <div className="basis-full">
                            {watchData?.data4k && (
                              <div
                                className={`grid grid-cols-1 divide-y divide-gray-700 overflow-hidden border-gray-700 text-sm text-gray-300 shadow ${
                                  safeTautulliUrl4k
                                    ? 'rounded-t-md border-x border-t'
                                    : 'rounded-md border'
                                }`}
                              >
                                <div className="grid grid-cols-3 divide-x divide-gray-700">
                                  <div className="px-4 py-3">
                                    <div className="font-bold">
                                      {intl.formatMessage(messages.pastdays, {
                                        days: 7,
                                      })}
                                    </div>
                                    <div className="text-white">
                                      {styledPlayCount(
                                        watchData.data4k.playCount7Days
                                      )}
                                    </div>
                                  </div>
                                  <div className="px-4 py-3">
                                    <div className="font-bold">
                                      {intl.formatMessage(messages.pastdays, {
                                        days: 30,
                                      })}
                                    </div>
                                    <div className="text-white">
                                      {styledPlayCount(
                                        watchData.data4k.playCount30Days
                                      )}
                                    </div>
                                  </div>
                                  <div className="px-4 py-3">
                                    <div className="font-bold">
                                      {intl.formatMessage(messages.alltime)}
                                    </div>
                                    <div className="text-white">
                                      {styledPlayCount(
                                        watchData.data4k.playCount
                                      )}
                                    </div>
                                  </div>
                                </div>
                                {!!watchData.data4k.users.length && (
                                  <div className="flex flex-row space-x-2 px-4 pt-3 pb-2">
                                    <span className="shrink-0 leading-8 font-bold">
                                      {intl.formatMessage(messages.playedby)}
                                    </span>
                                    <span className="flex flex-row flex-wrap">
                                      {watchData.data4k.users.map((user) => (
                                        <Link
                                          href={
                                            currentUser?.id === user.id
                                              ? '/profile'
                                              : `/users/${user.id}`
                                          }
                                          key={`watch-user-${user.id}`}
                                          className="z-0 -mr-2 mb-1 shrink-0 hover:z-50"
                                        >
                                          <Tooltip
                                            key={`watch-user-${user.id}`}
                                            content={user.displayName}
                                          >
                                            <CachedImage
                                              type="avatar"
                                              src={user.avatar}
                                              alt={user.displayName}
                                              className="h-8 w-8 scale-100 transform-gpu rounded-full object-cover ring-1 ring-gray-500 transition duration-300 hover:scale-105"
                                              width={32}
                                              height={32}
                                            />
                                          </Tooltip>
                                        </Link>
                                      ))}
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}
                            {safeTautulliUrl4k && (
                              <a
                                href={safeTautulliUrl4k}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <Button
                                  buttonType="ghost"
                                  buttonSize="standard"
                                >
                                  <Bars4Icon />
                                  <span>
                                    {intl.formatMessage(messages.opentautulli)}
                                  </span>
                                </Button>
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
          </div>
        </div>
      </Modal>
    </Transition>
  );
};

export default ManageSlideOver;
