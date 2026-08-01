import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getToastDedupeId } from './useToasts';

describe('getToastDedupeId', () => {
  it('deduplicates identical string messages by appearance', () => {
    assert.strictEqual(
      getToastDedupeId('Something went wrong. Please try again.', 'error'),
      getToastDedupeId('Something went wrong. Please try again.', 'error')
    );
    assert.notStrictEqual(
      getToastDedupeId('Something went wrong. Please try again.', 'error'),
      getToastDedupeId('Something went wrong. Please try again.', 'warning')
    );
  });

  it('leaves rendered message nodes independently addressable', () => {
    assert.strictEqual(getToastDedupeId(null, 'error'), undefined);
  });
});
