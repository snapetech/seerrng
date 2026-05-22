import OpenLibraryAPI from '@server/api/openlibrary';
import type { ReadarrBook } from '@server/api/servarr/readarr';
import { MediaIdentifierProvider } from '@server/entity/MediaIdentifier';
import {
  normalizeOpenLibraryEditionId,
  normalizeOpenLibraryWorkId,
} from '@server/lib/externalIds';
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
