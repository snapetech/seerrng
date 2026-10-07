import ExternalAPI from '@server/api/externalapi';
import OpenLibraryAPI from '@server/api/openlibrary';
import TheMovieDb from '@server/api/themoviedb';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { ExternalRequestList } from '@server/entity/ExternalRequestList';
import {
  BlocklistedMediaError,
  DuplicateMediaRequestError,
  MediaRequest,
} from '@server/entity/MediaRequest';
import type { User } from '@server/entity/User';
import type { MediaRequestBody } from '@server/interfaces/api/requestInterfaces';
import { normalizeOpenLibraryWorkId } from '@server/lib/externalIds';
import { normalizeValidIsbn } from '@server/lib/isbn';
import logger from '@server/logger';
import axios from 'axios';
import xml2js from 'xml2js';

export const MAX_EXTERNAL_REQUEST_LISTS_PER_USER = 10;
export const MAX_EXTERNAL_REQUEST_LIST_ITEMS = 100;

export type ExternalRequestListProvider = 'imdb' | 'goodreads' | 'hardcover';

export type ParsedExternalRequestListUrl = {
  provider: ExternalRequestListProvider;
  sourceId: string;
  sourceUrl: string;
};

export type ExternalRequestListItem = {
  id: string;
  title?: string;
  author?: string;
  isbn13?: string;
};

export type ResolvedExternalRequestListItem = {
  request: MediaRequestBody;
};

export type ExternalRequestListSyncResult = {
  listId: number;
  provider: ExternalRequestListProvider;
  sourceItems: number;
  requested: number;
  alreadyRequested: number;
  unmatched: number;
  failed: number;
  lastSyncedAt: string;
  error?: string;
};

export type ExternalRequestListSyncAdapters = {
  fetchImdbWatchlist: (userId: string) => Promise<ExternalRequestListItem[]>;
  fetchGoodreadsToRead: (userId: string) => Promise<ExternalRequestListItem[]>;
  fetchHardcoverToRead?: (
    apiToken: string
  ) => Promise<ExternalRequestListItem[]>;
  resolveImdbItem: (
    imdbId: string
  ) => Promise<ResolvedExternalRequestListItem | undefined>;
  resolveGoodreadsItem: (
    item: ExternalRequestListItem
  ) => Promise<ResolvedExternalRequestListItem | undefined>;
  requestMedia: (body: MediaRequestBody, user: User) => Promise<unknown>;
  saveList: (list: ExternalRequestList) => Promise<ExternalRequestList>;
  now: () => Date;
};

const HARDCOVER_GRAPHQL_URL = 'https://api.hardcover.app/v1/graphql';
const HARDCOVER_WANT_TO_READ_QUERY = `query SeerrNGWantToRead {
  me {
    user_books(where: { status_id: { _eq: 1 } }, limit: 100) {
      book {
        id
        title
        contributions { author { name } }
        editions { isbn_13 }
      }
    }
  }
}`;

export const fetchHardcoverToRead = async (
  apiToken: string
): Promise<ExternalRequestListItem[]> => {
  const response = await axios.post<unknown>(
    HARDCOVER_GRAPHQL_URL,
    { query: HARDCOVER_WANT_TO_READ_QUERY },
    {
      timeout: 12_000,
      maxRedirects: 0,
      maxContentLength: 2 * 1024 * 1024,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      validateStatus: () => true,
    }
  );
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Hardcover returned HTTP ${response.status}.`);
  }
  const root = isRecord(response.data) ? response.data : undefined;
  if (Array.isArray(root?.errors)) {
    throw new Error('Hardcover rejected the bookshelf query or API token.');
  }
  const data = isRecord(root?.data) ? root.data : undefined;
  const me = Array.isArray(data?.me) ? data.me[0] : data?.me;
  const entries =
    isRecord(me) && Array.isArray(me.user_books) ? me.user_books : [];
  const seen = new Set<string>();
  return entries.slice(0, MAX_EXTERNAL_REQUEST_LIST_ITEMS).flatMap((entry) => {
    const book =
      isRecord(entry) && isRecord(entry.book) ? entry.book : undefined;
    if (!book || (typeof book.id !== 'string' && typeof book.id !== 'number'))
      return [];
    const id = String(book.id);
    const title = boundedText(book.title);
    if (!title || seen.has(id)) return [];
    seen.add(id);
    const contributions = Array.isArray(book.contributions)
      ? book.contributions
      : [];
    const author = contributions
      .flatMap((contribution) => {
        const authorRecord =
          isRecord(contribution) && isRecord(contribution.author)
            ? contribution.author
            : undefined;
        return typeof authorRecord?.name === 'string'
          ? [authorRecord.name]
          : [];
      })
      .slice(0, 10)
      .join(', ');
    const editions = Array.isArray(book.editions) ? book.editions : [];
    const isbn13 = editions
      .map((edition) =>
        isRecord(edition) && typeof edition.isbn_13 === 'string'
          ? normalizeValidIsbn(edition.isbn_13)
          : undefined
      )
      .find((isbn) => isbn?.length === 13);
    return [{ id, title, author: author || undefined, isbn13 }];
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export const parseExternalRequestListUrl = (
  value: unknown
): ParsedExternalRequestListUrl | undefined => {
  if (typeof value !== 'string' || value.length > 2048) return undefined;

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    url.hash
  ) {
    return undefined;
  }

  if (
    (url.hostname === 'www.imdb.com' || url.hostname === 'imdb.com') &&
    url.search === ''
  ) {
    const match = url.pathname.match(/^\/user\/(ur[0-9]{1,20})\/watchlist\/?$/);
    if (!match) return undefined;
    return {
      provider: 'imdb',
      sourceId: match[1],
      sourceUrl: `https://www.imdb.com/user/${match[1]}/watchlist/`,
    };
  }

  if (
    url.hostname !== 'www.goodreads.com' &&
    url.hostname !== 'goodreads.com'
  ) {
    return undefined;
  }

  const feedMatch = url.pathname.match(
    /^\/review\/list_rss\/([0-9]{1,20})\/?$/
  );
  const profileMatch = url.pathname.match(
    /^\/user\/show\/([0-9]{1,20})(?:-[A-Za-z0-9-]+)?\/?$/
  );
  const listMatch = url.pathname.match(/^\/review\/list\/([0-9]{1,20})\/?$/);
  const userId = feedMatch?.[1] ?? profileMatch?.[1] ?? listMatch?.[1];
  if (!userId) return undefined;

  const allowedQueryKeys = new Set(['shelf', 'sort', 'order']);
  if (
    [...url.searchParams.keys()].some((key) => !allowedQueryKeys.has(key)) ||
    (url.searchParams.get('shelf') &&
      url.searchParams.get('shelf') !== 'to-read')
  ) {
    return undefined;
  }

  return {
    provider: 'goodreads',
    sourceId: `goodreads:${userId}:to-read`,
    sourceUrl: `https://www.goodreads.com/review/list_rss/${userId}?shelf=to-read`,
  };
};

const boundedText = (value: unknown, maxLength = 512): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const result = value.trim().slice(0, maxLength);
  return result || undefined;
};

const asXmlText = (value: unknown): string | undefined => {
  if (typeof value === 'string') return boundedText(value);
  if (Array.isArray(value)) return asXmlText(value[0]);
  return undefined;
};

class PublicListApi extends ExternalAPI {
  constructor(baseUrl: string) {
    super(
      baseUrl,
      {},
      {
        timeout: 10_000,
        maxContentLength: 2 * 1024 * 1024,
        maxBodyLength: 1024,
        headers: {
          accept:
            'text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        rateLimit: { maxRequests: 1, perMilliseconds: 1000 },
      }
    );
  }

  public fetchHtml(endpoint: string): Promise<string> {
    return this.get<string>(endpoint, {}, 0);
  }

  public fetchXml(endpoint: string): Promise<string> {
    return this.get<string>(endpoint, {}, 0);
  }
}

export const parseImdbWatchlistHtml = (
  html: string
): ExternalRequestListItem[] => {
  const matches = html.matchAll(/\/title\/(tt[0-9]{5,20})(?:[/?#"\\])/g);
  const seen = new Set<string>();
  const items: ExternalRequestListItem[] = [];
  for (const match of matches) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      items.push({ id: match[1] });
      if (items.length >= MAX_EXTERNAL_REQUEST_LIST_ITEMS) break;
    }
  }

  if (items.length === 0 && !/watchlist/i.test(html)) {
    throw new Error('IMDb did not return a public watchlist page.');
  }
  return items;
};

const fetchImdbWatchlist = async (
  userId: string
): Promise<ExternalRequestListItem[]> => {
  const html = await new PublicListApi('https://www.imdb.com').fetchHtml(
    `/user/${userId}/watchlist/`
  );
  return parseImdbWatchlistHtml(html);
};

export const parseGoodreadsToReadFeed = async (
  xml: string
): Promise<ExternalRequestListItem[]> => {
  const parsed: unknown = await xml2js.parseStringPromise(xml, {
    explicitArray: true,
    trim: true,
  });
  const rss = isRecord(parsed) && isRecord(parsed.rss) ? parsed.rss : undefined;
  const channelValue = rss?.channel;
  const channel = Array.isArray(channelValue) ? channelValue[0] : channelValue;
  const rawItems = isRecord(channel) ? channel.item : undefined;
  const entries = Array.isArray(rawItems)
    ? rawItems
    : rawItems
      ? [rawItems]
      : [];

  const seen = new Set<string>();
  return entries.slice(0, MAX_EXTERNAL_REQUEST_LIST_ITEMS).flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const id = asXmlText(entry.book_id);
    const title = asXmlText(entry.title);
    const author = asXmlText(entry.author_name);
    if (!id || !/^[0-9]{1,20}$/.test(id) || !title || seen.has(id)) return [];
    seen.add(id);
    const isbn = normalizeValidIsbn(
      asXmlText(entry.isbn13) ?? asXmlText(entry.isbn)
    );
    return [{ id, title, author, isbn13: isbn }];
  });
};

const fetchGoodreadsToRead = async (
  userId: string
): Promise<ExternalRequestListItem[]> => {
  const xml = await new PublicListApi('https://www.goodreads.com').fetchXml(
    `/review/list_rss/${userId}?shelf=to-read`
  );
  return parseGoodreadsToReadFeed(xml);
};

export const resolveImdbItem = async (
  imdbId: string
): Promise<ResolvedExternalRequestListItem | undefined> => {
  const result = await new TheMovieDb().getByExternalId({
    externalId: imdbId,
    type: 'imdb',
  });
  const movie = result.movie_results[0];
  if (movie) {
    return { request: { mediaType: MediaType.MOVIE, mediaId: movie.id } };
  }

  const show = result.tv_results[0];
  return show
    ? {
        request: {
          mediaType: MediaType.TV,
          mediaId: show.id,
          seasons: 'all',
        },
      }
    : undefined;
};

const normalizeBookIdentity = (value: string) =>
  value
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');

export const resolveGoodreadsItem = async (
  item: ExternalRequestListItem
): Promise<ResolvedExternalRequestListItem | undefined> => {
  const openLibrary = new OpenLibraryAPI();
  let candidates = item.isbn13
    ? (
        await openLibrary.searchBooks({
          query: `isbn:${item.isbn13}`,
          limit: 20,
        })
      ).docs.filter((book) =>
        book.isbn?.some((isbn) => normalizeValidIsbn(isbn) === item.isbn13)
      )
    : [];

  if (candidates.length === 0 && item.title && item.author) {
    const quote = (value: string) => value.replace(/["\\]/g, ' ').slice(0, 256);
    candidates = (
      await openLibrary.searchBooks({
        query: `title:"${quote(item.title)}" author:"${quote(item.author)}"`,
        limit: 20,
      })
    ).docs.filter(
      (book) =>
        normalizeBookIdentity(book.title) ===
          normalizeBookIdentity(item.title!) &&
        book.author_name?.some(
          (author) =>
            normalizeBookIdentity(author) ===
            normalizeBookIdentity(item.author!)
        )
    );
  }

  const candidate = candidates[0];
  const openLibraryId = candidate
    ? normalizeOpenLibraryWorkId(candidate.key)
    : undefined;
  if (!openLibraryId || !/^OL[0-9]+W$/.test(openLibraryId)) return undefined;

  return {
    request: {
      mediaType: MediaType.BOOK,
      mediaId: openLibraryId,
      ...(item.isbn13 ? { isbn13: item.isbn13 } : {}),
      format: 'ebook',
    },
  };
};

const defaultAdapters: ExternalRequestListSyncAdapters = {
  fetchImdbWatchlist,
  fetchGoodreadsToRead,
  fetchHardcoverToRead,
  resolveImdbItem,
  resolveGoodreadsItem,
  requestMedia: (body, user) => MediaRequest.request(body, user),
  saveList: (list) => getRepository(ExternalRequestList).save(list),
  now: () => new Date(),
};

const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message
    ? error.message.slice(0, 512)
    : 'The list sync failed.';

export const syncExternalRequestList = async (
  list: ExternalRequestList,
  user: User,
  adapters: ExternalRequestListSyncAdapters = defaultAdapters
): Promise<ExternalRequestListSyncResult> => {
  const result: ExternalRequestListSyncResult = {
    listId: list.id,
    provider: list.provider,
    sourceItems: 0,
    requested: 0,
    alreadyRequested: 0,
    unmatched: 0,
    failed: 0,
    lastSyncedAt: adapters.now().toISOString(),
  };
  const processed = new Set(
    Array.isArray(list.processedItemIds) ? list.processedItemIds : []
  );

  try {
    const userId =
      list.provider === 'imdb'
        ? list.sourceId
        : list.provider === 'goodreads'
          ? list.sourceId.match(/^goodreads:([0-9]{1,20}):to-read$/)?.[1]
          : list.sourceId === 'hardcover:me:want-to-read' && list.apiToken
            ? list.apiToken
            : undefined;
    if (!userId) throw new Error('The saved list source is invalid.');

    const items =
      list.provider === 'imdb'
        ? await adapters.fetchImdbWatchlist(userId)
        : list.provider === 'goodreads'
          ? await adapters.fetchGoodreadsToRead(userId)
          : adapters.fetchHardcoverToRead
            ? await adapters.fetchHardcoverToRead(userId)
            : (() => {
                throw new Error(
                  'Hardcover list synchronization is unavailable.'
                );
              })();
    result.sourceItems = items.length;

    for (const item of items.slice(0, MAX_EXTERNAL_REQUEST_LIST_ITEMS)) {
      if (processed.has(item.id)) continue;

      const resolved =
        list.provider === 'imdb'
          ? await adapters.resolveImdbItem(item.id)
          : await adapters.resolveGoodreadsItem(item);
      if (!resolved) {
        result.unmatched += 1;
        continue;
      }

      try {
        await adapters.requestMedia(resolved.request, user);
        result.requested += 1;
        processed.add(item.id);
        list.processedItemIds = [...processed];
        await adapters.saveList(list);
      } catch (error) {
        if (error instanceof DuplicateMediaRequestError) {
          result.alreadyRequested += 1;
          processed.add(item.id);
          list.processedItemIds = [...processed];
          await adapters.saveList(list);
          continue;
        }
        if (error instanceof BlocklistedMediaError) {
          result.alreadyRequested += 1;
          processed.add(item.id);
          list.processedItemIds = [...processed];
          await adapters.saveList(list);
          continue;
        }
        result.failed += 1;
        result.error = errorMessage(error);
        break;
      }
    }
  } catch (error) {
    result.failed += 1;
    result.error = errorMessage(error);
  }

  list.processedItemIds = [...processed];
  list.lastSyncedAt = adapters.now();
  list.lastSyncError = result.error ?? null;
  await adapters.saveList(list);
  result.lastSyncedAt = list.lastSyncedAt.toISOString();
  return result;
};

export const syncAllExternalRequestLists = async (): Promise<void> => {
  const lists = await getRepository(ExternalRequestList)
    .createQueryBuilder('list')
    .leftJoinAndSelect('list.user', 'user')
    .addSelect('list.apiToken')
    .orderBy('list.id', 'ASC')
    .getMany();

  for (const list of lists) {
    if (!list.user) continue;
    const result = await syncExternalRequestList(list, list.user);
    logger.info('External request list synchronization completed.', {
      label: 'External Request Lists',
      listId: list.id,
      provider: list.provider,
      requested: result.requested,
      alreadyRequested: result.alreadyRequested,
      unmatched: result.unmatched,
      failed: result.failed,
      error: result.error,
    });
  }
};
