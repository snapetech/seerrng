/* eslint-disable react-hooks/exhaustive-deps */
import CachedImage from '@app/components/Common/CachedImage';
import { SmallLoadingSpinner } from '@app/components/Common/LoadingSpinner';
import SlideCheckbox from '@app/components/Common/SlideCheckbox';
import type { User } from '@app/hooks/useUser';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { formatBytes } from '@app/utils/numberHelpers';
import { Listbox, Transition } from '@headlessui/react';
import { CheckIcon, ChevronDownIcon } from '@heroicons/react/24/solid';
import type { PaginatedResponse } from '@server/interfaces/api/common';
import type {
  ServiceCommonServer,
  ServiceCommonServerWithDetails,
} from '@server/interfaces/api/serviceInterfaces';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useIntl } from 'react-intl';
import Select from 'react-select';
import useSWR from 'swr';

type OptionType = {
  value: number;
  label: string;
};

type RequestListboxValue = string | number;

type RequestListboxOption<T extends RequestListboxValue> = {
  value: T;
  label: string;
};

type RequestListboxControlProps<T extends RequestListboxValue> = {
  id: string;
  label: string;
  value: T;
  options: RequestListboxOption<T>[];
  onChange: (value: T) => void;
  active?: boolean;
  disabled?: boolean;
  loadingLabel: string;
};

const areNumberArraysEqual = (a: number[], b: number[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const formatServiceLabel = (value: string) =>
  value.replace(/\beBook\b/g, 'Ebook');

const controlLabelClass = (active: boolean) =>
  `request-listbox-label ${active ? 'request-listbox-label-active' : ''}`;

const RequestListboxControl = <T extends RequestListboxValue>({
  id,
  label,
  value,
  options,
  onChange,
  active = false,
  disabled = false,
  loadingLabel,
}: RequestListboxControlProps<T>) => {
  const selectedLabel =
    options.find((option) => option.value === value)?.label ?? loadingLabel;

  return (
    <Listbox
      as="div"
      value={value}
      onChange={onChange}
      disabled={disabled}
      className="request-listbox-control"
    >
      {({ open }) => (
        <>
          <Listbox.Label className={controlLabelClass(active)}>
            {label}
          </Listbox.Label>
          <Listbox.Button id={id} className="request-listbox-button">
            <span className="truncate">{selectedLabel}</span>
            <ChevronDownIcon
              className="request-listbox-chevron"
              aria-hidden="true"
            />
          </Listbox.Button>
          <Transition
            show={open}
            enter="transition-opacity ease-in duration-150"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity ease-out duration-100"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <Listbox.Options static className="request-listbox-menu">
              {options.map((option) => (
                <Listbox.Option key={option.value} value={option.value}>
                  {({ selected, active: optionActive }) => (
                    <div
                      className={`request-listbox-option ${
                        optionActive ? 'request-listbox-option-active' : ''
                      }`}
                    >
                      <span
                        className={selected ? 'font-semibold' : 'font-normal'}
                      >
                        {option.label}
                      </span>
                      {selected && (
                        <CheckIcon
                          className="request-listbox-check"
                          aria-hidden="true"
                        />
                      )}
                    </div>
                  )}
                </Listbox.Option>
              ))}
            </Listbox.Options>
          </Transition>
        </>
      )}
    </Listbox>
  );
};

const messages = defineMessages('components.RequestModal.AdvancedRequester', {
  advancedoptions: 'Advanced Request',
  service: 'Service',
  status: 'Status',
  ready: 'Ready to Request',
  showOptions: 'Show Options',
  availableRootFolders: 'Available Root Folders',
  availableSpace: 'Available Space',
  destinationserver: 'Destination Server',
  qualityprofile: 'Quality Profile',
  metadataprofile: 'Metadata Profile',
  rootfolder: 'Root Folder',
  animenote: '* This series is an anime.',
  folder: '{path} ({space})',
  requestedBy: 'Requested By',
  languageprofile: 'Language Profile',
  tags: 'Tags',
  selecttags: 'Select tags',
  notagoptions: 'No tags',
  ignoreQuotaTitle: 'Bypass User Quota',
  ignoreQuotaDescription:
    "This request will not count against the user's quota limits. Use with caution.",
});

export type RequestOverrides = {
  server?: number;
  is4k?: boolean;
  profile?: number;
  metadataProfile?: number;
  folder?: string;
  tags?: number[];
  language?: number;
  user?: RequestUser;
  ignoreQuota?: boolean;
};

type RequestUser = Pick<
  User,
  'avatar' | 'displayName' | 'email' | 'id' | 'permissions'
>;

type ClientUserResultsResponse = PaginatedResponse & {
  results: User[];
};

interface AdvancedRequesterProps {
  type: 'movie' | 'tv' | 'music' | 'book';
  is4k: boolean;
  isAnime?: boolean;
  bookFormat?: 'ebook' | 'audiobook' | 'both';
  defaultOverrides?: RequestOverrides;
  requestUser?: RequestUser;
  quota?: {
    movie: { limit?: number };
    tv: { limit?: number };
    music: { limit?: number };
    book: { limit?: number };
  };
  mediaTitle?: string;
  posterPath?: string;
  requestStatus?: string;
  expanded?: boolean;
  panelOnly?: boolean;
  rootFolderTable?: boolean;
  allow4kServerSelection?: boolean;
  requestedByPortal?: HTMLElement | null;
  onChange: (overrides: RequestOverrides) => void;
}

const AdvancedRequester = ({
  type,
  is4k = false,
  isAnime = false,
  bookFormat,
  defaultOverrides,
  requestUser,
  quota,
  mediaTitle,
  posterPath,
  requestStatus,
  expanded,
  panelOnly = false,
  rootFolderTable = false,
  allow4kServerSelection = false,
  requestedByPortal,
  onChange,
}: AdvancedRequesterProps) => {
  const intl = useIntl();
  const { user: currentUser, hasPermission: currentHasPermission } = useUser();
  const serviceType =
    type === 'movie'
      ? 'radarr'
      : type === 'music'
        ? 'lidarr'
        : type === 'book'
          ? 'readarr'
          : 'sonarr';
  const { data, error } = useSWR<ServiceCommonServer[]>(
    `/api/v1/service/${serviceType}`,
    {
      refreshInterval: 0,
      refreshWhenHidden: false,
      revalidateOnFocus: false,
      revalidateOnMount: true,
    }
  );
  const [selectedServer, setSelectedServer] = useState<number | null>(
    defaultOverrides?.server !== undefined && defaultOverrides?.server >= 0
      ? defaultOverrides?.server
      : null
  );
  const [selectedProfile, setSelectedProfile] = useState<number>(
    defaultOverrides?.profile ?? -1
  );
  const [selectedMetadataProfile, setSelectedMetadataProfile] =
    useState<number>(defaultOverrides?.metadataProfile ?? -1);
  const [selectedFolder, setSelectedFolder] = useState<string>(
    defaultOverrides?.folder ?? ''
  );

  const [selectedLanguage, setSelectedLanguage] = useState<number>(
    defaultOverrides?.language ?? -1
  );

  const [selectedTags, setSelectedTags] = useState<number[]>(
    defaultOverrides?.tags ?? []
  );

  const [ignoreQuota, setIgnoreQuota] = useState<boolean>(
    defaultOverrides?.ignoreQuota ?? false
  );
  const quotaLimitForType =
    type === 'movie'
      ? quota?.movie.limit
      : type === 'music'
        ? quota?.music.limit
        : type === 'book'
          ? quota?.book.limit
          : quota?.tv.limit;
  const isIgnoreQuotaVisible =
    currentHasPermission([Permission.MANAGE_REQUESTS]) &&
    (quotaLimitForType ?? 0) > 0;

  const { data: serverData, isValidating } =
    useSWR<ServiceCommonServerWithDetails>(
      selectedServer !== null
        ? `/api/v1/service/${serviceType}/${selectedServer}`
        : null,
      {
        refreshInterval: 0,
        refreshWhenHidden: false,
        revalidateOnFocus: false,
      }
    );

  const [selectedUser, setSelectedUser] = useState<RequestUser | null>(
    requestUser ?? null
  );
  const bookServiceType = bookFormat === 'audiobook' ? 'audiobook' : 'ebook';
  const serviceOverridesEnabled = type !== 'book' || bookFormat !== 'both';
  const serviceServers = useMemo(
    () =>
      (data ?? []).filter(
        (server) =>
          (allow4kServerSelection || Boolean(server.is4k) === is4k) &&
          (type !== 'book' ||
            (server.serviceType ?? 'ebook') === bookServiceType)
      ),
    [allow4kServerSelection, bookServiceType, data, is4k, type]
  );
  const selectedServerDetails = useMemo(
    () => (data ?? []).find((server) => server.id === selectedServer),
    [data, selectedServer]
  );
  const selectedIs4k = allow4kServerSelection
    ? (selectedServerDetails?.is4k ?? is4k)
    : is4k;
  const availableServers = serviceServers;
  const selectedUserId = selectedUser?.id;
  const previousSelectedUserIdRef = useRef<number | undefined>(selectedUserId);

  const { data: userData } = useSWR<ClientUserResultsResponse>(
    currentHasPermission([Permission.MANAGE_REQUESTS, Permission.MANAGE_USERS])
      ? '/api/v1/user?take=1000&sort=displayname'
      : null
  );
  const selectableUserData = userData?.results;

  useEffect(() => {
    if (selectableUserData && !requestUser) {
      const nextSelectedUser =
        selectableUserData.find((u) => u.id === currentUser?.id) ?? null;

      if (nextSelectedUser?.id !== selectedUserId) {
        setIgnoreQuota(false);
      }

      setSelectedUser(nextSelectedUser);
    }
  }, [selectableUserData]);

  useEffect(() => {
    let defaultServer = data?.find((server) => {
      const formatMatches =
        type !== 'book' || (server.serviceType ?? 'ebook') === bookServiceType;

      return server.isDefault && Boolean(server.is4k) === is4k && formatMatches;
    });

    if (!defaultServer && type === 'book') {
      defaultServer = data?.find(
        (server) => (server.serviceType ?? 'ebook') === bookServiceType
      );
    }

    if (!defaultServer && serviceServers.length > 0) {
      defaultServer = serviceServers[0];
    }

    if (
      defaultServer &&
      defaultServer.id !== selectedServer &&
      (!defaultOverrides || defaultOverrides.server === null)
    ) {
      setSelectedServer(defaultServer.id);
    }
  }, [data, bookServiceType, serviceServers, type]);

  useEffect(() => {
    if (serverData) {
      const defaultProfile = serverData.profiles.find(
        (profile) =>
          profile.id ===
          (isAnime && serverData.server.activeAnimeProfileId
            ? serverData.server.activeAnimeProfileId
            : serverData.server.activeProfileId)
      );
      const defaultFolder = serverData.rootFolders.find(
        (folder) =>
          folder.path ===
          (isAnime && serverData.server.activeAnimeDirectory
            ? serverData.server.activeAnimeDirectory
            : serverData.server.activeDirectory)
      );
      const defaultLanguage = serverData.languageProfiles?.find(
        (language) =>
          language.id ===
          (isAnime && serverData.server.activeAnimeLanguageProfileId
            ? serverData.server.activeAnimeLanguageProfileId
            : serverData.server.activeLanguageProfileId)
      );
      const defaultMetadataProfile = serverData.metadataProfiles?.find(
        (profile) =>
          profile.id ===
          (serverData.server.activeMetadataProfileId ??
            serverData.metadataProfiles?.[0]?.id)
      );
      const defaultTags = isAnime
        ? serverData.server.activeAnimeTags
        : serverData.server.activeTags;

      const applyOverrides =
        defaultOverrides &&
        ((defaultOverrides.server === null && serverData.server.isDefault) ||
          defaultOverrides.server === serverData.server.id);

      if (
        defaultProfile &&
        defaultProfile.id !== selectedProfile &&
        (!applyOverrides || defaultOverrides.profile === null)
      ) {
        setSelectedProfile(defaultProfile.id);
      }

      if (
        defaultMetadataProfile &&
        defaultMetadataProfile.id !== selectedMetadataProfile &&
        (!applyOverrides || defaultOverrides.metadataProfile === null)
      ) {
        setSelectedMetadataProfile(defaultMetadataProfile.id);
      }

      if (
        defaultFolder &&
        defaultFolder.path !== selectedFolder &&
        (!applyOverrides || !defaultOverrides.folder)
      ) {
        setSelectedFolder(defaultFolder.path ?? '');
      }

      if (
        defaultLanguage &&
        defaultLanguage.id !== selectedLanguage &&
        (!applyOverrides || defaultOverrides.language === null)
      ) {
        setSelectedLanguage(defaultLanguage.id);
      }

      if (
        defaultTags &&
        !areNumberArraysEqual(defaultTags, selectedTags) &&
        (!applyOverrides || defaultOverrides.tags === null)
      ) {
        setSelectedTags(defaultTags);
      }
    }
  }, [serverData]);

  useEffect(() => {
    if (defaultOverrides && defaultOverrides.server != null) {
      setSelectedServer(defaultOverrides.server);
    }

    if (defaultOverrides && defaultOverrides.profile != null) {
      setSelectedProfile(defaultOverrides.profile);
    }

    if (defaultOverrides && defaultOverrides.metadataProfile != null) {
      setSelectedMetadataProfile(defaultOverrides.metadataProfile);
    }

    if (defaultOverrides && defaultOverrides.folder) {
      setSelectedFolder(defaultOverrides.folder);
    }

    if (defaultOverrides && defaultOverrides.language != null) {
      setSelectedLanguage(defaultOverrides.language);
    }

    if (defaultOverrides && defaultOverrides.tags != null) {
      setSelectedTags(defaultOverrides.tags);
    }

    if (defaultOverrides && defaultOverrides.ignoreQuota != null) {
      setIgnoreQuota(defaultOverrides.ignoreQuota);
    }
  }, [
    defaultOverrides?.server,
    defaultOverrides?.folder,
    defaultOverrides?.profile,
    defaultOverrides?.metadataProfile,
    defaultOverrides?.language,
    defaultOverrides?.tags,
    defaultOverrides?.ignoreQuota,
  ]);

  useEffect(() => {
    const selectedUserChanged =
      previousSelectedUserIdRef.current !== selectedUserId;
    previousSelectedUserIdRef.current = selectedUserId;

    if (!isIgnoreQuotaVisible || selectedUserChanged) {
      setIgnoreQuota(false);
    }
  }, [isIgnoreQuotaVisible, selectedUserId]);

  useEffect(() => {
    if (selectedServer !== null || selectedUser) {
      onChange({
        folder:
          serviceOverridesEnabled && selectedFolder !== ''
            ? selectedFolder
            : undefined,
        profile:
          serviceOverridesEnabled && selectedProfile !== -1
            ? selectedProfile
            : undefined,
        metadataProfile:
          serviceOverridesEnabled && selectedMetadataProfile !== -1
            ? selectedMetadataProfile
            : undefined,
        server: serviceOverridesEnabled
          ? (selectedServer ?? undefined)
          : undefined,
        is4k: serviceOverridesEnabled ? selectedIs4k : undefined,
        user: selectedUser ?? undefined,
        language:
          serviceOverridesEnabled && selectedLanguage !== -1
            ? selectedLanguage
            : undefined,
        tags: serviceOverridesEnabled ? selectedTags : undefined,
        ignoreQuota: isIgnoreQuotaVisible && ignoreQuota ? true : undefined,
      });
    }
  }, [
    selectedFolder,
    selectedServer,
    selectedIs4k,
    selectedProfile,
    selectedMetadataProfile,
    selectedUser,
    selectedLanguage,
    selectedTags,
    serviceOverridesEnabled,
    ignoreQuota,
    isIgnoreQuotaVisible,
  ]);

  if (!data && !error) {
    return (
      <div className="mb-2 w-full">
        <SmallLoadingSpinner />
      </div>
    );
  }

  const serviceOptionsHidden =
    !serviceOverridesEnabled ||
    selectedServer === null ||
    (availableServers.length < 2 &&
      (!serverData ||
        (serverData.profiles.length < 2 &&
          (serverData.metadataProfiles ?? []).length < 2 &&
          serverData.rootFolders.length < 2 &&
          (serverData.languageProfiles ?? []).length < 2 &&
          !serverData.tags?.length)));
  const selectedService = serviceServers.find(
    (server) => server.id === selectedServer
  );
  const defaultService =
    serviceServers.find(
      (server) => server.isDefault && Boolean(server.is4k) === is4k
    ) ?? serviceServers[0];
  const defaultProfileId = serverData
    ? isAnime && serverData.server.activeAnimeProfileId
      ? serverData.server.activeAnimeProfileId
      : serverData.server.activeProfileId
    : undefined;
  const defaultMetadataProfileId =
    serverData?.server.activeMetadataProfileId ??
    serverData?.metadataProfiles?.[0]?.id;
  const defaultFolderPath = serverData
    ? isAnime && serverData.server.activeAnimeDirectory
      ? serverData.server.activeAnimeDirectory
      : serverData.server.activeDirectory
    : undefined;
  const defaultLanguageId = serverData
    ? isAnime && serverData.server.activeAnimeLanguageProfileId
      ? serverData.server.activeAnimeLanguageProfileId
      : serverData.server.activeLanguageProfileId
    : undefined;
  const defaultTagIds = serverData
    ? isAnime
      ? serverData.server.activeAnimeTags
      : serverData.server.activeTags
    : undefined;
  const canSelectRequestedBy =
    currentHasPermission([
      Permission.MANAGE_REQUESTS,
      Permission.MANAGE_USERS,
    ]) && !!selectedUser;

  const requestedByControl =
    requestedByPortal && canSelectRequestedBy
      ? createPortal(
          <Listbox
            as="div"
            value={selectedUser}
            onChange={(value) => {
              setIgnoreQuota(false);
              setSelectedUser(value);
            }}
            className="request-form-control compact-control relative inline-flex max-w-full flex-shrink-0 items-stretch overflow-visible rounded-md border"
          >
            {({ open }) => (
              <>
                <Listbox.Label
                  className={`inline-flex h-full flex-shrink-0 items-center justify-center rounded-l-[5px] border-r border-gray-600 px-2 py-0 font-semibold whitespace-nowrap text-indigo-100 transition-colors ${
                    selectedUser.id !== currentUser?.id
                      ? 'bg-indigo-500/35 text-white'
                      : ''
                  } text-[11px] leading-none`}
                >
                  <span className="relative top-px">
                    {intl.formatMessage(messages.requestedBy)}
                  </span>
                </Listbox.Label>
                <Listbox.Button className="inline-grid h-full max-w-[min(24rem,55vw)] grid-cols-[minmax(6rem,max-content)_auto] items-center gap-2 rounded-r-[5px] px-2 py-0 text-[11px] leading-none font-semibold text-gray-300 focus:ring-2 focus:ring-indigo-400 focus:outline-none focus:ring-inset">
                  <span className="grid min-w-0">
                    {(selectableUserData ?? []).map((candidate) => (
                      <span
                        key={candidate.id}
                        aria-hidden="true"
                        className="invisible col-start-1 row-start-1 whitespace-nowrap"
                      >
                        {candidate.displayName}
                      </span>
                    ))}
                    <span className="relative top-px col-start-1 row-start-1 truncate">
                      {selectedUser.displayName}
                    </span>
                  </span>
                  <ChevronDownIcon
                    className="h-3.5 w-3.5 flex-shrink-0 text-gray-500"
                    aria-hidden="true"
                  />
                </Listbox.Button>
                <Transition
                  show={open}
                  enter="transition-opacity ease-in duration-150"
                  enterFrom="opacity-0"
                  enterTo="opacity-100"
                  leave="transition-opacity ease-out duration-100"
                  leaveFrom="opacity-100"
                  leaveTo="opacity-0"
                >
                  <Listbox.Options
                    static
                    className="absolute right-0 bottom-full z-50 mb-1 max-h-60 min-w-full overflow-auto rounded-md border border-gray-600 bg-gray-800 py-1 text-xs shadow-xl focus:outline-none"
                  >
                    {(selectableUserData ?? []).map((candidate) => (
                      <Listbox.Option key={candidate.id} value={candidate}>
                        {({ selected, active }) => (
                          <div
                            className={`relative cursor-default py-1.5 pr-3 pl-7 whitespace-nowrap select-none ${
                              active
                                ? 'bg-indigo-600 text-white'
                                : 'text-gray-300'
                            }`}
                          >
                            <span
                              className={
                                selected ? 'font-semibold' : 'font-normal'
                              }
                            >
                              {candidate.displayName}
                            </span>
                            {selected && (
                              <CheckIcon
                                className="absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2"
                                aria-hidden="true"
                              />
                            )}
                          </div>
                        )}
                      </Listbox.Option>
                    ))}
                  </Listbox.Options>
                </Transition>
              </>
            )}
          </Listbox>,
          requestedByPortal
        )
      : null;

  return (
    <>
      {requestedByControl}
      <details
        open={panelOnly ? expanded : true}
        className={
          panelOnly
            ? expanded
              ? 'group mt-2'
              : 'group'
            : 'refreshed-inset-surface group mt-4 rounded-lg border border-gray-700'
        }
      >
        <summary
          onClick={panelOnly ? undefined : (event) => event.preventDefault()}
          className={
            panelOnly
              ? 'hidden'
              : 'flex cursor-pointer list-none items-center gap-3 p-3 focus:ring-2 focus:ring-indigo-400 focus:outline-none'
          }
        >
          <div className="relative h-16 w-11 flex-shrink-0 overflow-hidden rounded ring-1 ring-gray-600">
            <CachedImage
              type={
                type === 'book' ? 'book' : type === 'music' ? 'music' : 'tmdb'
              }
              src={posterPath || '/images/seerr_poster_not_found.png'}
              alt=""
              fill
              className="object-cover"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-white">
              {mediaTitle || intl.formatMessage(messages.advancedoptions)}
            </div>
            <dl className="refreshed-detail-text mt-1 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 text-xs leading-5">
              <dt className="font-medium text-gray-200">
                {intl.formatMessage(messages.status)}:
              </dt>
              <dd className="m-0 truncate">
                {requestStatus || intl.formatMessage(messages.ready)}
              </dd>
              <dt className="font-medium text-gray-200">
                {intl.formatMessage(messages.service)}:
              </dt>
              <dd className="m-0 truncate">
                {selectedService?.name ??
                  intl.formatMessage(globalMessages.loading)}
              </dd>
              <dt className="font-medium text-gray-200">
                {intl.formatMessage(messages.rootfolder)}:
              </dt>
              <dd className="m-0 truncate">
                {selectedFolder || intl.formatMessage(globalMessages.loading)}
              </dd>
            </dl>
          </div>
          <span className="flex-shrink-0 text-xs font-semibold text-indigo-300 group-open:hidden">
            {intl.formatMessage(messages.showOptions)}
          </span>
          <ChevronDownIcon className="refreshed-detail-text-muted h-5 w-5 flex-shrink-0 transition group-open:rotate-180" />
        </summary>
        <div
          className={`${panelOnly ? 'refreshed-inset-surface rounded-lg border border-gray-700 p-3' : 'border-t border-gray-700 p-3'} ${!rootFolderTable && serviceOptionsHidden ? 'hidden' : ''}`}
        >
          {!!data && selectedServer !== null && serviceOverridesEnabled && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {serviceServers.length > 0 && (
                <RequestListboxControl
                  id="server"
                  label={intl.formatMessage(messages.destinationserver)}
                  value={selectedServer}
                  options={serviceServers.map((server) => ({
                    value: server.id,
                    label: formatServiceLabel(server.name),
                  }))}
                  onChange={setSelectedServer}
                  active={
                    defaultService !== undefined &&
                    selectedServer !== defaultService.id
                  }
                  loadingLabel={intl.formatMessage(globalMessages.loading)}
                />
              )}
              {(type === 'music' || type === 'book') &&
                (isValidating ||
                  !serverData ||
                  (serverData.metadataProfiles ?? []).length > 0) && (
                  <label className="inline-flex h-8 flex-shrink-0 overflow-hidden rounded-md border border-gray-600 bg-gray-900/70">
                    <span
                      className={controlLabelClass(
                        defaultMetadataProfileId !== undefined &&
                          selectedMetadataProfile !== defaultMetadataProfileId
                      )}
                    >
                      {intl.formatMessage(messages.metadataprofile)}
                    </span>
                    <select
                      id="metadataProfile"
                      name="metadataProfile"
                      value={selectedMetadataProfile}
                      onChange={(e) =>
                        setSelectedMetadataProfile(Number(e.target.value))
                      }
                      onBlur={(e) =>
                        setSelectedMetadataProfile(Number(e.target.value))
                      }
                      aria-label={intl.formatMessage(messages.metadataprofile)}
                      className="min-w-36 border-0 bg-gray-900/70 px-1.5 py-1 text-xs font-medium text-gray-300 focus:ring-2 focus:ring-indigo-400 focus:ring-inset"
                      disabled={isValidating || !serverData}
                    >
                      {(isValidating || !serverData) && (
                        <option value="">
                          {intl.formatMessage(globalMessages.loading)}
                        </option>
                      )}
                      {!isValidating &&
                        serverData &&
                        serverData.metadataProfiles
                          ?.toSorted((a, b) =>
                            a.name.localeCompare(b.name, intl.locale, {
                              numeric: true,
                              sensitivity: 'base',
                            })
                          )
                          .map((profile) => (
                            <option
                              key={`metadata-profile-list${profile.id}`}
                              value={profile.id}
                            >
                              {formatServiceLabel(profile.name)}
                            </option>
                          ))}
                    </select>
                  </label>
                )}
              {(isValidating ||
                !serverData ||
                serverData.profiles.length > 0) && (
                <RequestListboxControl
                  id="profile"
                  label={intl.formatMessage(messages.qualityprofile)}
                  value={selectedProfile}
                  options={(serverData?.profiles ?? [])
                    .toSorted((a, b) =>
                      a.name.localeCompare(b.name, intl.locale, {
                        numeric: true,
                        sensitivity: 'base',
                      })
                    )
                    .map((profile) => ({
                      value: profile.id,
                      label: formatServiceLabel(profile.name),
                    }))}
                  onChange={setSelectedProfile}
                  active={
                    defaultProfileId !== undefined &&
                    selectedProfile !== defaultProfileId
                  }
                  disabled={isValidating || !serverData}
                  loadingLabel={intl.formatMessage(globalMessages.loading)}
                />
              )}
              {!rootFolderTable &&
                (isValidating ||
                  !serverData ||
                  serverData.rootFolders.length > 1) && (
                  <RequestListboxControl<string>
                    id="folder"
                    label={intl.formatMessage(messages.rootfolder)}
                    value={selectedFolder}
                    options={(serverData?.rootFolders ?? []).map((folder) => ({
                      value: folder.path ?? '',
                      label: intl.formatMessage(messages.folder, {
                        path: folder.path,
                        space: formatBytes(folder.freeSpace ?? 0),
                      }),
                    }))}
                    onChange={setSelectedFolder}
                    active={
                      defaultFolderPath !== undefined &&
                      selectedFolder !== defaultFolderPath
                    }
                    disabled={isValidating || !serverData}
                    loadingLabel={intl.formatMessage(globalMessages.loading)}
                  />
                )}
              {type === 'tv' &&
                (isValidating ||
                  !serverData ||
                  (serverData.languageProfiles ?? []).length > 0) && (
                  <label className="inline-flex h-8 flex-shrink-0 overflow-hidden rounded-md border border-gray-600 bg-gray-900/70">
                    <span
                      className={controlLabelClass(
                        defaultLanguageId !== undefined &&
                          selectedLanguage !== defaultLanguageId
                      )}
                    >
                      {intl.formatMessage(messages.languageprofile)}
                    </span>
                    <select
                      id="language"
                      name="language"
                      value={selectedLanguage}
                      onChange={(e) =>
                        setSelectedLanguage(parseInt(e.target.value))
                      }
                      onBlur={(e) =>
                        setSelectedLanguage(parseInt(e.target.value))
                      }
                      aria-label={intl.formatMessage(messages.languageprofile)}
                      className="min-w-36 border-0 bg-gray-900/70 px-1.5 py-1 text-xs font-medium text-gray-300 focus:ring-2 focus:ring-indigo-400 focus:ring-inset"
                      disabled={isValidating || !serverData}
                    >
                      {(isValidating || !serverData) && (
                        <option value="">
                          {intl.formatMessage(globalMessages.loading)}
                        </option>
                      )}
                      {!isValidating &&
                        serverData &&
                        serverData.languageProfiles?.map((language) => (
                          <option
                            key={`folder-list${language.id}`}
                            value={language.id}
                          >
                            {language.name}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
            </div>
          )}
          {rootFolderTable && (
            <div className="mb-3">
              <h4 className="mb-2 text-xs font-semibold text-gray-200">
                {intl.formatMessage(messages.availableRootFolders)}
              </h4>
              <div className="grid w-fit max-w-full grid-cols-[minmax(0,max-content)_max-content] justify-start gap-x-3 gap-y-1 text-xs">
                <div className="request-divider-dark col-span-2 mb-1 grid grid-cols-subgrid border-b px-1 pb-2">
                  <span className="refreshed-detail-text font-medium">
                    {intl.formatMessage(messages.rootfolder)}
                  </span>
                  <span className="refreshed-detail-text font-medium">
                    {intl.formatMessage(messages.availableSpace)}
                  </span>
                </div>
                <div
                  className={`col-span-2 grid grid-cols-subgrid gap-y-1 ${
                    (serverData?.rootFolders.length ?? 0) > 5
                      ? 'scrollable-card max-h-[8.5rem] overflow-y-auto'
                      : ''
                  }`}
                >
                  {isValidating || !serverData ? (
                    <span className="refreshed-detail-text-muted col-span-2">
                      {intl.formatMessage(globalMessages.loading)}
                    </span>
                  ) : (
                    serverData.rootFolders.map((folder) => {
                      const isSelected = folder.path === selectedFolder;

                      return (
                        <button
                          type="button"
                          key={`folder-card-${folder.id}`}
                          onClick={() => setSelectedFolder(folder.path ?? '')}
                          className={`col-span-2 grid grid-cols-subgrid rounded px-1 py-1 text-left transition focus:ring-2 focus:ring-indigo-400 focus:outline-none ${
                            isSelected
                              ? 'bg-indigo-500/20 text-indigo-200'
                              : 'text-gray-300 hover:bg-gray-800/80 hover:text-white'
                          }`}
                        >
                          <span className="truncate">{folder.path}</span>
                          <span className="refreshed-detail-text whitespace-nowrap">
                            {formatBytes(folder.freeSpace ?? 0)}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}
          {selectedServer !== null &&
            serviceOverridesEnabled &&
            (isValidating || !serverData || !!serverData?.tags?.length) && (
              <div className="discover-filter-control mb-2 max-w-xl">
                <label
                  htmlFor="tags"
                  className={controlLabelClass(
                    defaultTagIds !== undefined &&
                      !areNumberArraysEqual(selectedTags, defaultTagIds)
                  )}
                >
                  {intl.formatMessage(messages.tags)}
                </label>
                <Select<OptionType, true>
                  name="tags"
                  options={(serverData?.tags ?? []).map((tag) => ({
                    label: tag.label,
                    value: tag.id,
                  }))}
                  isMulti
                  isDisabled={isValidating || !serverData}
                  placeholder={
                    isValidating || !serverData
                      ? intl.formatMessage(globalMessages.loading)
                      : intl.formatMessage(messages.selecttags)
                  }
                  className="react-select-container react-select-container-dark discover-compact-select"
                  classNamePrefix="react-select"
                  value={
                    selectedTags
                      .map((tagId) => {
                        const foundTag = serverData?.tags.find(
                          (tag) => tag.id === tagId
                        );

                        if (!foundTag) {
                          return undefined;
                        }

                        return {
                          value: foundTag.id,
                          label: foundTag.label,
                        };
                      })
                      .filter((option) => option !== undefined) as OptionType[]
                  }
                  onChange={(value) => {
                    setSelectedTags(value.map((option) => option.value));
                  }}
                  noOptionsMessage={() =>
                    intl.formatMessage(messages.notagoptions)
                  }
                />
              </div>
            )}
          {isIgnoreQuotaVisible && (
            <div className="mb-2">
              <label htmlFor="ignoreQuota">
                {intl.formatMessage(messages.ignoreQuotaTitle)}
              </label>
              <div className="flex items-center justify-between">
                <p className="refreshed-detail-text text-sm">
                  {intl.formatMessage(messages.ignoreQuotaDescription)}
                </p>
                <SlideCheckbox
                  checked={ignoreQuota}
                  onClick={() => setIgnoreQuota(!ignoreQuota)}
                />
              </div>
            </div>
          )}
          {isAnime && (
            <div className="mt-4 italic">
              {intl.formatMessage(messages.animenote)}
            </div>
          )}
        </div>
      </details>
    </>
  );
};

export default AdvancedRequester;
