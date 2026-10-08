import Tooltip from '@app/components/Common/Tooltip';
import globalMessages from '@app/i18n/globalMessages';
import {
  BookOpenIcon,
  FilmIcon,
  MusicalNoteIcon,
  NewspaperIcon,
  RectangleStackIcon,
  Square3Stack3DIcon,
  TrophyIcon,
  TvIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline';
import { useIntl } from 'react-intl';

export type MediaTypeBadgeType =
  | 'movie'
  | 'tv'
  | 'collection'
  | 'album'
  | 'artist'
  | 'book'
  | 'comic'
  | 'magazine'
  | 'sports';

export const mediaTypeBadgeTone: Record<MediaTypeBadgeType, string> = {
  movie: 'media-type-badge-tone-movie',
  tv: 'media-type-badge-tone-tv',
  collection: 'media-type-badge-tone-movie',
  album: 'media-type-badge-tone-album',
  artist: 'media-type-badge-tone-artist',
  book: 'media-type-badge-tone-book',
  comic: 'media-type-badge-tone-comic',
  magazine: 'media-type-badge-tone-magazine',
  sports: 'media-type-badge-tone-tv',
};

export const getMediaTypeBadgeType = (
  mediaType: string
): MediaTypeBadgeType | undefined => {
  if (mediaType === 'music') {
    return 'album';
  }

  if (
    mediaType === 'movie' ||
    mediaType === 'tv' ||
    mediaType === 'collection' ||
    mediaType === 'album' ||
    mediaType === 'artist' ||
    mediaType === 'book' ||
    mediaType === 'comic' ||
    mediaType === 'magazine' ||
    mediaType === 'sports'
  ) {
    return mediaType;
  }

  return undefined;
};

interface MediaTypeBadgeProps {
  mediaType: MediaTypeBadgeType;
  variant?: 'card' | 'compact' | 'inline' | 'button';
  className?: string;
  showIcon?: boolean;
  /**
   * Overrides the default per-type label (e.g. 'Album') while keeping that
   * type's icon and tone -- for contexts where the same icon/color applies
   * but the content-type label doesn't fit (a Plex library row is a whole
   * Music library, not a single Album).
   */
  label?: string;
}

const badgeConfig = {
  movie: {
    message: globalMessages.movie,
    icon: FilmIcon,
    tone: mediaTypeBadgeTone.movie,
  },
  tv: {
    message: globalMessages.tvshow,
    icon: TvIcon,
    tone: mediaTypeBadgeTone.tv,
  },
  collection: {
    message: globalMessages.collection,
    icon: RectangleStackIcon,
    tone: mediaTypeBadgeTone.collection,
  },
  album: {
    message: globalMessages.album,
    icon: MusicalNoteIcon,
    tone: mediaTypeBadgeTone.album,
  },
  artist: {
    message: globalMessages.artist,
    icon: UserCircleIcon,
    tone: mediaTypeBadgeTone.artist,
  },
  book: {
    message: globalMessages.book,
    icon: BookOpenIcon,
    tone: mediaTypeBadgeTone.book,
  },
  comic: {
    message: globalMessages.comic,
    icon: Square3Stack3DIcon,
    tone: mediaTypeBadgeTone.comic,
  },
  magazine: {
    message: globalMessages.magazine,
    icon: NewspaperIcon,
    tone: mediaTypeBadgeTone.magazine,
  },
  sports: {
    message: globalMessages.sports,
    icon: TrophyIcon,
    tone: mediaTypeBadgeTone.sports,
  },
} as const satisfies Record<
  MediaTypeBadgeType,
  {
    message: (typeof globalMessages)[keyof typeof globalMessages];
    icon: typeof FilmIcon;
    tone: string;
  }
>;

const variantClasses = {
  card: 'poster-control media-type-badge-card',
  compact: 'media-type-badge-compact',
  inline: 'media-type-badge-inline',
  button: 'app-button button-sm',
} as const;

const posterToneClass: Record<MediaTypeBadgeType, string> = {
  movie: 'poster-control-type-movie',
  tv: 'poster-control-type-tv',
  collection: 'poster-control-type-collection',
  album: 'poster-control-type-album',
  artist: 'poster-control-type-artist',
  book: 'poster-control-type-book',
  comic: 'poster-control-type-comic',
  magazine: 'poster-control-type-magazine',
  sports: 'poster-control-type-tv',
};

const buttonToneClass: Record<MediaTypeBadgeType, string> = {
  movie: 'app-button-media-type-movie',
  tv: 'app-button-media-type-tv',
  collection: 'app-button-media-type-collection',
  album: 'app-button-media-type-album',
  artist: 'app-button-media-type-artist',
  book: 'app-button-media-type-book',
  comic: 'app-button-media-type-comic',
  magazine: 'app-button-media-type-magazine',
  sports: 'app-button-media-type-tv',
};

const MediaTypeBadge = ({
  mediaType,
  variant = 'compact',
  className,
  showIcon = true,
  label: labelOverride,
}: MediaTypeBadgeProps) => {
  const intl = useIntl();
  const config = badgeConfig[mediaType];
  const label = labelOverride ?? intl.formatMessage(config.message);
  const Icon = config.icon;
  const badgeClassName = [
    variant === 'card' || variant === 'button'
      ? 'media-type-badge-width'
      : 'media-type-badge media-type-badge-width',
    variantClasses[variant],
    variant === 'card'
      ? posterToneClass[mediaType]
      : variant === 'button'
        ? buttonToneClass[mediaType]
        : config.tone,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const badge = (
    <span className={badgeClassName}>
      {showIcon && (
        <Icon className="media-type-badge-icon" aria-hidden="true" />
      )}
      <span className="media-type-badge-label">{label}</span>
    </span>
  );

  return <Tooltip content={label}>{badge}</Tooltip>;
};

export default MediaTypeBadge;
