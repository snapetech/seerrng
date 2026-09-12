import axios from 'axios';
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import MusicBrainz, {
  MAX_MUSICBRAINZ_ARTIST_CREDITS,
  MAX_MUSICBRAINZ_LABELS,
  MAX_MUSICBRAINZ_PAGE_SIZE,
  MAX_MUSICBRAINZ_RECORDING_RELEASES,
  MAX_MUSICBRAINZ_RELEASES,
  MAX_MUSICBRAINZ_TAGS,
  MAX_MUSICBRAINZ_TEXT_LENGTH,
  MAX_MUSICBRAINZ_WIKIPEDIA_LENGTH,
  WIKIPEDIA_EXTRACT_HTTP_OPTIONS,
  sanitizeMusicBrainzAlbum,
  sanitizeMusicBrainzArtist,
  sanitizeMusicBrainzRecording,
  sanitizeMusicBrainzReleaseLabels,
} from './musicbrainz';

afterEach(() => mock.restoreAll());

describe('WIKIPEDIA_EXTRACT_HTTP_OPTIONS', () => {
  it('bounds MusicBrainz Wikipedia extract requests', () => {
    assert.equal(WIKIPEDIA_EXTRACT_HTTP_OPTIONS.timeout, 10_000);
    assert.equal(WIKIPEDIA_EXTRACT_HTTP_OPTIONS.maxRedirects, 3);
    assert.equal(WIKIPEDIA_EXTRACT_HTTP_OPTIONS.maxContentLength, 256 * 1024);
    assert.equal(WIKIPEDIA_EXTRACT_HTTP_OPTIONS.maxBodyLength, 1024);
  });
});

describe('MusicBrainz response boundaries', () => {
  const album = (index: number) => ({
    id: `album-${index}`,
    title: 't'.repeat(MAX_MUSICBRAINZ_TEXT_LENGTH + 100),
    score: 100,
    'primary-type': 'Album',
    'artist-credit': Array.from(
      { length: MAX_MUSICBRAINZ_ARTIST_CREDITS + 10 },
      (_, artistIndex) => ({
        name: `Artist ${artistIndex}`,
        artist: {
          id: `artist-${artistIndex}`,
          name: `Artist ${artistIndex}`,
          'sort-name': `Artist ${artistIndex}`,
        },
      })
    ),
    releases: Array.from(
      { length: MAX_MUSICBRAINZ_RELEASES + 100 },
      (_, releaseIndex) => ({
        id: `release-${releaseIndex}`,
        title: `Release ${releaseIndex}`,
        status: 'Official',
        'status-id': 'official',
      })
    ),
    tags: Array.from({ length: MAX_MUSICBRAINZ_TAGS + 100 }, (_, tagIndex) => ({
      name: `tag-${tagIndex}`,
      count: 1,
    })),
    unexpectedProviderSecret: 'must-not-cross-boundary',
  });

  it('caps pages and returns only normalized album fields', async () => {
    const musicBrainz = new MusicBrainz();
    Object.defineProperty(musicBrainz, 'get', {
      configurable: true,
      value: async () => ({
        'release-groups': Array.from(
          { length: MAX_MUSICBRAINZ_PAGE_SIZE + 100 },
          (_, index) => album(index)
        ),
      }),
    });

    const results = await musicBrainz.searchAlbum({
      query: 'album',
      limit: 10_000,
    });

    assert.strictEqual(results.length, MAX_MUSICBRAINZ_PAGE_SIZE);
    assert.strictEqual(results[0].title.length, MAX_MUSICBRAINZ_TEXT_LENGTH);
    assert.strictEqual(
      results[0]['artist-credit'].length,
      MAX_MUSICBRAINZ_ARTIST_CREDITS
    );
    assert.strictEqual(results[0].releases.length, MAX_MUSICBRAINZ_RELEASES);
    assert.strictEqual(results[0].tags?.length, MAX_MUSICBRAINZ_TAGS);
    assert.ok(!('unexpectedProviderSecret' in results[0]));
  });

  it('exposes the provider match count separately from the capped page', async () => {
    const musicBrainz = new MusicBrainz();
    Object.defineProperty(musicBrainz, 'get', {
      configurable: true,
      value: async () => ({
        count: 4200,
        'release-groups': [album(0)],
      }),
    });

    const { results, totalResults } = await musicBrainz.searchAlbumWithTotal({
      query: 'album',
      limit: 30,
    });

    assert.strictEqual(results.length, 1);
    assert.strictEqual(totalResults, 4200);
  });

  it('exposes the provider artist match count separately from the capped page', async () => {
    const musicBrainz = new MusicBrainz();
    Object.defineProperty(musicBrainz, 'get', {
      configurable: true,
      value: async () => ({
        count: 900,
        artists: [
          {
            id: 'artist-0',
            name: 'Artist 0',
            type: 'Group',
            'sort-name': 'Artist 0',
            score: 100,
          },
        ],
      }),
    });

    const { results, totalResults } = await musicBrainz.searchArtistWithTotal({
      query: 'artist',
      limit: 30,
    });

    assert.strictEqual(results.length, 1);
    assert.strictEqual(totalResults, 900);
  });

  it('rejects malformed albums and normalizes artist records', () => {
    assert.strictEqual(sanitizeMusicBrainzAlbum(null), undefined);
    assert.strictEqual(
      sanitizeMusicBrainzAlbum({ id: 'album-without-title' }),
      undefined
    );
    const artist = sanitizeMusicBrainzArtist({
      id: 'artist-1',
      name: 'Artist',
      type: 'unexpected',
      aliases: Array.from({ length: 200 }, (_, index) => ({
        name: `Alias ${index}`,
        'sort-name': `Alias ${index}`,
      })),
      raw: 'not-public',
    });

    assert.ok(artist);
    assert.strictEqual(artist.type, 'Person');
    assert.strictEqual(artist.aliases?.length, 100);
    assert.ok(!('raw' in artist));
  });

  it('sanitizes recording releases used by playlist matching', () => {
    const recording = sanitizeMusicBrainzRecording({
      id: 'recording-id',
      title: 'Track',
      score: 100,
      'artist-credit': [
        {
          name: 'Artist',
          artist: { id: 'artist-id', name: 'Artist', 'sort-name': 'Artist' },
        },
      ],
      releases: Array.from(
        { length: MAX_MUSICBRAINZ_RECORDING_RELEASES + 10 },
        (_, index) => ({
          id: `release-${index}`,
          title: `Release ${index}`,
          status: 'Official',
          'first-release-date': '2001',
          'release-group': {
            id: `release-group-${index}`,
            title: `Release Group ${index}`,
            'primary-type': 'Album',
            'secondary-types': [],
          },
        })
      ),
      raw: 'not-public',
    });

    assert.ok(recording);
    assert.equal(recording.releases.length, MAX_MUSICBRAINZ_RECORDING_RELEASES);
    assert.ok(!('raw' in recording));
    assert.equal(
      sanitizeMusicBrainzRecording({ id: 'missing-title' }),
      undefined
    );
  });

  it('sanitizes release labels and bounds provider output', () => {
    const labels = sanitizeMusicBrainzReleaseLabels({
      'label-info': [
        { label: { name: '  Label One  ' } },
        { label: { name: '' } },
        { label: { name: 'Label Two' } },
        { label: { name: 'x'.repeat(300) } },
        ...Array.from({ length: MAX_MUSICBRAINZ_LABELS + 10 }, (_, index) => ({
          label: { name: `Label ${index + 3}` },
        })),
      ],
    });

    assert.equal(labels[0], 'Label One');
    assert.equal(labels[1], 'Label Two');
    assert.equal(labels[2].length, 256);
    assert.equal(labels.length, MAX_MUSICBRAINZ_LABELS - 1);
    assert.deepStrictEqual(sanitizeMusicBrainzReleaseLabels(null), []);
  });

  it('requests release labels from the MusicBrainz release endpoint', async () => {
    const musicBrainz = new MusicBrainz();
    Object.defineProperty(musicBrainz, 'get', {
      configurable: true,
      value: async (
        path: string,
        options: { params: Record<string, string> }
      ) => {
        assert.equal(path, '/release/00000000-0000-0000-0000-000000000001');
        assert.deepStrictEqual(options.params, { inc: 'labels', fmt: 'json' });
        return {
          'label-info': [{ label: { name: 'Example Label' } }],
        };
      },
    });

    const labels = await musicBrainz.getReleaseLabels({
      releaseId: '00000000-0000-0000-0000-000000000001',
    });

    assert.deepStrictEqual(labels, ['Example Label']);
  });

  it('sanitizes and bounds Wikipedia extracts and rejects provider URLs', async () => {
    mock.method(
      axios,
      'get',
      async () =>
        ({
          data: {
            wikipediaExtract: {
              title: 'x'.repeat(MAX_MUSICBRAINZ_TEXT_LENGTH + 100),
              url: 'javascript:alert(1)',
              content: `<b>${'content '.repeat(
                MAX_MUSICBRAINZ_WIKIPEDIA_LENGTH
              )}</b>`,
            },
          },
        }) as never
    );

    const result = await new MusicBrainz().getArtistWikipediaExtract({
      artistMbid: '00000000-0000-0000-0000-000000000001',
    });

    assert.ok(result);
    assert.strictEqual(result.title.length, MAX_MUSICBRAINZ_TEXT_LENGTH);
    assert.strictEqual(result.url, '');
    assert.ok(result.content.length <= MAX_MUSICBRAINZ_WIKIPEDIA_LENGTH);
    assert.doesNotMatch(result.content, /<b>/);
  });
});
