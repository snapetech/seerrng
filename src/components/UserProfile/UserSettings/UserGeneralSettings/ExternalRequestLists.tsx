import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import useLocale from '@app/hooks/useLocale';
import defineMessages from '@app/utils/defineMessages';
import axios from 'axios';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

interface ExternalRequestList {
  id: number;
  provider: 'imdb' | 'goodreads';
  sourceUrl: string;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
}

interface ExternalRequestListSyncResult {
  requested: number;
  alreadyRequested: number;
  unmatched: number;
  failed: number;
  error?: string;
}

const messages = defineMessages(
  'components.UserProfile.UserSettings.UserGeneralSettings.ExternalRequestLists',
  {
    title: 'External request lists',
    description:
      'Connect a public IMDb watchlist or Goodreads to-read shelf. New items are checked daily and requested through your normal permissions and approval settings.',
    urlLabel: 'Public list URL',
    urlPlaceholder: 'https://www.imdb.com/user/ur12345678/watchlist/',
    add: 'Add list',
    adding: 'Adding…',
    empty: 'No external lists are connected.',
    imdb: 'IMDb watchlist',
    goodreads: 'Goodreads to-read shelf',
    sync: 'Sync now',
    syncing: 'Syncing…',
    remove: 'Remove',
    syncedNever: 'Not synced yet',
    syncSummary:
      'Sync complete: {requested} requested, {alreadyRequested} already requested, {unmatched} not found, {failed} failed.',
    saved: 'External list added.',
    removed: 'External list removed.',
    error: 'Could not update the external list. Try again.',
  }
);

const ExternalRequestLists = () => {
  const intl = useIntl();
  const { locale } = useLocale();
  const [sourceUrl, setSourceUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyListId, setBusyListId] = useState<number | null>(null);
  const [message, setMessage] = useState<string>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const {
    data: lists,
    error,
    isLoading,
    mutate,
  } = useSWR<ExternalRequestList[]>('/api/v1/request/lists');

  const formatError = (error: unknown) =>
    axios.isAxiosError(error) &&
    typeof error.response?.data?.message === 'string'
      ? error.response.data.message
      : intl.formatMessage(messages.error);

  const addList = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(undefined);
    setErrorMessage(undefined);
    setSaving(true);
    try {
      await axios.post('/api/v1/request/lists', { url: sourceUrl.trim() });
      setSourceUrl('');
      setMessage(intl.formatMessage(messages.saved));
      await mutate();
    } catch (error) {
      setErrorMessage(formatError(error));
    } finally {
      setSaving(false);
    }
  };

  const syncList = async (list: ExternalRequestList) => {
    setMessage(undefined);
    setErrorMessage(undefined);
    setBusyListId(list.id);
    try {
      const { data } = await axios.post<ExternalRequestListSyncResult>(
        `/api/v1/request/lists/${list.id}/sync`
      );
      setMessage(
        intl.formatMessage(messages.syncSummary, {
          requested: data.requested,
          alreadyRequested: data.alreadyRequested,
          unmatched: data.unmatched,
          failed: data.failed,
        })
      );
      if (data.error) setErrorMessage(data.error);
      await mutate();
    } catch (error) {
      setErrorMessage(formatError(error));
    } finally {
      setBusyListId(null);
    }
  };

  const removeList = async (list: ExternalRequestList) => {
    setMessage(undefined);
    setErrorMessage(undefined);
    setBusyListId(list.id);
    try {
      await axios.delete(`/api/v1/request/lists/${list.id}`);
      setMessage(intl.formatMessage(messages.removed));
      await mutate();
    } catch (error) {
      setErrorMessage(formatError(error));
    } finally {
      setBusyListId(null);
    }
  };

  return (
    <section className="section">
      <h3 className="heading">{intl.formatMessage(messages.title)}</h3>
      <p className="description">{intl.formatMessage(messages.description)}</p>

      <form className="form-row" onSubmit={addList}>
        <label htmlFor="external-request-list-url">
          {intl.formatMessage(messages.urlLabel)}
        </label>
        <div className="form-input-area">
          <input
            id="external-request-list-url"
            type="url"
            autoComplete="url"
            maxLength={2048}
            placeholder={intl.formatMessage(messages.urlPlaceholder)}
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            required
          />
          <div className="settings-page-actions">
            <Button
              buttonType="primary"
              type="submit"
              disabled={saving || !sourceUrl.trim()}
            >
              {intl.formatMessage(saving ? messages.adding : messages.add)}
            </Button>
          </div>
        </div>
      </form>

      {message && <p className="description">{message}</p>}
      {errorMessage && <p className="error">{errorMessage}</p>}
      {error && <p className="error">{intl.formatMessage(messages.error)}</p>}
      {isLoading && <LoadingSpinner />}
      {!isLoading && lists?.length === 0 && (
        <p className="description">{intl.formatMessage(messages.empty)}</p>
      )}
      {lists?.length ? (
        <div className="section app-list-items">
          <div className="app-list" role="list">
            {lists.map((list) => (
              <div className="app-list-row" key={list.id} role="listitem">
                <span className="app-list-label">
                  {intl.formatMessage(
                    list.provider === 'imdb'
                      ? messages.imdb
                      : messages.goodreads
                  )}
                </span>
                <a
                  className="app-list-value"
                  href={list.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {list.sourceUrl}
                </a>
                <span className="app-list-value">
                  {list.lastSyncedAt
                    ? new Intl.DateTimeFormat(locale, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(list.lastSyncedAt))
                    : intl.formatMessage(messages.syncedNever)}
                </span>
                {list.lastSyncError && (
                  <span className="error">{list.lastSyncError}</span>
                )}
                <div className="app-action-row">
                  <Button
                    buttonType="default"
                    buttonSize="sm"
                    type="button"
                    disabled={busyListId !== null}
                    onClick={() => void syncList(list)}
                  >
                    {busyListId === list.id
                      ? intl.formatMessage(messages.syncing)
                      : intl.formatMessage(messages.sync)}
                  </Button>
                  <Button
                    buttonType="danger"
                    buttonSize="sm"
                    type="button"
                    disabled={busyListId !== null}
                    onClick={() => void removeList(list)}
                  >
                    {intl.formatMessage(messages.remove)}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
};

export default ExternalRequestLists;
