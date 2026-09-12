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

const normalizeForComparison = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * A cheap, dependency-free relevance gate for a fuzzy title search result.
 * Open Library's search endpoint has no minimum-relevance cutoff and will
 * happily return an unrelated book as its top hit for an obscure or
 * oddly-formatted title -- accepting that blindly would mark the wrong
 * book "available" in Plex. Requires either title to contain the other,
 * or at least half of the queried title's significant words to appear in
 * the candidate's title.
 */
const titlesAreReasonablyClose = (
  queriedTitle: string,
  candidateTitle: string
): boolean => {
  const normalizedQueried = normalizeForComparison(queriedTitle);
  const normalizedCandidate = normalizeForComparison(candidateTitle);
  if (!normalizedQueried || !normalizedCandidate) {
    return false;
  }
  if (
    normalizedCandidate.includes(normalizedQueried) ||
    normalizedQueried.includes(normalizedCandidate)
  ) {
    return true;
  }

  const queriedWords = normalizedQueried
    .split(' ')
    .filter((word) => word.length > 2);
  if (queriedWords.length === 0) {
    return false;
  }
  const candidateWords = new Set(normalizedCandidate.split(' '));
  const overlap = queriedWords.filter((word) =>
    candidateWords.has(word)
  ).length;
  return overlap / queriedWords.length >= 0.5;
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
    if (!titlesAreReasonablyClose(title, bestMatch.title)) {
      logger.debug('Rejecting weak Open Library match for Plex audiobook', {
        label: 'Plex Audiobook Scan',
        title,
        author,
        candidateTitle: bestMatch.title,
      });
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
