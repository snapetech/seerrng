import { sliderTitles } from '@app/components/Discover/constants';
import RequestCard from '@app/components/RequestCard';
import Slider from '@app/components/Slider';
import useDiscoverRowSnapshot from '@app/hooks/useDiscoverRowSnapshot';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import {
  ArrowRightCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import type { RequestResultsResponse } from '@server/interfaces/api/requestInterfaces';
import Link from 'next/link';
import { useInView } from 'react-intersection-observer';
import { useIntl } from 'react-intl';

const REQUESTS_URL = '/api/v1/request?filter=all&take=10&sort=modified&skip=0';

const messages = defineMessages('components.Discover.RecentRequestsSlider', {
  unableToConnect:
    'Unable to connect to {services}. Some information may be unavailable.',
});

const RecentRequestsSlider = () => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const { ref, inView } = useInView({
    rootMargin: '450px 0px',
    triggerOnce: true,
  });
  const {
    data: requests,
    error: requestError,
    isLoading,
  } = useDiscoverRowSnapshot<RequestResultsResponse>({
    enabled: inView,
    personalized: true,
    rowKey: 'recent-requests',
    url: REQUESTS_URL,
  });

  const hasServiceErrors =
    requests?.serviceErrors &&
    (requests.serviceErrors.radarr.length > 0 ||
      requests.serviceErrors.sonarr.length > 0 ||
      requests.serviceErrors.lidarr.length > 0 ||
      requests.serviceErrors.readarr.length > 0);

  return (
    <div ref={ref}>
      <div className="slider-header">
        <Link href="/requests?filter=all" className="slider-title">
          <span>{intl.formatMessage(sliderTitles.recentrequests)}</span>
          <ArrowRightCircleIcon />
        </Link>
      </div>

      {hasServiceErrors &&
        (hasPermission(Permission.MANAGE_REQUESTS) ||
          hasPermission(Permission.REQUEST_ADVANCED)) && (
          <div className="service-error-banner">
            <ExclamationTriangleIcon className="h-5 w-5 flex-shrink-0" />
            <span>
              {intl.formatMessage(messages.unableToConnect, {
                services: [
                  ...requests.serviceErrors.radarr.map((s) => s.name),
                  ...requests.serviceErrors.sonarr.map((s) => s.name),
                  ...requests.serviceErrors.lidarr.map((s) => s.name),
                  ...requests.serviceErrors.readarr.map((s) => s.name),
                ].join(', '),
              })}
            </span>
          </div>
        )}

      <Slider
        sliderKey="requests"
        isLoading={isLoading}
        isEmpty={!!requests && requests.results.length === 0 && !requestError}
        items={(requests?.results ?? []).map((request) => (
          <RequestCard
            key={`request-slider-item-${request.id}`}
            request={request}
          />
        ))}
        placeholder={<RequestCard.Placeholder />}
      />
    </div>
  );
};

export default RecentRequestsSlider;
