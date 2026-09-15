import CachedImage from '@app/components/Common/CachedImage';
import AvailabilityValue from '@app/components/MediaDetails/AvailabilityValue';
import type { AssociationEdge } from '@app/hooks/useAssociations';
import globalMessages from '@app/i18n/globalMessages';
import { MediaStatus } from '@server/constants/media';
import Link from 'next/link';
import { useIntl } from 'react-intl';
import {
  nodeBackdrop,
  nodeHref,
  nodeImage,
  nodeImageType,
  nodeTitle,
} from './helpers';

const getMediaLabel = (edge: AssociationEdge) => {
  switch (edge.node.mediaType) {
    case 'movie':
      return 'Movie';
    case 'tv':
      return 'Series';
    case 'album':
      return 'Album';
    case 'artist':
      return 'Artist';
    case 'book':
      return 'Book';
    case 'person':
      return 'Person';
  }
};

const getReleaseDate = (edge: AssociationEdge) => {
  switch (edge.node.mediaType) {
    case 'movie':
      return edge.node.releaseDate;
    case 'tv':
      return edge.node.firstAirDate;
    case 'album':
      return edge.node['first-release-date'];
    case 'book':
      return edge.node.firstPublishYear?.toString();
    default:
      return undefined;
  }
};

const getStatusLabel = (status: MediaStatus | undefined) => {
  switch (status) {
    case MediaStatus.AVAILABLE:
      return globalMessages.available;
    case MediaStatus.PARTIALLY_AVAILABLE:
      return globalMessages.partiallyavailable;
    case MediaStatus.PROCESSING:
      return globalMessages.processing;
    case MediaStatus.PENDING:
      return globalMessages.requested;
    case MediaStatus.BLOCKLISTED:
      return globalMessages.blocklisted;
    default:
      return globalMessages.notrequested;
  }
};

interface AssociationDetailCardProps {
  edge: AssociationEdge;
  onSelect?: () => void;
}

const AssociationDetailCard = ({
  edge,
  onSelect,
}: AssociationDetailCardProps) => {
  const intl = useIntl();
  const image = nodeImage(edge.node);
  const backdrop = nodeBackdrop(edge.node);
  const mediaInfo = 'mediaInfo' in edge.node ? edge.node.mediaInfo : undefined;
  const isAlbum = edge.node.mediaType === 'album';
  const qualityStatuses =
    edge.node.mediaType === 'album' ? edge.node.qualityStatuses : undefined;
  const status = isAlbum
    ? (qualityStatuses?.find(({ quality }) => quality === 'MP3')?.status ??
      mediaInfo?.status)
    : mediaInfo?.status;
  const status4k = isAlbum
    ? (qualityStatuses?.find(({ quality }) => quality === 'FLAC')?.status ??
      mediaInfo?.status4k)
    : mediaInfo?.status4k;
  const primaryQualityLabel = isAlbum ? 'MP3' : 'HD';
  const secondaryQualityLabel = isAlbum ? 'FLAC' : '4K';

  return (
    <article className="refreshed-card-surface relative overflow-hidden rounded-xl border border-gray-700 p-3 shadow-lg shadow-gray-950/20">
      {backdrop && (
        <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
          <CachedImage
            type={nodeImageType(edge.node)}
            src={backdrop}
            alt=""
            fill
            sizes="(min-width: 640px) 56rem, 100vw"
            className="object-cover object-center"
          />
          <div className="refreshed-artwork-scrim" />
          <div className="refreshed-artwork-gradient" />
        </div>
      )}

      <div className="relative z-10 grid min-w-0 grid-cols-[64px_minmax(0,1fr)] gap-3 sm:grid-cols-[80px_minmax(0,1fr)]">
        <Link
          href={nodeHref(edge.node)}
          onClick={onSelect}
          className="relative h-24 w-16 overflow-hidden rounded-lg ring-1 ring-gray-600 transition hover:ring-indigo-400 focus:ring-2 focus:ring-cyan-400 focus:outline-none sm:h-[120px] sm:w-20"
          aria-label={nodeTitle(edge.node)}
        >
          {image && (
            <CachedImage
              type={nodeImageType(edge.node)}
              src={image}
              alt=""
              fill
              sizes="(min-width: 640px) 80px, 64px"
              className="object-cover"
            />
          )}
        </Link>

        <div className="flex min-w-0 flex-col">
          <Link
            href={nodeHref(edge.node)}
            onClick={onSelect}
            className="-mt-0.5 block truncate text-lg leading-5 font-semibold text-white underline decoration-white/45 underline-offset-2 transition hover:decoration-white focus:ring-2 focus:ring-cyan-400 focus:outline-none"
          >
            {nodeTitle(edge.node)}
          </Link>

          <div className="card:grid-cols-3 mt-4 grid min-h-0 min-w-0 flex-1 grid-cols-1 items-stretch text-xs leading-4">
            <dl className="card:col-span-2 card:pr-3 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5">
              <dt className="font-medium text-gray-100">Media &amp; Format:</dt>
              <dd className="m-0 truncate">{getMediaLabel(edge)}</dd>
              <dt className="font-medium text-gray-100">Release Date:</dt>
              <dd className="m-0 truncate">
                {getReleaseDate(edge) || 'Not available'}
              </dd>
            </dl>

            <dl className="media-detail-column-divider grid h-full min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 text-gray-300">
              <dt className="font-medium text-gray-100">
                {primaryQualityLabel}:
              </dt>
              <dd className="m-0 truncate">
                <AvailabilityValue status={status}>
                  {intl.formatMessage(getStatusLabel(status))}
                </AvailabilityValue>
              </dd>
              <dt className="font-medium text-gray-100">
                {secondaryQualityLabel}:
              </dt>
              <dd className="m-0 truncate">
                <AvailabilityValue status={status4k}>
                  {intl.formatMessage(getStatusLabel(status4k))}
                </AvailabilityValue>
              </dd>
              <div className="col-span-2 h-4" aria-hidden="true" />
              <dd className="col-span-2 m-0 line-clamp-2 min-w-0 whitespace-normal">
                {edge.reason}
              </dd>
            </dl>
          </div>
        </div>
      </div>
    </article>
  );
};

export default AssociationDetailCard;
