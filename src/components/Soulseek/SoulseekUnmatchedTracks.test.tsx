import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { IntlProvider } from 'react-intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SoulseekUnmatchedTracks from './SoulseekUnmatchedTracks';

const state = vi.hoisted(() => ({
  status: { configured: true, canRequest: true },
  post: vi.fn(),
  addToast: vi.fn(),
}));

vi.mock('@app/hooks/useToasts', () => ({
  default: () => ({ addToast: state.addToast }),
}));

vi.mock('axios', () => ({
  default: { post: state.post, isAxiosError: () => false },
}));

vi.mock('swr', () => ({
  default: () => ({ data: state.status }),
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

let dom: JSDOM;
let root: ReturnType<typeof createRoot>;

const render = (tracks: { title: string; artist?: string }[]) =>
  act(async () =>
    root.render(
      <IntlProvider locale="en">
        <SoulseekUnmatchedTracks tracks={tracks} />
      </IntlProvider>
    )
  );

beforeEach(() => {
  dom = new JSDOM('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('React', React);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.getElementById('root')!);
  state.status = { configured: true, canRequest: true };
  state.post.mockReset();
  state.post.mockResolvedValue({ data: { results: [{}, {}] } });
  state.addToast.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it('renders nothing without slskdN or request permission', async () => {
  state.status = { configured: false, canRequest: true };
  await render([{ title: 'Song', artist: 'Band' }]);
  expect(document.getElementById('root')?.innerHTML).toBe('');

  state.status = { configured: true, canRequest: false };
  await render([{ title: 'Song', artist: 'Band' }]);
  expect(document.getElementById('root')?.innerHTML).toBe('');
});

it('requests only tracks with an artist, once', async () => {
  await render([
    { title: 'Song A', artist: 'Band' },
    { title: 'Song B', artist: 'Band' },
    { title: 'No Artist' },
  ]);
  const button = document.querySelector('button')!;
  expect(button.textContent).toBe('Request 2 Tracks from Soulseek');
  await act(async () => button.click());
  expect(state.post).toHaveBeenCalledWith('/api/v1/soulseek/track-requests', {
    tracks: [
      { artist: 'Band', title: 'Song A', source: 'playlist' },
      { artist: 'Band', title: 'Song B', source: 'playlist' },
    ],
  });
  expect(document.querySelector('button')!.disabled).toBe(true);
  expect(state.addToast).toHaveBeenCalledWith(
    '2 tracks requested from Soulseek.',
    expect.objectContaining({ appearance: 'success' })
  );
});
