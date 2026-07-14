import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canRegisterServiceWorker,
  createCacheUserMessage,
  postCacheUserToWorker,
  shouldVerifyPushSubscription,
  syncRegistrationCacheUser,
} from './registration';

describe('canRegisterServiceWorker', () => {
  it('allows service worker registration without a logged-in user', () => {
    assert.equal(
      canRegisterServiceWorker({
        serviceWorker: {},
      } as Pick<Navigator, 'serviceWorker'>),
      true
    );
  });

  it('skips registration when the browser does not support service workers', () => {
    assert.equal(
      canRegisterServiceWorker({} as Pick<Navigator, 'serviceWorker'>),
      false
    );
    assert.equal(canRegisterServiceWorker(undefined), false);
  });
});

describe('shouldVerifyPushSubscription', () => {
  it('keeps push resubscribe gated by user and local preference', () => {
    assert.equal(
      shouldVerifyPushSubscription({
        pushNotificationsEnabled: true,
        userId: 1,
      }),
      true
    );
    assert.equal(
      shouldVerifyPushSubscription({
        pushNotificationsEnabled: true,
        userId: undefined,
      }),
      false
    );
    assert.equal(
      shouldVerifyPushSubscription({
        pushNotificationsEnabled: false,
        userId: 1,
      }),
      false
    );
  });
});

describe('service worker cache user partition', () => {
  it('uses an explicit null partition when no user is authenticated', () => {
    assert.deepEqual(createCacheUserMessage(undefined), {
      type: 'SET_CACHE_USER',
      userId: null,
    });
  });

  it('posts the current user to each worker lifecycle state', () => {
    const messages: unknown[] = [];
    const worker = {
      postMessage: (message: unknown) => messages.push(message),
    } as Pick<ServiceWorker, 'postMessage'>;

    syncRegistrationCacheUser(
      {
        active: worker as ServiceWorker,
        waiting: worker as ServiceWorker,
        installing: null,
      },
      42
    );

    assert.deepEqual(messages, [
      { type: 'SET_CACHE_USER', userId: 42 },
      { type: 'SET_CACHE_USER', userId: 42 },
    ]);
  });

  it('does nothing when there is no controlling worker', () => {
    assert.equal(postCacheUserToWorker(null, 42), undefined);
  });
});
