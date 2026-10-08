import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import PageTitle from '@app/components/Common/PageTitle';
import SelectionCircle from '@app/components/Common/SelectionCircle';
import {
  CompactSelect,
  getFilterToggleButtonClass,
} from '@app/components/Discover/FilterPanel/CompactFilterSelect';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import axios from 'axios';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';

const messages = defineMessages('components.GameLibrary', {
  title: 'My Games',
  intro:
    'Track what you own and what you have played. Sharing is private until you turn it on for a game.',
  libraryTab: 'My Library',
  togetherTab: 'Play Together',
  search: 'Search My Games',
  searchPlaceholder: 'Search titles',
  allStatuses: 'All progress',
  allCategories: 'All game types',
  game: 'PC Games',
  retro: 'Retro',
  modern: 'Modern',
  backlog: 'Backlog',
  playing: 'Playing',
  played: 'Played',
  completed: 'Completed',
  paused: 'Paused',
  dropped: 'Dropped',
  noGames: 'Your game library is empty.',
  noGamesHelp:
    'Browse the software catalog to add a PC or emulation game, or import your Steam library below.',
  noMatches: 'No games match these filters.',
  noSharedGames: 'No shared games yet.',
  noSharedGamesHelp:
    'Choose Share with household on any owned game. SeerrNG only shows games people explicitly share.',
  sharedIntro:
    'Find games that people on this SeerrNG server have chosen to share. Private library entries stay hidden.',
  ownerCount:
    '{count, plural, one {# person owns this} other {# people own this}}',
  sharedBy: 'Shared by {owners}',
  shareWithHousehold: 'Share with household',
  privateLibrary: 'Private to you',
  owned: 'Owned',
  steamOwned: 'In your Steam library',
  alsoOwned: 'Also owned outside Steam',
  notMarkedOwned: 'Not marked as owned',
  store: 'Store or copy',
  platform: 'Platform',
  playtimeHours: '{hours}h played',
  playtimeMinutes: '{minutes}m played',
  playtimeHoursMinutes: '{hours}h {minutes}m played',
  combinedPlaytime: '{hours}h combined household playtime',
  combinedPlaytimeHoursMinutes:
    '{hours}h {minutes}m combined household playtime',
  combinedPlaytimeMinutes: '{minutes}m combined household playtime',
  requestStatus: 'Request: {status}',
  openCatalog: 'Open in catalog',
  requestGame: 'Request this game',
  edit: 'Edit',
  remove: 'Remove',
  removeConfirmTitle: 'Remove Game',
  removeConfirm: 'Remove {title} from your personal game library?',
  save: 'Save Changes',
  cancel: 'Cancel',
  loading: 'Loading games…',
  retry: 'Try Again',
  loadError: 'The game library could not be loaded.',
  updateError: 'This game could not be updated. Try again.',
  saveError: 'Game changes could not be saved. Try again.',
  saved: 'Game library updated.',
  steamTitle: 'Steam Library Import',
  steamDescription:
    'Link your Steam account to import owned games and playtime. Steam account details are private; your games stay private until you share them individually.',
  steamPrivacy:
    'Set Game Details to Public in Steam Privacy Settings before syncing. Steam does not provide playtime or ownership for private game libraries.',
  steamPrivacyLink: 'Steam Privacy Settings',
  steamConnect: 'Link Steam Account',
  steamConnected: 'Steam account linked',
  steamSync: 'Sync Steam Library',
  steamSyncing: 'Syncing Steam…',
  steamDisconnect: 'Unlink Steam',
  steamNotConfigured:
    'Steam import is not enabled by your SeerrNG administrator. You can still add games manually.',
  steamNoAccount: 'Link Steam to import your PC game library.',
  steamLastSynced: 'Last synced {date} · {count} games found',
  steamNeverSynced: 'Not synced yet',
  steamSyncError:
    'Steam could not return your library. Check privacy settings and try again.',
  steamSyncSummary:
    'Steam sync complete: {imported} added, {updated} updated, {total} total.',
  steamConnectedMessage: 'Steam account linked. Sync to import your games.',
  steamErrorMessage: 'Steam could not be linked. Try again.',
  steamUnlinked:
    'Steam account unlinked. Imported games and progress remain, but Steam ownership is cleared.',
  copyGame: 'Your store or copy',
  platformName: 'Platform or system',
  gameProgress: 'Progress',
  manualOwnership: 'I own this outside Steam',
  shareHelp:
    'Shared games are visible to other signed-in users on this SeerrNG server.',
  catalogMatch: 'Link this Steam game to the software catalog',
  catalogMatchHelp:
    'Matching a catalog entry connects household overlap and the existing request flow. Steam sync never guesses a match.',
  catalogSearch: 'Search PC game catalog',
  catalogSearchPlaceholder: 'Enter the game title',
  searchCatalog: 'Search',
  searchingCatalog: 'Searching…',
  matchGame: 'Use this match',
  noCatalogMatches: 'No matching catalog games were found.',
  catalogSearchError: 'The software catalog could not be searched.',
  gameMatched: 'Game linked to the software catalog.',
  request: 'Request',
  requestPending: 'Pending approval',
  requestApproved: 'Approved',
  requestSearching: 'Searching',
  requestDownloading: 'Downloading',
  requestImporting: 'Importing',
  requestAvailable: 'Available',
  requestFailed: 'Failed',
  requestCancelled: 'Cancelled',
  requestDeclined: 'Declined',
  requestWithdrawn: 'Withdrawn',
  requestUnknown: 'In progress',
  loadMore: 'Load More Games',
  loadingMore: 'Loading more games…',
  totalGames: '{count, plural, one {# game} other {# games}}',
  sharedFilterLabel: 'Owner count',
  sharedOnly: '2+ owners',
  allShared: 'All shared games',
  addGame: 'Add a Game',
  addGameTitle: 'Add a game to My Games',
  manualTitle: 'Game title',
  manualCategory: 'Game type',
  manualAdd: 'Add Game',
  manualAdded: 'Game added to your private library.',
  manualTitleRequired: 'Enter a game title.',
});

type GameLibraryStatus =
  'backlog' | 'playing' | 'played' | 'completed' | 'paused' | 'dropped';
type GameLibraryCategory = 'game' | 'retro' | 'modern';
type Tab = 'library' | 'together';

interface GameRequest {
  id: number;
  status: string;
}

interface GameEntry {
  id: number;
  externalKey: string;
  catalogId: number | null;
  category: GameLibraryCategory;
  title: string;
  summary: string;
  coverUrl: string;
  releaseDate: string;
  status: GameLibraryStatus;
  isOwned: boolean;
  steamAppId: number | null;
  steamOwned: boolean;
  playtimeMinutes: number;
  storeName: string;
  platformName: string;
  shareWithHousehold: boolean;
  source: 'manual' | 'steam';
  lastSyncedAt: string | null;
  request: GameRequest | null;
}

interface LibraryPage {
  results: GameEntry[];
  total: number;
  nextOffset: number | null;
}

interface SharedOwner {
  id: number;
  displayName: string;
  avatar: string;
  status: GameLibraryStatus;
  storeName: string;
  platformName: string;
  playtimeMinutes: number;
}

interface SharedGame {
  key: string;
  catalogId: number | null;
  category: GameLibraryCategory;
  title: string;
  summary: string;
  coverUrl: string;
  owners: SharedOwner[];
  ownerCount: number;
  steamAppId: number | null;
  playtimeMinutes: number;
}

interface SharedPage {
  results: SharedGame[];
  total: number;
  nextOffset: number | null;
}

interface SteamStatus {
  connected: boolean;
  lastSyncedAt: string | null;
  lastSyncCount: number;
  apiKeyConfigured: boolean;
}

interface CatalogSearchResult {
  igdbId: number;
  title: string;
  coverUrl: string;
  releaseDate: string;
}

interface EntryDraft {
  status: GameLibraryStatus;
  isOwned: boolean;
  storeName: string;
  platformName: string;
  shareWithHousehold: boolean;
}

const STATUSES: GameLibraryStatus[] = [
  'backlog',
  'playing',
  'played',
  'completed',
  'paused',
  'dropped',
];
const PAGE_SIZE = 48;

const GameLibrary = () => {
  const intl = useIntl();
  const router = useRouter();
  const { hasPermission } = useUser();
  const canRequest = hasPermission(Permission.REQUEST);
  const [tab, setTab] = useState<Tab>('library');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sharedFilter, setSharedFilter] = useState('multiple');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<GameEntry | null>(null);
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [feedback, setFeedback] = useState('');
  const [steamFeedback, setSteamFeedback] = useState('');
  const [steamFeedbackIsError, setSteamFeedbackIsError] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogResults, setCatalogResults] = useState<CatalogSearchResult[]>(
    []
  );
  const [catalogSearching, setCatalogSearching] = useState(false);
  const [catalogSearchError, setCatalogSearchError] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualCategory, setManualCategory] =
    useState<GameLibraryCategory>('game');
  const [manualStatus, setManualStatus] =
    useState<GameLibraryStatus>('backlog');
  const [manualOwned, setManualOwned] = useState(false);
  const [manualStore, setManualStore] = useState('');
  const [manualPlatform, setManualPlatform] = useState('');
  const [manualShared, setManualShared] = useState(false);
  const [removing, setRemoving] = useState<GameEntry | null>(null);
  const processedSteamResult = useRef<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const getLibraryKey = useCallback(
    (pageIndex: number, previousPage: LibraryPage | null) => {
      if (pageIndex > 0 && !previousPage?.nextOffset) return null;
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(pageIndex === 0 ? 0 : (previousPage?.nextOffset ?? 0)),
      });
      if (search) params.set('q', search);
      if (statusFilter) params.set('status', statusFilter);
      if (categoryFilter) params.set('category', categoryFilter);
      return `/api/v1/game-library?${params.toString()}`;
    },
    [categoryFilter, search, statusFilter]
  );
  const {
    data: libraryPages,
    error: libraryError,
    isLoading: libraryLoading,
    size: librarySize,
    setSize: setLibrarySize,
    mutate: mutateLibrary,
  } = useSWRInfinite<LibraryPage>(getLibraryKey, {
    revalidateOnFocus: false,
    revalidateFirstPage: false,
  });

  const getSharedKey = useCallback(
    (pageIndex: number, previousPage: SharedPage | null) => {
      if (tab !== 'together') return null;
      if (pageIndex > 0 && !previousPage?.nextOffset) return null;
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(pageIndex === 0 ? 0 : (previousPage?.nextOffset ?? 0)),
      });
      if (search) params.set('q', search);
      if (sharedFilter === 'multiple') params.set('minOwners', '2');
      return `/api/v1/game-library/shared?${params.toString()}`;
    },
    [search, sharedFilter, tab]
  );
  const {
    data: sharedPages,
    error: sharedError,
    isLoading: sharedLoading,
    size: sharedSize,
    setSize: setSharedSize,
    mutate: mutateShared,
  } = useSWRInfinite<SharedPage>(getSharedKey, {
    revalidateOnFocus: false,
    revalidateFirstPage: false,
  });
  const { data: steamStatus, mutate: mutateSteamStatus } = useSWR<SteamStatus>(
    '/api/v1/game-library/steam/status'
  );

  const entries = useMemo(
    () => [
      ...new Map(
        (libraryPages ?? [])
          .flatMap((page) => page.results)
          .map((entry) => [entry.id, entry])
      ).values(),
    ],
    [libraryPages]
  );
  const sharedGames = useMemo(
    () => [
      ...new Map(
        (sharedPages ?? [])
          .flatMap((page) => page.results)
          .map((game) => [game.key, game])
      ).values(),
    ],
    [sharedPages]
  );
  const shownSharedGames = sharedGames;
  const totalLibraryGames = libraryPages?.[0]?.total ?? 0;
  const totalSharedGames = sharedPages?.[0]?.total ?? 0;
  const canLoadMoreLibrary = Boolean(
    libraryPages?.length && libraryPages.at(-1)?.nextOffset !== null
  );
  const canLoadMoreShared = Boolean(
    sharedPages?.length && sharedPages.at(-1)?.nextOffset !== null
  );
  const libraryLoadingMore = librarySize > (libraryPages?.length ?? 0);
  const sharedLoadingMore = sharedSize > (sharedPages?.length ?? 0);
  const pageError = tab === 'library' ? libraryError : sharedError;

  useEffect(() => {
    const result = router.query.steam;
    if (
      !router.isReady ||
      (result !== 'connected' && result !== 'error') ||
      processedSteamResult.current === result
    ) {
      return;
    }
    processedSteamResult.current = result;
    if (result === 'connected') {
      setSteamFeedback(intl.formatMessage(messages.steamConnectedMessage));
      setSteamFeedbackIsError(false);
      void mutateSteamStatus();
    } else {
      setSteamFeedback(intl.formatMessage(messages.steamErrorMessage));
      setSteamFeedbackIsError(true);
    }
    const nextQuery = { ...router.query };
    delete nextQuery.steam;
    void router.replace({ pathname: '/games', query: nextQuery }, undefined, {
      shallow: true,
      scroll: false,
    });
  }, [intl, mutateSteamStatus, router, router.isReady, router.query.steam]);

  const formatStatus = (status: GameLibraryStatus) =>
    intl.formatMessage(messages[status]);

  const formatPlaytime = (minutes: number, combined = false) => {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (combined && hours > 0 && remainingMinutes > 0) {
      return intl.formatMessage(messages.combinedPlaytimeHoursMinutes, {
        hours: hours.toLocaleString(intl.locale),
        minutes: remainingMinutes.toLocaleString(intl.locale),
      });
    }
    if (combined && hours > 0) {
      return intl.formatMessage(messages.combinedPlaytime, {
        hours: hours.toLocaleString(intl.locale),
      });
    }
    if (combined) {
      return intl.formatMessage(messages.combinedPlaytimeMinutes, {
        minutes: remainingMinutes.toLocaleString(intl.locale),
      });
    }
    if (hours > 0 && remainingMinutes > 0) {
      return intl.formatMessage(messages.playtimeHoursMinutes, {
        hours: hours.toLocaleString(intl.locale),
        minutes: remainingMinutes.toLocaleString(intl.locale),
      });
    }
    if (hours > 0) {
      return intl.formatMessage(messages.playtimeHours, {
        hours: hours.toLocaleString(intl.locale),
      });
    }
    return intl.formatMessage(messages.playtimeMinutes, {
      minutes: remainingMinutes.toLocaleString(intl.locale),
    });
  };

  const formatRequestStatus = (status: string) => {
    const requestMessage =
      {
        pending: messages.requestPending,
        approved: messages.requestApproved,
        searching: messages.requestSearching,
        downloading: messages.requestDownloading,
        importing: messages.requestImporting,
        available: messages.requestAvailable,
        failed: messages.requestFailed,
        cancelled: messages.requestCancelled,
        declined: messages.requestDeclined,
        withdrawn: messages.requestWithdrawn,
      }[status] ?? messages.requestUnknown;
    return intl.formatMessage(requestMessage);
  };

  const showError = (error: unknown, fallback = messages.updateError) => {
    setErrorMessage(
      axios.isAxiosError(error) &&
        typeof error.response?.data?.error === 'string'
        ? error.response.data.error
        : intl.formatMessage(fallback)
    );
  };

  const refreshLibraryViews = async () => {
    await Promise.all([mutateLibrary(), mutateShared(), mutateSteamStatus()]);
  };

  const patchEntry = async (entry: GameEntry, update: Partial<EntryDraft>) => {
    setBusyId(entry.id);
    setErrorMessage('');
    try {
      await axios.patch(`/api/v1/game-library/${entry.id}`, update);
      await Promise.all([mutateLibrary(), mutateShared()]);
      setFeedback(intl.formatMessage(messages.saved));
    } catch (error) {
      showError(error);
    } finally {
      setBusyId(null);
    }
  };

  const openEdit = (entry: GameEntry) => {
    setEditing(entry);
    setDraft({
      status: entry.status,
      isOwned: entry.isOwned,
      storeName: entry.storeName,
      platformName: entry.platformName,
      shareWithHousehold: entry.shareWithHousehold,
    });
    setCatalogSearch('');
    setCatalogResults([]);
    setCatalogSearchError(false);
    setErrorMessage('');
  };

  const closeEdit = () => {
    if (saving) return;
    setEditing(null);
    setDraft(null);
    setCatalogResults([]);
    setErrorMessage('');
  };

  const saveEdit = async () => {
    if (!editing || !draft) return;
    setSaving(true);
    setErrorMessage('');
    try {
      await axios.patch(`/api/v1/game-library/${editing.id}`, draft);
      await Promise.all([mutateLibrary(), mutateShared()]);
      setEditing(null);
      setDraft(null);
      setFeedback(intl.formatMessage(messages.saved));
    } catch (error) {
      showError(error, messages.saveError);
    } finally {
      setSaving(false);
    }
  };

  const removeEntry = async (entry: GameEntry) => {
    setBusyId(entry.id);
    setErrorMessage('');
    try {
      await axios.delete(`/api/v1/game-library/${entry.id}`);
      await Promise.all([mutateLibrary(), mutateShared()]);
      setFeedback(intl.formatMessage(messages.saved));
    } catch (error) {
      showError(error);
    } finally {
      setBusyId(null);
    }
  };

  const openManualAdd = () => {
    setManualTitle('');
    setManualCategory('game');
    setManualStatus('backlog');
    setManualOwned(false);
    setManualStore('');
    setManualPlatform('');
    setManualShared(false);
    setErrorMessage('');
    setManualOpen(true);
  };

  const addManualGame = async () => {
    if (!manualTitle.trim()) {
      setErrorMessage(intl.formatMessage(messages.manualTitleRequired));
      return;
    }
    setSaving(true);
    setErrorMessage('');
    try {
      await axios.post('/api/v1/game-library/manual', {
        title: manualTitle.trim(),
        category: manualCategory,
        status: manualStatus,
        isOwned: manualOwned,
        storeName: manualStore,
        platformName: manualPlatform,
        shareWithHousehold: manualOwned && manualShared,
      });
      setManualOpen(false);
      await Promise.all([mutateLibrary(), mutateShared()]);
      setFeedback(intl.formatMessage(messages.manualAdded));
    } catch (error) {
      showError(error, messages.saveError);
    } finally {
      setSaving(false);
    }
  };

  const searchCatalog = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!catalogSearch.trim()) return;
    setCatalogSearching(true);
    setCatalogSearchError(false);
    setCatalogResults([]);
    try {
      const response = await axios.get<{ results: CatalogSearchResult[] }>(
        '/api/v1/request/software/catalog/search',
        {
          params: { category: 'game', q: catalogSearch.trim(), limit: 8 },
        }
      );
      setCatalogResults(response.data.results ?? []);
    } catch {
      setCatalogSearchError(true);
    } finally {
      setCatalogSearching(false);
    }
  };

  const matchCatalogGame = async (catalogId: number) => {
    if (!editing || !draft) return;
    setSaving(true);
    setErrorMessage('');
    try {
      await axios.post(`/api/v1/game-library/${editing.id}/match`, {
        category: 'game',
        catalogId,
        ...draft,
      });
      await Promise.all([mutateLibrary(), mutateShared()]);
      setEditing(null);
      setDraft(null);
      setFeedback(intl.formatMessage(messages.gameMatched));
    } catch (error) {
      showError(error, messages.saveError);
    } finally {
      setSaving(false);
    }
  };

  const syncSteam = async () => {
    setBusyId(-1);
    setErrorMessage('');
    setSteamFeedback('');
    setSteamFeedbackIsError(false);
    try {
      const response = await axios.post<{
        imported: number;
        updated: number;
        total: number;
      }>('/api/v1/game-library/steam/sync');
      setSteamFeedback(
        intl.formatMessage(messages.steamSyncSummary, response.data)
      );
      setSteamFeedbackIsError(false);
      await refreshLibraryViews();
    } catch (error) {
      setSteamFeedback(
        axios.isAxiosError(error) &&
          typeof error.response?.data?.error === 'string'
          ? error.response.data.error
          : intl.formatMessage(messages.steamSyncError)
      );
      setSteamFeedbackIsError(true);
    } finally {
      setBusyId(null);
    }
  };

  const unlinkSteam = async () => {
    setBusyId(-1);
    setErrorMessage('');
    setSteamFeedback('');
    setSteamFeedbackIsError(false);
    try {
      await axios.delete('/api/v1/game-library/steam');
      await mutateSteamStatus();
      setSteamFeedback(intl.formatMessage(messages.steamUnlinked));
      setSteamFeedbackIsError(false);
    } catch (error) {
      showError(error);
    } finally {
      setBusyId(null);
    }
  };

  const requestGame = (entry: GameEntry) => {
    if (entry.catalogId === null) {
      void router.push({
        pathname: '/software',
        query: { category: 'game', q: entry.title },
      });
      return;
    }
    void router.push({
      pathname: '/software',
      query: { category: entry.category, game: String(entry.catalogId) },
    });
  };

  const shareGame = (game: SharedGame) => {
    if (game.catalogId === null) {
      void router.push({
        pathname: '/software',
        query: { category: 'game', q: game.title },
      });
      return;
    }
    void router.push({
      pathname: '/software',
      query: { category: game.category, game: String(game.catalogId) },
    });
  };

  const renderGame = (entry: GameEntry) => {
    const owned = entry.isOwned || entry.steamOwned;
    return (
      <li key={entry.id}>
        <article className="app-card-sub" data-card-layout="portrait">
          <div data-card-part="artwork">
            <CachedImage
              type="tmdb"
              src={entry.coverUrl || '/images/seerr_poster_not_found.png'}
              alt=""
              width={54}
              height={81}
            />
          </div>
          <div data-card-part="content">
            <div className="page-title-row">
              <h2 className="card-title">{entry.title}</h2>
              <CompactSelect
                label={intl.formatMessage(messages.gameProgress)}
                value={entry.status}
                options={STATUSES.map((status) => ({
                  value: status,
                  label: formatStatus(status),
                }))}
                onChange={(value) =>
                  void patchEntry(entry, { status: value as GameLibraryStatus })
                }
              />
            </div>
            <p className="card-body-text">
              {entry.steamOwned
                ? intl.formatMessage(messages.steamOwned)
                : owned
                  ? intl.formatMessage(messages.owned)
                  : intl.formatMessage(messages.notMarkedOwned)}
              {entry.storeName ? ` · ${entry.storeName}` : ''}
              {entry.platformName ? ` · ${entry.platformName}` : ''}
              {entry.playtimeMinutes > 0
                ? ` · ${formatPlaytime(entry.playtimeMinutes)}`
                : ''}
            </p>
            {entry.request && (
              <p className="card-body-text">
                {intl.formatMessage(messages.requestStatus, {
                  status: formatRequestStatus(entry.request.status),
                })}
              </p>
            )}
            <div className="app-action-row">
              <SelectionCircle
                label={intl.formatMessage(messages.manualOwnership)}
                selected={entry.isOwned}
                disabled={busyId === entry.id}
                onClick={() =>
                  void patchEntry(entry, { isOwned: !entry.isOwned })
                }
              />
              <span>{intl.formatMessage(messages.manualOwnership)}</span>
              <SelectionCircle
                label={intl.formatMessage(messages.shareWithHousehold)}
                selected={entry.shareWithHousehold}
                disabled={busyId === entry.id || !owned}
                onClick={() =>
                  void patchEntry(entry, {
                    shareWithHousehold: !entry.shareWithHousehold,
                  })
                }
              />
              <span>
                {entry.shareWithHousehold
                  ? intl.formatMessage(messages.shareWithHousehold)
                  : intl.formatMessage(messages.privateLibrary)}
              </span>
            </div>
            <div className="app-action-row">
              <Button
                buttonType="default"
                buttonSize="sm"
                disabled={busyId === entry.id}
                onClick={() => openEdit(entry)}
              >
                {intl.formatMessage(messages.edit)}
              </Button>
              {canRequest && (
                <Button
                  buttonType="default"
                  buttonSize="sm"
                  disabled={busyId === entry.id}
                  onClick={() => requestGame(entry)}
                >
                  {intl.formatMessage(messages.requestGame)}
                </Button>
              )}
              <Button
                buttonType="danger"
                buttonSize="sm"
                disabled={busyId === entry.id}
                onClick={() => setRemoving(entry)}
              >
                {intl.formatMessage(messages.remove)}
              </Button>
            </div>
          </div>
        </article>
      </li>
    );
  };

  const renderSharedGame = (game: SharedGame) => (
    <li key={game.key}>
      <article className="app-card-sub" data-card-layout="portrait">
        <div data-card-part="artwork">
          <CachedImage
            type="tmdb"
            src={game.coverUrl || '/images/seerr_poster_not_found.png'}
            alt=""
            width={54}
            height={81}
          />
        </div>
        <div data-card-part="content">
          <h2 className="card-title">{game.title}</h2>
          <p className="card-body-text">
            {intl.formatMessage(messages.ownerCount, {
              count: game.ownerCount,
            })}
            {game.playtimeMinutes > 0
              ? ` · ${formatPlaytime(game.playtimeMinutes, true)}`
              : ''}
          </p>
          <p className="card-body-text">
            {intl.formatMessage(messages.sharedBy, {
              owners: game.owners
                .map(({ displayName }) => displayName)
                .join(', '),
            })}
          </p>
          <p className="card-body-text">
            {game.owners
              .map((owner) =>
                [
                  `${owner.displayName}: ${formatStatus(owner.status)}`,
                  owner.storeName,
                  owner.platformName,
                  owner.playtimeMinutes > 0
                    ? formatPlaytime(owner.playtimeMinutes)
                    : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
              )
              .join(' · ')}
          </p>
          <div className="app-action-row">
            <Button
              buttonType="default"
              buttonSize="sm"
              onClick={() => shareGame(game)}
            >
              {canRequest && game.catalogId === null
                ? intl.formatMessage(messages.requestGame)
                : intl.formatMessage(messages.openCatalog)}
            </Button>
          </div>
        </div>
      </article>
    </li>
  );

  const statusOptions = [
    { value: '', label: intl.formatMessage(messages.allStatuses) },
    ...STATUSES.map((status) => ({
      value: status,
      label: formatStatus(status),
    })),
  ];
  const categoryOptions = [
    { value: '', label: intl.formatMessage(messages.allCategories) },
    { value: 'game', label: intl.formatMessage(messages.game) },
    { value: 'retro', label: intl.formatMessage(messages.retro) },
    { value: 'modern', label: intl.formatMessage(messages.modern) },
  ];
  const textField = (
    id: string,
    label: string,
    value: string,
    onChange: (value: string) => void,
    maxLength = 120
  ) => (
    <div className="form-row">
      <label className="text-label" htmlFor={id}>
        {label}
      </label>
      <div className="form-input-area">
        <div className="form-input-field">
          <input
            id={id}
            className="input input-lite"
            type="text"
            maxLength={maxLength}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      </div>
    </div>
  );

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.title)} />
      <main className="page-layout">
        <div data-page-layout-part="content">
          <div className="page-title-row">
            <h1 className="page-title">{intl.formatMessage(messages.title)}</h1>
            {tab === 'library' && (
              <div className="app-action-row">
                <span className="card-body-text">
                  {intl.formatMessage(messages.totalGames, {
                    count: totalLibraryGames,
                  })}
                </span>
                <Button
                  buttonType="primary"
                  buttonSize="sm"
                  onClick={openManualAdd}
                >
                  {intl.formatMessage(messages.addGame)}
                </Button>
              </div>
            )}
          </div>
          <p className="page-title-subtext">
            {intl.formatMessage(messages.intro)}
          </p>

          {tab === 'library' && (
            <section className="app-card-main card-layout">
              <h2 className="page-heading">
                {intl.formatMessage(messages.steamTitle)}
              </h2>
              <p className="card-body-text">
                {intl.formatMessage(messages.steamDescription)}
              </p>
              <p className="card-body-text">
                {intl.formatMessage(messages.steamPrivacy)}{' '}
                <a
                  href="https://steamcommunity.com/my/edit/settings"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {intl.formatMessage(messages.steamPrivacyLink)}
                </a>
              </p>
              {steamStatus?.connected && (
                <p className="card-body-text">
                  {intl.formatMessage(messages.steamConnected)}
                  {steamStatus.lastSyncedAt
                    ? ` · ${intl.formatMessage(messages.steamLastSynced, {
                        date: intl.formatDate(steamStatus.lastSyncedAt),
                        count: steamStatus.lastSyncCount,
                      })}`
                    : ` · ${intl.formatMessage(messages.steamNeverSynced)}`}
                </p>
              )}
              {!steamStatus?.apiKeyConfigured && (
                <p className="page-status">
                  {intl.formatMessage(messages.steamNotConfigured)}
                </p>
              )}
              {steamFeedback && (
                <p
                  className={
                    steamFeedbackIsError ? 'page-error-message' : 'page-status'
                  }
                  role={steamFeedbackIsError ? 'alert' : 'status'}
                >
                  {steamFeedback}
                </p>
              )}
              <div className="app-action-row">
                {steamStatus?.connected ? (
                  <>
                    <Button
                      buttonType="primary"
                      buttonSize="sm"
                      disabled={busyId === -1 || !steamStatus.apiKeyConfigured}
                      onClick={() => void syncSteam()}
                    >
                      {busyId === -1
                        ? intl.formatMessage(messages.steamSyncing)
                        : intl.formatMessage(messages.steamSync)}
                    </Button>
                    <Button
                      buttonType="default"
                      buttonSize="sm"
                      disabled={busyId === -1}
                      onClick={() => void unlinkSteam()}
                    >
                      {intl.formatMessage(messages.steamDisconnect)}
                    </Button>
                  </>
                ) : steamStatus?.apiKeyConfigured ? (
                  <a
                    className="app-button app-button-default"
                    href={`${router.basePath}/api/v1/game-library/steam/connect`}
                  >
                    {intl.formatMessage(messages.steamConnect)}
                  </a>
                ) : null}
              </div>
            </section>
          )}

          <nav
            className="app-filter-row"
            aria-label={intl.formatMessage(messages.title)}
          >
            <button
              type="button"
              aria-pressed={tab === 'library'}
              className={getFilterToggleButtonClass(tab === 'library')}
              onClick={() => setTab('library')}
            >
              {intl.formatMessage(messages.libraryTab)}
            </button>
            <button
              type="button"
              aria-pressed={tab === 'together'}
              className={getFilterToggleButtonClass(tab === 'together')}
              onClick={() => setTab('together')}
            >
              {intl.formatMessage(messages.togetherTab)}
            </button>
          </nav>

          {tab === 'library' ? (
            <>
              <div className="app-filter-row">
                <label className="discover-filter-control app-filter-search-control">
                  <span className="discover-filter-control-label">
                    <MagnifyingGlassIcon
                      className="app-action-icon"
                      aria-hidden="true"
                    />
                    {intl.formatMessage(messages.search)}
                  </span>
                  <input
                    type="search"
                    className="app-filter-search-input"
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder={intl.formatMessage(messages.searchPlaceholder)}
                    aria-label={intl.formatMessage(messages.search)}
                  />
                </label>
                <CompactSelect
                  label={intl.formatMessage(messages.allStatuses)}
                  value={statusFilter}
                  options={statusOptions}
                  onChange={(value) => setStatusFilter(value)}
                />
                <CompactSelect
                  label={intl.formatMessage(messages.allCategories)}
                  value={categoryFilter}
                  options={categoryOptions}
                  onChange={(value) => setCategoryFilter(value)}
                />
              </div>
              {feedback && (
                <p className="page-status" role="status">
                  {feedback}
                </p>
              )}
              {errorMessage && (
                <p className="page-error-message" role="alert">
                  {errorMessage}
                </p>
              )}
              {libraryLoading ? (
                <div className="page-status" role="status">
                  <LoadingSpinner /> {intl.formatMessage(messages.loading)}
                </div>
              ) : pageError ? (
                <div className="page-error-message" role="alert">
                  <p>{intl.formatMessage(messages.loadError)}</p>
                  <Button
                    buttonType="default"
                    buttonSize="sm"
                    onClick={() => void mutateLibrary()}
                  >
                    {intl.formatMessage(messages.retry)}
                  </Button>
                </div>
              ) : entries.length > 0 ? (
                <ul className="card-list" data-list-layout="stacked">
                  {entries.map(renderGame)}
                </ul>
              ) : (
                <section className="app-card-main card-layout">
                  <h2 className="page-heading">
                    {totalLibraryGames === 0
                      ? intl.formatMessage(messages.noGames)
                      : intl.formatMessage(messages.noMatches)}
                  </h2>
                  {totalLibraryGames === 0 && (
                    <p className="card-body-text">
                      {intl.formatMessage(messages.noGamesHelp)}
                    </p>
                  )}
                  <div className="app-action-row">
                    <Button
                      buttonType="primary"
                      buttonSize="sm"
                      onClick={() => void router.push('/software')}
                    >
                      {intl.formatMessage(messages.openCatalog)}
                    </Button>
                  </div>
                </section>
              )}
              {canLoadMoreLibrary && (
                <div className="app-action-row">
                  <Button
                    buttonType="default"
                    buttonSize="sm"
                    disabled={libraryLoadingMore}
                    onClick={() => void setLibrarySize((size) => size + 1)}
                  >
                    {libraryLoadingMore
                      ? intl.formatMessage(messages.loadingMore)
                      : intl.formatMessage(messages.loadMore)}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="page-title-subtext">
                {intl.formatMessage(messages.sharedIntro)}
              </p>
              <div className="app-filter-row">
                <label className="discover-filter-control app-filter-search-control">
                  <span className="discover-filter-control-label">
                    <MagnifyingGlassIcon
                      className="app-action-icon"
                      aria-hidden="true"
                    />
                    {intl.formatMessage(messages.search)}
                  </span>
                  <input
                    type="search"
                    className="app-filter-search-input"
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder={intl.formatMessage(messages.searchPlaceholder)}
                    aria-label={intl.formatMessage(messages.search)}
                  />
                </label>
                <CompactSelect
                  label={intl.formatMessage(messages.sharedFilterLabel)}
                  value={sharedFilter}
                  options={[
                    {
                      value: 'multiple',
                      label: intl.formatMessage(messages.sharedOnly),
                    },
                    {
                      value: 'all',
                      label: intl.formatMessage(messages.allShared),
                    },
                  ]}
                  onChange={setSharedFilter}
                />
              </div>
              {sharedLoading ? (
                <div className="page-status" role="status">
                  <LoadingSpinner /> {intl.formatMessage(messages.loading)}
                </div>
              ) : sharedError ? (
                <div className="page-error-message" role="alert">
                  <p>{intl.formatMessage(messages.loadError)}</p>
                  <Button
                    buttonType="default"
                    buttonSize="sm"
                    onClick={() => void mutateShared()}
                  >
                    {intl.formatMessage(messages.retry)}
                  </Button>
                </div>
              ) : shownSharedGames.length > 0 ? (
                <ul className="card-list" data-list-layout="stacked">
                  {shownSharedGames.map(renderSharedGame)}
                </ul>
              ) : (
                <section className="app-card-main card-layout">
                  <h2 className="page-heading">
                    {intl.formatMessage(messages.noSharedGames)}
                  </h2>
                  <p className="card-body-text">
                    {intl.formatMessage(messages.noSharedGamesHelp)}
                  </p>
                </section>
              )}
              {canLoadMoreShared && (
                <div className="app-action-row">
                  <Button
                    buttonType="default"
                    buttonSize="sm"
                    disabled={sharedLoadingMore}
                    onClick={() => void setSharedSize((size) => size + 1)}
                  >
                    {sharedLoadingMore
                      ? intl.formatMessage(messages.loadingMore)
                      : intl.formatMessage(messages.loadMore)}
                  </Button>
                </div>
              )}
              {totalSharedGames > 0 && (
                <p className="card-body-text">
                  {intl.formatMessage(messages.totalGames, {
                    count: totalSharedGames,
                  })}
                </p>
              )}
            </>
          )}
        </div>
      </main>

      {editing && draft && (
        <Modal
          title={editing.title}
          subTitle={intl.formatMessage(messages.shareHelp)}
          onCancel={closeEdit}
          onOk={() => void saveEdit()}
          okText={intl.formatMessage(messages.save)}
          cancelText={intl.formatMessage(messages.cancel)}
          okDisabled={saving}
          loading={saving}
          manageHistory={false}
        >
          <div className="card-stack">
            <CompactSelect
              label={intl.formatMessage(messages.gameProgress)}
              value={draft.status}
              options={STATUSES.map((status) => ({
                value: status,
                label: formatStatus(status),
              }))}
              onChange={(value) =>
                setDraft((current) =>
                  current
                    ? { ...current, status: value as GameLibraryStatus }
                    : current
                )
              }
            />
            {textField(
              'game-store',
              intl.formatMessage(messages.copyGame),
              draft.storeName,
              (value) =>
                setDraft((current) =>
                  current ? { ...current, storeName: value } : current
                )
            )}
            {textField(
              'game-platform',
              intl.formatMessage(messages.platformName),
              draft.platformName,
              (value) =>
                setDraft((current) =>
                  current ? { ...current, platformName: value } : current
                )
            )}
            <div className="app-action-row">
              <SelectionCircle
                label={intl.formatMessage(messages.manualOwnership)}
                selected={draft.isOwned}
                onClick={() =>
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          isOwned: !current.isOwned,
                          shareWithHousehold:
                            current.isOwned && !editing.steamOwned
                              ? false
                              : current.shareWithHousehold,
                        }
                      : current
                  )
                }
              />
              <span>{intl.formatMessage(messages.manualOwnership)}</span>
            </div>
            <div className="app-action-row">
              <SelectionCircle
                label={intl.formatMessage(messages.shareWithHousehold)}
                selected={draft.shareWithHousehold}
                disabled={!draft.isOwned && !editing.steamOwned}
                onClick={() =>
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          shareWithHousehold: !current.shareWithHousehold,
                        }
                      : current
                  )
                }
              />
              <span>{intl.formatMessage(messages.shareWithHousehold)}</span>
            </div>
            {editing.catalogId === null && (
              <section className="app-card-inset card-layout">
                <h3 className="page-heading">
                  {intl.formatMessage(messages.catalogMatch)}
                </h3>
                <p className="card-body-text">
                  {intl.formatMessage(messages.catalogMatchHelp)}
                </p>
                <form
                  className="app-filter-row"
                  onSubmit={(event) => void searchCatalog(event)}
                >
                  <label className="discover-filter-control app-filter-search-control">
                    <span className="discover-filter-control-label">
                      {intl.formatMessage(messages.catalogSearch)}
                    </span>
                    <input
                      type="search"
                      className="app-filter-search-input"
                      value={catalogSearch}
                      onChange={(event) => setCatalogSearch(event.target.value)}
                      placeholder={intl.formatMessage(
                        messages.catalogSearchPlaceholder
                      )}
                    />
                  </label>
                  <Button
                    buttonType="default"
                    buttonSize="sm"
                    disabled={catalogSearching || !catalogSearch.trim()}
                    type="submit"
                  >
                    {catalogSearching
                      ? intl.formatMessage(messages.searchingCatalog)
                      : intl.formatMessage(messages.searchCatalog)}
                  </Button>
                </form>
                {catalogSearchError && (
                  <p className="page-error-message" role="alert">
                    {intl.formatMessage(messages.catalogSearchError)}
                  </p>
                )}
                {catalogResults.length > 0 ? (
                  <ul className="card-list" data-list-layout="stacked">
                    {catalogResults.map((game) => (
                      <li key={game.igdbId}>
                        <div
                          className="app-card-sub"
                          data-card-layout="portrait"
                        >
                          <div data-card-part="artwork">
                            <CachedImage
                              type="tmdb"
                              src={
                                game.coverUrl ||
                                '/images/seerr_poster_not_found.png'
                              }
                              alt=""
                              width={54}
                              height={81}
                            />
                          </div>
                          <div data-card-part="content">
                            <h4 className="card-title">{game.title}</h4>
                            <Button
                              buttonType="default"
                              buttonSize="sm"
                              disabled={saving}
                              onClick={() => void matchCatalogGame(game.igdbId)}
                            >
                              {intl.formatMessage(messages.matchGame)}
                            </Button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : catalogSearch &&
                  !catalogSearching &&
                  !catalogSearchError ? (
                  <p className="card-body-text">
                    {intl.formatMessage(messages.noCatalogMatches)}
                  </p>
                ) : null}
              </section>
            )}
            {errorMessage && (
              <p className="page-error-message" role="alert">
                {errorMessage}
              </p>
            )}
          </div>
        </Modal>
      )}
      {manualOpen && (
        <Modal
          title={intl.formatMessage(messages.addGameTitle)}
          onCancel={() => !saving && setManualOpen(false)}
          onOk={() => void addManualGame()}
          okText={intl.formatMessage(messages.manualAdd)}
          cancelText={intl.formatMessage(messages.cancel)}
          okDisabled={saving || manualTitle.trim().length === 0}
          loading={saving}
          manageHistory={false}
        >
          <div className="card-stack">
            {textField(
              'manual-game-title',
              intl.formatMessage(messages.manualTitle),
              manualTitle,
              setManualTitle,
              512
            )}
            <CompactSelect
              label={intl.formatMessage(messages.manualCategory)}
              value={manualCategory}
              options={categoryOptions.filter(({ value }) => value !== '')}
              onChange={(value) =>
                setManualCategory(value as GameLibraryCategory)
              }
            />
            <CompactSelect
              label={intl.formatMessage(messages.gameProgress)}
              value={manualStatus}
              options={STATUSES.map((status) => ({
                value: status,
                label: formatStatus(status),
              }))}
              onChange={(value) => setManualStatus(value as GameLibraryStatus)}
            />
            {textField(
              'manual-game-store',
              intl.formatMessage(messages.copyGame),
              manualStore,
              setManualStore
            )}
            {textField(
              'manual-game-platform',
              intl.formatMessage(messages.platformName),
              manualPlatform,
              setManualPlatform
            )}
            <div className="app-action-row">
              <SelectionCircle
                label={intl.formatMessage(messages.manualOwnership)}
                selected={manualOwned}
                onClick={() => {
                  setManualOwned((current) => !current);
                  if (manualOwned) setManualShared(false);
                }}
              />
              <span>{intl.formatMessage(messages.manualOwnership)}</span>
            </div>
            {manualOwned && (
              <div className="app-action-row">
                <SelectionCircle
                  label={intl.formatMessage(messages.shareWithHousehold)}
                  selected={manualShared}
                  onClick={() => setManualShared((current) => !current)}
                />
                <span>{intl.formatMessage(messages.shareWithHousehold)}</span>
              </div>
            )}
            {errorMessage && (
              <p className="page-error-message" role="alert">
                {errorMessage}
              </p>
            )}
          </div>
        </Modal>
      )}
      {removing && (
        <Modal
          title={intl.formatMessage(messages.removeConfirmTitle)}
          onCancel={() => setRemoving(null)}
          onOk={() => {
            const entry = removing;
            setRemoving(null);
            void removeEntry(entry);
          }}
          okText={intl.formatMessage(messages.remove)}
          cancelText={intl.formatMessage(messages.cancel)}
          okButtonType="danger"
          manageHistory={false}
        >
          <p className="card-body-text">
            {intl.formatMessage(messages.removeConfirm, {
              title: removing.title,
            })}
          </p>
        </Modal>
      )}
    </>
  );
};

export default GameLibrary;
