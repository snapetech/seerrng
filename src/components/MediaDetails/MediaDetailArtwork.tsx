import CachedImage from '@app/components/Common/CachedImage';
import useSettings from '@app/hooks/useSettings';
import type { CacheableImageType } from '@app/utils/imageCache';
import { getImageCacheUrl } from '@app/utils/imageCache';
import type { CSSProperties } from 'react';

interface MediaDetailArtworkProps {
  src: string;
  type: CacheableImageType;
}

const MediaDetailArtwork = ({ src, type }: MediaDetailArtworkProps) => {
  const { currentSettings } = useSettings();
  const resolvedSrc = getImageCacheUrl({
    cacheImages: currentSettings.cacheImages,
    src,
    type,
  });
  const artworkStyle = {
    '--media-detail-artwork-url': `url(${JSON.stringify(resolvedSrc)})`,
  } as CSSProperties;

  return (
    <div
      className="media-detail-artwork-layer"
      style={artworkStyle}
      aria-hidden
    >
      <CachedImage
        type={type}
        src={src}
        alt=""
        fill
        priority
        sizes="100vw"
        className="media-detail-artwork-image object-cover object-top"
      />
      <div className="refreshed-artwork-scrim" />
      <div className="refreshed-artwork-gradient" />
    </div>
  );
};

export default MediaDetailArtwork;
