import type {
  OpenLibraryEdition,
  OpenLibrarySearchDoc,
} from '@server/api/openlibrary';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import type Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import {
  normalizeOpenLibraryEditionId,
  normalizeOpenLibraryWorkId,
} from '@server/lib/externalIds';
import { normalizeValidIsbn } from '@server/lib/isbn';
import { In } from 'typeorm';

type BookMediaLookupResult = {
  id: string;
  isbn13?: string;
  isbnCandidates?: { isbn: string }[];
};

const MAX_IDENTIFIER_LOOKUPS = 200;

type IdentifierLookup = {
  provider: MediaIdentifierProvider;
  value: string;
};

const uniqIdentifierLookups = (
  lookups: IdentifierLookup[]
): IdentifierLookup[] => {
  const seen = new Set<string>();
  const unique: IdentifierLookup[] = [];

  for (const lookup of lookups) {
    const key = `${lookup.provider}:${lookup.value}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(lookup);

    if (unique.length >= MAX_IDENTIFIER_LOOKUPS) {
      break;
    }
  }

  return unique;
};

const getSearchDocIsbns = (doc: OpenLibrarySearchDoc): string[] => [
  ...new Set(
    (doc.isbn ?? [])
      .map((isbn) => normalizeValidIsbn(isbn))
      .filter((isbn): isbn is string => !!isbn)
  ),
];

const getEditionIsbns = (editions: OpenLibraryEdition[]): string[] => [
  ...new Set(
    editions
      .flatMap((edition) => [
        ...(edition.isbn_13 ?? []),
        ...(edition.isbn_10 ?? []),
      ])
      .map((isbn) => normalizeValidIsbn(isbn))
      .filter((isbn): isbn is string => !!isbn)
  ),
];

const findBookMediaByIdentifiers = async (
  lookups: IdentifierLookup[],
  userId?: number
): Promise<Map<string, Media>> => {
  const uniqueLookups = uniqIdentifierLookups(lookups);

  if (!uniqueLookups.length) {
    return new Map();
  }

  const groupedLookups = uniqueLookups.reduce((acc, lookup) => {
    const values = acc.get(lookup.provider) ?? [];
    values.push(lookup.value);
    acc.set(lookup.provider, values);
    return acc;
  }, new Map<MediaIdentifierProvider, string[]>());

  const identifiers = await getRepository(MediaIdentifier).find({
    where: [...groupedLookups.entries()].map(([provider, values]) => ({
      provider,
      value: In(values),
    })),
    relations: {
      media: {
        requests: {
          requestedBy: true,
          modifiedBy: true,
        },
        issues: {
          createdBy: true,
          modifiedBy: true,
          comments: {
            user: true,
          },
        },
        watchlists: true,
      },
    },
  });

  const mediaByIdentifier = new Map<string, Media>();

  identifiers
    .filter((identifier) => identifier.media.mediaType === MediaType.BOOK)
    .forEach((identifier) => {
      identifier.media.watchlists =
        identifier.media.watchlists?.filter(
          (watchlist) => watchlist.requestedBy.id === userId
        ) ?? [];

      mediaByIdentifier.set(
        `${identifier.provider}:${identifier.value}`,
        identifier.media
      );
    });

  return mediaByIdentifier;
};

export const findBookMediaForSearchDocs = async (
  docs: OpenLibrarySearchDoc[],
  userId?: number
): Promise<Map<string, Media>> => {
  const lookups = docs.flatMap((doc) => {
    const workId = doc.key ? normalizeOpenLibraryWorkId(doc.key) : undefined;
    const isbnLookups = getSearchDocIsbns(doc).map((isbn) => ({
      provider: MediaIdentifierProvider.ISBN,
      value: isbn,
    }));

    return [
      ...(workId
        ? [{ provider: MediaIdentifierProvider.OPENLIBRARY, value: workId }]
        : []),
      ...isbnLookups,
    ];
  });
  const mediaByIdentifier = await findBookMediaByIdentifiers(lookups, userId);
  const mediaByWorkId = new Map<string, Media>();

  docs.forEach((doc) => {
    const workId = doc.key ? normalizeOpenLibraryWorkId(doc.key) : undefined;
    const media =
      (workId
        ? mediaByIdentifier.get(
            `${MediaIdentifierProvider.OPENLIBRARY}:${workId}`
          )
        : undefined) ??
      getSearchDocIsbns(doc)
        .map((isbn) =>
          mediaByIdentifier.get(`${MediaIdentifierProvider.ISBN}:${isbn}`)
        )
        .find((matchedMedia): matchedMedia is Media => !!matchedMedia);

    if (workId && media) {
      mediaByWorkId.set(workId, media);
    }
  });

  return mediaByWorkId;
};

export const findBookMediaForBookResults = async (
  books: BookMediaLookupResult[],
  userId?: number
): Promise<Map<string, Media>> => {
  const lookups = books.flatMap((book) => [
    { provider: MediaIdentifierProvider.OPENLIBRARY, value: book.id },
    ...(book.isbn13
      ? [{ provider: MediaIdentifierProvider.ISBN, value: book.isbn13 }]
      : []),
    ...(book.isbnCandidates ?? []).map((candidate) => ({
      provider: MediaIdentifierProvider.ISBN,
      value: candidate.isbn,
    })),
  ]);
  const mediaByIdentifier = await findBookMediaByIdentifiers(lookups, userId);
  const mediaByWorkId = new Map<string, Media>();

  books.forEach((book) => {
    const media =
      mediaByIdentifier.get(
        `${MediaIdentifierProvider.OPENLIBRARY}:${book.id}`
      ) ??
      [
        ...(book.isbn13 ? [book.isbn13] : []),
        ...(book.isbnCandidates ?? []).map((candidate) => candidate.isbn),
      ]
        .map((isbn) =>
          mediaByIdentifier.get(`${MediaIdentifierProvider.ISBN}:${isbn}`)
        )
        .find((matchedMedia): matchedMedia is Media => !!matchedMedia);

    if (media) {
      mediaByWorkId.set(book.id, media);
    }
  });

  return mediaByWorkId;
};

export const findBookMediaForWork = async (
  workId: string,
  editions: OpenLibraryEdition[],
  userId?: number
): Promise<Media | undefined> => {
  const editionLookups = editions
    .map((edition) =>
      edition.key ? normalizeOpenLibraryEditionId(edition.key) : undefined
    )
    .filter((editionId): editionId is string => !!editionId)
    .map((editionId) => ({
      provider: MediaIdentifierProvider.OPENLIBRARY_EDITION,
      value: editionId,
    }));
  const isbnLookups = getEditionIsbns(editions).map((isbn) => ({
    provider: MediaIdentifierProvider.ISBN,
    value: isbn,
  }));
  const mediaByIdentifier = await findBookMediaByIdentifiers(
    [
      { provider: MediaIdentifierProvider.OPENLIBRARY, value: workId },
      ...editionLookups,
      ...isbnLookups,
    ],
    userId
  );

  return (
    mediaByIdentifier.get(`${MediaIdentifierProvider.OPENLIBRARY}:${workId}`) ??
    editionLookups
      .map((lookup) =>
        mediaByIdentifier.get(`${lookup.provider}:${lookup.value}`)
      )
      .find((media): media is Media => !!media) ??
    isbnLookups
      .map((lookup) =>
        mediaByIdentifier.get(`${lookup.provider}:${lookup.value}`)
      )
      .find((media): media is Media => !!media)
  );
};
