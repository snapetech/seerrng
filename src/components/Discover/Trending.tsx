import DiscoverBooks from '@app/components/Discover/DiscoverBooks';
import DiscoverMediaTabs, {
  type DiscoverMediaType,
} from '@app/components/Discover/DiscoverMediaTabs';
import DiscoverMovies from '@app/components/Discover/DiscoverMovies';
import DiscoverMusic from '@app/components/Discover/DiscoverMusic';
import DiscoverTv from '@app/components/Discover/DiscoverTv';
import defineMessages from '@app/utils/defineMessages';
import { useRouter } from 'next/router';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover', {
  trending: 'Trending',
});

const Trending = () => {
  const intl = useIntl();
  const router = useRouter();
  const mediaType: DiscoverMediaType =
    router.query.mediaType === 'tv' ||
    router.query.mediaType === 'music' ||
    router.query.mediaType === 'book' ||
    router.query.mediaType === 'audiobook'
      ? router.query.mediaType
      : 'movie';
  const title = intl.formatMessage(messages.trending);
  const mediaFilters = (
    <DiscoverMediaTabs selected={mediaType} basePath="/discover/trending" />
  );

  switch (mediaType) {
    case 'tv':
      return (
        <DiscoverTv
          titleOverride={title}
          initialFilters={{ sortBy: 'popularity.desc' }}
          randomizeOrder={false}
          mediaFilters={mediaFilters}
        />
      );
    case 'music':
      return (
        <DiscoverMusic titleOverride={title} mediaFilters={mediaFilters} />
      );
    case 'book':
    case 'audiobook':
      return (
        <DiscoverBooks
          format={mediaType === 'audiobook' ? 'audiobook' : 'ebook'}
          titleOverride={title}
          mediaFilters={mediaFilters}
          showFormatTabs={false}
        />
      );
    default:
      return (
        <DiscoverMovies
          titleOverride={title}
          initialFilters={{ sortBy: 'popularity.desc' }}
          randomizeOrder={false}
          mediaFilters={mediaFilters}
        />
      );
  }
};

export default Trending;
