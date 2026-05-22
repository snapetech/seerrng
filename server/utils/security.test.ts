import type { Request } from 'express';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getRateLimitKey,
  isSafeHttpUrl,
  isValidHttpUrl,
  safeStringEqual,
} from './security';

describe('isValidHttpUrl', () => {
  it('accepts http and https URLs', () => {
    assert.equal(isValidHttpUrl('http://example.com/webhook'), true);
    assert.equal(isValidHttpUrl('https://example.com/webhook'), true);
  });

  it('rejects non-http URLs and invalid values', () => {
    assert.equal(isValidHttpUrl('file:///etc/passwd'), false);
    assert.equal(isValidHttpUrl('javascript:alert(1)'), false);
    assert.equal(isValidHttpUrl('/relative/path'), false);
    assert.equal(isValidHttpUrl(''), false);
    assert.equal(isValidHttpUrl(undefined), false);
  });

  it('allows notification template variables only when requested', () => {
    const templatedUrl = 'https://example.com/hooks/{{media_tmdbid}}';

    assert.equal(isValidHttpUrl(templatedUrl), false);
    assert.equal(isValidHttpUrl(templatedUrl, { allowTemplates: true }), true);
  });
});

describe('isSafeHttpUrl', () => {
  it('rejects local and private network destinations by default', async () => {
    assert.equal(await isSafeHttpUrl('http://127.0.0.1/webhook'), false);
    assert.equal(await isSafeHttpUrl('http://localhost/webhook'), false);
    assert.equal(await isSafeHttpUrl('http://192.168.1.10/webhook'), false);
    assert.equal(await isSafeHttpUrl('http://169.254.169.254/latest'), false);
  });

  it('allows private destinations only when explicitly enabled', async () => {
    assert.equal(
      await isSafeHttpUrl('http://127.0.0.1/webhook', {
        allowPrivateAddresses: true,
      }),
      true
    );
  });
});

describe('safeStringEqual', () => {
  it('compares equal strings and rejects mismatches without throwing', () => {
    assert.equal(safeStringEqual('secret', 'secret'), true);
    assert.equal(safeStringEqual('secret', 'other'), false);
    assert.equal(safeStringEqual('secret', 'secret1'), false);
    assert.equal(safeStringEqual(undefined, 'secret'), false);
  });
});

describe('getRateLimitKey', () => {
  it('does not trust client-supplied forwarded headers directly', () => {
    const req = {
      headers: { 'x-forwarded-for': '203.0.113.10' },
      ip: '198.51.100.5',
      socket: { remoteAddress: '198.51.100.6' },
    } as unknown as Request;

    assert.equal(getRateLimitKey(req), '198.51.100.5');
  });

  it('falls back to the socket remote address when Express has no ip', () => {
    const req = {
      headers: {},
      ip: undefined,
      socket: { remoteAddress: '198.51.100.6' },
    } as unknown as Request;

    assert.equal(getRateLimitKey(req), '198.51.100.6');
  });
});
