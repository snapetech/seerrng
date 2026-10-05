import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { IntlProvider } from 'react-intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import GameLibrary from './index';

const state = vi.hoisted(() => ({
  canRequest: true,
  library: [] as Array<Record<string, unknown>>,
  shared: [] as Array<Record<string, unknown>>,
  steamStatus: {
    connected: true,
    lastSyncedAt: null,
    lastSyncCount: 0,
    apiKeyConfigured: true,
  },
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('next/router', () => ({
  useRouter: () => ({
    basePath: '/seerr',
    isReady: true,
    pathname: '/games',
    query: {},
    push: state.push,
    replace: state.replace,
  }),
}));

vi.mock('@app/hooks/useUser', () => ({
  Permission: { REQUEST: 1 },
  useUser: () => ({ hasPermission: () => state.canRequest }),
}));

vi.mock('axios', () => ({
  default: {
    delete: vi.fn(),
    get: vi.fn(),
    isAxiosError: () => false,
    patch: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('swr', () => ({
  default: () => ({ data: state.steamStatus, mutate: vi.fn() }),
}));

vi.mock('swr/infinite', () => ({
  default: (
    getKey: (index: number, previousPage: unknown) => string | null
  ) => {
    const key = getKey(0, null);
    const shared = key?.includes('/shared') ?? false;
    const page = {
      results: shared ? state.shared : state.library,
      total: shared ? state.shared.length : state.library.length,
      nextOffset: null,
    };
    return {
      data: key === null ? undefined : [page],
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
      setSize: vi.fn(),
      size: 1,
    };
  },
}));

vi.mock('@app/components/Common/Button', () => ({
  default: ({
    children,
    onClick,
    disabled,
    type,
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick} disabled={disabled} type={type ?? 'button'}>
      {children}
    </button>
  ),
}));

vi.mock('@app/components/Common/CachedImage', () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    <img alt={alt} src={src} />
  ),
}));

vi.mock('@app/components/Common/LoadingSpinner', () => ({
  default: () => <span aria-hidden="true" />,
}));

vi.mock('@app/components/Common/Modal', () => ({ default: () => null }));
vi.mock('@app/components/Common/PageTitle', () => ({ default: () => null }));
vi.mock('@app/components/Common/SelectionCircle', () => ({
  default: () => <button type="button" />,
}));

vi.mock('@app/components/Discover/FilterPanel/CompactFilterSelect', () => ({
  CompactSelect: ({
    label,
    value,
    options,
  }: {
    label: string;
    value: string;
    options: Array<{ value: string; label: string }>;
  }) => (
    <label>
      {label}
      <select aria-label={label} value={value} disabled>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  ),
  getFilterToggleButtonClass: () => 'filter-toggle',
}));

let dom: JSDOM;
let root: ReturnType<typeof createRoot>;

const render = async () =>
  act(async () =>
    root.render(
      <IntlProvider locale="en">
        <GameLibrary />
      </IntlProvider>
    )
  );

const clickButton = async (label: string) =>
  act(async () => {
    const matches = [...document.querySelectorAll('button')].filter(
      (button) => button.textContent?.trim() === label
    );
    expect(matches).toHaveLength(1);
    matches[0].click();
  });

beforeEach(() => {
  dom = new JSDOM('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('React', React);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.getElementById('root')!);
  state.canRequest = true;
  state.library = [
    {
      id: 7,
      externalKey: 'steam:413150',
      catalogId: null,
      category: 'game',
      title: 'Stardew Valley',
      summary: '',
      coverUrl: '',
      releaseDate: '',
      status: 'playing',
      isOwned: false,
      steamAppId: 413150,
      steamOwned: true,
      playtimeMinutes: 125,
      storeName: 'Steam',
      platformName: 'PC',
      shareWithHousehold: false,
      source: 'steam',
      lastSyncedAt: null,
      request: null,
    },
  ];
  state.shared = [
    {
      key: 'igdb:123',
      catalogId: 123,
      category: 'game',
      title: 'Portal 2',
      summary: '',
      coverUrl: '',
      owners: [
        {
          id: 2,
          displayName: 'Alex',
          avatar: '',
          status: 'completed',
          storeName: 'Steam',
          platformName: 'PC',
          playtimeMinutes: 180,
        },
        {
          id: 3,
          displayName: 'Sam',
          avatar: '',
          status: 'playing',
          storeName: '',
          platformName: 'PC',
          playtimeMinutes: 150,
        },
      ],
      ownerCount: 2,
      steamAppId: 620,
      playtimeMinutes: 330,
    },
  ];
  state.steamStatus = {
    connected: true,
    lastSyncedAt: null,
    lastSyncCount: 0,
    apiKeyConfigured: true,
  };
  state.push.mockReset();
  state.replace.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.unstubAllGlobals();
});

it('shows private Steam progress and household overlap with each owner’s status', async () => {
  await render();

  expect(document.body.textContent).toContain('Stardew Valley');
  expect(document.body.textContent).toContain('In your Steam library');
  expect(document.body.textContent).toContain('2h 5m played');
  expect(document.body.textContent).toContain('Private to you');
  expect(
    document.querySelector('a[href="/seerr/api/v1/game-library/steam/connect"]')
  ).toBeNull();

  await clickButton('Play Together');

  expect(document.body.textContent).toContain('Portal 2');
  expect(document.body.textContent).toContain('2 people own this');
  expect(document.body.textContent).toContain(
    '5h 30m combined household playtime'
  );
  expect(document.body.textContent).toContain('Alex: Completed');
  expect(document.body.textContent).toContain('Sam: Playing');
  expect(document.body.textContent).not.toContain('Stardew Valley');
});

it('links the Steam account under a subpath and only offers requests to permitted users', async () => {
  state.steamStatus = {
    connected: false,
    lastSyncedAt: null,
    lastSyncCount: 0,
    apiKeyConfigured: true,
  };
  state.canRequest = false;

  await render();

  expect(
    document.querySelector('a[href="/seerr/api/v1/game-library/steam/connect"]')
  ).not.toBeNull();
  expect(document.body.textContent).not.toContain('Request this game');
});
