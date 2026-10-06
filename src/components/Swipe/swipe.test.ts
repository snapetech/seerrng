import { requestBodyFor } from '@app/components/Swipe';
import {
  SWIPE_THRESHOLD,
  swipeFromDrag,
} from '@app/components/Swipe/SwipeCardView';
import { describe, expect, it } from 'vitest';

describe('swipeFromDrag', () => {
  it('needs the threshold distance', () => {
    expect(swipeFromDrag(SWIPE_THRESHOLD - 1, 0)).toBeUndefined();
    expect(swipeFromDrag(SWIPE_THRESHOLD + 1, 0)).toBe('right');
    expect(swipeFromDrag(-SWIPE_THRESHOLD - 1, 0)).toBe('left');
    expect(swipeFromDrag(0, -SWIPE_THRESHOLD - 1)).toBe('up');
  });

  it('prefers a sideways swipe when the drag is diagonal', () => {
    expect(swipeFromDrag(SWIPE_THRESHOLD + 5, -SWIPE_THRESHOLD - 5)).toBe(
      'right'
    );
    expect(swipeFromDrag(0, SWIPE_THRESHOLD + 50)).toBeUndefined();
  });
});

describe('requestBodyFor', () => {
  const profile = {
    tasteNotes: '',
    seriesRequest: 'first-season' as const,
    bookFormat: 'audiobook' as const,
  };

  it('requests movies by TMDB ID', () => {
    expect(
      requestBodyFor({ mediaType: 'movie', id: '603', title: 'M' }, profile)
    ).toEqual({ mediaType: 'movie', mediaId: 603 });
  });

  it('requests the first season or every season of a series', () => {
    const card = { mediaType: 'tv' as const, id: '1396', title: 'S' };
    expect(requestBodyFor(card, profile)).toEqual({
      mediaType: 'tv',
      mediaId: 1396,
      seasons: [1],
    });
    expect(
      requestBodyFor(card, { ...profile, seriesRequest: 'all-seasons' })
    ).toMatchObject({ seasons: 'all' });
  });

  it('requests books in the preferred format', () => {
    expect(
      requestBodyFor(
        { mediaType: 'book', id: 'OL45883W', title: 'B', authorId: 'OL1A' },
        { ...profile, bookFormat: 'ebook' }
      )
    ).toEqual({
      mediaType: 'book',
      mediaId: 'OL45883W',
      authorId: 'OL1A',
      format: 'ebook',
    });
  });
});
