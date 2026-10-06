import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';

import {
  buildGuideSnapshot,
  findAiringsInSnapshot,
  findProgrammeInSnapshot,
  normalizeGuideTitle,
  readGuideStream,
} from '@server/lib/liveTv/guideIndex';
import {
  buildTunerrRule,
  nextRecordingStatus,
} from '@server/lib/liveTv/recordings';
import {
  decodeXmlText,
  parseXmltv,
  parseXmltvNs,
  parseXmltvTime,
  XmltvStreamParser,
} from '@server/lib/liveTv/xmltv';

const GUIDE = `<?xml version="1.0" encoding="UTF-8"?>
<tv generator-info-name="IPTV Tunerr">
  <channel id="101"><display-name>News One</display-name></channel>
  <channel id="202"><display-name>Movies &amp; More</display-name></channel>
  <programme start="20261006180000 +0000" stop="20261006190000 +0000" channel="101">
    <title lang="en">Evening News</title>
    <category>News</category>
  </programme>
  <programme start="20261006200000 +0000" stop="20261006220000 +0000" channel="202">
    <title>The Matrix (1999)</title>
    <sub-title>Director&apos;s cut</sub-title>
    <category>Movie</category>
  </programme>
  <programme start="20261007200000 +0000" stop="20261007203000 +0000" channel="101">
    <title>Severance</title>
    <episode-num system="xmltv_ns">1.4.</episode-num>
  </programme>
  <programme start="20261001200000 +0000" stop="20261001210000 +0000" channel="101">
    <title>Old Show</title>
  </programme>
</tv>`;

const NOW = new Date('2026-10-06T17:00:00Z');
const LIMITS = {
  windowStart: NOW,
  windowEnd: new Date('2026-10-09T17:00:00Z'),
  maxProgrammes: 100,
  maxElementBytes: 64 * 1024,
};

describe('XMLTV parsing', () => {
  it('parses times with offsets and xmltv_ns episode numbers', () => {
    assert.equal(
      parseXmltvTime('20261006180000 -0500')?.toISOString(),
      '2026-10-06T23:00:00.000Z'
    );
    assert.equal(parseXmltvTime('2026-10-06'), undefined);
    assert.deepEqual(parseXmltvNs('1.4.0/1'), { season: 2, episode: 5 });
    assert.equal(decodeXmlText('A &amp; B &#233; &#x41;'), 'A & B é A');
  });

  it('keeps programmes inside the window and reads channels', () => {
    const result = parseXmltv(GUIDE, LIMITS);
    assert.deepEqual(
      result.channels.map((channel) => channel.name),
      ['News One', 'Movies & More']
    );
    assert.deepEqual(
      result.programmes.map((programme) => programme.title),
      ['Evening News', 'The Matrix (1999)', 'Severance']
    );
    const severance = result.programmes[2];
    assert.equal(severance.season, 2);
    assert.equal(severance.episode, 5);
    assert.equal(result.programmes[1].subTitle, "Director's cut");
  });

  it('handles elements split across arbitrary chunk boundaries', () => {
    for (const size of [1, 7, 50]) {
      const parser = new XmltvStreamParser(LIMITS);
      for (let index = 0; index < GUIDE.length; index += size) {
        parser.push(GUIDE.slice(index, index + size));
      }
      assert.equal(parser.finish().programmes.length, 3, `chunk ${size}`);
    }
  });

  it('stops collecting at the programme limit', () => {
    const result = parseXmltv(GUIDE, { ...LIMITS, maxProgrammes: 1 });
    assert.equal(result.programmes.length, 1);
    assert.equal(result.truncated, true);
  });

  it('skips oversized elements without failing', () => {
    const huge = `<programme start="20261006180000 +0000" stop="20261006190000 +0000" channel="1"><title>${'x'.repeat(2000)}</title></programme>`;
    const result = parseXmltv(huge + GUIDE, {
      ...LIMITS,
      maxElementBytes: 1500,
    });
    assert.equal(result.programmes.length, 3);
  });
});

describe('guide index', () => {
  it('normalizes titles for matching', () => {
    assert.equal(normalizeGuideTitle('The Matrix (1999)'), 'matrix');
    assert.equal(normalizeGuideTitle('Law & Order: SVU'), 'law and order svu');
    assert.equal(normalizeGuideTitle('Amélie'), 'amelie');
  });

  it('finds upcoming airings by catalog title', async () => {
    const snapshot = await readGuideStream(Readable.from([GUIDE]), NOW, 72);
    const airings = findAiringsInSnapshot(snapshot, ['The Matrix'], NOW, 10);
    assert.equal(airings.length, 1);
    assert.equal(airings[0].channelName, 'Movies & More');
    assert.equal(airings[0].start, '2026-10-06T20:00:00.000Z');

    const later = new Date('2026-10-06T23:00:00Z');
    assert.equal(
      findAiringsInSnapshot(snapshot, ['The Matrix'], later, 10).length,
      0
    );
  });

  it('looks up one exact programme by channel and start', () => {
    const { programmes, channels } = parseXmltv(GUIDE, LIMITS);
    const snapshot = buildGuideSnapshot(
      programmes,
      channels,
      NOW,
      LIMITS.windowEnd,
      false
    );
    assert.equal(
      findProgrammeInSnapshot(snapshot, '101', new Date('2026-10-06T18:00:00Z'))
        ?.title,
      'Evening News'
    );
    assert.equal(
      findProgrammeInSnapshot(
        snapshot,
        '202',
        new Date('2026-10-06T18:00:00Z')
      ),
      undefined
    );
  });
});

describe('recording rules', () => {
  it('targets one airing by exact title, guide number, and start window', () => {
    const rule = buildTunerrRule({
      id: 12,
      kind: 'airing',
      title: 'Evening News',
      channelId: '101',
      startsAt: new Date('2026-10-06T18:00:00Z'),
    });
    assert.deepEqual(rule, {
      id: 'seerrng-12',
      name: 'SeerrNG #12: Evening News',
      enabled: true,
      title_equals: ['Evening News'],
      title_contains: ['Evening News'],
      include_guide_numbers: ['101'],
      start_after: '2026-10-06T17:58:00.000Z',
      start_before: '2026-10-06T18:02:00.000Z',
    });
  });

  it('records a series on any channel without a time window', () => {
    const rule = buildTunerrRule({
      id: 3,
      kind: 'series',
      title: 'Severance',
      channelId: null,
      startsAt: null,
    });
    assert.equal(rule.include_guide_numbers, undefined);
    assert.equal(rule.start_after, undefined);
  });

  const airing = {
    kind: 'airing' as const,
    status: 'scheduled' as const,
    endsAt: new Date('2026-10-06T19:00:00Z'),
  };
  const match = (overrides = {}) => ({
    rule_id: 'seerrng-1',
    active_count: 0,
    completed_count: 0,
    failed_count: 0,
    ...overrides,
  });

  it('moves an airing through recording to completed', () => {
    assert.equal(
      nextRecordingStatus(airing, match({ active_count: 1 }), NOW).status,
      'recording'
    );
    const done = nextRecordingStatus(
      airing,
      match({ completed_count: 1 }),
      new Date('2026-10-06T19:05:00Z')
    );
    assert.equal(done.status, 'completed');
    assert.equal(done.removeRule, true);
  });

  it('fails an airing Tunerr never recorded after the grace period', () => {
    const waiting = nextRecordingStatus(
      airing,
      undefined,
      new Date('2026-10-06T19:10:00Z')
    );
    assert.equal(waiting.status, 'scheduled');
    const failed = nextRecordingStatus(
      airing,
      undefined,
      new Date('2026-10-06T19:31:00Z')
    );
    assert.equal(failed.status, 'failed');
    assert.equal(failed.removeRule, true);
    assert.match(failed.lastError ?? '', /did not record/);
  });

  it('keeps a series scheduled and counts its recordings', () => {
    const update = nextRecordingStatus(
      { kind: 'series', status: 'scheduled', endsAt: null },
      match({ completed_count: 3, failed_count: 1 }),
      NOW
    );
    assert.equal(update.status, 'scheduled');
    assert.equal(update.completedCount, 3);
    assert.equal(update.removeRule, false);
  });
});
