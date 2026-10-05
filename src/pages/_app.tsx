import ButtonHelp from '@app/components/Common/ButtonHelp';
import Layout from '@app/components/Layout';
import LoadingBar from '@app/components/LoadingBar';
import PWAHeader from '@app/components/PWAHeader';
import { InteractionProvider } from '@app/context/InteractionContext';
import { LanguageContext } from '@app/context/LanguageContext';
import { NativeRuntimeProvider } from '@app/context/NativeRuntimeContext';
import { SettingsProvider } from '@app/context/SettingsContext';
import { ThemeProvider } from '@app/context/ThemeContext';
import { UserContext } from '@app/context/UserContext';
import useSettings from '@app/hooks/useSettings';
import '@app/styles/globals.css';
import { polyfillIntl } from '@app/utils/polyfillIntl';
import '@fontsource-variable/inter';
import type { AvailableLocale } from '@server/types/languages';
import axios from 'axios';
import type { AppProps } from 'next/app';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { useEffect, useRef, useState } from 'react';
import { Toaster } from 'react-hot-toast';
import { IntlProvider } from 'react-intl';
import { SWRConfig } from 'swr';

const ServiceWorkerSetup = dynamic(
  () => import('@app/components/ServiceWorkerSetup'),
  { ssr: false }
);
const StatusChecker = dynamic(() => import('@app/components/StatusChecker'), {
  ssr: false,
});

const isPathPrefix = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loadLocaleData = (locale: AvailableLocale): Promise<any> => {
  switch (locale) {
    case 'ar':
      return import('../i18n/locale/ar.json');
    case 'bg':
      return import('../i18n/locale/bg.json');
    case 'ca':
      return import('../i18n/locale/ca.json');
    case 'cs':
      return import('../i18n/locale/cs.json');
    case 'da':
      return import('../i18n/locale/da.json');
    case 'de':
      return import('../i18n/locale/de.json');
    case 'el':
      return import('../i18n/locale/el.json');
    case 'es':
      return import('../i18n/locale/es.json');
    case 'es-MX':
      return import('../i18n/locale/es_MX.json');
    case 'et':
      return import('../i18n/locale/et.json');
    case 'fi':
      return import('../i18n/locale/fi.json');
    case 'fr':
      return import('../i18n/locale/fr.json');
    case 'he':
      return import('../i18n/locale/he.json');
    case 'hi':
      return import('../i18n/locale/hi.json');
    case 'hr':
      return import('../i18n/locale/hr.json');
    case 'hu':
      return import('../i18n/locale/hu.json');
    case 'it':
      return import('../i18n/locale/it.json');
    case 'ja':
      return import('../i18n/locale/ja.json');
    case 'ko':
      return import('../i18n/locale/ko.json');
    case 'lb':
      return import('../i18n/locale/lb.json');
    case 'lt':
      return import('../i18n/locale/lt.json');
    case 'nb-NO':
      return import('../i18n/locale/nb_NO.json');
    case 'nl':
      return import('../i18n/locale/nl.json');
    case 'pl':
      return import('../i18n/locale/pl.json');
    case 'pt-BR':
      return import('../i18n/locale/pt_BR.json');
    case 'pt-PT':
      return import('../i18n/locale/pt_PT.json');
    case 'ro':
      return import('../i18n/locale/ro.json');
    case 'ru':
      return import('../i18n/locale/ru.json');
    case 'sq':
      return import('../i18n/locale/sq.json');
    case 'sr':
      return import('../i18n/locale/sr.json');
    case 'sv':
      return import('../i18n/locale/sv.json');
    case 'tr':
      return import('../i18n/locale/tr.json');
    case 'uk':
      return import('../i18n/locale/uk.json');
    case 'vi':
      return import('../i18n/locale/vi.json');
    case 'zh-CN':
      return import('../i18n/locale/zh_Hans.json');
    case 'zh-TW':
      return import('../i18n/locale/zh_Hant.json');
    default:
      return import('../i18n/locale/en.json');
  }
};

type MessagesType = Record<string, string>;
// English defaults live on each message descriptor; avoid bundling the full
// catalogue into the shared app entry.
const emptyMessages: MessagesType = {};

// Reads settings from context (populated client-side by SettingsProvider)
// to set the document title and PWA meta tags.
const AppHead = () => {
  const { currentSettings } = useSettings();

  return (
    <Head>
      <title>{currentSettings.applicationTitle}</title>
      <PWAHeader applicationTitle={currentSettings.applicationTitle} />
    </Head>
  );
};

const CoreApp = ({ Component, pageProps, router }: AppProps) => {
  let component: React.ReactNode;
  const [loadedMessages, setMessages] = useState<MessagesType>(emptyMessages);
  const [currentLocale, setLocale] = useState<AvailableLocale>('en');
  const loadedLocale = useRef<AvailableLocale>('en');

  useEffect(() => {
    polyfillIntl();
  }, []);

  useEffect(() => {
    if (currentLocale === loadedLocale.current) {
      return;
    }

    if (currentLocale === 'en') {
      loadedLocale.current = 'en';
      setMessages(emptyMessages);
      return;
    }

    let active = true;
    void loadLocaleData(currentLocale)
      .then((localeMessages) => {
        if (!active) {
          return;
        }
        loadedLocale.current = currentLocale;
        setMessages(localeMessages);
      })
      .catch(() => {
        // Keep the last complete locale when a chunk fails to load.
      });

    return () => {
      active = false;
    };
  }, [currentLocale]);

  if (
    isPathPrefix(router.pathname, '/login') ||
    isPathPrefix(router.pathname, '/setup') ||
    isPathPrefix(router.pathname, '/resetpassword')
  ) {
    component = <Component {...pageProps} />;
  } else {
    component = (
      <Layout>
        <Component {...pageProps} />
      </Layout>
    );
  }

  return (
    <SWRConfig
      value={{
        fetcher: (url) => axios.get(url).then((res) => res.data),
        revalidateOnFocus: false,
        focusThrottleInterval: 30000,
        dedupingInterval: 30000,
        keepPreviousData: true,
      }}
    >
      <LanguageContext.Provider value={{ locale: currentLocale, setLocale }}>
        <IntlProvider
          locale={currentLocale}
          defaultLocale="en"
          messages={currentLocale === 'en' ? emptyMessages : loadedMessages}
        >
          <LoadingBar />
          <ThemeProvider>
            <SettingsProvider>
              <InteractionProvider>
                <Head>
                  <meta
                    name="viewport"
                    content="initial-scale=1, viewport-fit=cover, width=device-width"
                  />
                </Head>
                <AppHead />
                <StatusChecker />
                <ServiceWorkerSetup />
                <UserContext>
                  <NativeRuntimeProvider>{component}</NativeRuntimeProvider>
                </UserContext>
                <ButtonHelp key={router.asPath} />
                <Toaster
                  position="top-right"
                  toastOptions={{ duration: 4000 }}
                  containerStyle={{
                    zIndex: 10000,
                    paddingTop: 'env(safe-area-inset-top)',
                  }}
                />
              </InteractionProvider>
            </SettingsProvider>
          </ThemeProvider>
        </IntlProvider>
      </LanguageContext.Provider>
    </SWRConfig>
  );
};

export default CoreApp;
