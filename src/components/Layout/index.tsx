import MobileMenu from '@app/components/Layout/MobileMenu';
import PullToRefresh from '@app/components/Layout/PullToRefresh';
import SearchInput from '@app/components/Layout/SearchInput';
import Sidebar from '@app/components/Layout/Sidebar';
import ThemePicker from '@app/components/Layout/ThemePicker';
import UserDropdown from '@app/components/Layout/UserDropdown';
import UserWarnings from '@app/components/Layout/UserWarnings';
import useLocale from '@app/hooks/useLocale';
import useSearchActivity from '@app/hooks/useSearchActivity';
import useSettings from '@app/hooks/useSettings';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { ArrowLeftIcon, Bars3BottomLeftIcon } from '@heroicons/react/24/solid';
import type { AvailableLocale } from '@server/types/languages';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

type LayoutProps = {
  children: React.ReactNode;
};

const messages = defineMessages('components.Layout', {
  searching: 'Searching',
});

const Layout = ({ children }: LayoutProps) => {
  const intl = useIntl();
  const isSearching = useSearchActivity();
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const isScrolledRef = useRef(false);
  const { hasPermission, user } = useUser();
  const router = useRouter();
  const { currentSettings } = useSettings();
  const { setLocale } = useLocale();
  const [countsEnabled, setCountsEnabled] = useState(false);
  const { data: requestResponse, mutate: revalidateRequestsCount } = useSWR(
    countsEnabled ? '/api/v1/request/count' : null,
    {
      revalidateOnMount: true,
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    }
  );
  const { data: issueResponse, mutate: revalidateIssueCount } = useSWR(
    countsEnabled ? '/api/v1/issue/count' : null,
    {
      revalidateOnMount: true,
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    }
  );

  useEffect(() => {
    if (setLocale && user) {
      setLocale(
        (user?.settings?.locale
          ? user.settings.locale
          : currentSettings.locale) as AvailableLocale
      );
    }
  }, [setLocale, currentSettings.locale, user]);

  useEffect(() => {
    if ('requestIdleCallback' in window) {
      const idleCallback = window.requestIdleCallback(
        () => setCountsEnabled(true),
        { timeout: 5000 }
      );

      return () => window.cancelIdleCallback(idleCallback);
    }

    const timeout = globalThis.setTimeout(() => setCountsEnabled(true), 2000);

    return () => globalThis.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!countsEnabled) {
      return;
    }

    const handleFocus = () => {
      revalidateRequestsCount();
      revalidateIssueCount();
    };

    window.addEventListener('focus', handleFocus);

    return () => window.removeEventListener('focus', handleFocus);
  }, [countsEnabled, revalidateIssueCount, revalidateRequestsCount]);

  useEffect(() => {
    const newNavigator = navigator as unknown as {
      setAppBadge?: (count: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };

    if (!('setAppBadge' in newNavigator)) {
      return;
    }

    if (!hasPermission(Permission.ADMIN)) {
      newNavigator.clearAppBadge?.();
      return;
    }

    const pendingRequests = requestResponse?.pending;

    if (typeof pendingRequests !== 'number') {
      return;
    }

    if (pendingRequests > 0) {
      newNavigator.setAppBadge?.(pendingRequests);
    } else {
      newNavigator.clearAppBadge?.();
    }
  }, [hasPermission, requestResponse?.pending]);

  useEffect(() => {
    const updateScrolled = () => {
      const nextIsScrolled = window.pageYOffset > 20;

      if (nextIsScrolled !== isScrolledRef.current) {
        isScrolledRef.current = nextIsScrolled;
        setIsScrolled(nextIsScrolled);
      }
    };

    window.addEventListener('scroll', updateScrolled, { passive: true });

    return () => {
      window.removeEventListener('scroll', updateScrolled);
    };
  }, []);

  return (
    <div className="app-shell flex h-full min-h-full min-w-0">
      <div className="pwa-only fixed inset-0 z-20 h-1 w-full border-gray-700 md:border-t" />
      <div className="app-backdrop pointer-events-none fixed inset-0 h-full w-full" />
      <Sidebar
        open={isSidebarOpen}
        setClosed={() => setSidebarOpen(false)}
        pendingRequestsCount={requestResponse?.pending ?? 0}
        openIssuesCount={issueResponse?.open ?? 0}
        revalidateIssueCount={() => revalidateIssueCount()}
        revalidateRequestsCount={() => revalidateRequestsCount()}
      />
      <div className="sm:hidden">
        <MobileMenu
          pendingRequestsCount={requestResponse?.pending ?? 0}
          openIssuesCount={issueResponse?.open ?? 0}
          revalidateIssueCount={() => revalidateIssueCount()}
          revalidateRequestsCount={() => revalidateRequestsCount()}
        />
      </div>

      <div className="relative mb-16 flex w-0 min-w-0 flex-1 flex-col lg:ml-64">
        <PullToRefresh />
        <div
          className={`searchbar fixed top-0 right-0 left-0 z-10 flex flex-shrink-0 transition duration-300 ${
            isScrolled ? 'app-searchbar-scrolled' : 'bg-transparent'
          } lg:left-64`}
        >
          <div className="flex flex-1 items-center justify-between px-4 md:pr-4 md:pl-4">
            <button
              className={`mr-2 hidden text-white sm:block ${
                isScrolled ? 'opacity-90' : 'opacity-70'
              } transition duration-300 focus:outline-none lg:hidden`}
              aria-label="Open sidebar"
              onClick={() => setSidebarOpen(true)}
              data-testid="sidebar-toggle"
            >
              <Bars3BottomLeftIcon className="h-7 w-7" />
            </button>
            <button
              className={`mr-2 text-white ${
                isScrolled ? 'opacity-90' : 'opacity-70'
              } pwa-only transition duration-300 hover:text-white focus:text-white focus:outline-none`}
              onClick={() => router.back()}
            >
              <ArrowLeftIcon className="w-7" />
            </button>
            <div className="min-w-0 flex-1">
              <SearchInput />
            </div>
            <div className="relative z-20 ml-2 flex shrink-0 items-center gap-2">
              <ThemePicker />
              <UserDropdown />
            </div>
          </div>
        </div>

        <main className="relative top-16 z-0 focus:outline-none" tabIndex={0}>
          <div className="mb-6">
            <div className="max-w-8xl mx-auto px-4">
              <UserWarnings />
              <div className="global-search-progress-region">
                <div
                  className="global-search-progress-indicator"
                  role="status"
                  aria-live="polite"
                >
                  {isSearching && (
                    <>
                      <ArrowPathIcon className="h-5 w-5 animate-spin" />
                      <span>{intl.formatMessage(messages.searching)}</span>
                    </>
                  )}
                </div>
                {children}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Layout;
