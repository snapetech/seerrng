import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { IntlProvider } from 'react-intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LiveTvButton from './LiveTvButton';

const state = vi.hoisted(() => ({
  status: { configured: true, guideReady: true, canRequest: true },
  airings: [] as Record<string, unknown>[],
  post: vi.fn(),
  addToast: vi.fn(),
  push: vi.fn(),
}));

vi.mock('next/router', () => ({
  useRouter: () => ({ push: state.push }),
}));

vi.mock('@app/hooks/useToasts', () => ({
  default: () => ({ addToast: state.addToast }),
}));

vi.mock('axios', () => ({
  default: { post: state.post, isAxiosError: () => false },
}));

vi.mock('swr', () => ({
  default: (key: string | null) => ({
    data:
      key === '/api/v1/live-tv/status'
        ? state.status
        : key?.startsWith('/api/v1/live-tv/airings')
          ? { airings: state.airings }
          : undefined,
    mutate: vi.fn(),
  }),
}));

vi.mock('@app/components/Common/Button', () => ({
  default: ({
    children,
    onClick,
    disabled,
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick} disabled={disabled} type="button">
      {children}
    </button>
  ),
}));

vi.mock('@app/components/Common/Tooltip', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@app/components/Common/Modal', () => ({
  default: ({
    children,
    title,
  }: {
    children: React.ReactNode;
    title: string;
  }) => (
    <div role="dialog" aria-label={title}>
      {children}
    </div>
  ),
}));

let dom: JSDOM;
let root: ReturnType<typeof createRoot>;

const render = async (mediaType: 'movie' | 'tv' = 'movie') =>
  act(async () =>
    root.render(
      <IntlProvider locale="en" timeZone="UTC">
        <LiveTvButton
          titles={['The Matrix', 'The Matrix']}
          mediaType={mediaType}
          tmdbId={603}
        />
      </IntlProvider>
    )
  );

const buttons = (label: string) =>
  [...document.querySelectorAll('button')].filter(
    (button) => button.textContent?.trim() === label
  );

beforeEach(() => {
  dom = new JSDOM('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('React', React);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.getElementById('root')!);
  state.status = { configured: true, guideReady: true, canRequest: true };
  state.airings = [
    {
      channel: '202',
      channelName: 'Movies & More',
      start: '2026-10-06T20:00:00.000Z',
      stop: '2026-10-06T22:00:00.000Z',
      title: 'The Matrix (1999)',
      categories: ['Movie'],
    },
  ];
  state.post.mockReset();
  state.post.mockResolvedValue({ data: { status: 'pending' } });
  state.addToast.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it('renders nothing when Live TV is not set up', async () => {
  state.status = { configured: false, guideReady: false, canRequest: true };
  await render();
  expect(document.getElementById('root')?.innerHTML).toBe('');
});

it('renders nothing when the title is not airing', async () => {
  state.airings = [];
  await render();
  expect(buttons('On Live TV')).toHaveLength(0);
});

it('lists airings and requests the chosen one', async () => {
  await render();
  await act(async () => buttons('On Live TV')[0].click());

  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog?.textContent).toContain('Movies & More (202)');
  expect(buttons('Record Every Airing')).toHaveLength(0);

  await act(async () => buttons('Record')[0].click());
  expect(state.post).toHaveBeenCalledWith('/api/v1/live-tv/recordings', {
    kind: 'airing',
    title: 'The Matrix (1999)',
    channel: '202',
    start: '2026-10-06T20:00:00.000Z',
    mediaType: 'movie',
    tmdbId: 603,
  });
  expect(state.addToast).toHaveBeenCalledWith(
    'Recording requested. It will be scheduled after approval.',
    expect.objectContaining({ appearance: 'success' })
  );
});

it('offers series recording for TV and disables requests without permission', async () => {
  state.status = { configured: true, guideReady: true, canRequest: false };
  await render('tv');
  await act(async () => buttons('On Live TV')[0].click());
  expect(buttons('Record Every Airing')[0].disabled).toBe(true);
  expect(buttons('Record')[0].disabled).toBe(true);
});
