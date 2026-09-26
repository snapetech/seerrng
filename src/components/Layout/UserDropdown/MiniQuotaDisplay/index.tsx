import InfinityIcon from '@app/assets/infinity.svg';
import { SmallLoadingSpinner } from '@app/components/Common/LoadingSpinner';
import ProgressCircle from '@app/components/Common/ProgressCircle';
import defineMessages from '@app/utils/defineMessages';
import type { QuotaResponse } from '@server/interfaces/api/userInterfaces';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages(
  'components.Layout.UserDropdown.MiniQuotaDisplay',
  {
    movierequests: 'Movie Requests',
    seriesrequests: 'Series Requests',
    musicrequests: 'Music Requests',
    bookrequests: 'Book Requests',
    comicrequests: 'Comic Requests',
    magazinerequests: 'Magazine Requests',
    softwarerequests: 'Software Requests',
  }
);

type MiniQuotaDisplayProps = {
  userId: number;
};

const MiniQuotaDisplay = ({ userId }: MiniQuotaDisplayProps) => {
  const intl = useIntl();
  const { data, error } = useSWR<QuotaResponse>(`/api/v1/user/${userId}/quota`);

  if (error) {
    return null;
  }

  if (!data && !error) {
    return <SmallLoadingSpinner />;
  }

  const quotaItems = [
    {
      key: 'movie',
      label: intl.formatMessage(messages.movierequests),
      quota: data?.movie,
    },
    {
      key: 'tv',
      label: intl.formatMessage(messages.seriesrequests),
      quota: data?.tv,
    },
    {
      key: 'music',
      label: intl.formatMessage(messages.musicrequests),
      quota: data?.music,
    },
    {
      key: 'book',
      label: intl.formatMessage(messages.bookrequests),
      quota: data?.book,
    },
    {
      key: 'comic',
      label: intl.formatMessage(messages.comicrequests),
      quota: data?.comic,
    },
    {
      key: 'magazine',
      label: intl.formatMessage(messages.magazinerequests),
      quota: data?.magazine,
    },
    {
      key: 'software',
      label: intl.formatMessage(messages.softwarerequests),
      quota: data?.software,
    },
  ].filter((item) => (item.quota?.limit ?? 0) !== 0);

  return (
    <>
      {quotaItems.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          {quotaItems.map(({ key, label, quota }) => (
            <div key={key} className="flex flex-col space-y-2">
              <div className="text-sm text-gray-200">{label}</div>
              <div className="flex h-full items-center space-x-2 text-gray-200">
                {(quota?.limit ?? 0) > 0 ? (
                  <>
                    <ProgressCircle
                      className="h-8 w-8"
                      progress={Math.round(
                        ((quota?.remaining ?? 0) / (quota?.limit ?? 1)) * 100
                      )}
                      useHeatLevel
                    />
                    <span className="text-lg font-bold text-gray-200">
                      {quota?.remaining} / {quota?.limit}
                    </span>
                  </>
                ) : (
                  <>
                    <InfinityIcon className="w-7" />
                    <span className="font-bold">Unlimited</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
};

export default MiniQuotaDisplay;
