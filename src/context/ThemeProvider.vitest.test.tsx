import type { User } from '@app/hooks/useUser';
import { THEME_PALETTE_IDS } from '@server/utils/themePreference';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ThemeProvider, themePalettes, useTheme } from './ThemeContext';

const fixture = vi.hoisted(() => ({
  user: undefined as User | undefined,
  post: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock('@app/hooks/useUser', () => ({
  useUser: () => ({ user: fixture.user, revalidate: fixture.revalidate }),
}));
vi.mock('axios', () => ({ default: { post: fixture.post } }));

let root: Root;
let dom: JSDOM;
let container: HTMLDivElement;
let theme: ReturnType<typeof useTheme>;
const Probe = () => {
  theme = useTheme();
  return <span data-palette={theme.palette} />;
};
const render = () =>
  root.render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>
  );
const account = (id: number, palette?: string): User =>
  ({
    id,
    settings: { notificationTypes: {}, themePalette: palette },
  }) as User;

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost',
  });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('localStorage', dom.window.localStorage);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fixture.user = undefined;
  fixture.post.mockReset();
  fixture.revalidate.mockReset();
  fixture.revalidate.mockImplementation(async (callback) => {
    fixture.user = callback(fixture.user);
    return fixture.user;
  });
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  dom.window.close();
  vi.unstubAllGlobals();
});

test('all offered themes share the server allowlist', () => {
  expect(themePalettes.map((p) => p.id)).toEqual([...THEME_PALETTE_IDS]);
});

test('new installs and migrated logins ignore legacy browser palettes and use SeerrNG', async () => {
  localStorage.setItem('seerr-theme-palette', 'classic');
  localStorage.setItem('seerr-theme-mode', 'light');
  await act(async () => render());
  expect(theme.palette).toBe('seerr');
  expect(theme.mode).toBe('light');
  fixture.user = account(1);
  await act(async () => render());
  expect(theme.palette).toBe('seerr');
  expect(document.documentElement.dataset.themePalette).toBe('seerr');
  expect(fixture.post).not.toHaveBeenCalled();
});

test('later logins restore the account choice instead of resetting it or sharing another user choice', async () => {
  localStorage.setItem('seerr-theme-palette', 'classic');
  fixture.user = account(1, 'aurora');
  await act(async () => render());
  expect(theme.palette).toBe('aurora');
  fixture.user = account(2, 'seerr');
  await act(async () => render());
  expect(theme.palette).toBe('seerr');
  fixture.user = account(1, 'aurora');
  await act(async () => render());
  expect(theme.palette).toBe('aurora');
});

test('a logged-in choice is applied only after confirmation and stored in the account cache', async () => {
  fixture.user = account(1, 'seerr');
  await act(async () => render());
  let confirm!: (value: unknown) => void;
  fixture.post.mockImplementation(
    () =>
      new Promise((resolve) => {
        confirm = resolve;
      })
  );
  let save!: Promise<void>;
  await act(async () => {
    save = theme.setPalette('classic');
  });
  expect(theme.palette).toBe('seerr');
  expect(fixture.post).toHaveBeenCalledWith('/api/v1/user/1/settings/theme', {
    palette: 'classic',
  });
  await expect(theme.setPalette('aurora')).rejects.toThrow();
  expect(fixture.post).toHaveBeenCalledTimes(1);
  await act(async () => {
    confirm({ data: { themePalette: 'classic' } });
    await save;
  });
  expect(theme.palette).toBe('classic');
  expect(fixture.user?.settings?.themePalette).toBe('classic');
  expect(localStorage.getItem('seerr-theme-palette')).toBe('classic');
});

test('failed saves preserve the current theme and guest changes are not accepted', async () => {
  await act(async () => render());
  await expect(theme.setPalette('classic')).rejects.toThrow();
  expect(fixture.post).not.toHaveBeenCalled();
  fixture.user = account(1, 'seerr');
  await act(async () => render());
  fixture.post.mockRejectedValue(new Error('save failed'));
  await act(async () => {
    await expect(theme.setPalette('classic')).rejects.toThrow('save failed');
  });
  expect(theme.palette).toBe('seerr');
  expect(fixture.user?.settings?.themePalette).toBe('seerr');
});

test('a delayed save response cannot change the theme after switching accounts', async () => {
  fixture.user = account(1, 'seerr');
  await act(async () => render());
  let confirm!: (value: unknown) => void;
  fixture.post.mockImplementation(
    () =>
      new Promise((resolve) => {
        confirm = resolve;
      })
  );
  const save = theme.setPalette('classic');
  fixture.user = account(2, 'aurora');
  await act(async () => render());
  await act(async () => {
    confirm({ data: { themePalette: 'classic' } });
    await save;
  });
  expect(theme.palette).toBe('aurora');
  expect(fixture.revalidate).not.toHaveBeenCalled();
});
