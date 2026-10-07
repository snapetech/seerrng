import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import defineMessages from '@app/utils/defineMessages';
import type ReadMeABookRequest from '@server/entity/ReadMeABookRequest';
import axios from 'axios';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

type Audiobook = {
  asin: string;
  title: string;
  author: string;
  narrator?: string | null;
  description?: string | null;
  coverArtUrl?: string | null;
  durationMinutes?: number | null;
};
type RequestItem = Pick<
  ReadMeABookRequest,
  'id' | 'asin' | 'title' | 'author' | 'status' | 'statusMessage'
>;
type RemoteDetails = {
  downloadHistory: Record<string, unknown>[];
  jobs: Record<string, unknown>[];
};

const messages = defineMessages('components.Discover.ReadMeABookSearch', {
  title: 'ReadMeABook',
  description: 'Search available audiobooks and request them through SeerrNG.',
  query: 'Title, author, or narrator',
  search: 'Search ReadMeABook',
  searching: 'Searching…',
  requests: 'Your audiobook requests',
  request: 'Request audiobook',
  requesting: 'Requesting…',
  pending: 'Waiting for approval',
  refresh: 'Refresh status',
  refreshing: 'Refreshing…',
  empty: 'No audiobook requests yet.',
  disabled: 'ReadMeABook is not configured.',
  failed: 'The request could not be completed. Try again.',
});

const ReadMeABookSearch = () => {
  const intl = useIntl();
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [busyAsin, setBusyAsin] = useState<string>();
  const [busyRequestId, setBusyRequestId] = useState<number>();
  const [notice, setNotice] = useState<string>();
  const [details, setDetails] = useState<Record<number, RemoteDetails>>({});
  const { data: status } = useSWR<{ enabled: boolean }>(
    '/api/v1/readmeabook/status'
  );
  const { data: results, isLoading: isSearching } = useSWR<Audiobook[]>(
    status?.enabled && submittedQuery
      ? `/api/v1/readmeabook/search?query=${encodeURIComponent(submittedQuery)}`
      : null
  );
  const {
    data: requests,
    isLoading,
    mutate,
  } = useSWR<RequestItem[]>(
    status?.enabled ? '/api/v1/readmeabook/requests' : null
  );

  if (!status?.enabled) return null;

  const search = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice(undefined);
    setSubmittedQuery(query.trim().slice(0, 160));
  };
  const requestAudiobook = async (book: Audiobook) => {
    setBusyAsin(book.asin);
    setNotice(undefined);
    try {
      await axios.post('/api/v1/readmeabook/requests', book);
      setNotice(`${book.title} requested.`);
      await mutate();
    } catch (error) {
      setNotice(
        axios.isAxiosError(error) &&
          typeof error.response?.data?.message === 'string'
          ? error.response.data.message
          : intl.formatMessage(messages.failed)
      );
    } finally {
      setBusyAsin(undefined);
    }
  };
  const refreshRequest = async (item: RequestItem) => {
    setBusyRequestId(item.id);
    setNotice(undefined);
    try {
      const response = await axios.get<
        RemoteDetails & { status: string; statusMessage: string | null }
      >(`/api/v1/readmeabook/requests/${item.id}`);
      setDetails((current) => ({ ...current, [item.id]: response.data }));
      await mutate();
    } catch (error) {
      setNotice(
        axios.isAxiosError(error) &&
          typeof error.response?.data?.message === 'string'
          ? error.response.data.message
          : intl.formatMessage(messages.failed)
      );
    } finally {
      setBusyRequestId(undefined);
    }
  };

  return (
    <section className="section app-card-sub">
      <h2 className="heading">{intl.formatMessage(messages.title)}</h2>
      <p className="description">{intl.formatMessage(messages.description)}</p>
      <form className="form-row" onSubmit={search}>
        <label htmlFor="readmeabook-search">
          {intl.formatMessage(messages.query)}
        </label>
        <div className="form-input-area">
          <input
            id="readmeabook-search"
            type="search"
            maxLength={160}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="settings-page-actions">
            <Button buttonType="primary" type="submit" disabled={!query.trim()}>
              {intl.formatMessage(
                isSearching ? messages.searching : messages.search
              )}
            </Button>
          </div>
        </div>
      </form>
      {notice && (
        <p className="description" role="status">
          {notice}
        </p>
      )}
      {isSearching && <LoadingSpinner />}
      {results?.length ? (
        <div className="app-list" role="list">
          {results.map((book) => (
            <article className="app-list-row" role="listitem" key={book.asin}>
              <div className="app-list-label">{book.title}</div>
              <div className="app-list-value">
                {book.author}
                {book.narrator ? ` · ${book.narrator}` : ''}
              </div>
              <Button
                buttonType="primary"
                buttonSize="sm"
                type="button"
                disabled={busyAsin !== undefined}
                onClick={() => void requestAudiobook(book)}
              >
                {intl.formatMessage(
                  busyAsin === book.asin
                    ? messages.requesting
                    : messages.request
                )}
              </Button>
            </article>
          ))}
        </div>
      ) : null}
      <h3 className="heading">{intl.formatMessage(messages.requests)}</h3>
      {isLoading && <LoadingSpinner />}
      {!isLoading && requests?.length === 0 && (
        <p className="description">{intl.formatMessage(messages.empty)}</p>
      )}
      {requests?.map((item) => (
        <div className="app-list-row" key={item.id}>
          <span className="app-list-label">{item.title}</span>
          <span className="app-list-value">{item.author}</span>
          <span className="app-list-value">
            {item.status === 'awaiting_approval'
              ? intl.formatMessage(messages.pending)
              : item.status}
            {item.statusMessage ? ` · ${item.statusMessage}` : ''}
          </span>
          {item.status !== 'awaiting_approval' && (
            <Button
              buttonType="default"
              buttonSize="sm"
              type="button"
              disabled={busyRequestId !== undefined}
              onClick={() => void refreshRequest(item)}
            >
              {intl.formatMessage(
                busyRequestId === item.id
                  ? messages.refreshing
                  : messages.refresh
              )}
            </Button>
          )}
          {details[item.id]?.downloadHistory.length ||
          details[item.id]?.jobs.length ? (
            <details className="app-list-value">
              <summary>Download and processing details</summary>
              <pre>{JSON.stringify(details[item.id], null, 2)}</pre>
            </details>
          ) : null}
        </div>
      ))}
    </section>
  );
};

export default ReadMeABookSearch;
