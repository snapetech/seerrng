import CachedImage from '@app/components/Common/CachedImage';
import Placeholder from '@app/components/TitleCard/Placeholder';
import defineMessages from '@app/utils/defineMessages';
import { getTmdbPosterImageUrl } from '@app/utils/imageCache';
import { ArrowRightCircleIcon } from '@heroicons/react/24/solid';
import Link from 'next/link';
import { memo, useMemo } from 'react';
import { useInView } from 'react-intersection-observer';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.MediaSlider.ShowMoreCard', {
  seemore: 'See More',
});

interface ShowMoreCardProps {
  url: string;
  posters: (string | undefined)[];
}

const getImageProps = (poster: string) => {
  if (poster.startsWith('https://coverartarchive.org/')) {
    return { type: 'music' as const, src: poster };
  }

  if (poster.startsWith('https://covers.openlibrary.org/')) {
    return { type: 'book' as const, src: poster };
  }

  return {
    type: 'tmdb' as const,
    src: getTmdbPosterImageUrl(poster),
  };
};

const ShowMoreCard = memo(({ url, posters }: ShowMoreCardProps) => {
  const intl = useIntl();
  const { ref, inView } = useInView({
    triggerOnce: true,
  });
  const imageProps = useMemo(
    () => posters.map((poster) => (poster ? getImageProps(poster) : undefined)),
    [posters]
  );

  if (!inView) {
    return (
      <div ref={ref}>
        <Placeholder />
      </div>
    );
  }

  return (
    <Link
      href={url}
      prefetch={false}
      className="group w-36 sm:w-36 md:w-44"
      role="link"
      tabIndex={0}
    >
      <div className="relative w-36 transform-gpu cursor-pointer overflow-hidden rounded-xl bg-gray-800 text-white shadow-lg ring-1 ring-gray-700 transition duration-150 ease-in-out group-hover:scale-105 group-hover:bg-gray-600 group-hover:ring-gray-500 group-focus-visible:scale-105 group-focus-visible:bg-gray-600 group-focus-visible:ring-gray-500 sm:w-36 md:w-44">
        <div style={{ paddingBottom: '150%' }}>
          <div className="absolute inset-0 flex h-full w-full flex-col items-center p-2">
            <div className="relative z-10 grid h-full w-full grid-cols-2 items-center justify-center gap-2 opacity-30">
              {imageProps[0] && (
                <div className="">
                  <CachedImage
                    type={imageProps[0].type}
                    src={imageProps[0].src}
                    alt=""
                    className="rounded-md"
                    width={300}
                    height={450}
                  />
                </div>
              )}
              {imageProps[1] && (
                <div className="">
                  <CachedImage
                    type={imageProps[1].type}
                    src={imageProps[1].src}
                    alt=""
                    className="rounded-md"
                    width={300}
                    height={450}
                  />
                </div>
              )}
              {imageProps[2] && (
                <div className="">
                  <CachedImage
                    type={imageProps[2].type}
                    src={imageProps[2].src}
                    alt=""
                    className="rounded-md"
                    width={300}
                    height={450}
                  />
                </div>
              )}
              {imageProps[3] && (
                <div className="">
                  <CachedImage
                    type={imageProps[3].type}
                    src={imageProps[3].src}
                    alt=""
                    className="rounded-md"
                    width={300}
                    height={450}
                  />
                </div>
              )}
            </div>
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center text-white">
              <ArrowRightCircleIcon className="w-14" />
              <div className="mt-2 font-extrabold">
                {intl.formatMessage(messages.seemore)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
});

ShowMoreCard.displayName = 'ShowMoreCard';

export default ShowMoreCard;
