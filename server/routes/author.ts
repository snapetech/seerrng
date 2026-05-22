import OpenLibraryAPI, {
  type OpenLibraryAuthorWork,
} from '@server/api/openlibrary';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import type Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import { normalizeOpenLibraryWorkId } from '@server/lib/externalIds';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import {
  mapOpenLibraryAuthorWork,
  type AuthorDetails,
} from '@server/models/Book';
import {
  parseNonNegativeInt,
  parsePositiveInt,
} from '@server/utils/pagination';
import { parseBoundedString } from '@server/utils/validation';
import { Router } from 'express';
import { In } from 'typeorm';

const authorRoutes = Router();
const MAX_OPENLIBRARY_AUTHOR_ID_LENGTH = 128;

const ISO_639_1_TO_OPENLIBRARY: Record<string, string> = {
  ar: 'ara',
  ca: 'cat',
  cs: 'cze',
  da: 'dan',
  de: 'ger',
  el: 'gre',
  en: 'eng',
  es: 'spa',
  et: 'est',
  eu: 'baq',
  fi: 'fin',
  fr: 'fre',
  he: 'heb',
  hi: 'hin',
  hr: 'hrv',
  hu: 'hun',
  it: 'ita',
  ja: 'jpn',
  ko: 'kor',
  lt: 'lit',
  nl: 'dut',
  no: 'nor',
  pl: 'pol',
  pt: 'por',
  ro: 'rum',
  ru: 'rus',
  sk: 'slo',
  sl: 'slv',
  sq: 'alb',
  sr: 'srp',
  sv: 'swe',
  tr: 'tur',
  uk: 'ukr',
  vi: 'vie',
  zh: 'chi',
};

const parseOpenLibraryAuthorId = (value: unknown) =>
  parseBoundedString(value, {
    fieldName: 'Author ID',
    maxLength: MAX_OPENLIBRARY_AUTHOR_ID_LENGTH,
  });

const normalizeTitleForDedupe = (title: string) =>
  title
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const getPreferredOpenLibraryLanguage = () => {
  const settings = getSettings();
  const language = (
    settings.main.originalLanguage ||
    settings.main.locale ||
    ''
  )
    .split(/[-_]/)[0]
    ?.toLowerCase();

  return language ? ISO_639_1_TO_OPENLIBRARY[language] : undefined;
};

const workMatchesPreferredLanguage = (
  work: OpenLibraryAuthorWork,
  preferredLanguage?: string
) => {
  if (!preferredLanguage || !work.languages?.length) {
    return true;
  }

  return work.languages.some(
    (language) =>
      language.key.replace('/languages/', '').toLowerCase() ===
      preferredLanguage
  );
};

const filterAuthorWorks = (
  works: OpenLibraryAuthorWork[],
  preferredLanguage?: string
) => {
  const seenTitles = new Set<string>();

  return works.filter((work) => {
    if (!workMatchesPreferredLanguage(work, preferredLanguage)) {
      return false;
    }

    const titleKey = normalizeTitleForDedupe(work.title);

    if (seenTitles.has(titleKey)) {
      return false;
    }

    seenTitles.add(titleKey);
    return true;
  });
};

const findBookMediaByOpenLibraryIds = async (
  ids: string[],
  userId?: number
): Promise<Map<string, Media>> => {
  if (!ids.length) {
    return new Map();
  }

  const identifiers = await getRepository(MediaIdentifier).find({
    where: {
      provider: MediaIdentifierProvider.OPENLIBRARY,
      value: In(ids),
    },
    relations: { media: { requests: true, watchlists: true } },
  });

  return new Map(
    identifiers
      .filter((identifier) => identifier.media.mediaType === MediaType.BOOK)
      .map((identifier) => {
        identifier.media.watchlists =
          identifier.media.watchlists?.filter(
            (watchlist) => watchlist.requestedBy.id === userId
          ) ?? [];

        return [identifier.value, identifier.media];
      })
  );
};

const getAuthorWorksPayload = async (
  authorId: string,
  limit: number,
  offset: number,
  userId?: number
) => {
  const openLibrary = new OpenLibraryAPI();
  const works = await openLibrary.getAuthorWorks(authorId, { limit, offset });
  const preferredLanguage = getPreferredOpenLibraryLanguage();
  const filteredWorks = filterAuthorWorks(works.entries, preferredLanguage);
  const ids = filteredWorks.map((work) => normalizeOpenLibraryWorkId(work.key));
  const mediaByOpenLibraryId = await findBookMediaByOpenLibraryIds(ids, userId);

  return {
    works: filteredWorks.map((work) =>
      mapOpenLibraryAuthorWork(
        work,
        mediaByOpenLibraryId.get(normalizeOpenLibraryWorkId(work.key)),
        undefined,
        authorId.replace(/^\/?authors\//, '')
      )
    ),
    pagination: {
      limit,
      offset,
      totalItems: works.size,
      nextOffset: offset + works.entries.length,
    },
  };
};

authorRoutes.get<
  { id: string },
  AuthorDetails | { status: number; message: string }
>('/:id', async (req, res, next) => {
  const parsedAuthorId = parseOpenLibraryAuthorId(req.params.id);
  if ('error' in parsedAuthorId) {
    return res.status(404).json({ status: 404, message: 'Author not found' });
  }

  const authorId = parsedAuthorId.value;
  const limit = parsePositiveInt(req.query.limit, 20, 100);
  const offset = parseNonNegativeInt(req.query.offset);
  const openLibrary = new OpenLibraryAPI();

  try {
    const [author, worksPayload] = await Promise.all([
      openLibrary.getAuthor(authorId),
      getAuthorWorksPayload(authorId, limit, offset, req.user?.id),
    ]);
    const biography =
      typeof author.bio === 'string' ? author.bio : author.bio?.value;
    const normalizedAuthorId = author.key.replace('/authors/', '');

    return res.status(200).json({
      id: normalizedAuthorId,
      name: author.name,
      biography,
      birthDate: author.birth_date,
      deathDate: author.death_date,
      posterPath: author.photos?.[0]
        ? `https://covers.openlibrary.org/a/id/${author.photos[0]}-L.jpg`
        : undefined,
      works: worksPayload.works.map((work) => ({
        ...work,
        author: author.name,
        authorId: normalizedAuthorId,
      })),
      pagination: worksPayload.pagination,
    });
  } catch (e) {
    logger.error('Failed to retrieve author details', {
      label: 'Author',
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
      authorId,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve author details.',
    });
  }
});

authorRoutes.get<{ id: string }>('/:id/works', async (req, res, next) => {
  const parsedAuthorId = parseOpenLibraryAuthorId(req.params.id);
  if ('error' in parsedAuthorId) {
    return res.status(404).json({ status: 404, message: 'Author not found' });
  }

  const authorId = parsedAuthorId.value;
  const limit = parsePositiveInt(req.query.limit, 20, 100);
  const offset = parseNonNegativeInt(req.query.offset);

  try {
    const [author, worksPayload] = await Promise.all([
      new OpenLibraryAPI().getAuthor(authorId).catch(() => undefined),
      getAuthorWorksPayload(authorId, limit, offset, req.user?.id),
    ]);

    return res.status(200).json({
      ...worksPayload,
      works: worksPayload.works.map((work) => ({
        ...work,
        author: author?.name ?? work.author,
        authorId: authorId.replace(/^\/?authors\//, ''),
      })),
    });
  } catch (e) {
    logger.error('Failed to retrieve author works', {
      label: 'Author',
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
      authorId,
    });
    return next({ status: 500, message: 'Unable to retrieve author works.' });
  }
});

export default authorRoutes;
