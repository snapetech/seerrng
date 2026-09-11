import OpenLibraryAPI from '@server/api/openlibrary';
import type { ReadarrBook } from '@server/api/servarr/readarr';
import { MediaIdentifierProvider } from '@server/entity/MediaIdentifier';
import {
  normalizeOpenLibraryEditionId,
  normalizeOpenLibraryWorkId,
} from '@server/lib/externalIds';
import { normalizeValidIsbn } from '@server/lib/isbn';
import logger from '@server/logger';

type ResolvedIdentifier = {
  provider: MediaIdentifierProvider;
  value: string;
};

const getOpenLibraryWorkId = (value?: string): string | undefined => {
  const id = value ? normalizeOpenLibraryWorkId(value) : undefined;
  return id && /^OL\d+W$/i.test(id) ? id : undefined;
};

const getOpenLibraryEditionId = (value?: string): string | undefined => {
  const id = value ? normalizeOpenLibraryEditionId(value) : undefined;
  return id && /^OL\d+M$/i.test(id) ? id : undefined;
};

const uniqIdentifiers = (
  identifiers: (ResolvedIdentifier | undefined)[]
): ResolvedIdentifier[] => {
  const seen = new Set<string>();
  const unique: ResolvedIdentifier[] = [];

  for (const identifier of identifiers) {
    if (!identifier) {
      continue;
    }

    const key = `${identifier.provider}:${identifier.value}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(identifier);
  }

  return unique;
};

export const resolveOpenLibraryIdentifiersForReadarrBook = async (
  book: ReadarrBook,
  openLibrary = new OpenLibraryAPI()
): Promise<ResolvedIdentifier[]> => {
  const identifiers: (ResolvedIdentifier | undefined)[] = [];
  const workId = getOpenLibraryWorkId(book.foreignBookId);

  if (workId) {
    identifiers.push({
      provider: MediaIdentifierProvider.OPENLIBRARY,
      value: workId,
    });
  }

  const editionIds = [
    ...new Set(
      (book.editions ?? [])
        .map((edition) => getOpenLibraryEditionId(edition.foreignEditionId))
        .filter((editionId): editionId is string => !!editionId)
    ),
  ];

  editionIds.forEach((editionId) => {
    identifiers.push({
      provider: MediaIdentifierProvider.OPENLIBRARY_EDITION,
      value: editionId,
    });
  });

  for (const editionId of editionIds) {
    try {
      const edition = await openLibrary.getEdition(editionId);
      const editionWorkId = getOpenLibraryWorkId(edition.works?.[0]?.key);

      if (editionWorkId) {
        identifiers.push({
          provider: MediaIdentifierProvider.OPENLIBRARY,
          value: editionWorkId,
        });
      }
    } catch (e) {
      logger.debug('Unable to resolve Open Library edition for book scan', {
        label: 'Bookshelf Scan',
        errorMessage: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return uniqIdentifiers(identifiers);
};

/**
 * Resolves identifiers for a Plex-hosted audiobook that carries no ISBN or
 * other direct identifier in its Plex metadata, by searching Open Library
 * for the closest title/author match. Best-effort: Plex audiobook libraries
 * commonly expose only a title and author, unlike Bookshelf/Readarr which
 * hands us a structured book record.
 */
export const resolveOpenLibraryIdentifiersForPlexAudiobook = async (
  title: string,
  author: string | undefined,
  openLibrary = new OpenLibraryAPI()
): Promise<ResolvedIdentifier[]> => {
  const query = [title, author].filter(Boolean).join(' ').trim();
  if (!query) {
    return [];
  }

  try {
    const results = await openLibrary.searchBooks({ query, limit: 1 });
    const bestMatch = results.docs[0];
    if (!bestMatch) {
      return [];
    }

    const identifiers: (ResolvedIdentifier | undefined)[] = [];
    const workId = getOpenLibraryWorkId(bestMatch.key);
    if (workId) {
      identifiers.push({
        provider: MediaIdentifierProvider.OPENLIBRARY,
        value: workId,
      });
    }

    // Open Library exposes provider-supplied ISBN strings without
    // guaranteeing that they pass the ISBN checksum. Never persist an
    // invalid ISBN as a canonical book identifier: it cannot match the
    // normalized ISBN lookups used elsewhere in the application.
    const isbn = (bestMatch.isbn ?? [])
      .map((candidate) => normalizeValidIsbn(candidate))
      .find((candidate): candidate is string => !!candidate);
    if (isbn) {
      identifiers.push({
        provider: MediaIdentifierProvider.ISBN,
        value: isbn,
      });
    }

    return uniqIdentifiers(identifiers);
  } catch (e) {
    logger.debug('Unable to resolve Open Library match for Plex audiobook', {
      label: 'Plex Audiobook Scan',
      title,
      author,
      errorMessage: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
};
