import Badge from '@app/components/Common/Badge';
import BookFormatBadge, {
  type RequestedBookFormat,
} from '@app/components/Common/BookFormatBadge';
import Button from '@app/components/Common/Button';
import ConfirmButton from '@app/components/Common/ConfirmButton';
import { useLiveDownloadingItem } from '@app/hooks/useLiveDownload';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { formatBytes } from '@app/utils/numberHelpers';
import type { DownloadingItem } from '@server/lib/downloadtracker';
import axios from 'axios';
import { useState } from 'react';
import { FormattedRelativeTime, useIntl } from 'react-intl';
import { useSWRConfig } from 'swr';

const messages = defineMessages('components.DownloadBlock', {
  estimatedtime: 'Estimated {time}',
  formattedTitle: '{title}: Season {seasonNumber} Episode {episodeNumber}',
  failAndSearch: 'Fail this download and search again',
  confirmFailAndSearch: 'Remove and blocklist this release, then search again?',
  failingDownload: 'Failing download…',
  failAndSearchSuccess: 'The release was failed and a new search was started.',
  failAndSearchError:
    'Could not fail this download. Refresh the request and try again.',
  liveRate: '{rate}/s',
  liveSeeds: '{count, plural, one {# Seed} other {# Seeds}}',
  liveStalled: 'Stalled',
  liveError: 'Client Error',
});

interface DownloadBlockProps {
  downloadItem: DownloadingItem;
  is4k?: boolean;
  title?: string;
  bookFormat?: RequestedBookFormat;
  requestId?: number;
  canFailDownload?: boolean;
}

const DownloadBlock = ({
  downloadItem: queueItem,
  is4k = false,
  title,
  bookFormat,
  requestId,
  canFailDownload = false,
}: DownloadBlockProps) => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const { addToast } = useToasts();
  const { mutate } = useSWRConfig();
  const [isFailing, setIsFailing] = useState(false);
  const downloadItem = useLiveDownloadingItem(queueItem);
  const live = downloadItem.live;
  const displayTitle = hasPermission(Permission.ADMIN)
    ? downloadItem.title
    : downloadItem.episode
      ? intl.formatMessage(messages.formattedTitle, {
          title,
          seasonNumber: downloadItem?.episode?.seasonNumber,
          episodeNumber: downloadItem?.episode?.episodeNumber,
        })
      : title;

  return (
    <div className="p-4">
      <div className="mb-2 flex min-w-0 items-center text-sm">
        {bookFormat && (
          <BookFormatBadge
            format={bookFormat}
            variant="compact"
            className="mr-2 shrink-0"
          />
        )}
        <span className="w-56 min-w-0 truncate sm:w-80 md:w-full">
          {displayTitle}
        </span>
      </div>
      <div className="relative mb-2 h-6 min-w-0 overflow-hidden rounded-full bg-gray-700">
        <div
          className="h-8 bg-indigo-600 transition-all duration-200 ease-in-out"
          style={{
            width: `${
              downloadItem.size
                ? Math.round(
                    ((downloadItem.size - downloadItem.sizeLeft) /
                      downloadItem.size) *
                      100
                  )
                : 0
            }%`,
          }}
        />
        <div className="absolute inset-0 flex h-6 w-full items-center justify-center text-xs">
          <span>
            {downloadItem.size
              ? Math.round(
                  ((downloadItem.size - downloadItem.sizeLeft) /
                    downloadItem.size) *
                    100
                )
              : 0}
            %
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span>
          {is4k && (
            <Badge badgeType="warning" className="mr-2">
              4K
            </Badge>
          )}
          <Badge className="capitalize">{downloadItem.status}</Badge>
          {live && (
            <>
              {' '}
              <Badge
                badgeType={
                  live.state === 'error'
                    ? 'danger'
                    : live.state === 'stalled'
                      ? 'warning'
                      : 'default'
                }
              >
                {live.state === 'error'
                  ? intl.formatMessage(messages.liveError)
                  : live.state === 'stalled'
                    ? intl.formatMessage(messages.liveStalled)
                    : intl.formatMessage(messages.liveRate, {
                        rate: formatBytes(live.downloadRate, 1),
                      })}
                {live.seeds !== null &&
                  ` · ${intl.formatMessage(messages.liveSeeds, {
                    count: live.seeds,
                  })}`}
              </Badge>
            </>
          )}
        </span>
        <span>
          {downloadItem.estimatedCompletionTime
            ? intl.formatMessage(messages.estimatedtime, {
                time: (
                  <FormattedRelativeTime
                    key="estimated-completion-time"
                    value={Math.floor(
                      (new Date(
                        downloadItem.estimatedCompletionTime
                      ).getTime() -
                        Date.now()) /
                        1000
                    )}
                    updateIntervalInSeconds={1}
                    numeric="auto"
                  />
                ),
              })
            : ''}
        </span>
      </div>
      {canFailDownload && requestId && downloadItem.downloadId && (
        <div className="mt-3">
          {isFailing ? (
            <Button className="w-full" buttonSize="sm" disabled>
              {intl.formatMessage(messages.failingDownload)}
            </Button>
          ) : (
            <ConfirmButton
              className="min-h-12 w-full px-2 text-center whitespace-normal"
              buttonSize="sm"
              confirmText={intl.formatMessage(messages.confirmFailAndSearch)}
              onClick={() => {
                setIsFailing(true);
                void axios
                  .post(`/api/v1/request/${requestId}/fail-download`, {
                    downloadId: downloadItem.downloadId,
                  })
                  .then(() => {
                    void mutate(`/api/v1/request/${requestId}`);
                    addToast(
                      intl.formatMessage(messages.failAndSearchSuccess),
                      { appearance: 'success', autoDismiss: true }
                    );
                  })
                  .catch((error: unknown) => {
                    const message =
                      axios.isAxiosError(error) &&
                      typeof error.response?.data?.message === 'string'
                        ? error.response.data.message
                        : intl.formatMessage(messages.failAndSearchError);
                    addToast(message, {
                      appearance: 'error',
                      autoDismiss: true,
                    });
                  })
                  .finally(() => setIsFailing(false));
              }}
            >
              {intl.formatMessage(messages.failAndSearch)}
            </ConfirmButton>
          )}
        </div>
      )}
    </div>
  );
};

export default DownloadBlock;
