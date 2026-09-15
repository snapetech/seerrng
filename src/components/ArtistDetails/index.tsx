import AssociationBadge from '@app/components/Association/AssociationBadge';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import MediaTypeBadge from '@app/components/Common/MediaTypeBadge';
import PageTitle from '@app/components/Common/PageTitle';
import MediaSlider from '@app/components/MediaSlider';
import BulkRequestModal from '@app/components/RequestModal/BulkRequestModal';
import TitleCard from '@app/components/TitleCard';
import { Permission, useUser } from '@app/hooks/useUser';
import ErrorPage from '@app/pages/_error';
import { encodeApiPathSegment } from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
import { ArrowDownTrayIcon } from '@heroicons/react/24/solid';
import { MediaStatus } from '@server/constants/media';
import type Media from '@server/entity/Media';
import type { AlbumResult } from '@server/models/Search';
import axios from 'axios';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.ArtistDetails', {
  album: 'Album',
  single: 'Single',
  ep: 'EP',
  live: 'Live',
  compilation: 'Compilation',
  remix: 'Remix',
  soundtrack: 'Soundtrack',
  broadcast: 'Broadcast',
  demo: 'Demo',
  other: 'Other',
  similarartists: 'Similar Artists',
  showall: 'Show All',
  showless: 'Show Less',
  requestdiscography: 'Request Discography',
});

interface Album {
  id: string;
  title?: string;
  'first-release-date'?: string;
  posterPath?: string | null;
  'primary-type'?: string;
  secondary_types?: string[];
  'artist-credit'?: { name: string }[];
  availableQualities?: ('MP3' | 'FLAC')[];
  qualityStatuses?: AlbumResult['qualityStatuses'];
  mediaInfo?: Media;
}

interface ArtistData {
  artist?: {
    name: string;
    area?: string;
  };
  name?: string;
  artistThumb?: string;
  artistBackdrop?: string;
  biography?: string;
  wikipedia?: {
    content: string;
  };
  birthday?: string;
  deathday?: string;
  releaseGroups: Album[];
  typeCounts?: Record<string, number>;
}

interface AlbumTypeState {
  albums: Album[];
  isExpanded: boolean;
  isLoading: boolean;
}

const albumTypeMessages: Record<string, keyof typeof messages> = {
  Album: 'album',
  EP: 'ep',
  Single: 'single',
  Live: 'live',
  Compilation: 'compilation',
  Remix: 'remix',
  Soundtrack: 'soundtrack',
  Broadcast: 'broadcast',
  Demo: 'demo',
  Other: 'other',
};

const ArtistDetails = () => {
  const intl = useIntl();
  const router = useRouter();
  const { hasPermission } = useUser();
  const artistId = router.query.artistId as string | undefined;
  const [showBulkRequestModal, setShowBulkRequestModal] = useState(false);
  const { data, error } = useSWR<ArtistData>(
    artistId ? `/api/v1/artist/${encodeApiPathSegment(artistId)}` : null,
    { revalidateOnFocus: false, dedupingInterval: 30000 }
  );
  const [albumTypes, setAlbumTypes] = useState<Record<string, AlbumTypeState>>(
    {}
  );

  useEffect(() => {
    if (!data?.releaseGroups) {
      return;
    }

    const grouped: Record<string, AlbumTypeState> = {};

    data.releaseGroups.forEach((album) => {
      if (!album?.id) {
        return;
      }

      const type =
        album.secondary_types?.[0] ?? album['primary-type'] ?? 'Other';
      grouped[type] ??= { albums: [], isExpanded: false, isLoading: false };
      grouped[type].albums.push(album);
    });

    setAlbumTypes(grouped);
  }, [data]);

  const artistName = useMemo(
    () => data?.artist?.name ?? data?.name ?? '',
    [data]
  );

  const biography = data?.biography ?? data?.wikipedia?.content ?? '';

  const loadAllAlbumsOfType = useCallback(
    async (albumType: string) => {
      if (!artistId) {
        return;
      }

      setAlbumTypes((previous) => ({
        ...previous,
        [albumType]: { ...previous[albumType], isLoading: true },
      }));

      try {
        const pageSize = Math.min(data?.typeCounts?.[albumType] ?? 100, 1000);
        const response = await axios.get<ArtistData>(
          `/api/v1/artist/${encodeApiPathSegment(artistId)}`,
          { params: { albumType, pageSize } }
        );

        setAlbumTypes((previous) => ({
          ...previous,
          [albumType]: {
            albums: response.data.releaseGroups.filter((album) => album?.id),
            isExpanded: true,
            isLoading: false,
          },
        }));
      } catch {
        setAlbumTypes((previous) => ({
          ...previous,
          [albumType]: { ...previous[albumType], isLoading: false },
        }));
      }
    },
    [artistId, data?.typeCounts]
  );

  const toggleType = useCallback(
    (albumType: string) => {
      const current = albumTypes[albumType];

      if (current?.isExpanded) {
        setAlbumTypes((previous) => ({
          ...previous,
          [albumType]: { ...previous[albumType], isExpanded: false },
        }));
        return;
      }

      if (
        (current?.albums.length ?? 0) < (data?.typeCounts?.[albumType] ?? 0)
      ) {
        loadAllAlbumsOfType(albumType);
        return;
      }

      setAlbumTypes((previous) => ({
        ...previous,
        [albumType]: { ...previous[albumType], isExpanded: true },
      }));
    },
    [albumTypes, data?.typeCounts, loadAllAlbumsOfType]
  );

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  if (!data) {
    return <ErrorPage statusCode={404} />;
  }

  const albumTypeOrder = [
    'Album',
    'EP',
    'Single',
    'Live',
    'Compilation',
    'Remix',
    'Soundtrack',
    'Broadcast',
    'Demo',
    'Other',
  ];

  return (
    <>
      <PageTitle title={artistName} />
      {showBulkRequestModal && artistId && (
        <BulkRequestModal
          show={showBulkRequestModal}
          mediaType="music"
          artistId={artistId}
          title={artistName}
          onCancel={() => setShowBulkRequestModal(false)}
        />
      )}
      <div className="relative z-10 mt-4 mb-10 flex flex-col items-center gap-6 text-gray-300 lg:flex-row lg:items-start">
        {data.artistThumb && (
          <div className="relative h-36 w-36 flex-shrink-0 overflow-hidden rounded-full ring-1 ring-gray-700 lg:h-44 lg:w-44">
            <CachedImage
              type="music"
              src={data.artistThumb}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              fill
            />
          </div>
        )}
        <div className="min-w-0 text-center lg:text-left">
          <div className="flex min-w-0 flex-wrap items-center justify-center gap-3 lg:justify-start">
            <MediaTypeBadge mediaType="artist" variant="inline" />
            <h1 className="min-w-0 text-3xl font-bold break-words text-white lg:text-5xl">
              {artistName}
            </h1>
            {artistId && (
              <div className="flex-shrink-0">
                <AssociationBadge
                  mediaType="artist"
                  id={artistId}
                  variant="inline"
                />
              </div>
            )}
          </div>
          {data.artist?.area && <div className="mt-2">{data.artist.area}</div>}
          {biography && (
            <p className="mt-4 max-w-4xl text-sm leading-6 lg:text-base">
              {biography}
            </p>
          )}
          {hasPermission([Permission.REQUEST, Permission.REQUEST_MUSIC], {
            type: 'or',
          }) && (
            <div className="mt-5">
              <Button
                buttonType="primary"
                onClick={() => setShowBulkRequestModal(true)}
              >
                <ArrowDownTrayIcon />
                <span>{intl.formatMessage(messages.requestdiscography)}</span>
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-8">
        {artistId && (
          <MediaSlider
            sliderKey="artist-similar-artists"
            title={intl.formatMessage(messages.similarartists)}
            url={`/api/v1/artist/${encodeApiPathSegment(artistId)}/similar`}
            hideWhenEmpty
          />
        )}
        {albumTypeOrder
          .filter((type) => (albumTypes[type]?.albums.length ?? 0) > 0)
          .map((type) => {
            const state = albumTypes[type];
            const displayAlbums = state.isExpanded
              ? state.albums
              : state.albums.slice(0, 20);
            const totalCount = data.typeCounts?.[type] ?? state.albums.length;

            return (
              <section key={type}>
                <div className="slider-header">
                  <div className="slider-title">
                    {intl.formatMessage(messages[albumTypeMessages[type]])}
                    <span className="ml-2 text-sm text-gray-400">
                      ({totalCount})
                    </span>
                  </div>
                  {totalCount > 20 && (
                    <button
                      type="button"
                      className="text-sm font-medium text-gray-300 transition hover:text-white"
                      onClick={() => toggleType(type)}
                    >
                      {intl.formatMessage(
                        state.isExpanded ? messages.showless : messages.showall
                      )}
                    </button>
                  )}
                </div>
                <ul className="cards-vertical">
                  {displayAlbums.map((album) => (
                    <li key={`release-${album.id}`}>
                      <TitleCard
                        id={album.id}
                        title={album.title ?? 'Unknown Album'}
                        year={album['first-release-date']}
                        image={album.posterPath ?? undefined}
                        mediaType="album"
                        artist={album['artist-credit']?.[0]?.name ?? artistName}
                        type={album['primary-type']}
                        status={album.mediaInfo?.status ?? MediaStatus.UNKNOWN}
                        availableQualities={album.availableQualities}
                        qualityStatuses={album.qualityStatuses}
                        inProgress={
                          (album.mediaInfo?.downloadStatus ?? []).length > 0
                        }
                        canExpand
                      />
                    </li>
                  ))}
                  {state.isLoading &&
                    [...Array(10)].map((_, index) => (
                      <li key={`placeholder-${type}-${index}`}>
                        <TitleCard.Placeholder canExpand />
                      </li>
                    ))}
                </ul>
              </section>
            );
          })}
      </div>
    </>
  );
};

export default ArtistDetails;
