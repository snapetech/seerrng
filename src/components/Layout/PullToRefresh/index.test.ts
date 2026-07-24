import { acquireInlineStyleLease } from '@app/utils/inlineStyleLease';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { PullToRefreshController } from './index';

const createTouchEvent = (
  document: Document,
  type: string,
  screenY?: number
): Event => {
  const event = document.createEvent('Event');
  event.initEvent(type, true, true);
  Object.defineProperty(event, 'targetTouches', {
    value: screenY === undefined ? [] : [{ screenY }],
  });
  return event;
};

describe('PullToRefreshController', () => {
  it('restores exact page styles and cancels a pending reload on unmount', async () => {
    const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {
      url: 'http://localhost/',
    });
    const originalWindow = Object.getOwnPropertyDescriptor(
      globalThis,
      'window'
    );
    const originalDocument = Object.getOwnPropertyDescriptor(
      globalThis,
      'document'
    );
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const originalActEnvironment = Object.getOwnPropertyDescriptor(
      globalThis,
      'IS_REACT_ACT_ENVIRONMENT'
    );
    const timers = new Map<number, () => void>();
    const cleared: number[] = [];
    let nextTimer = 0;
    let reloads = 0;

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: dom.window,
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: dom.window.document,
    });
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      configurable: true,
      value: true,
    });
    globalThis.setTimeout = ((callback: () => void) => {
      nextTimer += 1;
      timers.set(nextTimer, callback);
      return nextTimer;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = ((timer: number) => {
      cleared.push(timer);
      timers.delete(timer);
    }) as unknown as typeof clearTimeout;

    document.body.style.touchAction = 'pan-x';
    document.body.style.overscrollBehavior = 'contain';
    document.documentElement.style.overscrollBehaviorY = 'auto';
    const root = createRoot(document.getElementById('root')!);

    try {
      await act(async () =>
        root.render(
          createElement(PullToRefreshController, {
            reload: () => {
              reloads += 1;
            },
          })
        )
      );
      assert.strictEqual(document.body.style.touchAction, 'pan-x');
      assert.strictEqual(document.body.style.overscrollBehavior, 'contain');
      await act(async () => {
        dom.window.dispatchEvent(
          createTouchEvent(dom.window.document, 'touchstart', 10)
        );
      });
      assert.strictEqual(document.body.style.touchAction, 'pan-x');
      assert.strictEqual(document.body.style.overscrollBehavior, 'contain');
      await act(async () => {
        assert.strictEqual(
          dom.window.dispatchEvent(
            createTouchEvent(dom.window.document, 'touchmove', 0)
          ),
          true
        );
      });
      assert.strictEqual(document.body.style.touchAction, 'pan-x');
      assert.strictEqual(document.body.style.overscrollBehavior, 'contain');
      const releaseModalTouchLock = acquireInlineStyleLease(
        document.body,
        'touchAction',
        'none'
      );

      await act(async () => {
        dom.window.dispatchEvent(
          createTouchEvent(dom.window.document, 'touchmove', 400)
        );
        dom.window.dispatchEvent(
          createTouchEvent(dom.window.document, 'touchend')
        );
      });
      assert.strictEqual(document.body.style.touchAction, 'none');
      assert.strictEqual(document.body.style.overscrollBehavior, 'contain');
      assert.strictEqual(
        document.documentElement.style.overscrollBehaviorY,
        'auto'
      );
      assert.strictEqual(timers.size, 1);
      assert.strictEqual(reloads, 0);

      releaseModalTouchLock();
      assert.strictEqual(document.body.style.touchAction, 'pan-x');

      await act(async () => root.unmount());
      assert.deepStrictEqual(cleared, [1]);
      assert.strictEqual(timers.size, 0);
      assert.strictEqual(reloads, 0);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      if (originalWindow) {
        Object.defineProperty(globalThis, 'window', originalWindow);
      } else {
        Reflect.deleteProperty(globalThis, 'window');
      }
      if (originalDocument) {
        Object.defineProperty(globalThis, 'document', originalDocument);
      } else {
        Reflect.deleteProperty(globalThis, 'document');
      }
      if (originalActEnvironment) {
        Object.defineProperty(
          globalThis,
          'IS_REACT_ACT_ENVIRONMENT',
          originalActEnvironment
        );
      } else {
        Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
      }
      dom.window.close();
    }
  });
});
