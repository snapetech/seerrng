import CachedImage from '@app/components/Common/CachedImage';
import type { CacheableImageType } from '@app/utils/imageCache';
import type { ReactNode } from 'react';

interface RequestMediaCardProps {
  artwork?: string | null;
  artworkType: CacheableImageType;
  children: ReactNode;
}

const RequestMediaCard = ({
  artwork,
  artworkType,
  children,
}: RequestMediaCardProps) => (
  <article className="media-detail-card refreshed-card-surface relative overflow-hidden rounded-xl border border-gray-700 p-3 shadow-lg shadow-gray-950/20">
    {artwork && (
      <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
        <CachedImage
          type={artworkType}
          src={artwork}
          alt=""
          fill
          priority
          sizes="(min-width: 1024px) 64rem, 100vw"
          className="object-cover object-top"
        />
        <div className="refreshed-artwork-scrim" />
        <div className="refreshed-artwork-gradient" />
      </div>
    )}
    <div className="relative z-10">{children}</div>
  </article>
);

export default RequestMediaCard;
