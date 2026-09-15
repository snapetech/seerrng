import Tooltip from '@app/components/Common/Tooltip';
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
  'movie' | 'tv' | 'collection' | 'album' | 'artist' | 'book';

export const mediaTypeBadgeTone: Record<MediaTypeBadgeType, string> = {
  movie: 'border-blue-500/70 bg-blue-700/35 text-blue-50',
  tv: 'border-violet-300/90 bg-purple-700/35 text-purple-50',
  collection: 'border-blue-500/70 bg-blue-700/35 text-blue-50',
  album: 'border-emerald-500/70 bg-emerald-700/35 text-emerald-50',
  artist: 'border-fuchsia-500/70 bg-fuchsia-700/35 text-fuchsia-50',
  book: 'border-amber-500/70 bg-amber-700/35 text-amber-50',
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

  const badge = (
    <span
      className={twMerge(
        'inline-flex max-w-full items-center gap-1 rounded-full border leading-none font-semibold',
        variantClasses[variant],
        config.tone,
        className
      )}
    >
      {showIcon && (
        <Icon
          className="h-3.5 w-3.5 shrink-0 -translate-y-px"
          aria-hidden="true"
        />
      )}
      <span className="truncate">{label}</span>
    </span>
  );

  return <Tooltip content={label}>{badge}</Tooltip>;
};

export default MediaTypeBadge;
