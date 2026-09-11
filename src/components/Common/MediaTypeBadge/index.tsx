import globalMessages from '@app/i18n/globalMessages';
import {
  BookOpenIcon,
  FilmIcon,
  MusicalNoteIcon,
  RectangleStackIcon,
  TvIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline';
import { useIntl } from 'react-intl';
import { twMerge } from 'tailwind-merge';

export type MediaTypeBadgeType =
  | 'movie'
  | 'tv'
  | 'collection'
  | 'album'
  | 'artist'
  | 'book';

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
    mediaType === 'book'
  ) {
    return mediaType;
  }

  return undefined;
};

interface MediaTypeBadgeProps {
  mediaType: MediaTypeBadgeType;
  variant?: 'card' | 'compact' | 'inline';
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
    tone: 'border-blue-500 bg-blue-600/85 text-white',
  },
  tv: {
    message: globalMessages.tvshow,
    icon: TvIcon,
    tone: 'border-purple-600 bg-purple-600/85 text-white',
  },
  collection: {
    message: globalMessages.collection,
    icon: RectangleStackIcon,
    tone: 'border-blue-500 bg-blue-600/85 text-white',
  },
  album: {
    message: globalMessages.album,
    icon: MusicalNoteIcon,
    tone: 'border-emerald-500 bg-emerald-600/85 text-white',
  },
  artist: {
    message: globalMessages.artist,
    icon: UserCircleIcon,
    tone: 'border-fuchsia-500 bg-fuchsia-600/85 text-white',
  },
  book: {
    message: globalMessages.book,
    icon: BookOpenIcon,
    tone: 'border-amber-500 bg-amber-600/85 text-white',
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
  card: 'px-2 py-1 text-[11px] shadow-md',
  compact: 'px-2 py-1 text-[11px]',
  inline: 'px-2 py-1 text-xs',
} as const;

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

  return (
    <span
      className={twMerge(
        'inline-flex max-w-full items-center gap-1 rounded-full border font-semibold leading-none',
        variantClasses[variant],
        config.tone,
        className
      )}
      title={label}
    >
      {showIcon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      <span className="truncate">{label}</span>
    </span>
  );
};

export default MediaTypeBadge;
