import { MediaType } from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import type Media from '@server/entity/Media';

export const getPlaybackMediaRootId = (
  media: Media,
  serverType: MediaServerType,
  is4k: boolean
): string | undefined => {
  if (serverType === MediaServerType.PLEX) {
    if (media.mediaType === MediaType.MUSIC) {
      const selectedVariant = is4k ? media.ratingKeyFlac : media.ratingKeyMp3;
      if (selectedVariant) {
        return selectedVariant;
      }
      // A row written before audio variants existed may only have the legacy
      // root. Once either exact variant is known, never use that ambiguous root
      // for the other quality because it could build a mixed-quality playlist.
      return !media.ratingKeyMp3 && !media.ratingKeyFlac
        ? (media.ratingKey ?? undefined)
        : undefined;
    }
    if (is4k) {
      return media.ratingKey4k ?? undefined;
    }
    return media.ratingKey ?? undefined;
  }

  if (
    serverType === MediaServerType.JELLYFIN ||
    serverType === MediaServerType.EMBY
  ) {
    if (media.mediaType === MediaType.MUSIC) {
      const selectedVariant = is4k
        ? media.jellyfinMediaIdFlac
        : media.jellyfinMediaIdMp3;
      if (selectedVariant) {
        return selectedVariant;
      }
      return !media.jellyfinMediaIdMp3 && !media.jellyfinMediaIdFlac
        ? (media.jellyfinMediaId ?? undefined)
        : undefined;
    }
    if (is4k) {
      return media.jellyfinMediaId4k ?? undefined;
    }
    return media.jellyfinMediaId ?? undefined;
  }

  return undefined;
};
