import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { tvdbTokenNeedsRefresh } from './tvdb';

const encodePayload = (payload: Record<string, unknown>) =>
  `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

describe('tvdbTokenNeedsRefresh', () => {
  it('keeps tokens that expire outside the refresh window', () => {
    const now = 1_700_000_000;
    const token = encodePayload({ exp: now + 700_000 });

    assert.equal(tvdbTokenNeedsRefresh(token, now), false);
  });

  it('refreshes missing, malformed, and soon-expiring tokens', () => {
    const now = 1_700_000_000;

    assert.equal(tvdbTokenNeedsRefresh(undefined, now), true);
    assert.equal(tvdbTokenNeedsRefresh('not-a-jwt', now), true);
    assert.equal(tvdbTokenNeedsRefresh('header.not-json.sig', now), true);
    assert.equal(tvdbTokenNeedsRefresh(encodePayload({}), now), true);
    assert.equal(
      tvdbTokenNeedsRefresh(encodePayload({ exp: now + 60 }), now),
      true
    );
  });

  it('refreshes oversized tokens before decoding payloads', () => {
    const oversizedPayload = 'x'.repeat(5 * 1024);

    assert.equal(tvdbTokenNeedsRefresh(`header.${oversizedPayload}.sig`), true);
    assert.equal(tvdbTokenNeedsRefresh('x'.repeat(9 * 1024)), true);
  });
});
