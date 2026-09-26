import { MediaServerType } from '@server/constants/server';
import type { PublicSettingsResponse } from '@server/interfaces/api/settingsInterfaces';
import axios from 'axios';
import React from 'react';
import useSWR from 'swr';

export interface SettingsContextProps {
  currentSettings: PublicSettingsResponse;
  children?: React.ReactNode;
}

const defaultSettings: PublicSettingsResponse = {
  initialized: false,
  applicationTitle: 'Seerr',
  applicationUrl: '',
  hideAvailable: false,
  hideBlocklisted: false,
  hideRequested: false,
  localLogin: true,
  mediaServerLogin: true,
  movie4kEnabled: false,
  series4kEnabled: false,
  musicEnabled: false,
  booksEnabled: false,
  comicsEnabled: false,
  magazinesEnabled: false,
  softwareEnabled: false,
  discoverRegion: '',
  streamingRegion: '',
  originalLanguage: '',
  mediaServerType: MediaServerType.NOT_CONFIGURED,
  partialRequestsEnabled: true,
  enableSpecialEpisodes: false,
  cacheImages: true,
  vapidPublic: '',
  enablePushRegistration: false,
  locale: 'en',
  emailEnabled: false,
  newPlexLogin: true,
  youtubeUrl: '',
  versionCheck: true,
  plexClientIdentifier: '',
  openIdProviders: [],
};

export const SettingsContext = React.createContext<SettingsContextProps>({
  currentSettings: defaultSettings,
});

export const SettingsProvider = ({
  children,
  currentSettings,
}: {
  currentSettings?: PublicSettingsResponse;
  children?: React.ReactNode;
}) => {
  const { data } = useSWR<PublicSettingsResponse>('/api/v1/settings/public', {
    fetcher: () =>
      axios
        .get<PublicSettingsResponse>('/api/v1/settings/public', {
          headers: { 'Cache-Control': 'no-cache' },
        })
        .then((response) => response.data),
    fallbackData: currentSettings,
    // Settings drive visibility, authentication options, and feature flags.
    // Always validate them on a fresh app mount instead of rendering a stale
    // value from an earlier page load.
    dedupingInterval: 0,
    revalidateOnMount: true,
    revalidateOnFocus: false,
  });

  let newSettings = defaultSettings;

  if (data) {
    newSettings = data;
  }

  return (
    <SettingsContext.Provider value={{ currentSettings: newSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};
