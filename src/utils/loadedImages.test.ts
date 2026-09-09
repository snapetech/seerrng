import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  LoadedImageRegistry,
  requiredImageWidth,
  selectImageUpgrade,
} from './loadedImages';

let dom: JSDOM;
let requested: TestImage[];
class TestImage {
  src = '';
  decoding = '';
  naturalWidth = 500;
  naturalHeight = 750;
  onload: (() => Promise<void>) | null = null;
  onerror: (() => void) | null = null;
  decode: () => Promise<void> = async () => undefined;
  constructor() {
    requested.push(this);
  }
}

beforeEach(() => {
  requested = [];
  dom = new JSDOM('');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: dom.window,
  });
  dom.window.Image = TestImage as unknown as typeof Image;
});
afterEach(() => {
  dom.window.close();
  Reflect.deleteProperty(globalThis, 'window');
});

describe('loaded image metadata', () => {
  it('never stores or returns image metadata on the server', () => {
    Reflect.deleteProperty(globalThis, 'window');
    const registry = new LoadedImageRegistry();
    assert.equal(registry.record('/poster', 342, 513), undefined);
    assert.equal(registry.get('/poster'), undefined);
  });

  it('expires idle entries after 30 minutes and retains only 512 by access', () => {
    let now = 0;
    const registry = new LoadedImageRegistry(() => now);
    for (let index = 0; index < 512; index++) {
      registry.record(`/poster-${index}`, 342, 513);
    }
    registry.get('/poster-0');
    registry.record('/poster-new', 342, 513);
    assert.equal(registry.get('/poster-1'), undefined);
    assert.ok(registry.get('/poster-0'));
    now += 29 * 60 * 1000;
    registry.get('/poster-0');
    now += 60 * 1000;
    assert.equal(registry.get('/poster-2'), undefined);
    assert.ok(registry.get('/poster-0'));
    now += 30 * 60 * 1000;
    assert.equal(registry.get('/poster-0'), undefined);
  });

  it('keeps editions, providers and version queries separate', () => {
    const registry = new LoadedImageRegistry();
    registry.record('/api/book/1/cover?version=1', 780, 1170);
    registry.record('https://example.com/cover?version=1', 900, 1350);
    registry.record('/api/book/2/cover?version=1', 900, 1350);
    const actual = registry.record('/api/book/1/cover?version=2', 342, 513);
    assert.equal(
      registry.findLargest([
        { src: '/api/book/1/cover?version=2', width: 342 },
      ]),
      actual
    );
    assert.equal(registry.record('/broken', 0, 0), undefined);
    assert.equal(registry.record('/broken', NaN, 513), undefined);
  });

  it('deduplicates an upgrade through decode and records its natural dimensions', async () => {
    const registry = new LoadedImageRegistry();
    const first = registry.preload('/upgrade');
    const second = registry.preload('/upgrade');
    assert.equal(first, second);
    assert.equal(requested.length, 1);
    let finishDecode: (() => void) | undefined;
    requested[0].decode = () =>
      new Promise((resolve) => {
        finishDecode = resolve;
      });
    const load = requested[0].onload?.();
    assert.equal(registry.get('/upgrade'), undefined);
    assert.equal(registry.preload('/upgrade'), first);
    finishDecode?.();
    await load;
    assert.equal((await first)?.width, 500);
    assert.equal((await second)?.height, 750);
    assert.equal((await registry.preload('/upgrade'))?.src, '/upgrade');
    assert.equal(requested.length, 1);
    assert.equal(requested[0].onload, null);
    assert.equal(requested[0].onerror, null);
  });

  it('retains failures for 60 seconds before allowing a new load', async () => {
    let now = 0;
    const registry = new LoadedImageRegistry(() => now);
    const first = registry.preload('/failure');
    requested[0].onerror?.();
    assert.equal(await first, undefined);
    assert.equal(await registry.preload('/failure'), undefined);
    assert.equal(requested.length, 1);
    now = 60_000;
    const retry = registry.preload('/failure');
    assert.equal(requested.length, 2);
    await requested[1].onload?.();
    assert.ok(await retry);
  });

  it('does not publish an image whose decode failed', async () => {
    const registry = new LoadedImageRegistry();
    const pending = registry.preload('/decode-failure');
    requested[0].decode = async () => {
      throw new Error('decode failed');
    };
    await requested[0].onload?.();
    assert.equal(await pending, undefined);
    assert.equal(registry.get('/decode-failure'), undefined);
  });
});

describe('resolution selection', () => {
  const variants = [
    { src: '/w342', width: 342 },
    { src: '/w500', width: 500 },
    { src: '/w780', width: 780 },
  ];
  it('retains a sufficient thumbnail and selects only the needed upgrade', () => {
    assert.equal(selectImageUpgrade(variants, 342, 128 * 2), undefined);
    assert.equal(selectImageUpgrade(variants, 342, 208 * 2)?.width, 500);
    assert.equal(selectImageUpgrade(variants, 342, 208 * 3)?.width, 780);
    assert.equal(selectImageUpgrade(variants, 342, 2000)?.width, 780);
    assert.equal(selectImageUpgrade(variants, 780, 2000), undefined);
  });
  it('uses the cropped height for cover and painted width for contain', () => {
    const box = {
      width: 128,
      height: 400,
      naturalWidth: 342,
      naturalHeight: 513,
      devicePixelRatio: 2,
    };
    assert.ok(
      Math.abs(requiredImageWidth({ ...box, objectFit: 'cover' }) - 1600 / 3) <
        0.0001
    );
    assert.equal(requiredImageWidth({ ...box, objectFit: 'contain' }), 256);
    assert.ok(
      Math.abs(
        requiredImageWidth({ ...box, height: 100, objectFit: 'contain' }) -
          400 / 3
      ) < 0.0001
    );
  });
});
