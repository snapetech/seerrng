import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { setupTestDb } from '@server/test/db';

setupTestDb();

describe('Media.getRelatedMedia', () => {
  it('normalizes MusicBrainz IDs before matching related media', async () => {
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 0,
        mbId: 'release-group-id',
        mediaType: MediaType.MUSIC,
        status: MediaStatus.AVAILABLE,
        status4k: MediaStatus.UNKNOWN,
      })
    );

    const relatedMedia = await Media.getRelatedMedia(undefined, [
      ' RELEASE-GROUP-ID ',
    ]);

    assert.equal(relatedMedia.length, 1);
    assert.equal(relatedMedia[0].id, media.id);
  });
});
