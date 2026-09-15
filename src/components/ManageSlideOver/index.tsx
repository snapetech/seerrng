import BlocklistBlock from '@app/components/BlocklistBlock';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import ConfirmButton from '@app/components/Common/ConfirmButton';
import Modal from '@app/components/Common/Modal';
import Tooltip from '@app/components/Common/Tooltip';
import DownloadBlock from '@app/components/DownloadBlock';
import IssueMediaSummary from '@app/components/IssueDetails/IssueMediaSummary';
import IssueItem from '@app/components/IssueList/IssueItem';
import AvailabilityValue from '@app/components/MediaDetails/AvailabilityValue';
import RequestBlock from '@app/components/RequestBlock';
import SelectableDownloadList from '@app/components/SelectableDownloadList';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { getSafeHref } from '@app/utils/safeUrl';
import { Transition } from '@headlessui/react';
import { Bars4Icon, ServerIcon } from '@heroicons/react/24/outline';
import {
  CheckCircleIcon,
  DocumentMinusIcon,
  TrashIcon,
} from '@heroicons/react/24/solid';
import { IssueStatus } from '@server/constants/issue';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import type { MediaWatchDataResponse } from '@server/interfaces/api/mediaInterfaces';
import type { DownloadingItem } from '@server/lib/downloadtracker';
import type { RadarrSettings, SonarrSettings } from '@server/lib/settings';
import type { MovieDetails } from '@server/models/Movie';
import type { TvDetails } from '@server/models/Tv';
import axios from 'axios';
import Link from 'next/link';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

import { Fragment, type JSX } from 'react';

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
  manageModalAdvanced: 'Advanced',
  manageModalNoRequests: 'No requests',
  manageModalClearMedia: 'Clear Data',
  manageModalClearMediaWarning:
    '* This will irreversibly remove all data for this {mediaType}, including any requests. If this item exists in your {mediaServerName} library, the media information will be recreated during the next scan.',
  manageModalRemoveMediaWarning:
    '* This will irreversibly remove this {mediaType} from {arr}, including all files.',
  openarr: 'Open in {arr}',
  removearr: 'Remove from {arr}',
  openarr4k: 'Open in 4K {arr}',
  removearr4k: 'Remove from 4K {arr}',
  clearmediadataerror: 'Something went wrong while clearing the media data.',
  removemediaerror: 'Something went wrong while removing the media.',
  downloadstatus: 'Downloads',
  markavailable: 'Mark as Available',
  mark4kavailable: 'Mark as Available in 4K',
  markallseasonsavailable: 'Mark All Seasons as Available',
  markallseasons4kavailable: 'Mark All Seasons as Available in 4K',
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
  const { addToast } = useToasts();
  const settings = useSettings();
  const { data: watchData } = useSWR<MediaWatchDataResponse>(
    settings.currentSettings.mediaServerType === MediaServerType.PLEX &&
      data.mediaInfo &&
      hasPermission(Permission.ADMIN)
      ? `/api/v1/media/${data.mediaInfo.id}/watch_data`
      : null
  );
  const { data: radarrData } = useSWR<RadarrSettings[]>(
    hasPermission(Permission.ADMIN) ? '/api/v1/settings/radarr' : null
  );
  const { data: sonarrData } = useSWR<SonarrSettings[]>(
    hasPermission(Permission.ADMIN) ? '/api/v1/settings/sonarr' : null
  );
  const safeServiceUrl = getSafeHref(data.mediaInfo?.serviceUrl);
  const safeServiceUrl4k = getSafeHref(data.mediaInfo?.serviceUrl4k);
  const safeTautulliUrl = getSafeHref(data.mediaInfo?.tautulliUrl);
  const safeTautulliUrl4k = getSafeHref(data.mediaInfo?.tautulliUrl4k);
  const manageBackdrop = data.backdropPath
    ? `https://image.tmdb.org/t/p/original${data.backdropPath}`
    : undefined;

  const deleteMedia = async () => {
    if (data.mediaInfo) {
      try {
        await axios.delete(`/api/v1/media/${data.mediaInfo.id}`);
        revalidate();
        onClose();
      } catch {
        addToast(intl.formatMessage(messages.clearmediadataerror), {
          appearance: 'error',
          autoDismiss: true,
        });
      }
    }
  };

  const deleteMediaFile = async (is4k = false) => {
    if (data.mediaInfo) {
      try {
        await axios.delete(
          `/api/v1/media/${data.mediaInfo.id}/file?is4k=${is4k}`
        );
      } catch (e) {
        if (!axios.isAxiosError(e) || e.response?.status !== 404) {
          addToast(intl.formatMessage(messages.removemediaerror), {
            appearance: 'error',
            autoDismiss: true,
          });
          revalidate();
          return;
        }
      }
      revalidate();
      onClose();
    }
  };

  const isDefaultService = () => {
    if (data.mediaInfo) {
      if (data.mediaInfo.mediaType === MediaType.MOVIE) {
        return (
          radarrData?.find(
            (radarr) =>
              radarr.isDefault && radarr.id === data.mediaInfo?.serviceId
          ) !== undefined
        );
      } else {
        return (
          sonarrData?.find(
            (sonarr) =>
              sonarr.isDefault && sonarr.id === data.mediaInfo?.serviceId
          ) !== undefined
        );
      }
    }
    return false;
  };

  const isDefault4kService = () => {
    if (data.mediaInfo) {
      if (data.mediaInfo.mediaType === MediaType.MOVIE) {
        return (
          radarrData?.find(
            (radarr) =>
              radarr.isDefault &&
              radarr.is4k &&
              radarr.id === data.mediaInfo?.serviceId4k
          ) !== undefined
        );
      } else {
        return (
          sonarrData?.find(
            (sonarr) =>
              sonarr.isDefault &&
              sonarr.is4k &&
              sonarr.id === data.mediaInfo?.serviceId4k
          ) !== undefined
        );
      }
    }
    return false;
  };

  const markAvailable = async (is4k = false) => {
    if (data.mediaInfo) {
      await axios.post(`/api/v1/media/${data.mediaInfo?.id}/available`, {
        is4k,
        ...(mediaType === 'tv' && {
          seasons: data.seasons.filter((season) => season.seasonNumber !== 0),
        }),
      });
      revalidate();
    }
  };

  const requests =
    data.mediaInfo?.requests?.filter(
      (request) => request.status !== MediaRequestStatus.DECLINED
    ) ?? [];

  const openIssues =
    data.mediaInfo?.issues?.filter(
      (issue) => issue.status === IssueStatus.OPEN
    ) ?? [];
  const canViewIssues = hasPermission(
    [Permission.MANAGE_ISSUES, Permission.VIEW_ISSUES],
    { type: 'or' }
  );

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
        cancelButtonType="danger"
        actionButtonSize="standard"
        actionsClass="!mt-[5px] !justify-start"
        backdrop={manageBackdrop}
        backdropFull
        dialogClass="refreshed-card-surface refreshed-detail-text !w-[calc(100%-2rem)] rounded-xl border border-gray-700 shadow-lg shadow-gray-950/20 sm:!max-w-5xl"
      >
        <div className="-mt-4 space-y-[5px]">
          {canViewIssues && openIssues.length > 0 ? (
            <div className="space-y-[5px]">
              {openIssues.map((issue) => (
                <IssueItem key={`manage-issue-${issue.id}`} issue={issue} />
              ))}
            </div>
          ) : (
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
                {
                  label: 'Requests',
                  value: intl.formatNumber(requests.length),
                },
                {
                  label: intl.formatMessage(messages.manageModalIssues),
                  value: intl.formatNumber(openIssues.length),
                },
              ]}
            />
          )}
          <div className="manage-media-card-sections space-y-[5px]">
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
                          request={request}
                          onUpdate={() => revalidate()}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {data.mediaInfo?.status === MediaStatus.BLOCKLISTED && (
              <div>
                <h3 className="manage-media-section-title">
                  {intl.formatMessage(globalMessages.blocklist)}
                </h3>
                <div className="overflow-hidden rounded-md border border-gray-700 shadow">
                  <BlocklistBlock
                    tmdbId={data.mediaInfo.tmdbId}
                    mediaType={data.mediaInfo.mediaType}
                    onUpdate={() => revalidate()}
                    onDelete={() => onClose()}
                  />
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
                (data.mediaInfo &&
                  data.mediaInfo.status !== MediaStatus.BLOCKLISTED)) && (
                <div>
                  <h3 className="manage-media-section-title">
                    {intl.formatMessage(messages.manageModalAdvanced)}
                  </h3>
                  <div
                    className="space-y-[5px]"
                    data-testid="manage-advanced-actions"
                  >
                    {(safeServiceUrl || safeTautulliUrl || watchData?.data) && (
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
                        {safeServiceUrl && (
                          <a
                            href={safeServiceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-block"
                          >
                            <Button buttonType="ghost" buttonSize="standard">
                              <ServerIcon />
                              <span>
                                {intl.formatMessage(messages.openarr, {
                                  arr:
                                    mediaType === 'movie' ? 'Radarr' : 'Sonarr',
                                })}
                              </span>
                            </Button>
                          </a>
                        )}

                        {hasPermission(Permission.ADMIN) &&
                          safeServiceUrl &&
                          isDefaultService() && (
                            <div className="flex min-w-0 flex-col items-start">
                              <ConfirmButton
                                buttonSize="standard"
                                onClick={() => deleteMediaFile(false)}
                                confirmText={intl.formatMessage(
                                  globalMessages.areyousure
                                )}
                              >
                                <TrashIcon />
                                <span>
                                  {intl.formatMessage(messages.removearr, {
                                    arr:
                                      mediaType === 'movie'
                                        ? 'Radarr'
                                        : 'Sonarr',
                                  })}
                                </span>
                              </ConfirmButton>
                              <div className="mt-1 text-xs text-gray-400">
                                {intl.formatMessage(
                                  messages.manageModalRemoveMediaWarning,
                                  {
                                    mediaType: intl.formatMessage(
                                      mediaType === 'movie'
                                        ? messages.movie
                                        : messages.tvshow
                                    ),
                                    arr:
                                      mediaType === 'movie'
                                        ? 'Radarr'
                                        : 'Sonarr',
                                  }
                                )}
                              </div>
                            </div>
                          )}
                      </div>
                    )}
                    {(safeServiceUrl4k ||
                      safeTautulliUrl4k ||
                      watchData?.data4k) && (
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
                        {safeServiceUrl4k && (
                          <>
                            <a
                              href={safeServiceUrl4k}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-block"
                            >
                              <Button buttonType="ghost" buttonSize="standard">
                                <ServerIcon />
                                <span>
                                  {intl.formatMessage(messages.openarr4k, {
                                    arr:
                                      mediaType === 'movie'
                                        ? 'Radarr'
                                        : 'Sonarr',
                                  })}
                                </span>
                              </Button>
                            </a>
                            {isDefault4kService() && (
                              <div className="flex min-w-0 flex-col items-start">
                                <ConfirmButton
                                  buttonSize="standard"
                                  onClick={() => deleteMediaFile(true)}
                                  confirmText={intl.formatMessage(
                                    globalMessages.areyousure
                                  )}
                                >
                                  <TrashIcon />
                                  <span>
                                    {intl.formatMessage(messages.removearr4k, {
                                      arr:
                                        mediaType === 'movie'
                                          ? 'Radarr'
                                          : 'Sonarr',
                                    })}
                                  </span>
                                </ConfirmButton>
                                <div className="mt-1 text-xs text-gray-400">
                                  {intl.formatMessage(
                                    messages.manageModalRemoveMediaWarning,
                                    {
                                      mediaType: intl.formatMessage(
                                        mediaType === 'movie'
                                          ? messages.movie
                                          : messages.tvshow
                                      ),
                                      arr:
                                        mediaType === 'movie'
                                          ? 'Radarr'
                                          : 'Sonarr',
                                    }
                                  )}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                    {data.mediaInfo &&
                      data.mediaInfo.status !== MediaStatus.BLOCKLISTED && (
                        <div className="flex flex-wrap gap-2">
                          {data?.mediaInfo.status !== MediaStatus.AVAILABLE && (
                            <Button
                              buttonSize="standard"
                              onClick={() => markAvailable()}
                              buttonType="success"
                            >
                              <CheckCircleIcon />
                              <span>
                                {intl.formatMessage(
                                  mediaType === 'movie'
                                    ? messages.markavailable
                                    : messages.markallseasonsavailable
                                )}
                              </span>
                            </Button>
                          )}
                          {data?.mediaInfo.status4k !== MediaStatus.AVAILABLE &&
                            settings.currentSettings.series4kEnabled && (
                              <Button
                                buttonSize="standard"
                                onClick={() => markAvailable(true)}
                                buttonType="success"
                              >
                                <CheckCircleIcon />
                                <span>
                                  {intl.formatMessage(
                                    mediaType === 'movie'
                                      ? messages.mark4kavailable
                                      : messages.markallseasons4kavailable
                                  )}
                                </span>
                              </Button>
                            )}
                          <div className="flex min-w-0 basis-full flex-col items-start">
                            <ConfirmButton
                              buttonSize="standard"
                              onClick={() => deleteMedia()}
                              confirmText={intl.formatMessage(
                                globalMessages.areyousure
                              )}
                            >
                              <DocumentMinusIcon />
                              <span>
                                {intl.formatMessage(
                                  messages.manageModalClearMedia
                                )}
                              </span>
                            </ConfirmButton>
                            <div className="mt-2 text-xs text-gray-400">
                              {intl.formatMessage(
                                messages.manageModalClearMediaWarning,
                                {
                                  mediaType: intl.formatMessage(
                                    mediaType === 'movie'
                                      ? messages.movie
                                      : messages.tvshow
                                  ),
                                  mediaServerName:
                                    settings.currentSettings.mediaServerType ===
                                    MediaServerType.EMBY
                                      ? 'Emby'
                                      : settings.currentSettings
                                            .mediaServerType ===
                                          MediaServerType.PLEX
                                        ? 'Plex'
                                        : 'Jellyfin',
                                }
                              )}
                            </div>
                          </div>
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
