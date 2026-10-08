import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getSportarrLeagueAlias,
  getSportarrLeagueExternalId,
  isSportarrLeagueExternalId,
} from './sportarrIdentity';

describe('Sportarr canonical league identity', () => {
  it('round-trips the supported Sonarr compatibility alias range', () => {
    for (const externalId of ['lg-000001', 'lg-123456', 'lg-99999999']) {
      const alias = getSportarrLeagueAlias(externalId);
      assert.ok(alias);
      assert.equal(getSportarrLeagueExternalId(alias), externalId);
    }
  });

  it('rejects malformed IDs and compatibility IDs outside the reserved range', () => {
    assert.equal(isSportarrLeagueExternalId('lg-000001'), true);
    assert.equal(isSportarrLeagueExternalId('lg-00001'), false);
    assert.equal(isSportarrLeagueExternalId('900000001'), false);
    assert.equal(getSportarrLeagueAlias('lg-100000000'), undefined);
    assert.equal(getSportarrLeagueExternalId(899_999_999), undefined);
    assert.equal(getSportarrLeagueExternalId(1_000_000_000), undefined);
  });
});
