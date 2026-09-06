import EmbyLogo from '@app/assets/services/emby.svg';
import JellyfinLogo from '@app/assets/services/jellyfin.svg';
import PlexLogo from '@app/assets/services/plex.svg';
import AppDataWarning from '@app/components/AppDataWarning';
import Button from '@app/components/Common/Button';
import ImageFader from '@app/components/Common/ImageFader';
import PageTitle from '@app/components/Common/PageTitle';
import LanguagePicker from '@app/components/Layout/LanguagePicker';
import SetupSteps from '@app/components/Setup/SetupSteps';
import TransportSecurityNotice from '@app/components/TransportSecurityNotice';
import useLocale from '@app/hooks/useLocale';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import versionedAsset from '@app/utils/versionedAsset';
import { MediaServerType } from '@server/constants/server';
import type { Library } from '@server/lib/settings';
import axios from 'axios';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';
import { completeSetupRequests } from './setupCompletion';

const SettingsJellyfin = dynamic(
  () => import('@app/components/Settings/SettingsJellyfin')
);
const SettingsPlex = dynamic(
  () => import('@app/components/Settings/SettingsPlex')
);
const SettingsServices = dynamic(
  () => import('@app/components/Settings/SettingsServices')
);
const SetupLogin = dynamic(() => import('./SetupLogin'));

const messages = defineMessages('components.Setup', {
  welcome: 'Welcome to Seerr',
  subtitle: 'Get started by choosing your media server',
  configjellyfin: 'Configure Jellyfin',
  configplex: 'Configure Plex',
  configemby: 'Configure Emby',
  setup: 'Setup',
  finish: 'Finish Setup',
  finishing: 'Finishing…',
  continue: 'Continue',
  servertype: 'Choose Server Type',
  signin: 'Sign In',
  configuremediaserver: 'Configure Media Server',
  configureservices: 'Configure Services',
  librarieserror:
    'Validation failed. Please toggle the libraries again to continue.',
  finisherror: 'Something went wrong while finishing setup.',
  localesaveerror:
    'Setup completed, but the selected language could not be saved.',
});

const Setup = () => {
  const intl = useIntl();
  const [isUpdating, setIsUpdating] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [mediaServerSettingsComplete, setMediaServerSettingsComplete] =
    useState(false);
  const [mediaServerType, setMediaServerType] = useState(
    MediaServerType.NOT_CONFIGURED
  );
  const router = useRouter();
  const { locale } = useLocale();
  const settings = useSettings();
  const toasts = useToasts();
  const libraryValidationController = useRef<AbortController | undefined>(
    undefined
  );
  const setupCompletionController = useRef<AbortController | undefined>(
    undefined
  );

  const finishSetup = async () => {
    if (setupCompletionController.current) {
      return;
    }

    const controller = new AbortController();
    setupCompletionController.current = controller;
    setIsUpdating(true);
    try {
      const result = await completeSetupRequests({
        initialize: async () => {
          const response = await axios.post<{ initialized: boolean }>(
            '/api/v1/settings/initialize',
            undefined,
            { signal: controller.signal }
          );
          return response.data.initialized;
        },
        saveLocale: async () => {
          await axios.post(
            '/api/v1/settings/main',
            { locale },
            { signal: controller.signal }
          );
        },
        isCancellation: axios.isCancel,
      });

      if (!result.initialized) {
        throw new Error('Setup initialization was not persisted.');
      }
      if (!result.localeSaved) {
        toasts.addToast(intl.formatMessage(messages.localesaveerror), {
          autoDismiss: true,
          appearance: 'error',
        });
      }

      void mutate('/api/v1/settings/public').catch(() => undefined);
      await router.push('/');
    } catch (error) {
      if (!axios.isCancel(error)) {
        toasts.addToast(intl.formatMessage(messages.finisherror), {
          autoDismiss: true,
          appearance: 'error',
        });
      }
    } finally {
      if (setupCompletionController.current === controller) {
        setupCompletionController.current = undefined;
        setIsUpdating(false);
      }
    }
  };

  const validateLibraries = useCallback(async () => {
    libraryValidationController.current?.abort();
    const controller = new AbortController();
    libraryValidationController.current = controller;
    try {
      const endpointMap: Record<MediaServerType, string> = {
        [MediaServerType.JELLYFIN]: '/api/v1/settings/jellyfin',
        [MediaServerType.EMBY]: '/api/v1/settings/jellyfin',
        [MediaServerType.PLEX]: '/api/v1/settings/plex',
        [MediaServerType.NOT_CONFIGURED]: '',
      };

      const endpoint = endpointMap[mediaServerType];
      if (!endpoint) return;

      const response = await axios.get(endpoint, { signal: controller.signal });

      const hasEnabledLibraries = response.data?.libraries?.some(
        (library: Library) => library.enabled
      );

      if (!controller.signal.aborted) {
        setMediaServerSettingsComplete(hasEnabledLibraries);
      }
    } catch (error) {
      if (axios.isCancel(error)) {
        return;
      }
      toasts.addToast(intl.formatMessage(messages.librarieserror), {
        autoDismiss: true,
        appearance: 'error',
      });

      setMediaServerSettingsComplete(false);
    } finally {
      if (libraryValidationController.current === controller) {
        libraryValidationController.current = undefined;
      }
    }
  }, [intl, mediaServerType, toasts]);

  const { data: backdrops } = useSWR<string[]>('/api/v1/backdrops', {
    refreshInterval: 0,
    refreshWhenHidden: false,
    revalidateOnFocus: false,
  });

  useEffect(() => {
    if (settings.currentSettings.initialized) {
      router.push('/');
    }

    if (
      settings.currentSettings.mediaServerType !==
      MediaServerType.NOT_CONFIGURED
    ) {
      setMediaServerType(settings.currentSettings.mediaServerType);
      if (currentStep < 3) {
        setCurrentStep(3);
      }
    }
  }, [
    settings.currentSettings.mediaServerType,
    settings.currentSettings.initialized,
    router,
    currentStep,
  ]);

  useEffect(() => {
    if (currentStep === 3) {
      void validateLibraries();
    }
  }, [currentStep, validateLibraries]);

  useEffect(
    () => () => {
      libraryValidationController.current?.abort();
      setupCompletionController.current?.abort();
    },
    []
  );

  const handleComplete = () => {
    void validateLibraries();
  };

  if (settings.currentSettings.initialized) return <></>;

  return (
    <div className="relative flex min-h-screen flex-col justify-center bg-gray-900 py-12">
      <PageTitle title={intl.formatMessage(messages.setup)} />
      <ImageFader
        backgroundImages={
          backdrops?.map(
            (backdrop) => `https://image.tmdb.org/t/p/w1280${backdrop}`
          ) ?? []
        }
      />
      <div className="absolute right-4 top-4 z-50">
        <LanguagePicker />
      </div>
      <div className="relative z-40 px-4 sm:mx-auto sm:w-full sm:max-w-4xl">
        <div className="relative mb-10 h-48 max-w-full sm:mx-auto sm:h-64 sm:max-w-md">
          <Image
            src={versionedAsset('/logo_stacked.svg')}
            alt="Logo"
            fill
            className="object-contain"
          />
        </div>
        <AppDataWarning />
        <nav className="relative z-50">
          <ul
            className="divide-y divide-gray-600 rounded-md border border-gray-600 bg-gray-800/50 md:flex md:divide-y-0"
            style={{ backdropFilter: 'blur(5px)' }}
          >
            <SetupSteps
              stepNumber={1}
              description={intl.formatMessage(messages.servertype)}
              active={currentStep === 1}
              completed={currentStep > 1}
            />
            <SetupSteps
              stepNumber={2}
              description={intl.formatMessage(messages.signin)}
              active={currentStep === 2}
              completed={currentStep > 2}
            />
            <SetupSteps
              stepNumber={3}
              description={intl.formatMessage(messages.configuremediaserver)}
              active={currentStep === 3}
              completed={currentStep > 3}
            />
            <SetupSteps
              stepNumber={4}
              description={intl.formatMessage(messages.configureservices)}
              active={currentStep === 4}
              isLastStep
            />
          </ul>
        </nav>
        <TransportSecurityNotice />
        <div className="mt-10 w-full rounded-md border border-gray-600 bg-gray-800/50 p-4 text-white">
          {currentStep === 1 && (
            <div className="flex flex-col items-center pb-6">
              <div className="mb-2 flex justify-center text-xl font-bold">
                {intl.formatMessage(messages.welcome)}
              </div>
              <div className="mb-2 flex justify-center pb-6 text-sm">
                {intl.formatMessage(messages.subtitle)}
              </div>
              <div className="grid grid-cols-3">
                <div className="flex flex-col divide-y divide-gray-600 rounded-l border border-gray-600 py-2">
                  <div className="mb-2 flex flex-1 items-center justify-center px-2 py-2">
                    <JellyfinLogo className="h-10" />
                  </div>
                  <div className="px-2 pt-2">
                    <button
                      onClick={() => {
                        setMediaServerType(MediaServerType.JELLYFIN);
                        setCurrentStep(2);
                      }}
                      className="button-md relative z-10 inline-flex h-full w-full items-center justify-center rounded-md border border-gray-600 bg-transparent px-4 py-2 text-sm font-medium leading-5 text-white transition duration-150 ease-in-out hover:z-20 hover:border-gray-200 focus:z-20 focus:border-gray-100 focus:outline-none active:border-gray-100"
                    >
                      {intl.formatMessage(messages.configjellyfin)}
                    </button>
                  </div>
                </div>
                <div className="flex flex-col divide-y divide-gray-600 border-y border-gray-600 py-2">
                  <div className="mb-2 flex flex-1 items-center justify-center px-2 py-2">
                    <PlexLogo className="h-8" />
                  </div>
                  <div className="px-2 pt-2">
                    <button
                      onClick={() => {
                        setMediaServerType(MediaServerType.PLEX);
                        setCurrentStep(2);
                      }}
                      className="button-md relative z-10 inline-flex h-full w-full items-center justify-center rounded-md border border-gray-600 bg-transparent px-4 py-2 text-sm font-medium leading-5 text-white transition duration-150 ease-in-out hover:z-20 hover:border-gray-200 focus:z-20 focus:border-gray-100 focus:outline-none active:border-gray-100"
                    >
                      {intl.formatMessage(messages.configplex)}
                    </button>
                  </div>
                </div>
                <div className="flex flex-col divide-y divide-gray-600 rounded-r border border-gray-600 py-2">
                  <div className="mb-2 flex flex-1 items-center justify-center px-2 py-2">
                    <EmbyLogo className="h-9" />
                  </div>
                  <div className="px-2 pt-2">
                    <button
                      onClick={() => {
                        setMediaServerType(MediaServerType.EMBY);
                        setCurrentStep(2);
                      }}
                      className="button-md relative z-10 inline-flex h-full w-full items-center justify-center rounded-md border border-gray-600 bg-transparent px-4 py-2 text-sm font-medium leading-5 text-white transition duration-150 ease-in-out hover:z-20 hover:border-gray-200 focus:z-20 focus:border-gray-100 focus:outline-none active:border-gray-100"
                    >
                      {intl.formatMessage(messages.configemby)}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
          {currentStep === 2 && (
            <SetupLogin
              serverType={mediaServerType}
              onCancel={() => {
                setMediaServerType(MediaServerType.NOT_CONFIGURED);
                setCurrentStep(1);
              }}
              onComplete={() => setCurrentStep(3)}
            />
          )}
          {currentStep === 3 && (
            <div className="p-2">
              {mediaServerType === MediaServerType.PLEX ? (
                <SettingsPlex onComplete={handleComplete} />
              ) : (
                <SettingsJellyfin isSetupSettings onComplete={handleComplete} />
              )}
              <div className="actions">
                <div className="flex justify-end">
                  <span className="ml-3 inline-flex rounded-md shadow-sm">
                    <Button
                      buttonType="primary"
                      disabled={!mediaServerSettingsComplete}
                      onClick={() => setCurrentStep(4)}
                    >
                      {intl.formatMessage(messages.continue)}
                    </Button>
                  </span>
                </div>
              </div>
            </div>
          )}
          {currentStep === 4 && (
            <div>
              <SettingsServices />
              <div className="actions">
                <div className="flex justify-end">
                  <span className="ml-3 inline-flex rounded-md shadow-sm">
                    <Button
                      buttonType="primary"
                      onClick={() => void finishSetup()}
                      disabled={isUpdating}
                    >
                      {isUpdating
                        ? intl.formatMessage(messages.finishing)
                        : intl.formatMessage(messages.finish)}
                    </Button>
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Setup;
