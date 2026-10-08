import ArtistCard from '@app/components/ArtistCard';
import AuthorCard from '@app/components/AuthorCard';
import Button from '@app/components/Common/Button';
import PersonCard from '@app/components/PersonCard';
import TitleCard from '@app/components/TitleCard';
import LibraryTitleCard from '@app/components/TitleCard/LibraryTitleCard';
import TmdbTitleCard from '@app/components/TitleCard/TmdbTitleCard';
import useCardTextVisibility from '@app/hooks/useCardTextVisibility';
import useSettings from '@app/hooks/useSettings';
import { Permission, useUser } from '@app/hooks/useUser';
import useVerticalScroll from '@app/hooks/useVerticalScroll';
import useWarmImageCache, {
  MAIN_MEDIA_POSTER_CACHE_WARM_LIMIT,
} from '@app/hooks/useWarmImageCache';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import {
  canRequestMissingBookFormat,
  isBookInProgress,
} from '@app/utils/libraryMedia';
import { MediaStatus } from '@server/constants/media';
import type { WatchlistItem } from '@server/interfaces/api/discoverInterfaces';
import type { ComicResult } from '@server/models/Comic';
import type { MagazineResult } from '@server/models/Magazine';
import type {
  AlbumResult,
  ArtistResult,
  AuthorResult,
  BookResult,
  CollectionResult,
  MovieResult,
  PersonResult,
  TvResult,
} from '@server/models/Search';
import type { SportarrResult } from '@server/models/Sportarr';
import { useMemo } from 'react';
import { useIntl } from 'react-intl';
import { twMerge } from 'tailwind-merge';

type ListViewProps = {
  items?: (
    | TvResult
    | MovieResult
    | PersonResult
    | CollectionResult
    | ArtistResult
    | AlbumResult
    | BookResult
    | AuthorResult
    | ComicResult
    | MagazineResult
    | SportarrResult
  )[];
  plexItems?: WatchlistItem[];
  isEmpty?: boolean;
  isLoading?: boolean;
  isReachingEnd?: boolean;
  onScrollBottom: () => void;
  mutateParent?: () => void;
  preferredBookFormat?: 'ebook' | 'audiobook';
  showAllBookFormats?: boolean;
  posterTitleWeight?: 'regular';
  watchlistPreview?: boolean;
  watchlistPreviewDisabled?: boolean;
  emptyMessage?: React.ReactNode;
  emptyClassName?: string;
};

const messages = defineMessages('components.ListView', {
  continueSearch: 'Continue Search',
});

const ListView = ({
  items,
  isEmpty,
  isLoading,
  onScrollBottom,
  isReachingEnd,
  plexItems,
  mutateParent,
  preferredBookFormat,
  showAllBookFormats = false,
  posterTitleWeight,
  watchlistPreview = false,
  watchlistPreviewDisabled = false,
  emptyMessage,
  emptyClassName,
}: ListViewProps) => {
  const intl = useIntl();
  const { visibility } = useCardTextVisibility();
  const { hasPermission } = useUser();
  const { currentSettings } = useSettings();
  const canManageBlocklist = hasPermission(Permission.MANAGE_BLOCKLIST);

  const visibleItems = useMemo(
    () =>
      items?.filter(
        (title) =>
          (canManageBlocklist && !currentSettings.hideBlocklisted) ||
          (
            title as
              | TvResult
              | MovieResult
              | AlbumResult
              | BookResult
              | ComicResult
              | MagazineResult
              | SportarrResult
          ).mediaInfo?.status !== MediaStatus.BLOCKLISTED
      ),
    [items, canManageBlocklist, currentSettings.hideBlocklisted]
  );

  useWarmImageCache(visibleItems ?? [], {
    maxUrls: MAIN_MEDIA_POSTER_CACHE_WARM_LIMIT,
    posterOnly: true,
  });
  const plexCards = useMemo(
    () =>
      plexItems?.flatMap((title, index) => {
        const card =
          title.mediaType === 'music' && title.mbId ? (
            <LibraryTitleCard
              id={title.mbId}
              type="album"
              title={title.title}
              isAddedToWatchlist={true}
              canExpand
              mutateParent={mutateParent}
            />
          ) : title.mediaType === 'book' && title.externalId ? (
            <LibraryTitleCard
              id={title.externalId}
              type="book"
              title={title.title}
              isAddedToWatchlist={true}
              canExpand
              mutateParent={mutateParent}
            />
          ) : (title.mediaType === 'comic' || title.mediaType === 'magazine') &&
            title.externalId ? (
            <LibraryTitleCard
              id={title.externalId}
              type={title.mediaType}
              title={title.title}
              isAddedToWatchlist={true}
              canExpand
              mutateParent={mutateParent}
            />
          ) : title.tmdbId ? (
            <TmdbTitleCard
              id={title.tmdbId}
              tmdbId={title.tmdbId}
              type={title.mediaType === 'tv' ? 'tv' : 'movie'}
              title={title.title}
              isAddedToWatchlist={true}
              canExpand
              mutateParent={mutateParent}
            />
          ) : null;

        return card
          ? [<li key={`${title.ratingKey}-${index}`}>{card}</li>]
          : [];
      }),
    [mutateParent, plexItems]
  );
  const itemCards = useMemo(
    () =>
      visibleItems?.map((title) => {
        let titleCard: React.ReactNode;

        switch (title.mediaType) {
          case 'movie':
            titleCard = (
              <TitleCard
                titleWeight={posterTitleWeight}
                key={title.id}
                id={title.id}
                isAddedToWatchlist={title.mediaInfo?.watchlists?.length ?? 0}
                image={title.posterPath}
                status={title.mediaInfo?.status}
                status4k={title.mediaInfo?.status4k}
                summary={title.overview}
                title={title.title}
                userScore={title.voteAverage}
                voteCount={title.voteCount}
                year={title.releaseDate}
                mediaType={title.mediaType}
                inProgress={(title.mediaInfo?.downloadStatus ?? []).length > 0}
                inProgress4k={
                  (title.mediaInfo?.downloadStatus4k ?? []).length > 0
                }
                canExpand
                showText={visibility.movie === 'always'}
              />
            );
            break;
          case 'tv':
            titleCard = (
              <TitleCard
                titleWeight={posterTitleWeight}
                watchlistPreview={watchlistPreview}
                watchlistPreviewDisabled={watchlistPreviewDisabled}
                key={title.id}
                id={title.id}
                isAddedToWatchlist={title.mediaInfo?.watchlists?.length ?? 0}
                image={title.posterPath}
                status={title.mediaInfo?.status}
                status4k={title.mediaInfo?.status4k}
                summary={title.overview}
                title={title.name}
                userScore={title.voteAverage}
                voteCount={title.voteCount}
                year={title.firstAirDate}
                mediaType={title.mediaType}
                inProgress={(title.mediaInfo?.downloadStatus ?? []).length > 0}
                inProgress4k={
                  (title.mediaInfo?.downloadStatus4k ?? []).length > 0
                }
                canExpand
                showText={visibility.tv === 'always'}
              />
            );
            break;
          case 'sports':
            titleCard = (
              <TitleCard
                titleWeight={posterTitleWeight}
                key={title.id}
                id={title.id}
                image={title.posterPath}
                summary={title.overview}
                title={title.title}
                year={title.year ? String(title.year) : undefined}
                mediaType={title.mediaType}
                status={title.mediaInfo?.status}
                requestable={title.requestable}
                sportarrState={title.libraryState}
                canExpand
                showText={visibility.tv === 'always'}
              />
            );
            break;
          case 'collection':
            titleCard = (
              <TitleCard
                titleWeight={posterTitleWeight}
                id={title.id}
                image={title.posterPath}
                summary={title.overview}
                title={title.title}
                mediaType={title.mediaType}
                canExpand
              />
            );
            break;
          case 'person':
            titleCard = (
              <PersonCard
                personId={title.id}
                name={title.name}
                profilePath={title.profilePath}
                canExpand
              />
            );
            break;
          case 'album':
            titleCard = (
              <TitleCard
                titleWeight={posterTitleWeight}
                key={title.id}
                id={title.id}
                isAddedToWatchlist={title.mediaInfo?.watchlists?.length ?? 0}
                image={title.posterPath}
                status={title.mediaInfo?.status}
                title={title.title}
                artist={title['artist-credit']?.[0]?.name}
                type={title['primary-type']}
                year={
                  title.releaseDate ??
                  title['first-release-date']?.split('-')[0]
                }
                mediaType={title.mediaType}
                availableQualities={title.availableQualities}
                qualityStatuses={title.qualityStatuses}
                inProgress={(title.mediaInfo?.downloadStatus ?? []).length > 0}
                needsCoverArt={title.needsCoverArt}
                canExpand
                showText={visibility.album === 'always'}
              />
            );
            break;
          case 'artist':
            titleCard = title.tmdbPersonId ? (
              <PersonCard
                key={title.id}
                personId={title.tmdbPersonId}
                name={title.name}
                profilePath={title.artistThumb ?? undefined}
                subName={title.disambiguation}
                canExpand
              />
            ) : (
              <ArtistCard
                key={title.id}
                artistId={title.id}
                name={title.name}
                artistThumb={title.artistThumb}
                subName={title.disambiguation}
                canExpand
              />
            );
            break;
          case 'book':
            titleCard = (
              <TitleCard
                titleWeight={posterTitleWeight}
                key={title.id}
                id={title.id}
                image={title.posterPath}
                isAddedToWatchlist={title.mediaInfo?.watchlists?.length ?? 0}
                status={title.mediaInfo?.status}
                title={title.title}
                artist={title.author}
                bookRatingAverage={title.ratingsAverage}
                bookRatingCount={title.ratingsCount}
                year={title.firstPublishYear?.toString()}
                mediaType={title.mediaType}
                inProgress={isBookInProgress(title)}
                canRequestAdditionalFormat={canRequestMissingBookFormat(title)}
                canExpand
                showText={visibility.book === 'always'}
                preferredBookFormat={title.bookFormat ?? preferredBookFormat}
                showAllBookFormats={showAllBookFormats && !title.bookFormat}
              />
            );
            break;
          case 'comic':
            titleCard = (
              <TitleCard
                titleWeight={posterTitleWeight}
                key={title.id}
                id={title.id}
                isAddedToWatchlist={title.mediaInfo?.watchlists?.length ?? 0}
                image={title.posterPath}
                status={title.mediaInfo?.status}
                title={title.title}
                artist={title.publisher}
                year={title.startYear}
                mediaType={title.mediaType}
                canExpand
              />
            );
            break;
          case 'magazine':
            titleCard = (
              <TitleCard
                titleWeight={posterTitleWeight}
                key={title.id}
                id={title.id}
                isAddedToWatchlist={title.mediaInfo?.watchlists?.length ?? 0}
                image={title.posterPath}
                status={title.mediaInfo?.status}
                title={title.title}
                artist={
                  title.publisher ??
                  (title.latestIssue
                    ? `Latest issue ${title.latestIssue}`
                    : undefined)
                }
                year={title.firstPublishYear?.toString()}
                mediaType={title.mediaType}
                requestable={title.requestable}
                providerTracked={title.provider === 'lazylibrarian'}
                canExpand
              />
            );
            break;
          case 'author':
            titleCard = <AuthorCard key={title.id} author={title} canExpand />;
            break;
          default:
            return null;
        }

        return <li key={`${title.mediaType}:${title.id}`}>{titleCard}</li>;
      }),
    [
      visibleItems,
      visibility.album,
      visibility.book,
      visibility.movie,
      visibility.tv,
      preferredBookFormat,
      showAllBookFormats,
      posterTitleWeight,
      watchlistPreview,
      watchlistPreviewDisabled,
    ]
  );
  const hasRenderableItems =
    (plexCards?.length ?? 0) > 0 || (itemCards?.length ?? 0) > 0;
  const effectiveIsEmpty =
    isEmpty || (!isLoading && isReachingEnd && !hasRenderableItems);
  useVerticalScroll(
    onScrollBottom,
    !isLoading && !effectiveIsEmpty && !isReachingEnd
  );
  const placeholderCards = useMemo(
    () =>
      [...Array(20)].map((_item, i) => (
        <li key={`placeholder-${i}`}>
          <TitleCard.Placeholder canExpand />
        </li>
      )),
    []
  );

  return (
    <>
      {!hasRenderableItems && !isLoading && !isReachingEnd && (
        <Button onClick={onScrollBottom}>
          {intl.formatMessage(messages.continueSearch)}
        </Button>
      )}
      {effectiveIsEmpty && (
        <div
          className={twMerge('page-error-message', emptyClassName)}
          data-severity="empty"
          role="status"
        >
          {emptyMessage ?? intl.formatMessage(globalMessages.noresults)}
        </div>
      )}
      <ul className="cards-vertical poster-grid">
        {plexCards}
        {itemCards}
        {isLoading && !isReachingEnd && placeholderCards}
      </ul>
    </>
  );
};

export default ListView;
