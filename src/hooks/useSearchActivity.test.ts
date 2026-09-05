import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  getSearchActivitySnapshot,
  setSearchActivity,
} from './useSearchActivity';

afterEach(() => setSearchActivity(false));

describe('search activity state', () => {
  it('tracks repeated loading transitions until the request finishes', () => {
    assert.strictEqual(getSearchActivitySnapshot(), false);

    setSearchActivity(true);
    setSearchActivity(true);
    assert.strictEqual(getSearchActivitySnapshot(), true);

    setSearchActivity(false);
    assert.strictEqual(getSearchActivitySnapshot(), false);
  });
});
