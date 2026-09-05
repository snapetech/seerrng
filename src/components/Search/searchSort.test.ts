import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getDefaultSortOrder, getSortField, getSortOrder } from './searchSort';

describe('search sorting query state', () => {
  it('keeps relevance selected instead of falling back to date', () => {
    assert.equal(getSortField('relevance'), 'relevance');
  });

  it('defaults date and relevance to descending', () => {
    assert.equal(getDefaultSortOrder('date'), 'desc');
    assert.equal(getDefaultSortOrder('relevance'), 'desc');
  });

  it('defaults text fields to ascending and preserves explicit direction', () => {
    assert.equal(getSortOrder(undefined, 'title'), 'asc');
    assert.equal(getSortOrder(undefined, 'publisher'), 'asc');
    assert.equal(getSortOrder(undefined, 'author'), 'asc');
    assert.equal(getSortOrder('desc', 'publisher'), 'desc');
  });
});
