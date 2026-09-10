import type { AssociationNode } from '@app/hooks/useAssociations';
import {
  encodeApiPathSegment,
  normalizeMusicBrainzId,
  normalizeOpenLibraryWorkId,
} from '@app/utils/apiPath';
import { getTmdbPosterImageUrl } from '@app/utils/imageCache';

export const nodeHref = (node: AssociationNode): string => {
  switch (node.mediaType) {
    case 'movie':
      return `/movie/${node.id}`;
    case 'tv':
      return `/tv/${node.id}`;
    case 'album':
      return `/music/${encodeApiPathSegment(normalizeMusicBrainzId(node.id))}`;
    case 'artist':
      return `/artist/${encodeApiPathSegment(node.id)}`;
    case 'book':
      return `/book/${encodeApiPathSegment(
        normalizeOpenLibraryWorkId(node.id)
      )}`;
    case 'person':
      return `/person/${node.id}`;
    default:
      return '/';
  }
};

export const nodeTitle = (node: AssociationNode): string => {
  switch (node.mediaType) {
    case 'movie':
      return node.title;
    case 'tv':
      return node.name;
    case 'album':
      return node.title;
    case 'artist':
    case 'person':
      return node.name;
    case 'book':
      return node.title;
    default:
      return '';
  }
};

export const nodeImage = (node: AssociationNode): string | undefined => {
  switch (node.mediaType) {
    case 'movie':
    case 'tv':
      return getTmdbPosterImageUrl(node.posterPath);
    case 'album':
      return node.posterPath ?? undefined;
    case 'artist':
      return node.artistThumb ?? undefined;
    case 'book':
      return node.posterPath;
    case 'person':
      return getTmdbPosterImageUrl(node.profilePath, 'w600_and_h900_bestv2');
    default:
      return undefined;
  }
};

export const nodeImageType = (
  node: AssociationNode
): 'tmdb' | 'music' | 'book' => {
  switch (node.mediaType) {
    case 'album':
    case 'artist':
      return 'music';
    case 'book':
      return 'book';
    default:
      return 'tmdb';
  }
};
