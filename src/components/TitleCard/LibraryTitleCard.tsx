import TitleCard from '@app/components/TitleCard';
import { Permission, useUser } from '@app/hooks/useUser';
import {
  encodeApiPathSegment,
  normalizeExternalTitleId,
} from '@app/utils/apiPath';
import {
  canRequestMissingBookFormat,
  isBookInProgress,
} from '@app/utils/libraryMedia';
import type { BookDetails } from '@server/models/Book';
import type { ComicDetails } from '@server/models/Comic';
import type { MagazineDetails } from '@server/models/Magazine';
import type { MusicDetails } from '@server/models/Music';
import { useMemo } from 'react';
import { useInView } from 'react-intersection-observer';
import useSWR from 'swr';

export interface LibraryTitleCardProps {
  id: string;
  type: 'album' | 'book' | 'comic' | 'magazine';
  title?: string;
  canExpand?: boolean;
  isAddedToWatchlist?: boolean;
  mutateParent?: () => void;
}

const LibraryTitleCard = ({
  id,
  type,
  title: fallbackTitle,
  canExpand,
  isAddedToWatchlist = false,
  mutateParent,
}: LibraryTitleCardProps) => {
  const { hasPermission } = useUser();
  const { ref, inView } = useInView({
    rootMargin: '100% 0px',
    triggerOnce: true,
  });
  const normalizedId = normalizeExternalTitleId(type, id).toString();
  const url = useMemo(
    () =>
      type === 'album'
        ? `/api/v1/music/${encodeApiPathSegment(normalizedId)}`
        : type === 'book'
          ? `/api/v1/book/${encodeApiPathSegment(normalizedId)}`
          : type === 'comic'
            ? `/api/v1/comic/${encodeApiPathSegment(normalizedId)}`
            : `/api/v1/magazine/${encodeApiPathSegment(normalizedId)}`,
    [normalizedId, type]
  );
  const { data: title, error } = useSWR<
    MusicDetails | BookDetails | ComicDetails | MagazineDetails
  >(inView ? url : null, {
    dedupingInterval: 30000,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  if (!title && !error && fallbackTitle) {
    return (
      <div ref={ref}>
        <TitleCard
          id={normalizedId}
          title={fallbackTitle}
          mediaType={type}
          isAddedToWatchlist={isAddedToWatchlist}
          canExpand={canExpand}
          mutateParent={mutateParent}
        />
      </div>
    );
  }

  if (!title && !error) {
    return (
      <div ref={ref}>
        <TitleCard.Placeholder canExpand={canExpand} />
      </div>
    );
  }

  if (!title) {
    return hasPermission(Permission.ADMIN) ? (
      <TitleCard
        id={normalizedId}
        title={fallbackTitle ?? normalizedId}
        mediaType={type}
        isAddedToWatchlist={isAddedToWatchlist}
        canExpand={canExpand}
        mutateParent={mutateParent}
      />
    ) : null;
  }

  if (type === 'album') {
    const album = title as MusicDetails;
    const availableServiceQualities = (album.availableServices ?? []).map(
      (service) => service.quality.toUpperCase()
    );
    const availableQualities = (['MP3', 'FLAC'] as const).filter((quality) =>
      availableServiceQualities.some((serviceQuality) =>
        serviceQuality.includes(quality)
      )
    );

    return (
      <TitleCard
        key={album.id}
        id={album.id}
        isAddedToWatchlist={album.mediaInfo?.watchlists?.length ?? true}
        image={album.posterPath}
        status={album.mediaInfo?.status}
        title={album.title}
        artist={album.artist?.name}
        type={album.type}
        year={album.releaseDate}
        mediaType="album"
        availableQualities={availableQualities}
        inProgress={(album.mediaInfo?.downloadStatus ?? []).length > 0}
        needsCoverArt={album.needsCoverArt}
        canExpand={canExpand}
        mutateParent={mutateParent}
      />
    );
  }

  if (type === 'book') {
    const book = title as BookDetails;

    return (
      <TitleCard
        key={book.id}
        id={book.id}
        image={book.posterPath}
        isAddedToWatchlist={book.mediaInfo?.watchlists?.length ?? true}
        status={book.mediaInfo?.status}
        title={book.title}
        artist={book.author}
        year={book.firstPublishYear?.toString()}
        mediaType="book"
        inProgress={isBookInProgress(book)}
        canRequestAdditionalFormat={canRequestMissingBookFormat(book)}
        canExpand={canExpand}
        mutateParent={mutateParent}
      />
    );
  }

  if (type === 'comic') {
    const comic = title as ComicDetails;

    return (
      <TitleCard
        key={comic.id}
        id={comic.id}
        image={comic.posterPath}
        isAddedToWatchlist={comic.onUserWatchlist ?? isAddedToWatchlist}
        status={comic.mediaInfo?.status}
        title={comic.title}
        artist={comic.publisher}
        year={comic.startYear}
        mediaType="comic"
        canExpand={canExpand}
        mutateParent={mutateParent}
      />
    );
  }

  const magazine = title as MagazineDetails;

  return (
    <TitleCard
      key={magazine.id}
      id={magazine.id}
      image={magazine.posterPath}
      isAddedToWatchlist={magazine.onUserWatchlist ?? isAddedToWatchlist}
      status={magazine.mediaInfo?.status}
      title={magazine.title}
      artist={
        magazine.latestIssue
          ? `Latest issue ${magazine.latestIssue}`
          : undefined
      }
      mediaType="magazine"
      canExpand={canExpand}
      mutateParent={mutateParent}
    />
  );
};

export default LibraryTitleCard;
