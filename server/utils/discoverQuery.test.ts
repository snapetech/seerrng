import {
  appendDiscoverQueryString,
  buildDiscoverQueryString,
} from '@server/utils/discoverQuery';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('buildDiscoverQueryString', () => {
  it('omits nullish and empty query values', () => {
    assert.strictEqual(
      buildDiscoverQueryString({
        page: 1,
        query: undefined,
        genre: '',
        subject: null,
      }),
      'page=1'
    );
  });

  it('uses the first non-empty value from array query values', () => {
    assert.strictEqual(
      buildDiscoverQueryString({
        page: 1,
        genre: ['', undefined, 'jazz'],
      }),
      'page=1&genre=jazz'
    );
  });

  it('escapes query values for discover APIs', () => {
    assert.strictEqual(
      buildDiscoverQueryString({
        page: 1,
        query: 'kind of blue!',
        subject: 'science_fiction',
      }),
      'page=1&query=kind%20of%20blue%21&subject=science_fiction'
    );
  });
});

describe('appendDiscoverQueryString', () => {
  it('appends pre-encoded query strings after structured params', () => {
    assert.strictEqual(
      appendDiscoverQueryString(
        {
          page: 1,
          shuffleSeed: 'refresh 1',
        },
        'subject=science_fiction&sortBy=ranked'
      ),
      'page=1&shuffleSeed=refresh%201&subject=science_fiction&sortBy=ranked'
    );
  });

  it('omits empty structured and extra query segments', () => {
    assert.strictEqual(
      appendDiscoverQueryString({
        page: 1,
        query: undefined,
      }),
      'page=1'
    );
  });
});
