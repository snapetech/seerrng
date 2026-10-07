import EmbyLogo from '@app/assets/services/emby-icon-only.svg';
import JellyfinLogo from '@app/assets/services/jellyfin-icon.svg';
import PlexLogo from '@app/assets/services/plex.svg';
import Button from '@app/components/Common/Button';
import ButtonWithLoader from '@app/components/Common/ButtonWithLoader';
import ImageFader from '@app/components/Common/ImageFader';
import PageTitle from '@app/components/Common/PageTitle';
import LanguagePicker from '@app/components/Layout/LanguagePicker';
import JellyfinLogin from '@app/components/Login/JellyfinLogin';
import LocalLogin from '@app/components/Login/LocalLogin';
import OidcLoginButton from '@app/components/Login/OidcLoginButton';
import PlexLoginButton from '@app/components/Login/PlexLoginButton';
import TransportSecurityNotice from '@app/components/TransportSecurityNotice';
import useSettings from '@app/hooks/useSettings';
import { useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import versionedAsset from '@app/utils/versionedAsset';
import { Transition } from '@headlessui/react';
import { XCircleIcon } from '@heroicons/react/24/solid';
import { MediaServerType } from '@server/constants/server';
import axios from 'axios';
import { useRouter } from 'next/dist/client/router';
import Image from 'next/image';
import { useEffect, useRef, useState, type JSX } from 'react';
import { useIntl } from 'react-intl';
import { CSSTransition, SwitchTransition } from 'react-transition-group';
import useSWR from 'swr';

const messages = defineMessages('components.Login', {
  signin: 'Sign In',
  signinheader: 'Sign in to continue',
  signinwithplex: 'Use your Plex account',
  signinwithjellyfin: 'Use your {mediaServerName} account',
  signinwithoverseerr: 'Use your {applicationTitle} account',
  loginLinkTitle: 'Sign in with a one-time link',
  loginLinkHelp:
    'Use this only if you expected a link from your administrator.',
  loginLinkContinue: 'Continue with sign-in link',
  loginLinkUsing: 'Signing in…',
  orsigninwith: 'Or sign in with',
  movie: 'Movie',
  series: 'Series',
});

export type LoginBackdrop = {
  path: string;
  title: string;
  mediaType: 'movie' | 'tv';
  year?: string;
};

const Login = ({
  initialBackdrops,
}: {
  initialBackdrops?: LoginBackdrop[];
}) => {
  const intl = useIntl();
  const router = useRouter();
  const settings = useSettings();
  const { user, revalidate } = useUser();

  const [error, setError] = useState('');
  const [isProcessing, setProcessing] = useState(false);
  const [authToken, setAuthToken] = useState<string | undefined>(undefined);
  const [transportReady, setTransportReady] = useState(false);
  const [loginLinkToken, setLoginLinkToken] = useState<string>();
  const [loginLinkProcessing, setLoginLinkProcessing] = useState(false);
  const [mediaServerLogin, setMediaServerLogin] = useState(
    settings.currentSettings.mediaServerLogin
  );

  useEffect(() => {
    if (!router.isReady) return;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get('loginToken');
    if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
      setLoginLinkToken(token);
    }
    if (params.has('loginToken')) {
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${window.location.search}`
      );
    }
  }, [router.isReady]);

  const handleGeneratedLoginLink = async () => {
    if (!loginLinkToken) return;
    setLoginLinkProcessing(true);
    setError('');
    try {
      const response = await axios.post('/api/v1/auth/login-link', {
        token: loginLinkToken,
      });
      if (!response.data?.id) throw new Error('Unable to complete sign-in.');
      const authenticatedUser = await revalidate();
      if (!authenticatedUser) {
        throw new Error(
          'Sign-in succeeded, but the browser session could not be established.'
        );
      }
    } catch (caught) {
      setError(
        axios.isAxiosError(caught) &&
          typeof caught.response?.data?.message === 'string'
          ? caught.response.data.message
          : caught instanceof Error
            ? caught.message
            : 'Unable to use this sign-in link.'
      );
      setLoginLinkToken(undefined);
    } finally {
      setLoginLinkProcessing(false);
    }
  };

  // Effect that is triggered when the `authToken` comes back from the Plex OAuth
  // We take the token and attempt to sign in. If we get a success message, we will
  // ask swr to revalidate the user which _should_ come back with a valid user.
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const login = async () => {
      setProcessing(true);
      try {
        const response = await axios.post(
          '/api/v1/auth/plex',
          { authToken },
          { signal: controller.signal }
        );

        if (active) {
          if (!response.data?.id) {
            throw new Error('Unable to complete Plex sign-in.');
          }

          const authenticatedUser = await revalidate();
          if (!authenticatedUser) {
            throw new Error(
              'Plex sign-in succeeded, but Seerr could not establish a browser session. Check that you are using the HTTPS URL or that direct HTTP session cookies are enabled.'
            );
          }
        }
      } catch (e) {
        if (active && !axios.isCancel(e)) {
          const message = axios.isAxiosError(e)
            ? e.response?.data?.message
            : e instanceof Error
              ? e.message
              : undefined;
          setError(message || 'Unable to complete Plex sign-in.');
        }
      } finally {
        if (active) {
          setAuthToken(undefined);
          setProcessing(false);
        }
      }
    };
    if (authToken) {
      void login();
    }

    return () => {
      active = false;
      controller.abort();
    };
  }, [authToken, revalidate]);

  // Effect that is triggered whenever `useUser`'s user changes. If we get a new
  // valid user, we redirect the user to the home page as the login was successful.
  useEffect(() => {
    if (user) {
      router.push('/');
    }
  }, [user, router]);

  const { data: backdrops } = useSWR<LoginBackdrop[]>('/api/v1/backdrops', {
    fallbackData: initialBackdrops,
    revalidateOnMount: !initialBackdrops,
    refreshInterval: 0,
    refreshWhenHidden: false,
    revalidateOnFocus: false,
  });

  const mediaServerName =
    settings.currentSettings.mediaServerType === MediaServerType.PLEX
      ? 'Plex'
      : settings.currentSettings.mediaServerType === MediaServerType.JELLYFIN
        ? 'Jellyfin'
        : settings.currentSettings.mediaServerType === MediaServerType.EMBY
          ? 'Emby'
          : undefined;

  const MediaServerLogo =
    settings.currentSettings.mediaServerType === MediaServerType.PLEX
      ? PlexLogo
      : settings.currentSettings.mediaServerType === MediaServerType.JELLYFIN
        ? JellyfinLogo
        : settings.currentSettings.mediaServerType === MediaServerType.EMBY
          ? EmbyLogo
          : undefined;

  const isJellyfin =
    settings.currentSettings.mediaServerType === MediaServerType.JELLYFIN ||
    settings.currentSettings.mediaServerType === MediaServerType.EMBY;
  const mediaServerLoginRef = useRef<HTMLDivElement>(null);
  const localLoginRef = useRef<HTMLDivElement>(null);
  const loginRef = mediaServerLogin ? mediaServerLoginRef : localLoginRef;

  const loginFormVisible =
    (isJellyfin && settings.currentSettings.mediaServerLogin) ||
    settings.currentSettings.localLogin;
  const additionalLoginOptions = [
    settings.currentSettings.mediaServerLogin &&
      (settings.currentSettings.mediaServerType === MediaServerType.PLEX ? (
        <PlexLoginButton
          key="plex"
          isProcessing={isProcessing}
          onAuthToken={(authToken) => setAuthToken(authToken)}
          onError={setError}
          large={!isJellyfin && !settings.currentSettings.localLogin}
        />
      ) : (
        settings.currentSettings.localLogin &&
        (mediaServerLogin ? (
          <ButtonWithLoader
            key="seerr"
            data-testid="seerr-login-button"
            className="min-w-0 flex-grow"
            onClick={() => setMediaServerLogin(false)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={versionedAsset('/os_icon.svg')}
              alt={settings.currentSettings.applicationTitle}
              className="mr-2 h-5"
            />
            <span>{settings.currentSettings.applicationTitle}</span>
          </ButtonWithLoader>
        ) : (
          <ButtonWithLoader
            key="mediaserver"
            data-testid="mediaserver-login-button"
            className="min-w-0 flex-grow"
            onClick={() => setMediaServerLogin(true)}
          >
            <MediaServerLogo />
            <span>{mediaServerName}</span>
          </ButtonWithLoader>
        ))
      )),
    ...settings.currentSettings.openIdProviders.map((provider) => (
      <OidcLoginButton
        key={provider.slug}
        provider={provider}
        onError={setError}
      />
    )),
  ].filter((o): o is JSX.Element => !!o);

  return (
    <div className="auth-login-page relative flex min-h-screen flex-col bg-gray-900">
      <PageTitle title={intl.formatMessage(messages.signin)} />
      <ImageFader
        backgroundImages={
          backdrops?.map(
            (backdrop) => `https://image.tmdb.org/t/p/w1280${backdrop.path}`
          ) ?? []
        }
        backgroundTitles={
          backdrops?.map(
            (backdrop) =>
              intl.formatMessage(
                backdrop.mediaType === 'tv' ? messages.series : messages.movie
              ) +
              ': ' +
              backdrop.title +
              (backdrop.year ? ' (' + backdrop.year + ')' : '')
          ) ?? []
        }
      />
      <div className="absolute top-4 right-4 z-50">
        <LanguagePicker />
      </div>
      <div className="auth-login-brand relative z-40 flex flex-col items-center px-4 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="relative h-48 w-full max-w-full drop-shadow-[0_2px_8px_rgba(15,23,42,0.65)]">
          <Image
            src={versionedAsset('/logo_stacked.svg')}
            alt="Logo"
            fill
            priority
            fetchPriority="high"
            className="object-contain"
          />
        </div>
      </div>
      <div className="relative z-50 mt-4 sm:mx-auto sm:w-full sm:max-w-md">
        <TransportSecurityNotice onReadinessChange={setTransportReady} />
      </div>
      <div className="auth-login-form relative z-50 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="auth-frosted-surface app-card-main refreshed-card-surface overflow-hidden rounded-xl border border-gray-700 shadow-lg shadow-gray-950/20">
          <>
            <Transition
              as="div"
              show={!!error}
              enter="transition-opacity duration-300"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="transition-opacity duration-300"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <div className="bg-red-600 p-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <XCircleIcon className="h-5 w-5 text-red-300" />
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-red-300">
                      {error}
                    </h3>
                  </div>
                </div>
              </div>
            </Transition>
            <div className="px-10 py-8">
              {transportReady && loginLinkToken && (
                <div className="mb-6">
                  <h2 className="refreshed-detail-text mb-2 text-center text-lg font-bold">
                    {intl.formatMessage(messages.loginLinkTitle)}
                  </h2>
                  <p className="refreshed-detail-text-muted mb-4 text-center text-sm">
                    {intl.formatMessage(messages.loginLinkHelp)}
                  </p>
                  <Button
                    buttonType="primary"
                    type="button"
                    className="w-full"
                    disabled={loginLinkProcessing}
                    onClick={() => void handleGeneratedLoginLink()}
                  >
                    {intl.formatMessage(
                      loginLinkProcessing
                        ? messages.loginLinkUsing
                        : messages.loginLinkContinue
                    )}
                  </Button>
                </div>
              )}
              {transportReady && loginFormVisible && (
                <SwitchTransition mode="out-in">
                  <CSSTransition
                    key={mediaServerLogin ? 'ms' : 'local'}
                    nodeRef={loginRef}
                    timeout={{ enter: 300, exit: 150 }}
                    onEntered={() => {
                      document
                        .querySelector<HTMLInputElement>('#email, #username')
                        ?.focus();
                    }}
                    classNames={{
                      enter: 'opacity-0',
                      enterActive:
                        'transition-opacity duration-300 opacity-100',
                      exit: 'opacity-100',
                      exitActive: 'transition-opacity duration-150 opacity-0',
                    }}
                  >
                    <div ref={loginRef} className="button-container">
                      {isJellyfin &&
                      (mediaServerLogin ||
                        !settings.currentSettings.localLogin) ? (
                        <JellyfinLogin
                          serverType={settings.currentSettings.mediaServerType}
                          revalidate={revalidate}
                        />
                      ) : (
                        settings.currentSettings.localLogin && (
                          <LocalLogin revalidate={revalidate} />
                        )
                      )}
                    </div>
                  </CSSTransition>
                </SwitchTransition>
              )}

              {transportReady &&
                additionalLoginOptions.length > 0 &&
                (loginFormVisible ? (
                  <div className="flex items-center py-5">
                    <div className="flex-grow border-t border-gray-600" />
                    <span className="refreshed-detail-text-muted mx-2 flex-shrink text-sm">
                      {intl.formatMessage(messages.orsigninwith)}
                    </span>
                    <div className="flex-grow border-t border-gray-600" />
                  </div>
                ) : (
                  <h2 className="refreshed-detail-text mb-6 text-center text-lg font-bold">
                    {intl.formatMessage(messages.signinheader)}
                  </h2>
                ))}

              {transportReady && (
                <div
                  className={`flex w-full flex-wrap gap-2 ${
                    !loginFormVisible ? 'flex-col' : ''
                  }`}
                >
                  {additionalLoginOptions}
                </div>
              )}
            </div>
          </>
        </div>
      </div>
    </div>
  );
};

export default Login;
