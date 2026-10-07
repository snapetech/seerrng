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
  coverArtUrl?: string | null;
  durationMinutes?: number | null;
};
type RequestItem = Pick<ReadMeABookRequest, 'asin' | 'status'>;

const messages = defineMessages('components.Discover.ReadMeABookHomeSection', {
  request: 'Request',
  requesting: 'Requesting…',
  requested: 'Requested',
  loadError: 'This audiobook section could not be loaded.',
  requestError: 'The audiobook request could not be completed.',
});

type Props = {
  title: string;
  section: 'popular' | 'new' | 'subject';
  subject?: string;
};

const ReadMeABookHomeSection = ({ title, section, subject }: Props) => {
  const intl = useIntl();
  const [busyAsin, setBusyAsin] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const { data: status } = useSWR<{ enabled: boolean }>(
    '/api/v1/readmeabook/status'
  );
  const params = new URLSearchParams({ section });
  if (subject) params.set('subject', subject);
  const {
    data: books,
    error,
    isLoading,
  } = useSWR<Audiobook[]>(
    status?.enabled ? `/api/v1/readmeabook/discover?${params.toString()}` : null
  );
  const { data: requests, mutate } = useSWR<RequestItem[]>(
    status?.enabled ? '/api/v1/readmeabook/requests' : null
  );

  if (!status?.enabled) return null;

  const requestAudiobook = async (book: Audiobook) => {
    setBusyAsin(book.asin);
    setNotice(undefined);
    try {
      await axios.post('/api/v1/readmeabook/requests', book);
      setNotice(`${book.title} requested.`);
      await mutate();
    } catch (caught) {
      setNotice(
        axios.isAxiosError(caught) &&
          typeof caught.response?.data?.message === 'string'
          ? caught.response.data.message
          : intl.formatMessage(messages.requestError)
      );
    } finally {
      setBusyAsin(undefined);
    }
  };

  return (
    <section className="section app-card-sub">
      <h2 className="heading">{title}</h2>
      {isLoading && <LoadingSpinner />}
      {error && (
        <p className="error">{intl.formatMessage(messages.loadError)}</p>
      )}
      {notice && (
        <p className="description" role="status">
          {notice}
        </p>
      )}
      {books?.length ? (
        <div className="app-list" role="list">
          {books.map((book) => {
            const requested = requests?.some(
              (item) =>
                item.asin === book.asin &&
                !['failed', 'denied', 'cancelled'].includes(item.status)
            );
            return (
              <article className="app-list-row" role="listitem" key={book.asin}>
                <div>
                  <div className="app-list-label">{book.title}</div>
                  <div className="app-list-value">
                    {book.author}
                    {book.narrator ? ` · ${book.narrator}` : ''}
                  </div>
                </div>
                <Button
                  buttonType={requested ? 'default' : 'primary'}
                  buttonSize="sm"
                  type="button"
                  disabled={requested || busyAsin !== undefined}
                  onClick={() => void requestAudiobook(book)}
                >
                  {intl.formatMessage(
                    busyAsin === book.asin
                      ? messages.requesting
                      : requested
                        ? messages.requested
                        : messages.request
                  )}
                </Button>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
};

export default ReadMeABookHomeSection;
