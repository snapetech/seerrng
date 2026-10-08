import { MediaStatus } from '@server/constants/media';
import type { SeasonEpisodeSelection } from '@server/interfaces/api/seasonInterfaces';
import axios from 'axios';
import { JSDOM } from 'jsdom';
import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import type * as ReactIntl from 'react-intl';
import { afterEach, expect, it, vi } from 'vitest';
import TvRequestModal from './TvRequestModal';

const fixtureState = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  quota: { tv: { limit: 0, remaining: 10 } },
  catalog: undefined as unknown,
  partialRequestsEnabled: true,
  requestPermission: false,
  linkedPlexAccount: false,
  sonarrServers: [] as unknown[],
  ready: true,
  mutate: vi.fn(),
  addToast: vi.fn(),
}));
vi.mock('axios', () => ({
  default: { post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock('swr', () => ({
  default: (key: string | null) => ({
    data: key?.startsWith('/api/v1/tv/')
      ? fixtureState.data
      : key?.endsWith('/quota')
        ? fixtureState.quota
        : key === '/api/v1/service/sonarr'
          ? fixtureState.sonarrServers
          : undefined,
  }),
  mutate: fixtureState.mutate,
}));
vi.mock('@app/hooks/useSettings', () => ({
  default: () => ({
    currentSettings: {
      partialRequestsEnabled: fixtureState.partialRequestsEnabled,
      enableSpecialEpisodes: false,
      mediaServerType: 1,
    },
  }),
}));
vi.mock('@app/hooks/useUser', () => ({
  useUser: () => ({
    user: {
      id: 7,
      permissions: 0,
      ...(fixtureState.linkedPlexAccount ? { plexId: 101 } : {}),
    },
    hasPermission: () => fixtureState.requestPermission,
  }),
}));
vi.mock('@app/hooks/usePlaybackCatalog', () => ({
  default: () => ({ data: fixtureState.catalog }),
}));
vi.mock('@app/hooks/useToasts', () => ({
  default: () => ({ addToast: fixtureState.addToast }),
}));
vi.mock('@app/hooks/useAdvancedOptionsDisclosure', () => ({
  default: () => ({
    open: false,
    pinned: false,
    toggleOpen: vi.fn(),
    togglePin: vi.fn(),
  }),
}));
vi.mock('react-intl', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactIntl>()),
  useIntl: () => ({
    formatMessage: (
      { defaultMessage }: { defaultMessage: string },
      values?: Record<string, unknown>
    ) =>
      defaultMessage.replace(/\{([^}]+)\}/g, (placeholder, key) =>
        values?.[key] === undefined ? placeholder : String(values[key])
      ),
    formatDate: () => 'Fixture Date',
    formatNumber: String,
  }),
}));
vi.mock('@app/components/Common/Modal', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('@app/components/Common/CachedImage', () => ({
  default: () => null,
}));
vi.mock('@app/components/Common/Button', () => ({
  default: ({
    children,
    onClick,
    disabled,
    type,
    'data-testid': testId,
    as,
    href,
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    'data-testid'?: string;
    as?: 'a' | 'button';
    href?: string;
  }) =>
    as === 'a' ? (
      <a href={href} data-testid={testId}>
        {children}
      </a>
    ) : (
      <button
        type={type}
        onClick={onClick}
        disabled={disabled}
        data-testid={testId}
      >
        {children}
      </button>
    ),
}));
vi.mock('@app/components/RequestModal/RequestMediaCard', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('@app/components/RequestModal/RequestFooterStatus', () => ({
  default: () => null,
}));
vi.mock('@app/components/RequestModal/QuotaDisplay', () => ({
  default: () => null,
}));
vi.mock('@app/components/RequestModal/AdvancedRequester', () => ({
  default: () => null,
  RequestListboxControl: ({
    id,
    label,
    value,
    options,
    onChange,
    disabled,
  }: {
    id: string;
    label: React.ReactNode;
    value: number;
    options: { value: number; label: string }[];
    onChange: (value: number) => void;
    disabled?: boolean;
  }) => (
    <label>
      {label}
      <select
        data-testid={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  ),
}));
vi.mock('@app/components/RequestModal/AdvancedOptionsDisclosureButton', () => ({
  default: () => null,
}));
vi.mock('@app/components/RequestModal/SearchByNameModal', () => ({
  default: () => null,
}));
vi.mock('@app/components/MediaDetails/MediaQualitySelect', () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: 'hd' | '4k') => void;
  }) => (
    <div data-testid="quality" data-value={value}>
      <button
        type="button"
        data-testid="quality-hd"
        onClick={() => onChange('hd')}
      >
        HD
      </button>
      <button
        type="button"
        data-testid="quality-4k"
        onClick={() => onChange('4k')}
      >
        4K
      </button>
    </div>
  ),
}));
// The adapter has independent real-tree interaction tests. This boundary fixture
// drives its public contract while preserving the modal's actual selection,
// availability, quota, quality and request-submission implementation.
vi.mock('@app/components/RequestModal/RequestSeasonEpisodeTree', () => ({
  default: function MockRequestTree({
    selections,
    disabledSeasons,
    disabledEpisodes,
    onReadyChange,
    onSelectionsChange,
    selectionMode,
  }: {
    selections: SeasonEpisodeSelection[];
    disabledSeasons: number[];
    disabledEpisodes: Record<number, number[]>;
    onReadyChange: (ready: boolean) => void;
    onSelectionsChange: (selection: SeasonEpisodeSelection[]) => void;
    selectionMode: 'multiple' | 'single-episode';
  }) {
    useEffect(() => {
      onReadyChange(fixtureState.ready);
    }, [onReadyChange]);
    useEffect(() => {
      if (
        selectionMode === 'single-episode' &&
        (selections.length !== 1 || selections[0]?.episodeNumbers?.length !== 1)
      ) {
        onSelectionsChange([{ seasonNumber: 1, episodeNumbers: [1] }]);
      }
    }, [onSelectionsChange, selectionMode, selections]);
    return (
      <div
        data-testid="tree"
        data-selections={JSON.stringify(selections)}
        data-selection-mode={selectionMode}
        data-disabled-seasons={JSON.stringify(disabledSeasons)}
        data-disabled-episodes={JSON.stringify(disabledEpisodes)}
      >
        <button
          type="button"
          data-testid="tree-ready"
          onClick={() => onReadyChange(true)}
        >
          Ready
        </button>
        <button
          type="button"
          data-testid="tree-season"
          onClick={() => onSelectionsChange([{ seasonNumber: 2 }])}
        >
          Season
        </button>
        <button
          type="button"
          data-testid="tree-episode"
          onClick={() =>
            onSelectionsChange([{ seasonNumber: 2, episodeNumbers: [1, 3] }])
          }
        >
          Episodes
        </button>
        <button
          type="button"
          data-testid="tree-start-episode-2"
          onClick={() =>
            onSelectionsChange([{ seasonNumber: 2, episodeNumbers: [2] }])
          }
        >
          Start Episode 2
        </button>
        <button
          type="button"
          data-testid="tree-both"
          onClick={() =>
            onSelectionsChange([{ seasonNumber: 1 }, { seasonNumber: 2 }])
          }
        >
          Both
        </button>
        <button
          type="button"
          data-testid="tree-clear"
          onClick={() => onSelectionsChange([])}
        >
          Clear
        </button>
      </div>
    );
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

type ModalProps = Parameters<typeof TvRequestModal>[0];
async function fixture(
  run: (doc: Document, complete: ReturnType<typeof vi.fn>) => Promise<void>,
  options: {
    props?: Partial<ModalProps>;
    configure?: () => void;
  } = {}
) {
  fixtureState.data = {
    id: 123,
    name: 'Fixture Series',
    externalIds: { tvdbId: 456 },
    keywords: [],
    createdBy: [],
    credits: { crew: [] },
    networks: [],
    productionCompanies: [],
    genres: [],
    episodeRunTime: [],
    seasons: [
      { id: 9001, seasonNumber: 1, episodeCount: 3 },
      { id: 9002, seasonNumber: 2, episodeCount: 3 },
    ],
    mediaInfo: {
      id: 321,
      status: MediaStatus.UNKNOWN,
      status4k: MediaStatus.UNKNOWN,
      requests: [],
      seasons: [],
    },
  };
  fixtureState.quota = { tv: { limit: 0, remaining: 10 } };
  fixtureState.catalog = undefined;
  fixtureState.partialRequestsEnabled = true;
  fixtureState.requestPermission = false;
  fixtureState.linkedPlexAccount = false;
  fixtureState.sonarrServers = [];
  fixtureState.ready = true;
  options.configure?.();
  vi.mocked(axios.post).mockResolvedValue({
    data: {
      media: { status: MediaStatus.PENDING, status4k: MediaStatus.PENDING },
    },
  });
  vi.mocked(axios.put).mockResolvedValue({ data: {} });
  vi.mocked(axios.delete).mockResolvedValue({ data: {} });
  const dom = new JSDOM('<div id="root"></div>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('React', React);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const complete = vi.fn();
  const root = createRoot(document.getElementById('root')!);
  try {
    await act(async () =>
      root.render(
        <TvRequestModal tmdbId={123} onComplete={complete} {...options.props} />
      )
    );
    await run(document, complete);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
}

function button(doc: Document, id: string) {
  return doc.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;
}
function selections(doc: Document) {
  return JSON.parse(
    doc.querySelector('[data-testid="tree"]')!.getAttribute('data-selections')!
  );
}
async function click(doc: Document, id: string) {
  await act(async () => button(doc, id).click());
}
async function selectValue(doc: Document, id: string, value: string) {
  const control = doc.querySelector<HTMLSelectElement>(
    `[data-testid="${id}"]`
  )!;
  await act(async () => {
    control.value = value;
    control.dispatchEvent(
      new doc.defaultView!.Event('change', { bubbles: true })
    );
  });
}

it('default whole-season selection reaches the actual Request handler and completion callback', async () => {
  await fixture(async (doc, complete) => {
    expect(selections(doc)).toEqual([{ seasonNumber: 1 }, { seasonNumber: 2 }]);
    expect(button(doc, 'modal-ok-button').disabled).toBe(false);
    await click(doc, 'modal-ok-button');
    expect(axios.post).toHaveBeenCalledExactlyOnceWith(
      '/api/v1/request',
      expect.objectContaining({
        mediaId: 123,
        tvdbId: 456,
        mediaType: 'tv',
        is4k: false,
        seasons: [1, 2],
        seasonRequests: [{ seasonNumber: 1 }, { seasonNumber: 2 }],
        watchAheadEpisodeCount: 0,
      })
    );
    expect(complete).toHaveBeenCalledExactlyOnceWith(
      MediaStatus.PENDING,
      false
    );
  });
});

it('individual season selection preserves the existing whole-season request shape', async () => {
  await fixture(async (doc) => {
    await click(doc, 'tree-season');
    await click(doc, 'modal-ok-button');
    expect(axios.post).toHaveBeenCalledExactlyOnceWith(
      '/api/v1/request',
      expect.objectContaining({
        seasons: [2],
        seasonRequests: [{ seasonNumber: 2 }],
      })
    );
  });
});

it('episode selection submits episode numbers and strips already-available episodes', async () => {
  await fixture(
    async (doc) => {
      expect(
        JSON.parse(
          doc
            .querySelector('[data-testid="tree"]')!
            .getAttribute('data-disabled-episodes')!
        )
      ).toEqual({ 2: [1] });
      await click(doc, 'tree-episode');
      expect(selections(doc)).toEqual([
        { seasonNumber: 2, episodeNumbers: [3] },
      ]);
      await click(doc, 'modal-ok-button');
      expect(axios.post).toHaveBeenCalledExactlyOnceWith(
        '/api/v1/request',
        expect.objectContaining({
          seasons: [2],
          seasonRequests: [{ seasonNumber: 2, episodeNumbers: [3] }],
        })
      );
    },
    {
      configure: () => {
        fixtureState.catalog = {
          groups: [{ index: 2, items: [{ id: 'native-901', index: 1 }] }],
        };
      },
    }
  );
});

it('metadata readiness gates submission, and clearing the selection disables a new request', async () => {
  await fixture(
    async (doc) => {
      expect(button(doc, 'modal-ok-button').disabled).toBe(true);
      await click(doc, 'modal-ok-button');
      expect(axios.post).not.toHaveBeenCalled();
      await click(doc, 'tree-ready');
      expect(button(doc, 'modal-ok-button').disabled).toBe(false);
      await click(doc, 'tree-clear');
      expect(selections(doc)).toEqual([]);
      expect(button(doc, 'modal-ok-button').disabled).toBe(true);
      await click(doc, 'modal-ok-button');
      expect(axios.post).not.toHaveBeenCalled();
    },
    {
      configure: () => {
        fixtureState.ready = false;
      },
    }
  );
});

it('changing quality recomputes eligibility and submits the selected 4K destination', async () => {
  await fixture(
    async (doc, complete) => {
      expect(button(doc, 'modal-ok-button').disabled).toBe(true);
      await click(doc, 'quality-4k');
      expect(
        doc.querySelector('[data-testid="quality"]')!.getAttribute('data-value')
      ).toBe('4k');
      expect(button(doc, 'modal-ok-button').disabled).toBe(false);
      expect(selections(doc)).toEqual([
        { seasonNumber: 1 },
        { seasonNumber: 2 },
      ]);
      await click(doc, 'modal-ok-button');
      expect(axios.post).toHaveBeenCalledExactlyOnceWith(
        '/api/v1/request',
        expect.objectContaining({ is4k: true, seasons: [1, 2] })
      );
      expect(complete).toHaveBeenCalledExactlyOnceWith(
        MediaStatus.PENDING,
        true
      );
    },
    {
      configure: () => {
        (fixtureState.data.mediaInfo as Record<string, unknown>).status =
          MediaStatus.AVAILABLE;
      },
    }
  );
});

it('quota blocks an oversized default and refuses a later expansion beyond the remaining seasons', async () => {
  await fixture(
    async (doc) => {
      expect(button(doc, 'modal-ok-button').disabled).toBe(true);
      await click(doc, 'tree-season');
      expect(button(doc, 'modal-ok-button').disabled).toBe(false);
      await click(doc, 'tree-both');
      expect(selections(doc)).toEqual([{ seasonNumber: 2 }]);
      await click(doc, 'modal-ok-button');
      expect(axios.post).toHaveBeenCalledExactlyOnceWith(
        '/api/v1/request',
        expect.objectContaining({ seasons: [2] })
      );
    },
    {
      configure: () => {
        fixtureState.quota = { tv: { limit: 1, remaining: 1 } };
      },
    }
  );
});

it('clearing an edited request retains Cancel Request and its existing DELETE behavior even before tree readiness', async () => {
  await fixture(
    async (doc, complete) => {
      expect(button(doc, 'modal-ok-button').disabled).toBe(true);
      await click(doc, 'tree-clear');
      expect(button(doc, 'modal-ok-button').disabled).toBe(false);
      expect(button(doc, 'modal-ok-button').textContent).toContain(
        'Cancel Request'
      );
      await click(doc, 'modal-ok-button');
      expect(axios.delete).toHaveBeenCalledExactlyOnceWith(
        '/api/v1/request/88'
      );
      expect(axios.post).not.toHaveBeenCalled();
      expect(axios.put).not.toHaveBeenCalled();
      expect(complete).toHaveBeenCalledExactlyOnceWith(
        MediaStatus.PENDING,
        false
      );
    },
    {
      props: {
        editRequest: {
          id: 88,
          requestedBy: { id: 7, displayName: 'Fixture User' },
          seasons: [{ seasonNumber: 2, episodeNumbers: [3] }],
          media: { tvdbId: 456 },
        } as ModalProps['editRequest'],
      },
      configure: () => {
        fixtureState.ready = false;
      },
    }
  );
});

it('surfaces Episode Queue requirements when the requester has not linked Plex', async () => {
  await fixture(async (doc) => {
    const control = doc.querySelector<HTMLSelectElement>(
      '[data-testid="tv-watch-ahead-count"]'
    );
    expect(control).not.toBeNull();
    expect(control?.disabled).toBe(true);
    expect(doc.body.textContent).toContain('Link your Plex account to SeerrNG');
    expect(
      doc.querySelector('a[href="/profile/settings/linked-accounts"]')
    ).not.toBeNull();
    expect(
      doc.querySelector('a[href*="docs/using-seerr/jellyfin-watch-ahead.md"]')
    ).not.toBeNull();
  });
});

it('starts a new Episode Queue request with one episode and submits the chosen buffer', async () => {
  await fixture(
    async (doc) => {
      await selectValue(doc, 'tv-watch-ahead-count', '3');
      expect(
        doc
          .querySelector('[data-testid="tree"]')
          ?.getAttribute('data-selection-mode')
      ).toBe('single-episode');
      expect(selections(doc)).toEqual([
        { seasonNumber: 1, episodeNumbers: [1] },
      ]);
      await click(doc, 'tree-start-episode-2');
      expect(selections(doc)).toEqual([
        { seasonNumber: 2, episodeNumbers: [2] },
      ]);
      await click(doc, 'modal-ok-button');
      expect(axios.post).toHaveBeenCalledExactlyOnceWith(
        '/api/v1/request',
        expect.objectContaining({
          seasons: [2],
          seasonRequests: [{ seasonNumber: 2, episodeNumbers: [2] }],
          watchAheadEpisodeCount: 3,
        })
      );
    },
    {
      configure: () => {
        fixtureState.requestPermission = true;
        fixtureState.linkedPlexAccount = true;
        fixtureState.sonarrServers = [
          { id: 1, name: 'Sonarr', is4k: false, isDefault: true },
        ];
      },
    }
  );
});

it('restores the normal season selection when Episode Queue is turned off', async () => {
  await fixture(
    async (doc) => {
      await selectValue(doc, 'tv-watch-ahead-count', '2');
      expect(selections(doc)).toEqual([
        { seasonNumber: 1, episodeNumbers: [1] },
      ]);
      await click(doc, 'tree-start-episode-2');
      await selectValue(doc, 'tv-watch-ahead-count', '0');
      expect(
        doc
          .querySelector('[data-testid="tree"]')
          ?.getAttribute('data-selection-mode')
      ).toBe('multiple');
      expect(selections(doc)).toEqual([
        { seasonNumber: 1 },
        { seasonNumber: 2 },
      ]);
      await click(doc, 'modal-ok-button');
      expect(axios.post).toHaveBeenCalledExactlyOnceWith(
        '/api/v1/request',
        expect.objectContaining({
          seasons: [1, 2],
          seasonRequests: [{ seasonNumber: 1 }, { seasonNumber: 2 }],
          watchAheadEpisodeCount: 0,
        })
      );
    },
    {
      configure: () => {
        fixtureState.requestPermission = true;
        fixtureState.linkedPlexAccount = true;
        fixtureState.sonarrServers = [
          { id: 1, name: 'Sonarr', is4k: false, isDefault: true },
        ];
      },
    }
  );
});

it('restores full-season requests when Episode Queue is off and partial selection is disabled', async () => {
  await fixture(
    async (doc) => {
      expect(doc.querySelector('[data-testid="tree"]')).toBeNull();
      await selectValue(doc, 'tv-watch-ahead-count', '1');
      expect(
        doc
          .querySelector('[data-testid="tree"]')
          ?.getAttribute('data-selection-mode')
      ).toBe('single-episode');
      expect(selections(doc)).toEqual([
        { seasonNumber: 1, episodeNumbers: [1] },
      ]);
      await selectValue(doc, 'tv-watch-ahead-count', '0');
      expect(doc.querySelector('[data-testid="tree"]')).toBeNull();
      await click(doc, 'modal-ok-button');
      expect(axios.post).toHaveBeenCalledExactlyOnceWith(
        '/api/v1/request',
        expect.objectContaining({
          seasons: [1, 2],
          seasonRequests: undefined,
          watchAheadEpisodeCount: 0,
        })
      );
    },
    {
      configure: () => {
        fixtureState.partialRequestsEnabled = false;
        fixtureState.requestPermission = true;
        fixtureState.linkedPlexAccount = true;
        fixtureState.sonarrServers = [
          { id: 1, name: 'Sonarr', is4k: false, isDefault: true },
        ];
      },
    }
  );
});

it('keeps an existing request selection when its owner enables Episode Queue', async () => {
  await fixture(
    async (doc) => {
      expect(selections(doc)).toEqual([
        { seasonNumber: 1 },
        { seasonNumber: 2 },
      ]);
      await selectValue(doc, 'tv-watch-ahead-count', '2');
      expect(
        doc
          .querySelector('[data-testid="tree"]')
          ?.getAttribute('data-selection-mode')
      ).toBe('multiple');
      expect(selections(doc)).toEqual([
        { seasonNumber: 1 },
        { seasonNumber: 2 },
      ]);
      await click(doc, 'modal-ok-button');
      expect(axios.put).toHaveBeenCalledExactlyOnceWith(
        '/api/v1/request/88',
        expect.objectContaining({
          seasons: [1, 2],
          seasonRequests: [{ seasonNumber: 1 }, { seasonNumber: 2 }],
          watchAheadEpisodeCount: 2,
        })
      );
      expect(axios.delete).not.toHaveBeenCalled();
    },
    {
      props: {
        editRequest: {
          id: 88,
          requestedBy: { id: 7, displayName: 'Fixture User' },
          seasons: [{ seasonNumber: 1 }, { seasonNumber: 2 }],
          media: { tvdbId: 456 },
          watchAheadEpisodeCount: 0,
        } as ModalProps['editRequest'],
      },
      configure: () => {
        fixtureState.requestPermission = true;
        fixtureState.linkedPlexAccount = true;
        fixtureState.sonarrServers = [
          { id: 1, name: 'Sonarr', is4k: false, isDefault: true },
        ];
      },
    }
  );
});
