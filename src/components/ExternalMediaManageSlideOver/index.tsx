import Button from '@app/components/Common/Button';
import Modal from '@app/components/Common/Modal';
import DownloadBlock from '@app/components/DownloadBlock';
import IssueMediaSummary from '@app/components/IssueDetails/IssueMediaSummary';
import ManageMediaActions from '@app/components/ManageSlideOver/ManageMediaActions';
import AvailabilityValue from '@app/components/MediaDetails/AvailabilityValue';
import type { RequestBlockMediaIdentity } from '@app/components/RequestBlock';
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
import { ServerIcon } from '@heroicons/react/24/solid';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import type { BookDetails } from '@server/models/Book';
import type { ComicDetails } from '@server/models/Comic';
import type { MagazineDetails } from '@server/models/Magazine';
import type { MusicDetails } from '@server/models/Music';
import { Fragment, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.ExternalMediaManageSlideOver', {
  manageModalTitle: 'Manage {mediaType}',
  manageModalIssues: 'Open Issues',
  manageModalRequests: 'Requests',
  downloadstatus: 'Downloads',
  openarr: 'Open in {arr}',
  openarrFormat: 'Open {format} in {arr}',
  ebook: 'Book',
  audiobook: 'Audiobook',
  music: 'music',
  book: 'book',
  comic: 'comic',
  magazine: 'magazine',
  musicTitle: 'Music',
  bookTitle: 'Book',
  comicTitle: 'Comic',
  magazineTitle: 'Magazine',
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
  mediaType:
    MediaType.MUSIC | MediaType.BOOK | MediaType.COMIC | MediaType.MAGAZINE;
  data: MusicDetails | BookDetails | ComicDetails | MagazineDetails;
  onClose: () => void;
  revalidate: () => void;
};

type ServiceLink = {
  key: string;
  url: string;
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
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const { hasPermission } = useUser();
  const mediaInfo = data.mediaInfo;
  const arrName =
    mediaType === MediaType.MUSIC
      ? 'Lidarr'
      : mediaType === MediaType.COMIC
        ? 'Mylar'
        : mediaType === MediaType.MAGAZINE
          ? 'Kapowarr'
          : 'Bookshelf';
  const externalId =
    mediaType === MediaType.MUSIC
      ? normalizeMusicBrainzId((data as MusicDetails).mbId)
      : mediaType === MediaType.COMIC || mediaType === MediaType.MAGAZINE
        ? String(data.id)
        : normalizeOpenLibraryWorkId(data.id);
  const requestBlockIdentity: RequestBlockMediaIdentity = (() => {
    switch (mediaType) {
      case MediaType.MUSIC:
        return { mediaType, mbId: externalId };
      case MediaType.BOOK:
        return { mediaType, bookId: externalId };
      case MediaType.COMIC:
        return { mediaType, comicId: externalId };
      case MediaType.MAGAZINE:
        return { mediaType, magazineTitle: externalId };
    }
  })();
  const mediaTitleLabel = intl.formatMessage(
    mediaType === MediaType.MUSIC
      ? messages.musicTitle
      : mediaType === MediaType.COMIC
        ? messages.comicTitle
        : mediaType === MediaType.MAGAZINE
          ? messages.magazineTitle
          : messages.bookTitle
  );
  const manageBackdrop =
    mediaType === MediaType.MUSIC
      ? ((data as MusicDetails).artistBackdrop ?? data.posterPath)
      : data.posterPath;

  const requests =
    mediaInfo?.requests?.filter(
      (request) => request.status !== MediaRequestStatus.DECLINED
    ) ?? [];
  const downloads = filterDuplicateDownloads(mediaInfo?.downloadStatus);
  const audiobookDownloads =
    mediaType === MediaType.BOOK
      ? filterDuplicateDownloads(mediaInfo?.audiobookDownloadStatus)
      : [];

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
  const serviceLinks = (
    [
      mediaInfo?.serviceUrl
        ? {
            key: 'primary',
            url: mediaInfo.serviceUrl,
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
            formatLabel: intl.formatMessage(messages.audiobook),
          }
        : undefined,
    ] as (ServiceLink | undefined)[]
  )
    .map((link) =>
      link ? { ...link, url: getSafeHref(link.url) ?? '' } : undefined
    )
    .filter((link): link is ServiceLink => Boolean(link?.url));

  return (
    <Transition appear show={Boolean(show)} as={Fragment}>
      <Modal
        ariaLabel={intl.formatMessage(messages.manageModalTitle, {
          mediaType: mediaTitleLabel,
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
            mediaType={
              mediaType === MediaType.MUSIC
                ? 'music'
                : mediaType === MediaType.COMIC
                  ? 'comic'
                  : mediaType === MediaType.MAGAZINE
                    ? 'magazine'
                    : 'book'
            }
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
            ]}
          />
          <div className="manage-media-card-sections card-stack">
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
                        <RequestBlock
                          hideDeleteAction
                          request={request}
                          {...requestBlockIdentity}
                          onUpdate={revalidate}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {hasPermission(Permission.ADMIN) && mediaInfo && (
              <div>
                <div
                  className="card-stack"
                  data-testid="manage-advanced-actions"
                >
                  {serviceLinks.map((link) => (
                    <a
                      key={`external-service-link-${link.key}`}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Button buttonType="success">
                        <ServerIcon />
                        {link.formatLabel
                          ? intl.formatMessage(messages.openarrFormat, {
                              arr: arrName,
                              format: link.formatLabel,
                            })
                          : intl.formatMessage(messages.openarr, {
                              arr: arrName,
                            })}
                      </Button>
                    </a>
                  ))}
                  {mediaInfo && (
                    <ManageMediaActions
                      media={mediaInfo}
                      externalId={externalId}
                      mediaType={mediaType}
                      title={data.title}
                      year={
                        isMusic
                          ? (data as MusicDetails).releaseDate?.slice(0, 4)
                          : mediaType === MediaType.BOOK
                            ? (data as BookDetails).firstPublishYear
                            : undefined
                      }
                      onUpdate={revalidate}
                      onDialogChange={setConfirmationOpen}
                    />
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
