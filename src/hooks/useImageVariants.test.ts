import CachedImage from '@app/components/Common/CachedImage';
import { loadedImages } from '@app/utils/loadedImages';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { act, createElement, type SyntheticEvent } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import useImageVariants from './useImageVariants';

let dom: JSDOM;
let root: Root | undefined;
let nextFamily = 0;
let family: string;
let downloads: UpgradeImage[];
let dimensions: Map<string, { width: number; height: number }>;
let box: { top: number; left: number; width: number; height: number };
let observers: (() => void)[];
let disconnected: number;
let dprListeners: Set<() => void>;

class UpgradeImage {
  src = '';
  decoding = '';
  naturalWidth = 780;
  naturalHeight = 1170;
  onload: (() => Promise<void>) | null = null;
  onerror: (() => void) | null = null;
  decode: () => Promise<void> = async () => undefined;
  constructor() {
    downloads.push(this);
  }
}

const variantsFor = (id: string) =>
  [342, 500, 780].map((width) => ({ src: `/${id}/w${width}`, width }));
const Probe = ({
  id = family,
  enabled = true,
  singleSource = false,
}: {
  id?: string;
  enabled?: boolean;
  singleSource?: boolean;
}) => {
  const variant = useImageVariants(
    `/${id}/w342`,
    singleSource ? undefined : variantsFor(id),
    enabled
  );
  return createElement('img', {
    src: variant.src,
    ref: variant.ref,
    loading: 'lazy',
    alt: 'Poster',
    style: { objectFit: 'cover' },
    onLoad: (event: SyntheticEvent<HTMLImageElement>) =>
      variant.onLoad(event.currentTarget),
  });
};
const imageSrc = () =>
  dom.window.document.querySelector('img')?.getAttribute('src');
const record = (width: number, id = family) => {
  const src = `/${id}/w${width}`;
  const size = { width, height: width * 1.5 };
  dimensions.set(src, size);
  loadedImages.record(src, size.width, size.height);
};
const render = async (id = family) => {
  root ??= createRoot(dom.window.document.getElementById('root')!);
  await act(async () => root?.render(createElement(Probe, { id })));
};
const resize = async (width: number, dpr = dom.window.devicePixelRatio) => {
  box.width = width;
  box.height = width * 1.5;
  Object.defineProperty(dom.window, 'devicePixelRatio', {
    value: dpr,
    configurable: true,
  });
  await act(async () => {
    dom.window.dispatchEvent(new dom.window.Event('resize'));
  });
};
const finishUpgrade = async (index = 0) => {
  const download = downloads[index];
  const width = Number(download.src.split('/w')[1]);
  download.naturalWidth = width;
  download.naturalHeight = width * 1.5;
  dimensions.set(download.src, { width, height: width * 1.5 });
  await act(async () => download.onload?.());
};

beforeEach(() => {
  family = `artwork-${nextFamily++}`;
  downloads = [];
  dimensions = new Map();
  observers = [];
  disconnected = 0;
  dprListeners = new Set();
  box = { top: 0, left: 0, width: 128, height: 192 };
  dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  Object.defineProperty(globalThis, 'window', {
    value: dom.window,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'document', {
    value: dom.window.document,
    configurable: true,
  });
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(dom.window, 'devicePixelRatio', {
    value: 2,
    configurable: true,
  });
  dom.window.Image = UpgradeImage as unknown as typeof Image;
  const Observer = class {
    constructor(callback: () => void) {
      observers.push(callback);
    }
    observe() {}
    disconnect() {
      disconnected++;
    }
  };
  dom.window.ResizeObserver = Observer as unknown as typeof ResizeObserver;
  dom.window.IntersectionObserver =
    Observer as unknown as typeof IntersectionObserver;
  dom.window.matchMedia = () =>
    ({
      addEventListener: (_: string, listener: () => void) =>
        dprListeners.add(listener),
      removeEventListener: (_: string, listener: () => void) =>
        dprListeners.delete(listener),
    }) as unknown as MediaQueryList;
  const prototype = dom.window.HTMLImageElement.prototype;
  const getDimensions = (image: HTMLImageElement) => {
    const url = new URL(image.src);
    return (
      dimensions.get(image.getAttribute('src')!) ??
      dimensions.get(url.pathname + url.search)
    );
  };
  Object.defineProperties(prototype, {
    naturalWidth: {
      get() {
        return getDimensions(this)?.width ?? 0;
      },
      configurable: true,
    },
    naturalHeight: {
      get() {
        return getDimensions(this)?.height ?? 0;
      },
      configurable: true,
    },
    clientWidth: {
      get() {
        return box.width;
      },
      configurable: true,
    },
    clientHeight: {
      get() {
        return box.height;
      },
      configurable: true,
    },
    complete: {
      get() {
        return !!getDimensions(this);
      },
      configurable: true,
    },
  });
  prototype.getBoundingClientRect = () => ({
    ...box,
    x: box.left,
    y: box.top,
    right: box.left + box.width,
    bottom: box.top + box.height,
    toJSON: () => undefined,
  });
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  // Settle any intentionally abandoned upgrade; production requests are shared
  // across mounts and continue until their own bounded timeout.
  for (const download of downloads) download.onerror?.();
  await Promise.resolve();
  dom.window.close();
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'document');
});

describe('progressive artwork lifecycle', () => {
  it('keeps a loaded 342px thumbnail at 128 CSS pixels and DPR 2', async () => {
    record(342);
    await render();
    assert.equal(imageSrc(), `/${family}/w342`);
    assert.equal(downloads.length, 0);
  });

  it('keeps the thumbnail visible until the single sufficient upgrade decodes', async () => {
    record(342);
    box.width = 208;
    box.height = 312;
    Object.defineProperty(dom.window, 'devicePixelRatio', {
      value: 3,
      configurable: true,
    });
    await render();
    assert.equal(imageSrc(), `/${family}/w342`);
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].src, `/${family}/w780`);
    let finishDecode: (() => void) | undefined;
    downloads[0].decode = () =>
      new Promise((resolve) => {
        finishDecode = resolve;
      });
    const loading = downloads[0].onload?.();
    await act(async () => Promise.resolve());
    assert.equal(imageSrc(), `/${family}/w342`);
    await act(async () => {
      finishDecode?.();
      await loading;
    });
    assert.equal(imageSrc(), `/${family}/w780`);
    await resize(80, 1);
    assert.equal(imageSrc(), `/${family}/w780`);
    assert.equal(downloads.length, 1);
  });

  it('reuses an already loaded larger variant on the first client render', async () => {
    record(780);
    await render();
    assert.equal(imageSrc(), `/${family}/w780`);
    assert.equal(downloads.length, 0);
  });

  it('keeps cold SSR and hydration deterministic and waits for the base image', async () => {
    const serverHtml = renderToString(createElement(Probe));
    assert.match(serverHtml, new RegExp(`src="/${family}/w342"`));
    dom.window.document.getElementById('root')!.innerHTML = serverHtml;
    const errors: unknown[] = [];
    await act(async () => {
      root = hydrateRoot(
        dom.window.document.getElementById('root')!,
        createElement(Probe),
        { onRecoverableError: (error) => errors.push(error) }
      );
    });
    await resize(208, 3);
    assert.equal(downloads.length, 0);
    dimensions.set(`/${family}/w342`, { width: 342, height: 513 });
    await act(async () =>
      dom.window.document
        .querySelector('img')!
        .dispatchEvent(new dom.window.Event('load'))
    );
    assert.equal(downloads.length, 1);
    assert.equal(imageSrc(), `/${family}/w342`);
    assert.deepEqual(errors, []);
    await finishUpgrade();
  });

  it('hydrates the base without mismatching even when a larger variant is already known', async () => {
    record(342);
    record(780);
    const serverHtml = renderToString(createElement(Probe));
    assert.match(serverHtml, new RegExp(`src="/${family}/w342"`));
    dom.window.document.getElementById('root')!.innerHTML = serverHtml;
    const errors: unknown[] = [];
    await act(async () => {
      root = hydrateRoot(
        dom.window.document.getElementById('root')!,
        createElement(Probe),
        { onRecoverableError: (error) => errors.push(error) }
      );
    });
    assert.deepEqual(errors, []);
    assert.equal(imageSrc(), `/${family}/w780`);
    assert.equal(downloads.length, 0);
  });

  it('deduplicates concurrent consumers and ignores inline array recreation', async () => {
    record(342);
    box.width = 208;
    box.height = 312;
    root = createRoot(dom.window.document.getElementById('root')!);
    const content = () =>
      createElement('div', {}, createElement(Probe), createElement(Probe));
    await act(async () => root?.render(content()));
    await act(async () => root?.render(content()));
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].src, `/${family}/w500`);
    await finishUpgrade();
    assert.deepEqual(
      Array.from(dom.window.document.querySelectorAll('img')).map((image) =>
        image.getAttribute('src')
      ),
      [`/${family}/w500`, `/${family}/w500`]
    );
  });

  it('retains the thumbnail on upgrade failure without a resize retry storm', async () => {
    record(342);
    await render();
    await resize(208, 3);
    await act(async () => downloads[0].onerror?.());
    await resize(209, 3);
    await resize(208, 3);
    assert.equal(downloads.length, 1);
    assert.equal(imageSrc(), `/${family}/w342`);
  });

  it('ignores completion for replaced artwork', async () => {
    record(342);
    await render();
    await resize(208, 3);
    const next = `${family}-edition-2`;
    record(342, next);
    await resize(128, 2);
    await render(next);
    assert.equal(imageSrc(), `/${next}/w342`);
    await finishUpgrade();
    assert.equal(imageSrc(), `/${next}/w342`);
  });

  it('does not upgrade offscreen images until the intersection changes', async () => {
    record(342);
    box.top = 4000;
    box.width = 208;
    box.height = 312;
    await render();
    assert.equal(downloads.length, 0);
    assert.equal(
      dom.window.document.querySelector('img')?.getAttribute('loading'),
      'lazy'
    );
    box.top = 0;
    await act(async () => {
      for (const observer of observers) observer();
    });
    assert.equal(downloads.length, 1);
    await finishUpgrade();
  });

  it('does not upgrade a sufficient poster solely because of a hover transform', async () => {
    record(342);
    dom.window.HTMLImageElement.prototype.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 256,
      bottom: 384,
      width: 256,
      height: 384,
      toJSON: () => undefined,
    });
    await render();
    assert.equal(downloads.length, 0);
    assert.equal(imageSrc(), `/${family}/w342`);
  });

  it('registers single-source artwork without allocating upgrade observers', async () => {
    dimensions.set(`/${family}/w342`, { width: 342, height: 513 });
    root = createRoot(dom.window.document.getElementById('root')!);
    await act(async () =>
      root?.render(createElement(Probe, { singleSource: true }))
    );
    assert.equal(loadedImages.get(`/${family}/w342`)?.width, 342);
    assert.equal(observers.length, 0);
    assert.equal(dprListeners.size, 0);
    await resize(800, 4);
    assert.equal(downloads.length, 0);
  });

  it('responds to DPR and box changes and removes observers on unmount', async () => {
    record(342);
    await render();
    Object.defineProperty(dom.window, 'devicePixelRatio', {
      value: 4,
      configurable: true,
    });
    await act(async () => {
      for (const listener of [...dprListeners]) listener();
    });
    assert.equal(downloads[0].src, `/${family}/w780`);
    await finishUpgrade();
    await act(async () => root?.unmount());
    root = undefined;
    assert.ok(disconnected >= 2);
    assert.equal(dprListeners.size, 0);
  });
});

describe('CachedImage integration', () => {
  const providerUrl = (id: string, width: number) =>
    `https://image.tmdb.org/t/p/w${width}/${id}.jpg`;
  const proxyUrl = (id: string, width: number) =>
    `/imageproxy/tmdb/t/p/w${width}/${id}.jpg`;

  it('resolves and reuses previously loaded provider variants through Next Image', async () => {
    const src = proxyUrl(family, 780);
    dimensions.set(src, { width: 780, height: 1170 });
    loadedImages.record(src, 780, 1170);
    let loaded = 0;
    root = createRoot(dom.window.document.getElementById('root')!);
    await act(async () =>
      root?.render(
        createElement(CachedImage, {
          src: providerUrl(family, 342),
          type: 'tmdb',
          width: 128,
          height: 192,
          alt: 'Poster',
          variants: [342, 500, 780].map((width) => ({
            src: providerUrl(family, width),
            width,
          })),
          onLoad: () => {
            loaded++;
          },
        })
      )
    );
    assert.equal(imageSrc(), new URL(src, dom.window.location.href).href);
    assert.equal(loadedImages.get(src)?.width, 780);
    assert.equal(
      dom.window.document.querySelector('img')?.getAttribute('loading'),
      'lazy'
    );
    assert.equal(downloads.length, 0);
    assert.equal(loaded, 1);
  });

  it('registers a card by its declared proxy URL despite Next normalizing the DOM URL', async () => {
    const src = proxyUrl(family, 342);
    dimensions.set(src, { width: 342, height: 513 });
    root = createRoot(dom.window.document.getElementById('root')!);
    const props = {
      src: providerUrl(family, 342),
      type: 'tmdb' as const,
      width: 128,
      height: 192,
      alt: 'Poster',
    };
    await act(async () => root?.render(createElement(CachedImage, props)));
    assert.equal(loadedImages.get(src)?.width, 342);
    await act(async () =>
      root?.render(
        createElement(CachedImage, {
          ...props,
          variants: [342, 500, 780].map((width) => ({
            src: providerUrl(family, width),
            width,
          })),
        })
      )
    );
    assert.equal(imageSrc(), new URL(src, dom.window.location.href).href);
    assert.equal(downloads.length, 0);
  });

  it('falls back if a remembered larger image was evicted and now fails to load', async () => {
    const base = proxyUrl(family, 342);
    const large = proxyUrl(family, 780);
    dimensions.set(base, { width: 342, height: 513 });
    loadedImages.record(base, 342, 513);
    // Only metadata remains for the larger artwork, not browser image bytes.
    loadedImages.record(large, 780, 1170);
    let failures = 0;
    root = createRoot(dom.window.document.getElementById('root')!);
    await act(async () =>
      root?.render(
        createElement(CachedImage, {
          src: providerUrl(family, 342),
          type: 'tmdb',
          width: 128,
          height: 192,
          alt: 'Poster',
          variants: [342, 500, 780].map((width) => ({
            src: providerUrl(family, width),
            width,
          })),
          onError: () => {
            failures++;
          },
        })
      )
    );
    assert.equal(imageSrc(), new URL(large, dom.window.location.href).href);
    await act(async () =>
      dom.window.document
        .querySelector('img')!
        .dispatchEvent(new dom.window.Event('error'))
    );
    assert.equal(
      dom.window.document.querySelector('img')?.src,
      new URL(base, dom.window.location.href).href
    );
    assert.equal(loadedImages.get(large), undefined);
    assert.equal(loadedImages.isCoolingDown(large), true);
    assert.equal(failures, 1);
    await resize(208, 3);
    assert.equal(downloads.length, 0);
    assert.equal(
      dom.window.document.querySelector('img')?.src,
      new URL(base, dom.window.location.href).href
    );
  });

  it('only emits the deterministic base URL for a cold priority poster', () => {
    const html = renderToString(
      createElement(CachedImage, {
        src: providerUrl(family, 342),
        type: 'tmdb',
        width: 208,
        height: 312,
        alt: 'Poster',
        priority: true,
        variants: [342, 500, 780].map((width) => ({
          src: providerUrl(family, width),
          width,
        })),
      })
    );
    assert.ok(html.includes(proxyUrl(family, 342)));
    assert.ok(!html.includes(proxyUrl(family, 500)));
    assert.ok(!html.includes(proxyUrl(family, 780)));
    assert.equal(downloads.length, 0);
  });

  it('keeps avatar placeholders and their failure behavior', async () => {
    root = createRoot(dom.window.document.getElementById('root')!);
    await act(async () =>
      root?.render(
        createElement(CachedImage, {
          src: 'https://plex.tv/users/avatar',
          type: 'avatar',
          width: 40,
          height: 40,
          alt: 'Avatar',
        })
      )
    );
    assert.ok(dom.window.document.querySelector('svg'));
    assert.equal(imageSrc(), undefined);
    assert.equal(downloads.length, 1);
    await act(async () => downloads[0].onerror?.());
    assert.ok(dom.window.document.querySelector('svg'));
    assert.equal(downloads.length, 1);
  });
});
