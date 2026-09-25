import { MediaType } from '@server/constants/media';
import { MediaIdentifierProvider } from '@server/entity/MediaIdentifier';
import { normalizeValidIsbn } from '@server/lib/isbn';
import { normalizeMagazineTitle } from '@server/lib/magazineIdentity';

export const normalizeMusicBrainzId = (id: string): string =>
  id.trim().toLowerCase();

export const MAX_MUSICBRAINZ_BATCH_IDS = 100;
export const MAX_MUSICBRAINZ_ID_LENGTH = 128;

export const isValidMusicBrainzResourceId = (id: string): boolean =>
  id.length > 0 &&
  id.length <= MAX_MUSICBRAINZ_ID_LENGTH &&
  /^[A-Za-z0-9_-]+$/.test(id);

export const prepareMusicBrainzBatchIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids = new Set<string>();
  for (const rawId of value) {
    if (typeof rawId !== 'string' || rawId.length > MAX_MUSICBRAINZ_ID_LENGTH) {
      continue;
    }
    const id = normalizeMusicBrainzId(rawId);
    if (isValidMusicBrainzResourceId(id)) {
      ids.add(id);
    }
    if (ids.size >= MAX_MUSICBRAINZ_BATCH_IDS) {
      break;
    }
  }
  return [...ids];
};

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

export const normalizeOpenLibraryAuthorId = (id: string): string =>
  id.trim().replace(/^\/?authors\//i, '');

export const MAX_OPENLIBRARY_RESOURCE_ID_LENGTH = 128;

export const isValidOpenLibraryResourceId = (id: string): boolean =>
  id.length > 0 &&
  id.length <= MAX_OPENLIBRARY_RESOURCE_ID_LENGTH &&
  /^[A-Za-z0-9_-]+$/.test(id);

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
      : mediaType === MediaType.MAGAZINE
        ? normalizeMagazineTitle(id)
        : id.trim();

export const isValidExternalMediaId = (
  id: string,
  mediaType: MediaType,
  provider?: MediaIdentifierProvider
): boolean => {
  if (mediaType === MediaType.MUSIC) {
    return (
      (provider === undefined ||
        provider === MediaIdentifierProvider.MUSICBRAINZ) &&
      isValidMusicBrainzResourceId(normalizeMusicBrainzId(id))
    );
  }

  if (mediaType === MediaType.COMIC) {
    return (
      (provider === undefined ||
        provider === MediaIdentifierProvider.COMICVINE) &&
      /^\d+$/.test(id.trim())
    );
  }

  if (mediaType === MediaType.MAGAZINE) {
    const normalizedId = normalizeMagazineTitle(id);
    return (
      (provider === undefined ||
        provider === MediaIdentifierProvider.LAZYLIBRARIAN) &&
      normalizedId.length > 0 &&
      normalizedId.length <= 256
    );
  }

  if (mediaType !== MediaType.BOOK) {
    return false;
  }

  if (provider === MediaIdentifierProvider.ISBN) {
    return normalizeValidIsbn(id) !== undefined;
  }

  if (
    provider === undefined ||
    provider === MediaIdentifierProvider.OPENLIBRARY
  ) {
    return isValidOpenLibraryResourceId(normalizeOpenLibraryWorkId(id));
  }

  if (provider === MediaIdentifierProvider.OPENLIBRARY_EDITION) {
    return isValidOpenLibraryResourceId(normalizeOpenLibraryEditionId(id));
  }

  return false;
};
