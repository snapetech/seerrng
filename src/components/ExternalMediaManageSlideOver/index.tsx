import BlocklistBlock from '@app/components/BlocklistBlock';
import Button from '@app/components/Common/Button';
import ConfirmButton from '@app/components/Common/ConfirmButton';
import Modal from '@app/components/Common/Modal';
import DownloadBlock from '@app/components/DownloadBlock';
import IssueMediaSummary from '@app/components/IssueDetails/IssueMediaSummary';
import IssueItem from '@app/components/IssueList/IssueItem';
import AvailabilityValue from '@app/components/MediaDetails/AvailabilityValue';
import RequestBlock from '@app/components/RequestBlock';
import SelectableDownloadList from '@app/components/SelectableDownloadList';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import {
  normalizeMusicBrainzId,
  normalizeOpenLibraryWorkId,
} from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
import { getSafeHref } from '@app/utils/safeUrl';
import { Transition } from '@headlessui/react';
import {
  CheckCircleIcon,
  DocumentMinusIcon,
  ServerIcon,
  TrashIcon,
} from '@heroicons/react/24/solid';
import { IssueStatus } from '@server/constants/issue';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import type { BookDetails } from '@server/models/Book';
import type { MusicDetails } from '@server/models/Music';
import axios from 'axios';
import { Fragment } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.ExternalMediaManageSlideOver', {
  manageModalTitle: 'Manage {mediaType}',
  manageModalIssues: 'Open Issues',
  manageModalRequests: 'Requests',
  manageModalAdvanced: 'Advanced',
  downloadstatus: 'Downloads',
  manageModalClearMedia: 'Clear Data',
  manageModalClearMediaWarning:
    '* This will irreversibly remove all local data for this {mediaType}, including any requests.',
  manageModalRemoveMediaWarning:
    '* This will remove this {mediaType} from {arr}, including all files.',
  openarr: 'Open in {arr}',
  openarrFormat: 'Open {format} in {arr}',
  removearr: 'Remove from {arr}',
  removearrFormat: 'Remove {format} from {arr}',
  removearrAll: 'Remove all from {arr}',
  ebook: 'Book',
  audiobook: 'Audiobook',
  markavailable: 'Mark as Available',
  music: 'music',
  book: 'book',
  musicTitle: 'Music',
  bookTitle: 'Book',
});

const filterDuplicateDownloads = (
  items: NonNullable<MusicDetails['mediaInfo']>['downloadStatus'] = []
) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.downloadId)) return false;
    seen.add(item.downloadId);
    return true;
  });
};

type ExternalMediaManageSlideOverProps = {
  show?: boolean;
  mediaType: MediaType.MUSIC | MediaType.BOOK;
  data: MusicDetails | BookDetails;
  onClose: () => void;
  revalidate: () => void;
};

type ServiceLink = {
  key: string;
  url: string;
  format?: 'ebook' | 'audiobook';
  formatLabel?: string;
};

const ExternalMediaManageSlideOver = ({
  show,
  mediaType,
  data,
  onClose,
  revalidate,
}: ExternalMediaManageSlideOverProps) => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const mediaInfo = data.mediaInfo;
  const arrName = mediaType === MediaType.MUSIC ? 'Lidarr' : 'Bookshelf';
  const externalId =
    mediaType === MediaType.MUSIC
      ? normalizeMusicBrainzId((data as MusicDetails).mbId)
      : normalizeOpenLibraryWorkId(data.id);
  const mediaLabel = intl.formatMessage(
    mediaType === MediaType.MUSIC ? messages.music : messages.book
  );
  const mediaTitleLabel = intl.formatMessage(
    mediaType === MediaType.MUSIC ? messages.musicTitle : messages.bookTitle
  );
  const manageBackdrop =
    mediaType === MediaType.MUSIC
      ? ((data as MusicDetails).artistBackdrop ?? data.posterPath)
      : data.posterPath;
  const serviceLinks = (
    [
      mediaInfo?.serviceUrl
        ? {
            key: 'primary',
            url: mediaInfo.serviceUrl,
            format: mediaType === MediaType.BOOK ? 'ebook' : undefined,
            formatLabel:
              mediaType === MediaType.BOOK
                ? intl.formatMessage(messages.ebook)
                : undefined,
          }
        : undefined,
      mediaType === MediaType.BOOK && mediaInfo?.audiobookServiceUrl
        ? {
            key: 'audiobook',
            url: mediaInfo.audiobookServiceUrl,
            format: 'audiobook',
            formatLabel: intl.formatMessage(messages.audiobook),
          }
        : undefined,
    ] as (ServiceLink | undefined)[]
  )
    .map((link) =>
      link ? { ...link, url: getSafeHref(link.url) ?? '' } : undefined
    )
    .filter((link): link is ServiceLink => Boolean(link && link.url));

  const requests =
    mediaInfo?.requests?.filter(
      (request) => request.status !== MediaRequestStatus.DECLINED
    ) ?? [];
  const downloads = filterDuplicateDownloads(mediaInfo?.downloadStatus);
  const audiobookDownloads =
    mediaType === MediaType.BOOK
      ? filterDuplicateDownloads(mediaInfo?.audiobookDownloadStatus)
      : [];
  const openIssues =
    mediaInfo?.issues?.filter((issue) => issue.status === IssueStatus.OPEN) ??
    [];
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
  const isMusic = mediaType === MediaType.MUSIC;

  const markAvailable = async () => {
    if (!mediaInfo) {
      return;
    }

    await axios.post(`/api/v1/media/${mediaInfo.id}/available`);
    revalidate();
  };

  const deleteMedia = async () => {
    if (!mediaInfo) {
      return;
    }

    await axios.delete(`/api/v1/media/${mediaInfo.id}`);
    revalidate();
    onClose();
  };

  const deleteMediaFile = async (format?: 'ebook' | 'audiobook' | 'both') => {
    if (!mediaInfo) {
      return;
    }

    const formatQuery =
      mediaType === MediaType.BOOK && format ? `?format=${format}` : '';
    await axios.delete(`/api/v1/media/${mediaInfo.id}/file${formatQuery}`);

    const removedEveryLinkedFormat =
      mediaType !== MediaType.BOOK ||
      format === 'both' ||
      serviceLinks.length <= 1;

    if (removedEveryLinkedFormat) {
      await axios.delete(`/api/v1/media/${mediaInfo.id}`);
    }

    revalidate();
    onClose();
  };

  return (
    <Transition appear show={Boolean(show)} as={Fragment}>
      <Modal
        ariaLabel={intl.formatMessage(messages.manageModalTitle, {
          mediaType: mediaTitleLabel,
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
                <IssueItem
                  key={`external-manage-issue-${issue.id}`}
                  issue={issue}
                />
              ))}
            </div>
          ) : (
            <IssueMediaSummary
              data={data}
              mediaType={mediaType === MediaType.MUSIC ? 'music' : 'book'}
              embedded
              rightDetails={[
                ...(isMusic
                  ? [
                      {
                        label: 'MP3',
                        value: (
                          <AvailabilityValue status={mediaInfo?.status}>
                            {getManageStatus(mediaInfo?.status)}
                          </AvailabilityValue>
                        ),
                      },
                      {
                        label: 'FLAC',
                        value: (
                          <AvailabilityValue status={mediaInfo?.status4k}>
                            {getManageStatus(mediaInfo?.status4k)}
                          </AvailabilityValue>
                        ),
                      },
                    ]
                  : [
                      {
                        label: intl.formatMessage(globalMessages.status),
                        value: (
                          <AvailabilityValue status={mediaInfo?.status}>
                            {getManageStatus(mediaInfo?.status)}
                          </AvailabilityValue>
                        ),
                      },
                    ]),
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
            {(downloads.length > 0 || audiobookDownloads.length > 0) && (
              <div>
                <h3 className="manage-media-section-title">
                  {intl.formatMessage(messages.downloadstatus)}
                </h3>
                <div className="overflow-hidden rounded-md border border-gray-700 shadow">
                  <SelectableDownloadList
                    items={[
                      ...downloads.map((status, index) => {
                        return {
                          id: `standard-${status.downloadId ?? status.externalId ?? index}`,
                          content: (
                            <DownloadBlock
                              downloadItem={{
                                ...status,
                                title: status.title,
                              }}
                              title={data.title}
                              bookFormat={
                                mediaType === MediaType.BOOK
                                  ? 'ebook'
                                  : undefined
                              }
                            />
                          ),
                        };
                      }),
                      ...audiobookDownloads.map((status, index) => {
                        return {
                          id: `audiobook-${status.downloadId ?? status.externalId ?? index}`,
                          content: (
                            <DownloadBlock
                              downloadItem={{
                                ...status,
                                title: status.title,
                              }}
                              title={data.title}
                              bookFormat="audiobook"
                            />
                          ),
                        };
                      }),
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
                        key={`external-manage-request-${request.id}`}
                        className="border-b border-gray-700 last:border-b-0"
                      >
                        <RequestBlock request={request} onUpdate={revalidate} />
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {mediaInfo?.status === MediaStatus.BLOCKLISTED && (
              <div>
                <h3 className="manage-media-section-title">
                  {intl.formatMessage(globalMessages.blocklist)}
                </h3>
                <div className="overflow-hidden rounded-md border border-gray-700 shadow">
                  <BlocklistBlock
                    externalId={externalId}
                    mediaType={mediaType}
                    onUpdate={revalidate}
                    onDelete={onClose}
                  />
                </div>
              </div>
            )}

            {hasPermission(Permission.ADMIN) &&
              (serviceLinks.length > 0 ||
                (mediaInfo &&
                  mediaInfo.status !== MediaStatus.BLOCKLISTED)) && (
                <div>
                  <h3 className="manage-media-section-title">
                    {intl.formatMessage(messages.manageModalAdvanced)}
                  </h3>
                  <div
                    className="space-y-[5px]"
                    data-testid="manage-advanced-actions"
                  >
                    {serviceLinks.length > 0 && (
                      <div className="flex flex-wrap items-start gap-2">
                        {serviceLinks.map((link) => (
                          <a
                            key={`external-service-link-${link.key}`}
                            href={link.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-block"
                          >
                            <Button buttonType="ghost" buttonSize="standard">
                              <ServerIcon />
                              <span>
                                {link.format
                                  ? intl.formatMessage(messages.openarrFormat, {
                                      arr: arrName,
                                      format: link.formatLabel,
                                    })
                                  : intl.formatMessage(messages.openarr, {
                                      arr: arrName,
                                    })}
                              </span>
                            </Button>
                          </a>
                        ))}
                        {mediaType === MediaType.BOOK &&
                          serviceLinks.map((link) => (
                            <div
                              key={`external-remove-${link.key}`}
                              className="flex min-w-0 flex-col items-start"
                            >
                              <ConfirmButton
                                buttonSize="standard"
                                onClick={() => deleteMediaFile(link.format)}
                                confirmText={intl.formatMessage(
                                  globalMessages.areyousure
                                )}
                              >
                                <TrashIcon />
                                <span>
                                  {intl.formatMessage(
                                    messages.removearrFormat,
                                    {
                                      arr: arrName,
                                      format: link.formatLabel,
                                    }
                                  )}
                                </span>
                              </ConfirmButton>
                            </div>
                          ))}
                        <div className="flex min-w-0 basis-full flex-col items-start">
                          <ConfirmButton
                            buttonSize="standard"
                            onClick={() =>
                              deleteMediaFile(
                                mediaType === MediaType.BOOK
                                  ? 'both'
                                  : undefined
                              )
                            }
                            confirmText={intl.formatMessage(
                              globalMessages.areyousure
                            )}
                          >
                            <TrashIcon />
                            <span>
                              {intl.formatMessage(
                                mediaType === MediaType.BOOK &&
                                  serviceLinks.length > 1
                                  ? messages.removearrAll
                                  : messages.removearr,
                                { arr: arrName }
                              )}
                            </span>
                          </ConfirmButton>
                          <div className="mt-1 text-xs text-gray-400">
                            {intl.formatMessage(
                              messages.manageModalRemoveMediaWarning,
                              {
                                mediaType: mediaLabel,
                                arr: arrName,
                              }
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                    {mediaInfo &&
                      mediaInfo.status !== MediaStatus.BLOCKLISTED && (
                        <div className="flex flex-wrap gap-2">
                          {mediaInfo.status !== MediaStatus.AVAILABLE && (
                            <Button
                              buttonSize="standard"
                              onClick={markAvailable}
                              buttonType="success"
                            >
                              <CheckCircleIcon />
                              <span>
                                {intl.formatMessage(messages.markavailable)}
                              </span>
                            </Button>
                          )}
                          <div className="flex min-w-0 basis-full flex-col items-start">
                            <ConfirmButton
                              buttonSize="standard"
                              onClick={deleteMedia}
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
                                  mediaType: mediaLabel,
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

export default ExternalMediaManageSlideOver;
