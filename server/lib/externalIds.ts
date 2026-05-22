import { MediaType } from '@server/constants/media';
import { MediaIdentifierProvider } from '@server/entity/MediaIdentifier';
import { normalizeValidIsbn } from '@server/lib/isbn';

export const normalizeMusicBrainzId = (id: string): string =>
  id.trim().toLowerCase();

export const normalizeOpenLibraryWorkId = (id: string): string =>
  id
    .trim()
    .replace(/^\/?works\//i, '')
    .replace(/^ol(\d+)w$/i, 'OL$1W');

export const normalizeOpenLibraryEditionId = (id: string): string =>
  id
    .trim()
    .replace(/^\/?books\//i, '')
    .replace(/^ol(\d+)m$/i, 'OL$1M');

export const normalizeExternalBookId = (
  id: string,
  provider?: MediaIdentifierProvider
): string => {
  if (provider === MediaIdentifierProvider.ISBN) {
    return normalizeValidIsbn(id) ?? id.trim();
  }

  if (
    provider === undefined ||
    provider === MediaIdentifierProvider.OPENLIBRARY
  ) {
    return normalizeOpenLibraryWorkId(id);
  }

  if (provider === MediaIdentifierProvider.OPENLIBRARY_EDITION) {
    return normalizeOpenLibraryEditionId(id);
  }

  return id.trim();
};

export const normalizeExternalMediaId = (
  id: string,
  mediaType: MediaType,
  provider?: MediaIdentifierProvider
): string =>
  mediaType === MediaType.MUSIC
    ? normalizeMusicBrainzId(id)
    : mediaType === MediaType.BOOK
      ? normalizeExternalBookId(id, provider)
      : id.trim();
