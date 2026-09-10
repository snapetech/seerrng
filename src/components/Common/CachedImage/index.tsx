import useImageVariants from '@app/hooks/useImageVariants';
import useSettings from '@app/hooks/useSettings';
import type { CacheableImageType } from '@app/utils/imageCache';
import {
  AVATAR_FALLBACK_IMAGE,
  getImageCacheUrl,
  getImageErrorFallback,
  getInitialImageUrl,
} from '@app/utils/imageCache';
import type { ImageVariant } from '@app/utils/loadedImages';
import { UserIcon } from '@heroicons/react/24/solid';
import type { ImageLoader, ImageProps } from 'next/image';
import Image from 'next/image';
import { memo, useEffect, useMemo, useState } from 'react';

const imageLoader: ImageLoader = ({ src }) => src;

export type CachedImageProps = ImageProps & {
  src: string;
  type: CacheableImageType;
  variants?: readonly ImageVariant[];
};

/**
 * The CachedImage component should be used wherever
 * we want to offer the option to locally cache images.
 **/
const CachedImage = memo(
  ({
    src,
    type,
    variants,
    decoding = 'async',
    loading,
    priority,
    onError,
    onLoad,
    ...props
  }: CachedImageProps) => {
    const { currentSettings } = useSettings();

    const imageUrl = useMemo(
      () =>
        getImageCacheUrl({
          cacheImages: currentSettings.cacheImages,
          src,
          type,
        }),
      [currentSettings.cacheImages, src, type]
    );
    const resolvedVariants = variants?.map((variant) => ({
      ...variant,
      src: getImageCacheUrl({
        cacheImages: currentSettings.cacheImages,
        src: variant.src,
        type,
      }),
    }));
    const progressiveImage = useImageVariants(
      imageUrl,
      resolvedVariants,
      type !== 'avatar'
    );
    const [activeImageUrl, setActiveImageUrl] = useState(() =>
      getInitialImageUrl(type, imageUrl)
    );

    useEffect(() => {
      if (type !== 'avatar' || imageUrl === AVATAR_FALLBACK_IMAGE) {
        setActiveImageUrl(imageUrl);
        return;
      }

      setActiveImageUrl(AVATAR_FALLBACK_IMAGE);

      const avatarPreloader = new window.Image();
      avatarPreloader.onload = () => setActiveImageUrl(imageUrl);
      avatarPreloader.onerror = () => setActiveImageUrl(AVATAR_FALLBACK_IMAGE);
      avatarPreloader.src = imageUrl;

      return () => {
        avatarPreloader.onload = null;
        avatarPreloader.onerror = null;
      };
    }, [imageUrl, type]);

    if (type === 'avatar' && activeImageUrl === AVATAR_FALLBACK_IMAGE) {
      return (
        <UserIcon
          aria-label={typeof props.alt === 'string' ? props.alt : undefined}
          className={`inline-flex p-[15%] text-indigo-500 ${props.className ?? ''}`}
          role={props.alt ? 'img' : undefined}
        />
      );
    }

    const displayImageUrl =
      type === 'avatar' ? activeImageUrl : progressiveImage.src;

    return (
      <Image
        unoptimized
        loader={imageLoader}
        src={displayImageUrl}
        ref={progressiveImage.ref}
        decoding={decoding}
        loading={priority ? undefined : (loading ?? 'lazy')}
        priority={priority}
        onLoad={(event) => {
          if (type !== 'avatar') progressiveImage.onLoad(event.currentTarget);
          onLoad?.(event);
        }}
        onError={(event) => {
          if (type !== 'avatar') progressiveImage.onError(event.currentTarget);
          const fallbackImage = getImageErrorFallback(type, displayImageUrl);
          if (fallbackImage) {
            setActiveImageUrl(fallbackImage);
          }
          onError?.(event);
        }}
        {...props}
      />
    );
  }
);

CachedImage.displayName = 'CachedImage';

export default CachedImage;
