import useSettings from '@app/hooks/useSettings';
import { Permission, useUser } from '@app/hooks/useUser';
import { Transition } from '@headlessui/react';
import type { MediaStatus } from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { NonFunctionProperties } from '@server/interfaces/api/common';
import dynamic from 'next/dynamic';

const BookRequestModal = dynamic(
  () => import('@app/components/RequestModal/BookRequestModal'),
  { ssr: false }
);
const ComicRequestModal = dynamic(
  () => import('@app/components/RequestModal/ComicRequestModal'),
  { ssr: false }
);
const MagazineRequestModal = dynamic(
  () => import('@app/components/RequestModal/MagazineRequestModal'),
  { ssr: false }
);
const SportarrRequestModal = dynamic(
  () => import('@app/components/RequestModal/SportarrRequestModal'),
  { ssr: false }
);
const CollectionRequestModal = dynamic(
  () => import('@app/components/RequestModal/CollectionRequestModal'),
  { ssr: false }
);
const MovieRequestModal = dynamic(
  () => import('@app/components/RequestModal/MovieRequestModal'),
  { ssr: false }
);
const MusicRequestModal = dynamic(
  () => import('@app/components/RequestModal/MusicRequestModal'),
  { ssr: false }
);
const TvRequestModal = dynamic(
  () => import('@app/components/RequestModal/TvRequestModal'),
  { ssr: false }
);

interface RequestModalProps {
  show: boolean;
  type:
    | 'movie'
    | 'tv'
    | 'collection'
    | 'music'
    | 'book'
    | 'comic'
    | 'magazine'
    | 'sports';
  tmdbId?: number;
  mbId?: string;
  bookId?: string;
  comicId?: string;
  magazineTitle?: string;
  sportarrLeagueId?: string;
  sportarrTitle?: string;
  initialBookFormat?: 'ebook' | 'audiobook' | 'both';
  initialMusicServerId?: number;
  initialIs4k?: boolean;
  is4k?: boolean;
  editRequest?: NonFunctionProperties<MediaRequest>;
  show4kSelector?: boolean;
  onComplete?: (newStatus: MediaStatus, is4k?: boolean) => void;
  onCancel?: () => void;
  onUpdating?: (isUpdating: boolean) => void;
}

const RequestModal = ({
  type,
  show,
  tmdbId,
  mbId,
  bookId,
  comicId,
  magazineTitle,
  sportarrLeagueId,
  sportarrTitle,
  initialBookFormat,
  initialMusicServerId,
  initialIs4k,
  is4k,
  editRequest,
  show4kSelector = true,
  onComplete,
  onUpdating,
  onCancel,
}: RequestModalProps) => {
  const settings = useSettings();
  const { hasPermission } = useUser();
  const canRequestStandard =
    (type === 'movie' || type === 'tv') &&
    hasPermission(
      [
        Permission.REQUEST,
        type === 'movie' ? Permission.REQUEST_MOVIE : Permission.REQUEST_TV,
      ],
      { type: 'or' }
    );
  const canRequest4k =
    (type === 'movie' || type === 'tv') &&
    hasPermission(
      [
        Permission.REQUEST_4K,
        type === 'movie'
          ? Permission.REQUEST_4K_MOVIE
          : Permission.REQUEST_4K_TV,
      ],
      { type: 'or' }
    );
  const canSelect4k =
    show4kSelector &&
    !editRequest &&
    (type === 'movie' || type === 'tv') &&
    ((type === 'movie' && settings.currentSettings.movie4kEnabled) ||
      (type === 'tv' && settings.currentSettings.series4kEnabled)) &&
    canRequest4k;
  const modalIs4k =
    is4k ?? initialIs4k ?? (!canRequestStandard && canRequest4k);

  return (
    <Transition
      as="div"

      show={show}
    >
      {type === 'music' && mbId ? (
        <MusicRequestModal
          onComplete={onComplete}
          onCancel={onCancel}
          mbId={mbId}
          initialServerId={initialMusicServerId}
          onUpdating={onUpdating}
          editRequest={editRequest}
        />
      ) : type === 'book' && bookId ? (
        <BookRequestModal
          onComplete={onComplete}
          onCancel={onCancel}
          bookId={bookId}
          initialBookFormat={initialBookFormat}
          onUpdating={onUpdating}
          editRequest={editRequest}
        />
      ) : type === 'comic' && comicId ? (
        <ComicRequestModal
          onComplete={onComplete}
          onCancel={onCancel}
          comicId={comicId}
          onUpdating={onUpdating}
          editRequest={editRequest}
        />
      ) : type === 'magazine' && magazineTitle ? (
        <MagazineRequestModal
          magazineTitle={magazineTitle}
          onComplete={onComplete}
          onCancel={onCancel}
          onUpdating={onUpdating}
          editRequest={editRequest}
        />
      ) : type === 'sports' && sportarrLeagueId ? (
        <SportarrRequestModal
          leagueId={sportarrLeagueId}
          leagueTitle={sportarrTitle}
          onComplete={onComplete}
          onCancel={onCancel}
          onUpdating={onUpdating}
          editRequest={editRequest}
        />
      ) : type === 'movie' && tmdbId ? (
        <MovieRequestModal
          onComplete={onComplete}
          onCancel={onCancel}
          tmdbId={tmdbId}
          onUpdating={onUpdating}
          is4k={modalIs4k}
          editRequest={editRequest}
          allow4kServerSelection={canSelect4k}
        />
      ) : type === 'tv' && tmdbId ? (
        <TvRequestModal
          onComplete={onComplete}
          onCancel={onCancel}
          tmdbId={tmdbId}
          onUpdating={onUpdating}
          is4k={modalIs4k}
          editRequest={editRequest}
          allow4kServerSelection={canSelect4k}
        />
      ) : tmdbId ? (
        <CollectionRequestModal
          onComplete={onComplete}
          onCancel={onCancel}
          tmdbId={tmdbId}
          onUpdating={onUpdating}
          is4k={is4k}
        />
      ) : null}
    </Transition>
  );
};

export default RequestModal;
