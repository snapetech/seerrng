import Button from '@app/components/Common/Button';
import Header from '@app/components/Common/Header';
import Modal from '@app/components/Common/Modal';
import PageTitle from '@app/components/Common/PageTitle';
import type { SettingsRoute } from '@app/components/Common/SettingsTabs';
import SettingsTabs from '@app/components/Common/SettingsTabs';
import { SETTINGS_USER_CHANGE_EVENT } from '@app/components/Settings/settingsEvents';
import useSettings from '@app/hooks/useSettings';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { Transition } from '@headlessui/react';
import { MagnifyingGlassIcon } from '@heroicons/react/24/solid';
import { MediaServerType } from '@server/constants/server';
import { useRouter } from 'next/router';
import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Settings', {
  menuGeneralSettings: 'General',
  menuUsers: 'Users',
  menuPlexSettings: 'Plex',
  menuJellyfinSettings: '{mediaServerName}',
  menuServices: 'Services',
  menuNetwork: 'Network',
  menuNotifications: 'Notifications',
  menuLogs: 'Logs',
  menuJobs: 'Jobs & Cache',
  menuAbout: 'About',
  menuMetadataProviders: 'Metadata Providers',
  searchSettings: 'Search Settings',
  save: 'Save',
  discard: 'Discard',
  unsavedChanges: 'Unsaved Changes',
  unsavedChangesMessage: 'Changes have not been saved.',
});

type SettingsLayoutProps = {
  children: React.ReactNode;
};

type SettingsPageAction = {
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  onClick: () => void;
};

const SettingsPageActionContext = createContext<
  (action: SettingsPageAction | null) => void
>(() => undefined);

export const useSettingsPageAction = (action: SettingsPageAction | null) => {
  const setPageAction = useContext(SettingsPageActionContext);

  useEffect(() => {
    setPageAction(action);
    return () => setPageAction(null);
  }, [action, setPageAction]);
};

const editableSettingsRoute = (path: string) =>
  !/^\/settings\/(?:services|logs|jobs|about)(?:\/|$)/.test(path);

const SettingsLayout = ({ children }: SettingsLayoutProps) => {
  const intl = useIntl();
  const router = useRouter();
  const settings = useSettings();
  const contentRef = useRef<HTMLDivElement>(null);
  const currentSettingsPathRef = useRef(router.asPath);
  const dirtyRef = useRef(false);
  const [keywordSearch, setKeywordSearch] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showUnsavedChanges, setShowUnsavedChanges] = useState(false);
  const [pageAction, setPageAction] = useState<SettingsPageAction | null>(null);
  const registerPageAction = useCallback(
    (action: SettingsPageAction | null) => setPageAction(action),
    []
  );
  const hasSaveActions = editableSettingsRoute(router.pathname);
  const settingsRoutes: SettingsRoute[] = [
    {
      text: intl.formatMessage(messages.menuGeneralSettings),
      route: '/settings/main',
      regex: /^\/settings(\/main)?$/,
    },
    {
      text: intl.formatMessage(messages.menuUsers),
      route: '/settings/users',
      regex: /^\/settings\/users/,
    },
    settings.currentSettings.mediaServerType === MediaServerType.PLEX
      ? {
          text: intl.formatMessage(messages.menuPlexSettings),
          route: '/settings/plex',
          regex: /^\/settings\/plex/,
        }
      : {
          text: getAvailableMediaServerName(),
          route: '/settings/jellyfin',
          regex: /^\/settings\/jellyfin/,
        },
    {
      text: intl.formatMessage(messages.menuServices),
      route: '/settings/services',
      regex: /^\/settings\/services/,
    },
    {
      text: intl.formatMessage(messages.menuNetwork),
      route: '/settings/network',
      regex: /^\/settings\/network/,
    },
    {
      text: intl.formatMessage(messages.menuMetadataProviders),
      route: '/settings/metadata',
      regex: /^\/settings\/metadata/,
    },
    {
      text: intl.formatMessage(messages.menuNotifications),
      route: '/settings/notifications/email',
      regex: /^\/settings\/notifications/,
    },
    {
      text: intl.formatMessage(messages.menuLogs),
      route: '/settings/logs',
      regex: /^\/settings\/logs/,
    },
    {
      text: intl.formatMessage(messages.menuJobs),
      route: '/settings/jobs',
      regex: /^\/settings\/jobs/,
    },
    {
      text: intl.formatMessage(messages.menuAbout),
      route: '/settings/about',
      regex: /^\/settings\/about/,
    },
  ];

  const setDirty = (dirty: boolean) => {
    dirtyRef.current = dirty;
    setHasUnsavedChanges(dirty);
  };

  const submitSettingsForms = () => {
    const forms = Array.from(
      contentRef.current?.querySelectorAll<HTMLFormElement>('form') ?? []
    );
    const settingsForms = forms
      .map((form) => ({
        form,
        submitButton: form.querySelector<HTMLButtonElement>(
          'button[type="submit"]'
        ),
      }))
      .filter(
        (
          entry
        ): entry is {
          form: HTMLFormElement;
          submitButton: HTMLButtonElement;
        } => entry.submitButton !== null
      );

    if (
      settingsForms.length === 0 ||
      settingsForms.some(({ submitButton }) => submitButton.disabled)
    ) {
      return;
    }

    settingsForms.forEach(({ form, submitButton }) =>
      form.requestSubmit(submitButton)
    );
    setDirty(false);
  };

  useEffect(() => {
    currentSettingsPathRef.current = router.asPath;
    setDirty(false);
  }, [router.asPath]);

  useEffect(() => {
    router.beforePopState(() => {
      if (!dirtyRef.current) {
        return true;
      }

      window.history.pushState(null, '', currentSettingsPathRef.current);
      setShowUnsavedChanges(true);
      return false;
    });

    return () => router.beforePopState(() => true);
  }, [router]);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) {
        return;
      }
      event.preventDefault();
    };

    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, []);

  useEffect(() => {
    if (!hasSaveActions) {
      return;
    }

    const markDirtyFromCustomControl = () => setDirty(true);
    window.addEventListener(
      SETTINGS_USER_CHANGE_EVENT,
      markDirtyFromCustomControl
    );

    return () =>
      window.removeEventListener(
        SETTINGS_USER_CHANGE_EVENT,
        markDirtyFromCustomControl
      );
  }, [hasSaveActions]);

  const discardAndLeave = () => {
    setDirty(false);
    setShowUnsavedChanges(false);
    void router.push('/discover');
  };

  const saveAndStay = () => {
    submitSettingsForms();
    setShowUnsavedChanges(false);
  };

  return (
    <SettingsPageActionContext.Provider value={registerPageAction}>
      <PageTitle title={intl.formatMessage(globalMessages.settings)} />
      <Transition show={showUnsavedChanges}>
        <Modal
          title={intl.formatMessage(messages.unsavedChanges)}
          onCancel={discardAndLeave}
          cancelText={intl.formatMessage(messages.discard)}
          cancelButtonType="danger"
          onOk={saveAndStay}
          okText={intl.formatMessage(messages.save)}
          okButtonType="success"
          actionButtonSize="standard"
          backgroundClickable={false}
        >
          {intl.formatMessage(messages.unsavedChangesMessage)}
        </Modal>
      </Transition>

      <Header>{intl.formatMessage(globalMessages.settings)}</Header>
      <div className="settings-page-navigation-row">
        <SettingsTabs tabType="filter" settingsRoutes={settingsRoutes} />
        <form
          className="discover-filter-control settings-page-search"
          onSubmit={(event) => event.preventDefault()}
        >
          <span className="discover-filter-control-label gap-1.5">
            <MagnifyingGlassIcon className="h-4 w-4" aria-hidden="true" />
            {intl.formatMessage(messages.searchSettings)}
          </span>
          <input
            type="search"
            value={keywordSearch}
            onChange={(event) => setKeywordSearch(event.target.value)}
            aria-label={intl.formatMessage(messages.searchSettings)}
            className="settings-page-search-input"
          />
        </form>
      </div>

      <article className="settings-main-card">
        <div
          ref={contentRef}
          className={`settings-page-content ${
            hasSaveActions ? 'settings-page-has-actions' : ''
          }`}
          onChangeCapture={(event) => {
            if (hasSaveActions && event.nativeEvent.isTrusted) setDirty(true);
          }}
          onSubmitCapture={() => setDirty(false)}
        >
          {children}
        </div>
        <div className="settings-page-actions">
          <Button
            buttonType="danger"
            buttonSize="standard"
            onClick={discardAndLeave}
          >
            {intl.formatMessage(globalMessages.cancel)}
          </Button>
          {pageAction && (
            <Button
              buttonType="success"
              buttonSize="standard"
              disabled={pageAction.disabled}
              onClick={pageAction.onClick}
            >
              {pageAction.icon}
              <span>{pageAction.label}</span>
            </Button>
          )}
          {hasSaveActions && (
            <Button
              data-testid="settings-save-button"
              buttonType="success"
              buttonSize="standard"
              disabled={!hasUnsavedChanges}
              onClick={submitSettingsForms}
            >
              {intl.formatMessage(messages.save)}
            </Button>
          )}
        </div>
      </article>
    </SettingsPageActionContext.Provider>
  );

  function getAvailableMediaServerName() {
    return intl.formatMessage(messages.menuJellyfinSettings, {
      mediaServerName:
        settings.currentSettings.mediaServerType === MediaServerType.JELLYFIN
          ? 'Jellyfin'
          : settings.currentSettings.mediaServerType === MediaServerType.EMBY
            ? 'Emby'
            : undefined,
    });
  }
};

export default SettingsLayout;
