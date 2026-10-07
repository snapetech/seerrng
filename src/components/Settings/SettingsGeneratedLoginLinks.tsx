import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import defineMessages from '@app/utils/defineMessages';
import axios from 'axios';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

type UserOption = {
  id: number;
  username: string;
  displayName: string;
  email: string;
};
type LinkRecord = {
  id: number;
  userId: number;
  createdById: number;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  status: 'active' | 'used' | 'revoked' | 'expired';
};
type UserResults = { results: UserOption[] };
const messages = defineMessages(
  'components.Settings.SettingsGeneratedLoginLinks',
  {
    title: 'Admin-generated sign-in links',
    description:
      'Create a sign-in link for one user. Links expire after 30 minutes and can be used once. The raw token is shown only when created.',
    search: 'Find a user',
    selectUser: 'Select a user',
    generate: 'Generate sign-in link',
    generating: 'Generating…',
    link: 'Sign-in link (copy now)',
    copy: 'Copy link',
    copied: 'Copied.',
    active: 'Active',
    used: 'Used',
    revoked: 'Revoked',
    expired: 'Expired',
    revoke: 'Revoke',
    links: 'Recent links',
    empty: 'No sign-in links have been generated for this user.',
    error: 'Sign-in link action failed.',
  }
);

const SettingsGeneratedLoginLinks = () => {
  const intl = useIntl();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [userId, setUserId] = useState<number>();
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyLinkId, setBusyLinkId] = useState<number>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const { data: users } = useSWR<UserResults>(
    `/api/v1/user?take=100&sort=displayname${search.trim() ? `&q=${encodeURIComponent(search.trim())}` : ''}`
  );
  const linksKey = userId
    ? `/api/v1/settings/login-links?userId=${userId}`
    : null;
  const { data: links, isLoading, mutate } = useSWR<LinkRecord[]>(linksKey);

  const generate = async () => {
    if (!userId) return;
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    setGeneratedUrl('');
    try {
      const { data } = await axios.post<{ token: string }>(
        '/api/v1/settings/login-links',
        { userId }
      );
      const loginPath = `${router.basePath || ''}/login`;
      const url = new URL(loginPath, window.location.origin);
      url.hash = new URLSearchParams({ loginToken: data.token }).toString();
      setGeneratedUrl(url.toString());
      await mutate();
    } catch (caught) {
      setError(
        axios.isAxiosError(caught) &&
          typeof caught.response?.data?.message === 'string'
          ? caught.response.data.message
          : intl.formatMessage(messages.error)
      );
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(generatedUrl);
      setMessage(intl.formatMessage(messages.copied));
    } catch {
      setMessage(generatedUrl);
    }
  };
  const revoke = async (link: LinkRecord) => {
    setBusyLinkId(link.id);
    setError(undefined);
    try {
      await axios.post(`/api/v1/settings/login-links/${link.id}/revoke`);
      await mutate();
    } catch (caught) {
      setError(
        axios.isAxiosError(caught) &&
          typeof caught.response?.data?.message === 'string'
          ? caught.response.data.message
          : intl.formatMessage(messages.error)
      );
    } finally {
      setBusyLinkId(undefined);
    }
  };

  return (
    <section className="section app-card-sub">
      <h3 className="heading">{intl.formatMessage(messages.title)}</h3>
      <p className="description">{intl.formatMessage(messages.description)}</p>
      <div className="form-row">
        <label htmlFor="login-link-user-search">
          {intl.formatMessage(messages.search)}
        </label>
        <div className="form-input-area">
          <input
            id="login-link-user-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      <div className="form-row">
        <label htmlFor="login-link-user">
          {intl.formatMessage(messages.selectUser)}
        </label>
        <div className="form-input-area">
          <select
            id="login-link-user"
            value={userId ?? ''}
            onChange={(event) => {
              setUserId(
                event.target.value ? Number(event.target.value) : undefined
              );
              setGeneratedUrl('');
            }}
          >
            <option value="">{intl.formatMessage(messages.selectUser)}</option>
            {(users?.results ?? []).map((user) => (
              <option key={user.id} value={user.id}>
                {user.displayName || user.username || user.email} · {user.email}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="settings-page-actions">
        <Button
          buttonType="primary"
          type="button"
          disabled={!userId || busy}
          onClick={() => void generate()}
        >
          {intl.formatMessage(busy ? messages.generating : messages.generate)}
        </Button>
      </div>
      {generatedUrl && (
        <div className="form-row">
          <label htmlFor="generated-login-link">
            {intl.formatMessage(messages.link)}
          </label>
          <div className="form-input-area">
            <input
              id="generated-login-link"
              readOnly
              value={generatedUrl}
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button
              buttonType="default"
              type="button"
              onClick={() => void copy()}
            >
              {intl.formatMessage(messages.copy)}
            </Button>
          </div>
        </div>
      )}
      {message && (
        <p className="description" role="status">
          {message}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {userId && (
        <>
          <h4 className="heading">{intl.formatMessage(messages.links)}</h4>
          {isLoading && <LoadingSpinner />}
          {!isLoading && links?.length === 0 && (
            <p className="description">{intl.formatMessage(messages.empty)}</p>
          )}
          {links?.map((link) => (
            <div className="app-list-row" key={link.id}>
              <span className="app-list-value">
                {new Intl.DateTimeFormat(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(link.createdAt))}
              </span>
              <span className="app-list-value">
                {intl.formatMessage(messages[link.status])}
              </span>
              {link.status === 'active' && (
                <Button
                  buttonType="danger"
                  buttonSize="sm"
                  type="button"
                  disabled={busyLinkId !== undefined}
                  onClick={() => void revoke(link)}
                >
                  {intl.formatMessage(
                    busyLinkId === link.id
                      ? messages.generating
                      : messages.revoke
                  )}
                </Button>
              )}
            </div>
          ))}
        </>
      )}
    </section>
  );
};

export default SettingsGeneratedLoginLinks;
