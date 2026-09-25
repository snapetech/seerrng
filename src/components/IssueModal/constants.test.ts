import { IssueType } from '@server/constants/issue';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getIssueOptionsForMediaType } from './constants';

describe('Report an Issue type options', () => {
  it('keeps all four required Movie and Series issue types', () => {
    const required = [
      IssueType.OTHER,
      IssueType.AUDIO,
      IssueType.VIDEO,
      IssueType.SUBTITLES,
    ].sort();

    for (const mediaType of ['movie', 'tv'] as const) {
      assert.deepStrictEqual(
        getIssueOptionsForMediaType(mediaType)
          .map((option) => option.issueType)
          .sort(),
        required
      );
    }
  });

  it('limits book, comic, and magazine issues to Other, since they have no audio/video track', () => {
    for (const mediaType of ['book', 'comic', 'magazine'] as const) {
      assert.deepStrictEqual(
        getIssueOptionsForMediaType(mediaType).map(
          (option) => option.issueType
        ),
        [IssueType.OTHER]
      );
    }
  });
});
