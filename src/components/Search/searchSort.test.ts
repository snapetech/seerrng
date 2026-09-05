import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getDefaultSortOrder, getSortField, getSortOrder } from './searchSort';

describe('search sorting query state', () => {
  it('falls back to date for removed or unknown sort fields', () => {
    assert.equal(getSortField('relevance'), 'date');
    assert.equal(getSortField('unknown'), 'date');
  });

  it('defaults date and rating to descending', () => {
    assert.equal(getDefaultSortOrder('date'), 'desc');
    assert.equal(getDefaultSortOrder('rating'), 'desc');
  });

  it('defaults text fields to ascending and preserves explicit direction', () => {
    assert.equal(getSortOrder(undefined, 'title'), 'asc');
    assert.equal(getSortOrder(undefined, 'publisher'), 'asc');
    assert.equal(getSortOrder(undefined, 'author'), 'asc');
    assert.equal(getSortOrder(undefined, 'artist'), 'asc');
    assert.equal(getSortOrder(undefined, 'writer'), 'asc');
    assert.equal(getSortOrder(undefined, 'director'), 'asc');
    assert.equal(getSortOrder('desc', 'publisher'), 'desc');
  });
});
