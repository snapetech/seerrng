import Spinner from '@app/assets/spinner.svg';
import Badge from '@app/components/Common/Badge';
import {
  getBookFormatMessage,
  type RequestedBookFormat,
} from '@app/components/Common/BookFormatBadge';
import Tooltip from '@app/components/Common/Tooltip';
import DownloadBlock from '@app/components/DownloadBlock';
import { applyLiveDownload, useLiveDownload } from '@app/hooks/useLiveDownload';
import useSettings from '@app/hooks/useSettings';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import {
  encodeApiPathSegment,
  normalizeMusicBrainzId,
  normalizeOpenLibraryWorkId,
} from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
import { MediaStatus } from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import type { DownloadingItem } from '@server/lib/downloadtracker';
import type { ReactNode } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.StatusBadge', {
  status: '{status}',
  status4k: '4K {status}',
  playonplex: 'Play on {mediaServerName}',
  openinarr: 'Open in {arr}',
  managemedia: 'Manage {mediaType}',
  manageBookFormat: 'Manage {format}',
  seasonnumber: 'S{seasonNumber}',
  seasonepisodenumber: 'S{seasonNumber}E{episodeNumber}',
});

interface StatusBadgeProps {
  status?: MediaStatus;
  downloadItem?: DownloadingItem[];
  is4k?: boolean;
  inProgress?: boolean;
  plexUrl?: string;
  serviceUrl?: string;
  tmdbId?: number;
  mbId?: string;
  externalId?: string;
  mediaType?: 'movie' | 'tv' | 'music' | 'book' | 'comic' | 'magazine';
  bookFormat?: RequestedBookFormat;
  title?: string | string[];
  statusLabelOverride?: string;
  className?: string;
  requestId?: number;
  canFailDownload?: boolean;
  showQuality?: boolean;
  leadingIcon?: ReactNode;
}

const StatusBadge = ({
  status,
  downloadItem = [],
  is4k = false,
  inProgress = false,
  plexUrl,
  serviceUrl,
  tmdbId,
  mbId,
  externalId,
  mediaType,
  bookFormat,
  title,
  statusLabelOverride,
  className,
  requestId,
  canFailDownload = false,
  showQuality = true,
  leadingIcon,
}: StatusBadgeProps) => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const settings = useSettings();
  const firstLiveDownload = useLiveDownload(downloadItem[0]?.downloadId);
  const formatStatusLabel = (statusText: string) =>
    showQuality
      ? intl.formatMessage(is4k ? messages.status4k : messages.status, {
          status: statusText,
        })
      : statusText;

  let mediaLink: string | undefined;
  let mediaLinkDescription: string | undefined;

  const calculateDownloadProgress = (media: DownloadingItem) => {
    return Math.round(((media?.size - media?.sizeLeft) / media?.size) * 100);
  };

  if (
    mediaType &&
    plexUrl &&
    hasPermission(
      is4k
        ? [
            Permission.REQUEST_4K,
            mediaType === 'movie'
              ? Permission.REQUEST_4K_MOVIE
              : Permission.REQUEST_4K_TV,
          ]
        : [
            Permission.REQUEST,
            mediaType === 'music'
              ? Permission.REQUEST_MUSIC
              : mediaType === 'book'
                ? Permission.REQUEST_BOOK
                : mediaType === 'comic'
                  ? Permission.REQUEST_COMIC
                  : mediaType === 'magazine'
                    ? Permission.REQUEST_MAGAZINE
                    : mediaType === 'movie'
                      ? Permission.REQUEST_MOVIE
                      : Permission.REQUEST_TV,
          ],
      {
        type: 'or',
      }
    ) &&
    mediaType !== 'music' &&
    mediaType !== 'book' &&
    mediaType !== 'comic' &&
    mediaType !== 'magazine' &&
    (!is4k ||
      (mediaType === 'movie'
        ? settings.currentSettings.movie4kEnabled
        : settings.currentSettings.series4kEnabled))
  ) {
    mediaLink = plexUrl;
    mediaLinkDescription = intl.formatMessage(messages.playonplex, {
      mediaServerName:
        settings.currentSettings.mediaServerType === MediaServerType.EMBY
          ? 'Emby'
          : settings.currentSettings.mediaServerType === MediaServerType.PLEX
            ? 'Plex'
            : 'Jellyfin',
    });
  } else if (hasPermission(Permission.MANAGE_REQUESTS)) {
    if (mediaType === 'music' && (mbId || externalId)) {
      mediaLink = `/music/${encodeApiPathSegment(
        normalizeMusicBrainzId(mbId ?? externalId ?? '')
      )}?manage=1`;
      mediaLinkDescription = intl.formatMessage(messages.managemedia, {
        mediaType: 'Music',
      });
    } else if (mediaType === 'book' && externalId) {
      mediaLink = `/book/${encodeApiPathSegment(
        normalizeOpenLibraryWorkId(externalId)
      )}?manage=1${bookFormat ? `&format=${bookFormat}` : ''}`;
      mediaLinkDescription = bookFormat
        ? intl.formatMessage(messages.manageBookFormat, {
            format: intl.formatMessage(getBookFormatMessage(bookFormat)),
          })
        : intl.formatMessage(messages.managemedia, {
            mediaType: 'Book',
          });
    } else if (mediaType === 'comic' && externalId) {
      mediaLink = `/comic/${encodeApiPathSegment(externalId)}?manage=1`;
      mediaLinkDescription = intl.formatMessage(messages.managemedia, {
        mediaType: 'Comic',
      });
    } else if (mediaType === 'magazine' && externalId) {
      mediaLink = `/magazine/${encodeApiPathSegment(externalId)}?manage=1`;
      mediaLinkDescription = intl.formatMessage(messages.managemedia, {
        mediaType: 'Magazine',
      });
    } else if (mediaType && tmdbId) {
      mediaLink = `/${mediaType}/${tmdbId}?manage=1`;
      mediaLinkDescription = intl.formatMessage(messages.managemedia, {
        mediaType: intl.formatMessage(
          mediaType === 'movie' ? globalMessages.movie : globalMessages.tvshow
        ),
      });
    } else if (hasPermission(Permission.ADMIN) && serviceUrl) {
      mediaLink = serviceUrl;
      mediaLinkDescription = intl.formatMessage(messages.openinarr, {
        arr:
          mediaType === 'music'
            ? 'Lidarr'
            : mediaType === 'book'
              ? 'Bookshelf'
              : mediaType === 'comic'
                ? 'Comics'
                : mediaType === 'magazine'
                  ? 'LazyLibrarian'
                  : mediaType === 'movie'
                    ? 'Radarr'
                    : 'Sonarr',
      });
    }
  }

  const tooltipContent =
    mediaType === 'tv' &&
    downloadItem.length > 1 &&
    downloadItem.every(
      (item) =>
        item.downloadId && item.downloadId === downloadItem[0].downloadId
    ) ? (
      <DownloadBlock
        downloadItem={downloadItem[0]}
        title={Array.isArray(title) ? title[0] : title}
        is4k={is4k}
        requestId={requestId}
        canFailDownload={canFailDownload}
      />
    ) : (
      <ul>
        {downloadItem.map((status, index) => (
          <li
            key={`dl-status-${status.externalId}-${index}`}
            className="border-b border-gray-700 last:border-b-0"
          >
            <DownloadBlock
              downloadItem={status}
              title={Array.isArray(title) ? title[index] : title}
              is4k={is4k}
              bookFormat={mediaType === 'book' ? bookFormat : undefined}
              requestId={requestId}
              canFailDownload={canFailDownload}
            />
          </li>
        ))}
      </ul>
    );

  // When the badge opens a manual-fail tooltip, reserve its tap/click for that
  // action. Keep playback/service navigation beside the fail button instead
  // of making the same control both a link and a tooltip trigger.
  const opensManualFailTooltip =
    canFailDownload &&
    inProgress &&
    (status === MediaStatus.AVAILABLE ||
      status === MediaStatus.PARTIALLY_AVAILABLE ||
      status === MediaStatus.PROCESSING ||
      status === MediaStatus.DELETED);
  const statusBadgeLink = opensManualFailTooltip ? undefined : mediaLink;
  const downloadTooltipContent =
    opensManualFailTooltip && mediaLink && mediaLinkDescription ? (
      <>
        {tooltipContent}
        <div className="px-4 pb-4">
          <Badge href={mediaLink} className="min-h-11">
            {mediaLinkDescription}
          </Badge>
        </div>
      </>
    ) : (
      tooltipContent
    );

  const downloadTooltipClassName = inProgress
    ? `scrollable-card ${
        canFailDownload ? '' : 'hidden sm:block'
      } max-h-96 w-96 max-w-[calc(100vw-2rem)] overflow-y-auto`
    : undefined;
  const downloadTooltipConfig = inProgress
    ? {
        interactive: true,
        delayHide: 100,
        ...(canFailDownload && {
          trigger: ['hover', 'click', 'focus'] as (
            'hover' | 'click' | 'focus'
          )[],
          followCursor: false,
        }),
      }
    : undefined;

  const badgeDownloadProgress = (
    <div
      className={`absolute top-0 left-0 z-10 flex h-full ${
        status === MediaStatus.DELETED
          ? 'bg-red-600/35'
          : status === MediaStatus.PROCESSING
            ? 'bg-indigo-500/35'
            : 'bg-green-500/35'
      } transition-all duration-200 ease-in-out`}
      style={{
        width: `${
          downloadItem[0]
            ? calculateDownloadProgress(
                applyLiveDownload(downloadItem[0], firstLiveDownload)
              )
            : 0
        }%`,
      }}
    />
  );

  switch (status) {
    case MediaStatus.AVAILABLE:
      return (
        <Tooltip
          content={inProgress ? downloadTooltipContent : mediaLinkDescription}
          className={downloadTooltipClassName}
          tooltipConfig={downloadTooltipConfig}
        >
          <Badge
            badgeType="success"
            href={statusBadgeLink}
            className={`${className ?? ''} ${
              inProgress &&
              'relative !bg-gray-700/35 !px-0 hover:!bg-gray-700/55'
            } overflow-hidden`}
          >
            {inProgress && badgeDownloadProgress}
            <div
              className={`request-status-control-content relative z-20 flex items-center ${
                inProgress && 'px-2'
              }`}
            >
              {leadingIcon}
              <span>
                {formatStatusLabel(
                  inProgress
                    ? intl.formatMessage(globalMessages.processing)
                    : intl.formatMessage(globalMessages.available)
                )}
              </span>
              {inProgress && (
                <>
                  {mediaType === 'tv' &&
                    downloadItem[0].episode &&
                    (downloadItem.length > 1 &&
                    downloadItem.every(
                      (item) =>
                        item.downloadId &&
                        item.downloadId === downloadItem[0].downloadId
                    ) ? (
                      <span className="ml-1">
                        {intl.formatMessage(messages.seasonnumber, {
                          seasonNumber: downloadItem[0].episode.seasonNumber,
                        })}
                      </span>
                    ) : (
                      <span className="ml-1">
                        {intl.formatMessage(messages.seasonepisodenumber, {
                          seasonNumber: downloadItem[0].episode.seasonNumber,
                          episodeNumber: downloadItem[0].episode.episodeNumber,
                        })}
                      </span>
                    ))}
                  <Spinner className="ml-1 h-3 w-3" />
                </>
              )}
            </div>
          </Badge>
        </Tooltip>
      );

    case MediaStatus.PARTIALLY_AVAILABLE:
      return (
        <Tooltip
          content={inProgress ? downloadTooltipContent : mediaLinkDescription}
          className={downloadTooltipClassName}
          tooltipConfig={downloadTooltipConfig}
        >
          <Badge
            badgeType="success"
            href={statusBadgeLink}
            className={`${className ?? ''} ${
              inProgress &&
              'relative !bg-gray-700/35 !px-0 hover:!bg-gray-700/55'
            } overflow-hidden`}
          >
            {inProgress && badgeDownloadProgress}
            <div
              className={`request-status-control-content relative z-20 flex items-center ${
                inProgress && 'px-2'
              }`}
            >
              {leadingIcon}
              <span>
                {formatStatusLabel(
                  inProgress
                    ? intl.formatMessage(globalMessages.processing)
                    : intl.formatMessage(globalMessages.partiallyavailable)
                )}
              </span>
              {inProgress && (
                <>
                  {mediaType === 'tv' &&
                    downloadItem[0].episode &&
                    (downloadItem.length > 1 &&
                    downloadItem.every(
                      (item) =>
                        item.downloadId &&
                        item.downloadId === downloadItem[0].downloadId
                    ) ? (
                      <span className="ml-1">
                        {intl.formatMessage(messages.seasonnumber, {
                          seasonNumber: downloadItem[0].episode.seasonNumber,
                        })}
                      </span>
                    ) : (
                      <span className="ml-1">
                        {intl.formatMessage(messages.seasonepisodenumber, {
                          seasonNumber: downloadItem[0].episode.seasonNumber,
                          episodeNumber: downloadItem[0].episode.episodeNumber,
                        })}
                      </span>
                    ))}
                  <Spinner className="ml-1 h-3 w-3" />
                </>
              )}
            </div>
          </Badge>
        </Tooltip>
      );

    case MediaStatus.PROCESSING:
      return (
        <Tooltip
          content={inProgress ? downloadTooltipContent : mediaLinkDescription}
          className={downloadTooltipClassName}
          tooltipConfig={downloadTooltipConfig}
        >
          <Badge
            badgeType="primary"
            href={statusBadgeLink}
            className={`${className ?? ''} ${
              inProgress &&
              'relative !bg-gray-700/35 !px-0 hover:!bg-gray-700/55'
            } overflow-hidden`}
          >
            {inProgress && badgeDownloadProgress}
            <div
              className={`request-status-control-content relative z-20 flex items-center ${
                inProgress && 'px-2'
              }`}
            >
              {leadingIcon}
              <span>
                {formatStatusLabel(
                  inProgress
                    ? intl.formatMessage(globalMessages.processing)
                    : intl.formatMessage(globalMessages.requested)
                )}
              </span>
              {inProgress && (
                <>
                  {mediaType === 'tv' &&
                    downloadItem[0].episode &&
                    (downloadItem.length > 1 &&
                    downloadItem.every(
                      (item) =>
                        item.downloadId &&
                        item.downloadId === downloadItem[0].downloadId
                    ) ? (
                      <span className="ml-1">
                        {intl.formatMessage(messages.seasonnumber, {
                          seasonNumber: downloadItem[0].episode.seasonNumber,
                        })}
                      </span>
                    ) : (
                      <span className="ml-1">
                        {intl.formatMessage(messages.seasonepisodenumber, {
                          seasonNumber: downloadItem[0].episode.seasonNumber,
                          episodeNumber: downloadItem[0].episode.episodeNumber,
                        })}
                      </span>
                    ))}
                  <Spinner className="ml-1 h-3 w-3" />
                </>
              )}
            </div>
          </Badge>
        </Tooltip>
      );

    case MediaStatus.PENDING:
      return (
        <Tooltip content={mediaLinkDescription}>
          <Badge
            badgeType="warning"
            href={statusBadgeLink}
            className={className}
          >
            {formatStatusLabel(intl.formatMessage(globalMessages.pending))}
          </Badge>
        </Tooltip>
      );

    case MediaStatus.BLOCKLISTED:
      return (
        <Tooltip content={mediaLinkDescription}>
          <Badge
            badgeType="danger"
            href={statusBadgeLink}
            className={className}
          >
            {formatStatusLabel(
              statusLabelOverride ??
                intl.formatMessage(globalMessages.blocklisted)
            )}
          </Badge>
        </Tooltip>
      );

    case MediaStatus.DELETED:
      return (
        <Tooltip
          content={inProgress ? downloadTooltipContent : mediaLinkDescription}
          className={downloadTooltipClassName}
          tooltipConfig={downloadTooltipConfig}
        >
          <Badge
            badgeType="danger"
            href={statusBadgeLink}
            className={`${className ?? ''} ${
              inProgress &&
              'relative !bg-gray-700/35 !px-0 hover:!bg-gray-700/55'
            } overflow-hidden`}
          >
            {inProgress && badgeDownloadProgress}
            <div
              className={`request-status-control-content relative z-20 flex items-center ${
                inProgress && 'px-2'
              }`}
            >
              {leadingIcon}
              <span>
                {formatStatusLabel(
                  inProgress
                    ? intl.formatMessage(globalMessages.processing)
                    : intl.formatMessage(globalMessages.deleted)
                )}
              </span>
              {inProgress && (
                <>
                  {mediaType === 'tv' &&
                    downloadItem[0].episode &&
                    (downloadItem.length > 1 &&
                    downloadItem.every(
                      (item) =>
                        item.downloadId &&
                        item.downloadId === downloadItem[0].downloadId
                    ) ? (
                      <span className="ml-1">
                        {intl.formatMessage(messages.seasonnumber, {
                          seasonNumber: downloadItem[0].episode.seasonNumber,
                        })}
                      </span>
                    ) : (
                      <span className="ml-1">
                        {intl.formatMessage(messages.seasonepisodenumber, {
                          seasonNumber: downloadItem[0].episode.seasonNumber,
                          episodeNumber: downloadItem[0].episode.episodeNumber,
                        })}
                      </span>
                    ))}
                  <Spinner className="ml-1 h-3 w-3" />
                </>
              )}
            </div>
          </Badge>
        </Tooltip>
      );

    default:
      return null;
  }
};

export default StatusBadge;
