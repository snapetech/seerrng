import Badge from '@app/components/Common/Badge';
import CachedImage from '@app/components/Common/CachedImage';
import defineMessages from '@app/utils/defineMessages';
import type { CSSProperties, PointerEvent } from 'react';
import { useRef, useState } from 'react';
import { useIntl } from 'react-intl';

export type SwipeDirection = 'right' | 'left' | 'up';

export interface SwipeCardData {
  mediaType: 'movie' | 'tv' | 'book';
  id: string;
  title: string;
  subtitle?: string;
  year?: number;
  overview?: string;
  imageUrl?: string;
  rating?: number;
  authorId?: string;
  because?: string;
  reason?: string;
}

const messages = defineMessages('components.Swipe.SwipeCardView', {
  want: 'Request',
  pass: 'Pass',
  seen: 'Seen It',
  rating: '{rating} / 10',
  bookRating: '{rating} / 5',
});

/** Distance in pixels a drag must travel to count as a swipe. */
export const SWIPE_THRESHOLD = 110;

/** Decides a swipe from a finished drag. Exposed for tests. */
export const swipeFromDrag = (
  dx: number,
  dy: number
): SwipeDirection | undefined => {
  if (-dy > SWIPE_THRESHOLD && Math.abs(dx) < SWIPE_THRESHOLD) return 'up';
  if (dx > SWIPE_THRESHOLD) return 'right';
  if (dx < -SWIPE_THRESHOLD) return 'left';
  return undefined;
};

interface SwipeCardViewProps {
  card: SwipeCardData;
  position: 0 | 1 | 2;
  exit?: SwipeDirection;
  disabled: boolean;
  onSwipe: (direction: SwipeDirection) => void;
}

const SwipeCardView = ({
  card,
  position,
  exit,
  disabled,
  onSwipe,
}: SwipeCardViewProps) => {
  const intl = useIntl();
  const start = useRef<{ x: number; y: number; id: number }>(undefined);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const isTop = position === 0;

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!isTop || disabled || event.button !== 0) return;
    // Let the details panel scroll on touch devices.
    if ((event.target as HTMLElement).closest('.swipe-card-body')) return;
    start.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!start.current || start.current.id !== event.pointerId) return;
    setOffset({
      x: event.clientX - start.current.x,
      y: event.clientY - start.current.y,
    });
  };

  const finishDrag = (event: PointerEvent<HTMLElement>, cancelled = false) => {
    if (!start.current || start.current.id !== event.pointerId) return;
    const direction = cancelled ? undefined : swipeFromDrag(offset.x, offset.y);
    start.current = undefined;
    setDragging(false);
    setOffset({ x: 0, y: 0 });
    if (direction) onSwipe(direction);
  };

  const stampOpacity = (stamp: 'want' | 'pass' | 'seen') => {
    const progress =
      stamp === 'want'
        ? offset.x / SWIPE_THRESHOLD
        : stamp === 'pass'
          ? -offset.x / SWIPE_THRESHOLD
          : -offset.y / SWIPE_THRESHOLD;
    const fromExit =
      (exit === 'right' && stamp === 'want') ||
      (exit === 'left' && stamp === 'pass') ||
      (exit === 'up' && stamp === 'seen');
    return fromExit ? 1 : Math.max(0, Math.min(1, progress));
  };

  // Runtime drag geometry is the only inline styling (see .swipe-card).
  const style = (
    dragging
      ? {
          '--swipe-offset-x': `${offset.x}px`,
          '--swipe-offset-y': `${Math.min(offset.y, 0)}px`,
          '--swipe-tilt': `${offset.x / 20}deg`,
        }
      : {}
  ) as CSSProperties;

  const stamp = (kind: 'want' | 'pass' | 'seen') => (
    <span
      className="swipe-card-stamp"
      data-stamp={kind}
      style={{ '--swipe-stamp-opacity': stampOpacity(kind) } as CSSProperties}
      aria-hidden="true"
    >
      <Badge
        badgeType={
          kind === 'want' ? 'success' : kind === 'pass' ? 'danger' : 'primary'
        }
      >
        {intl.formatMessage(messages[kind])}
      </Badge>
    </span>
  );

  return (
    <article
      className="swipe-card app-card-sub"
      data-stack-position={position}
      data-dragging={dragging}
      data-swipe-exit={exit}
      aria-hidden={!isTop}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finishDrag(event)}
      onPointerCancel={(event) => finishDrag(event, true)}
    >
      <div className="swipe-card-artwork">
        {card.imageUrl && (
          <CachedImage
            type={card.mediaType === 'book' ? 'book' : 'tmdb'}
            src={card.imageUrl}
            alt=""
            fill
            sizes="24rem"
            draggable={false}
          />
        )}
        {isTop && (
          <>
            {stamp('want')}
            {stamp('pass')}
            {stamp('seen')}
          </>
        )}
      </div>
      <div className="swipe-card-body">
        <div className="page-title-row">
          <h2 className="card-title">{card.title}</h2>
          {card.rating !== undefined && (
            <Badge>
              {intl.formatMessage(
                card.mediaType === 'book'
                  ? messages.bookRating
                  : messages.rating,
                { rating: card.rating }
              )}
            </Badge>
          )}
        </div>
        {card.subtitle && <p className="card-subheading">{card.subtitle}</p>}
        {(card.reason ?? card.because) && (
          <p className="card-body-text">{card.reason ?? card.because}</p>
        )}
        {card.overview && <p className="card-body-text">{card.overview}</p>}
      </div>
    </article>
  );
};

export default SwipeCardView;
