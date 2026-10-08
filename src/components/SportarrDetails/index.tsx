import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import Header from '@app/components/Common/Header';
import { PageStatus } from '@app/components/Common/LoadingSpinner';
import PageErrorMessage from '@app/components/Common/PageErrorMessage';
import PageTitle from '@app/components/Common/PageTitle';
import SportarrRequestModal from '@app/components/RequestModal/SportarrRequestModal';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { CalendarDaysIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import type { SportarrDetails } from '@server/models/Sportarr';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

interface SportarrEventItem {
  id: number;
  title: string;
  season?: string;
  eventDate?: string;
  broadcastDate?: string;
  broadcastTimezone?: string;
  monitored: boolean;
  hasFile: boolean;
  fileCount: number;
  quality?: string;
}

interface SportarrEventPage {
  eventsAvailable: boolean;
  page: number;
  pageSize: number;
  totalRecords: number;
  totalPages: number;
  results: SportarrEventItem[];
}

interface AppError {
  response?: { data?: { message?: string }; status?: number };
}

const messages = defineMessages('components.SportarrDetails', {
  heading: 'League Details',
  loading: 'Loading league details',
  back: 'Back to sports',
  request: 'Request league',
  noPermission: 'You do not have permission to request this league.',
  requested: 'Request pending',
  monitored: 'Monitored in Sportarr',
  unmonitored: 'This league is in Sportarr but is not monitored.',
  unmonitoredHint:
    'Enable monitoring for this league in Sportarr to see its events here.',
  requestedHint: 'This league already has an active request.',
  sport: 'Sport',
  country: 'Country',
  season: 'Season',
  events: 'Events',
  noEvents: 'Sportarr has no monitored events for this league yet.',
  eventsAfterAdd:
    'Events appear here after this league is added to Sportarr and monitoring is enabled.',
  eventError: 'Events could not be loaded.',
  retry: 'Try again',
  loadMore: 'Load more events',
  loadingEvents: 'Loading events',
  noDate: 'Date not announced',
  available: 'Available',
  missing: 'Not downloaded',
  partCount: '{count} files',
  eventCount: '{count} events',
  loadError: 'League details could not be loaded.',
  loadErrorHint: 'Try again in a moment.',
});

const getMessage = (error: unknown): string | undefined =>
  (error as AppError | undefined)?.response?.data?.message;

const formatEventDate = (
  intl: ReturnType<typeof useIntl>,
  value?: string,
  timeZone?: string
): string => {
  if (!value) return intl.formatMessage(messages.noDate);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    return intl.formatMessage(messages.noDate);
  try {
    return intl.formatDate(date, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timeZone || 'UTC',
    });
  } catch {
    return intl.formatDate(date, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    });
  }
};

const SportarrDetailsPage = () => {
  const intl = useIntl();
  const router = useRouter();
  const { hasPermission } = useUser();
  const externalId =
    typeof router.query.externalId === 'string' ? router.query.externalId : '';
  const [showRequest, setShowRequest] = useState(false);
  const [page, setPage] = useState(1);
  const [events, setEvents] = useState<SportarrEventItem[]>([]);

  const {
    data,
    error,
    mutate: revalidateLeague,
    isLoading,
  } = useSWR<SportarrDetails>(
    externalId ? `/api/v1/sportarr/${encodeURIComponent(externalId)}` : null
  );
  const eventUrl = data?.eventsAvailable
    ? `/api/v1/sportarr/${encodeURIComponent(externalId)}/events?page=${page}&pageSize=50`
    : null;
  const {
    data: eventPage,
    error: eventError,
    isLoading: eventsLoading,
    mutate: revalidateEvents,
  } = useSWR<SportarrEventPage>(eventUrl);

  useEffect(() => {
    setPage(1);
    setEvents([]);
  }, [externalId]);

  useEffect(() => {
    if (!eventPage) return;
    setEvents((current) => {
      const seen = new Set(current.map((event) => event.id));
      return [
        ...current,
        ...eventPage.results.filter((event) => !seen.has(event.id)),
      ];
    });
  }, [eventPage]);

  const title = data?.title ?? intl.formatMessage(messages.heading);
  const eventCountLabel = useMemo(() => {
    if (!eventPage) return '';
    return intl.formatMessage(messages.eventCount, {
      count: intl.formatNumber(eventPage.totalRecords),
    });
  }, [eventPage, intl]);
  const mayRequest = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_SPORTS],
    { type: 'or' }
  );
  const requestable =
    mayRequest && data?.libraryState === 'not-added' && data.requestable;
  const requestDisabledReason = !mayRequest
    ? intl.formatMessage(messages.noPermission)
    : data?.libraryState === 'unmonitored'
      ? intl.formatMessage(messages.unmonitored)
      : data?.libraryState === 'monitored'
        ? intl.formatMessage(messages.monitored)
        : data?.libraryState === 'requested'
          ? intl.formatMessage(messages.requestedHint)
          : undefined;

  const loadMore = () => setPage((current) => current + 1);
  const retryEvents = () => void revalidateEvents();
  const retryLeague = () => void revalidateLeague();

  return (
    <div className="media-page sportarr-detail-page">
      <PageTitle title={title} />
      <div className="page-title-row">
        <h1 className="page-title">{title}</h1>
        <PageStatus
          active={isLoading}
          label={intl.formatMessage(messages.loading)}
        />
      </div>
      <div className="sportarr-detail-navigation">
        <Button as="a" href="/discover/sports" buttonType="ghost">
          {intl.formatMessage(messages.back)}
        </Button>
        {data && (
          <Button
            buttonType="primary"
            disabled={!requestable}
            disabledReason={requestDisabledReason}
            onClick={() => setShowRequest(true)}
          >
            {data.libraryState === 'requested'
              ? intl.formatMessage(messages.requested)
              : intl.formatMessage(messages.request)}
          </Button>
        )}
      </div>

      {error && !data && (
        <PageErrorMessage
          title={getMessage(error) ?? intl.formatMessage(messages.loadError)}
          description={intl.formatMessage(messages.loadErrorHint)}
          retry={{
            onClick: retryLeague,
            tooltip: intl.formatMessage(messages.retry),
          }}
        />
      )}

      {data && (
        <>
          <article className="media-detail-card app-card-main card-layout refreshed-card-surface">
            {data.posterPath && (
              <div className="media-detail-artwork-layer">
                <CachedImage
                  type="tmdb"
                  src={data.posterPath}
                  alt=""
                  fill
                  priority
                  sizes="100vw"
                  className="media-detail-artwork-image"
                />
                <div className="refreshed-artwork-scrim" />
                <div className="refreshed-artwork-gradient" />
              </div>
            )}
            <div data-card-part="content">
              <div className="app-card-inset refreshed-inset-surface detail-summary-card app-detail-summary-grid">
                <div className="app-detail-poster-frame detail-card-poster sportarr-detail-poster">
                  <CachedImage
                    type="tmdb"
                    src={
                      data.posterPath ?? '/images/seerr_poster_not_found.png'
                    }
                    alt=""
                    fill
                    priority
                    sizes="(min-width: 640px) 80px, 64px"
                    className="media-detail-artwork-image"
                  />
                </div>
                <div>
                  <h2
                    className="card-title detail-summary-title"
                    data-title-weight="regular"
                  >
                    {data.title}
                  </h2>
                  {data.overview && (
                    <p className="description sportarr-detail-overview">
                      {data.overview}
                    </p>
                  )}
                  <div
                    className="sportarr-detail-facts"
                    aria-label={intl.formatMessage(messages.heading)}
                  >
                    {data.sport && (
                      <span>
                        <strong>{intl.formatMessage(messages.sport)}:</strong>{' '}
                        {data.sport}
                      </span>
                    )}
                    {data.country && (
                      <span>
                        <strong>{intl.formatMessage(messages.country)}:</strong>{' '}
                        {data.country}
                      </span>
                    )}
                    {data.year && (
                      <span>
                        <strong>{intl.formatMessage(messages.season)}:</strong>{' '}
                        {data.year}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </article>

          {data.libraryState === 'unmonitored' && (
            <Alert
              title={intl.formatMessage(messages.unmonitored)}
              type="warning"
            >
              {intl.formatMessage(messages.unmonitoredHint)}
            </Alert>
          )}
          {data.libraryState === 'requested' && (
            <Alert title={intl.formatMessage(messages.requested)} type="info">
              {intl.formatMessage(messages.requestedHint)}
            </Alert>
          )}

          <section
            className="app-filter-section-gap sportarr-event-section"
            aria-labelledby="sportarr-events-heading"
          >
            <Header subtext={eventPage ? eventCountLabel : undefined}>
              <span id="sportarr-events-heading">
                <CalendarDaysIcon
                  aria-hidden="true"
                  className="sportarr-event-heading-icon"
                />
                {intl.formatMessage(messages.events)}
              </span>
            </Header>
            {!data.eventsAvailable && data.libraryState !== 'unmonitored' && (
              <Alert
                title={intl.formatMessage(messages.eventsAfterAdd)}
                type="info"
              />
            )}
            {data.eventsAvailable && eventError && (
              <Alert
                title={
                  getMessage(eventError) ??
                  intl.formatMessage(messages.eventError)
                }
                type="warning"
              >
                <Button buttonType="ghost" onClick={retryEvents}>
                  {intl.formatMessage(messages.retry)}
                </Button>
              </Alert>
            )}
            {data.eventsAvailable &&
              !eventError &&
              events.length === 0 &&
              !eventsLoading && (
                <Alert
                  title={intl.formatMessage(messages.noEvents)}
                  type="info"
                />
              )}
            {events.length > 0 && (
              <div className="sportarr-event-list" aria-live="polite">
                {events.map((event) => {
                  const date = event.broadcastDate ?? event.eventDate;
                  return (
                    <article key={event.id} className="sportarr-event-card">
                      <div className="sportarr-event-card-main">
                        <h3>{event.title}</h3>
                        <time className="sportarr-event-date" dateTime={date}>
                          {event.season
                            ? `${intl.formatMessage(messages.season)} ${event.season} · `
                            : null}
                          {formatEventDate(intl, date, event.broadcastTimezone)}
                        </time>
                      </div>
                      <div className="sportarr-event-state">
                        <span
                          className={
                            event.hasFile
                              ? 'sportarr-event-file-ready'
                              : 'sportarr-event-file-missing'
                          }
                        >
                          {event.hasFile ? (
                            <CheckCircleIcon aria-hidden="true" />
                          ) : null}
                          {event.hasFile
                            ? intl.formatMessage(messages.available)
                            : intl.formatMessage(messages.missing)}
                        </span>
                        {event.fileCount > 1 && (
                          <span>
                            {intl.formatMessage(messages.partCount, {
                              count: event.fileCount,
                            })}
                          </span>
                        )}
                        {event.quality && <span>{event.quality}</span>}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            {data.eventsAvailable &&
              eventPage &&
              page < eventPage.totalPages && (
                <div className="sportarr-event-load-more">
                  <Button
                    buttonType="default"
                    disabled={eventsLoading}
                    onClick={loadMore}
                  >
                    {eventsLoading
                      ? intl.formatMessage(messages.loadingEvents)
                      : intl.formatMessage(messages.loadMore)}
                  </Button>
                </div>
              )}
          </section>
        </>
      )}

      {showRequest && data && (
        <SportarrRequestModal
          leagueId={data.id}
          leagueTitle={data.title}
          onCancel={() => setShowRequest(false)}
          onComplete={() => {
            setShowRequest(false);
            void revalidateLeague();
          }}
          onUpdating={() => undefined}
        />
      )}
    </div>
  );
};

export default SportarrDetailsPage;
