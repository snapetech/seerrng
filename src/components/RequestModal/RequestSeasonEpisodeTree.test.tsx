import type { SeasonEpisodeSelection } from '@server/interfaces/api/seasonInterfaces';
import type { SeasonWithEpisodes, TvDetails } from '@server/models/Tv';
import { JSDOM } from 'jsdom';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { IntlProvider } from 'react-intl';
import { afterEach, expect, it, vi } from 'vitest';
import RequestSeasonEpisodeTree from './RequestSeasonEpisodeTree';

const swr = vi.hoisted(() => ({
  data: undefined as SeasonWithEpisodes[] | undefined,
  error: undefined as Error | undefined,
  isValidating: false,
  mutate: vi.fn().mockResolvedValue(undefined),
  get: vi.fn(),
  fetcher: undefined as (() => Promise<SeasonWithEpisodes[]>) | undefined,
  key: undefined as unknown,
}));
vi.mock('swr', () => ({
  default: (key: unknown, fetcher: () => Promise<SeasonWithEpisodes[]>) => {
    swr.key = key;
    swr.fetcher = fetcher;
    return swr;
  },
}));
vi.mock('axios', () => ({ default: { get: swr.get } }));
const seasons = [
  { seasonNumber: 0, episodeCount: 1 },
  { seasonNumber: 1, episodeCount: 2 },
] as TvDetails['seasons'];
const metadata = [
  {
    seasonNumber: 0,
    episodes: [{ id: 0, episodeNumber: 1, name: 'Special', airDate: null }],
  },
  {
    seasonNumber: 1,
    episodes: [
      { id: 11, episodeNumber: 1, name: 'First', airDate: null },
      { id: 12, episodeNumber: 2, name: 'Second', airDate: null },
    ],
  },
] as SeasonWithEpisodes[];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  swr.data = undefined;
  swr.error = undefined;
  swr.isValidating = false;
});

const setup = async (
  initial: SeasonEpisodeSelection[] = [{ seasonNumber: 1 }],
  blocked: Record<number, number[]> = {},
  options: {
    selectionMode?: 'multiple' | 'single-episode';
    visibleSeasons?: TvDetails['seasons'];
  } = {}
) => {
  const dom = new JSDOM('<div id="root"></div>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('React', React);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = createRoot(document.getElementById('root')!);
  const changed = vi.fn();
  const ready = vi.fn();
  const loading = vi.fn();
  const Harness = () => {
    const [selection, setSelection] = useState(initial);
    return (
      <IntlProvider locale="en">
        <RequestSeasonEpisodeTree
          tvId={24}
          seasons={options.visibleSeasons ?? seasons}
          selections={selection}
          disabledEpisodes={blocked}
          availableEpisodesBySeason={{ 1: [2] }}
          selectionMode={options.selectionMode}
          onSelectionsChange={(next) => {
            changed(next);
            setSelection(next);
          }}
          onReadyChange={ready}
          onLoadingChange={loading}
        />
      </IntlProvider>
    );
  };
  const render = async () => {
    await act(async () => root.render(<Harness />));
  };
  await render();
  const button = (label: string) =>
    [...document.querySelectorAll('button')].find(
      (candidate) =>
        candidate.getAttribute('aria-label') === label ||
        candidate.textContent?.trim() === label
    )!;
  const click = async (label: string) => {
    await act(async () => button(label).click());
  };
  const close = async () => {
    await act(async () => root.unmount());
    dom.window.close();
  };
  return { changed, ready, loading, render, button, click, close };
};

it('uses the actual shared tree to change whole-season selection into episode-number payloads and clear/all', async () => {
  swr.data = metadata;
  const ui = await setup();
  try {
    expect(ui.ready).toHaveBeenLastCalledWith(true);
    await ui.click('Expand Season 01');
    await ui.click('Deselect Episode 1: First');
    expect(ui.changed).toHaveBeenLastCalledWith([
      { seasonNumber: 1, episodeNumbers: [2] },
    ]);
    await ui.click('Clear Selection');
    expect(ui.changed).toHaveBeenLastCalledWith([]);
    await ui.click('Select all requestable episodes');
    expect(ui.changed).toHaveBeenLastCalledWith([
      { seasonNumber: 0 },
      { seasonNumber: 1 },
    ]);
  } finally {
    await ui.close();
  }
});

it('keeps unavailable episodes requestable, disables blocked episodes and leaves disclosure independent', async () => {
  swr.data = metadata;
  const ui = await setup([], { 1: [2] });
  try {
    await ui.click('Expand Season 01');
    expect(ui.changed).not.toHaveBeenCalled();
    expect(ui.button('Select Episode 2: Second').disabled).toBe(true);
    expect(ui.button('Select Episode 1: First').disabled).toBe(false);
    await ui.click('Select Episode 1: First');
    expect(ui.changed).toHaveBeenLastCalledWith([{ seasonNumber: 1 }]);
    expect(
      document.querySelector('[aria-label="Not Available"]')
    ).not.toBeNull();
  } finally {
    await ui.close();
  }
});

it('limits Episode Queue selection to one requestable starting episode', async () => {
  swr.data = metadata;
  const ui = await setup(
    [{ seasonNumber: 1 }],
    {},
    {
      selectionMode: 'single-episode',
      visibleSeasons: seasons.filter((season) => season.seasonNumber > 0),
    }
  );
  try {
    expect(ui.changed).toHaveBeenLastCalledWith([
      { seasonNumber: 1, episodeNumbers: [1] },
    ]);
    expect(
      document.querySelector('[data-tree-part="select-all"] button')
    ).toBeNull();
    expect(
      [...document.querySelectorAll('[data-tree-part="season"] button')].some(
        (button) =>
          button.getAttribute('aria-label') ===
          'Select requestable episodes in Season 01'
      )
    ).toBe(false);
    await ui.click('Expand Season 01');
    expect(
      ui.button('Deselect Episode 1: First').getAttribute('aria-pressed')
    ).toBe('true');
    await ui.click('Select Episode 2: Second');
    expect(ui.changed).toHaveBeenLastCalledWith([
      { seasonNumber: 1, episodeNumbers: [2] },
    ]);
  } finally {
    await ui.close();
  }
});

it('starts the queue at the first selectable episode when no current selection remains', async () => {
  swr.data = metadata;
  const ui = await setup(
    [],
    { 1: [1] },
    {
      selectionMode: 'single-episode',
      visibleSeasons: seasons.filter((season) => season.seasonNumber > 0),
    }
  );
  try {
    expect(ui.changed).toHaveBeenLastCalledWith([
      { seasonNumber: 1, episodeNumbers: [2] },
    ]);
  } finally {
    await ui.close();
  }
});

it('does not edit or drop selections with incomplete/loading metadata and reports readiness', async () => {
  swr.data = metadata.slice(0, 1);
  swr.isValidating = true;
  const ui = await setup();
  try {
    expect(ui.ready).toHaveBeenLastCalledWith(false);
    expect(ui.loading).toHaveBeenLastCalledWith(true);
    expect(document.body.textContent).toContain('Loading Episodes');
    await ui.click('Select all requestable episodes');
    expect(ui.changed).not.toHaveBeenCalled();
    swr.data = metadata;
    swr.isValidating = false;
    await ui.render();
    expect(ui.ready).toHaveBeenLastCalledWith(true);
    await ui.click('Expand Season 01');
    expect(
      ui.button('Deselect Episode 1: First').getAttribute('aria-pressed')
    ).toBe('true');
  } finally {
    await ui.close();
  }
  expect(ui.ready).toHaveBeenLastCalledWith(false);
});

it('retries metadata GETs only, preserves cached selected rows on failure and recovers editing', async () => {
  swr.data = metadata;
  swr.error = new Error('Fixture metadata failure');
  const ui = await setup();
  try {
    expect(ui.ready).toHaveBeenLastCalledWith(false);
    await ui.click('Expand Season 01');
    expect(ui.button('Deselect Episode 1: First').disabled).toBe(true);
    expect(
      ui.button('Deselect Episode 1: First').getAttribute('aria-pressed')
    ).toBe('true');
    await ui.click('Retry');
    expect(swr.mutate).toHaveBeenCalledOnce();
    expect(ui.changed).not.toHaveBeenCalled();
    swr.get.mockImplementation(async (path: string) => ({
      data: path.endsWith('/0') ? metadata[0] : metadata[1],
    }));
    expect(await swr.fetcher!()).toEqual(metadata);
    expect(swr.get.mock.calls.map(([path]) => path)).toEqual([
      '/api/v1/tv/24/season/0',
      '/api/v1/tv/24/season/1',
    ]);
    swr.error = undefined;
    await ui.render();
    expect(ui.ready).toHaveBeenLastCalledWith(true);
    expect(ui.button('Deselect Episode 1: First').disabled).toBe(false);
  } finally {
    await ui.close();
  }
});
