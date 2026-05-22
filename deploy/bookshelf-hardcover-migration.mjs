#!/usr/bin/env node
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const getApiTimeoutMs = () => {
  const timeoutMs = Number(process.env.HARDCOVER_API_TIMEOUT_MS ?? 30000);

  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('HARDCOVER_API_TIMEOUT_MS must be a positive integer.');
  }

  return timeoutMs;
};

const getValidationLookupTerm = () =>
  normalizeText(
    process.env.HARDCOVER_VALIDATION_TERM ?? 'Foundation Isaac Asimov'
  );

const getValidationLookupRetries = () => {
  const rawValue = process.env.HARDCOVER_VALIDATION_LOOKUP_RETRIES;

  if (rawValue === undefined || rawValue === '') {
    return 3;
  }

  const retries = Number(rawValue);

  if (!Number.isInteger(retries) || retries < 0) {
    throw new Error(
      'HARDCOVER_VALIDATION_LOOKUP_RETRIES must be a non-negative integer.'
    );
  }

  return retries;
};

const getValidationLookupRetryDelayMs = () => {
  const rawValue = process.env.HARDCOVER_VALIDATION_LOOKUP_RETRY_DELAY_MS;

  if (rawValue === undefined || rawValue === '') {
    return 10000;
  }

  const delayMs = Number(rawValue);

  if (!Number.isInteger(delayMs) || delayMs < 0) {
    throw new Error(
      'HARDCOVER_VALIDATION_LOOKUP_RETRY_DELAY_MS must be a non-negative integer.'
    );
  }

  return delayMs;
};

const getMigrationMaxBooks = () => {
  const rawValue = process.env.HARDCOVER_MIGRATION_MAX_BOOKS;

  if (rawValue === undefined || rawValue === '') {
    return undefined;
  }

  const maxBooks = Number(rawValue);

  if (!Number.isInteger(maxBooks) || maxBooks <= 0) {
    throw new Error(
      'HARDCOVER_MIGRATION_MAX_BOOKS must be a positive integer.'
    );
  }

  return maxBooks;
};

const getRateLimitDelayMs = () => {
  const rawValue = process.env.HARDCOVER_RATE_LIMIT_DELAY_MS;

  if (rawValue === undefined || rawValue === '') {
    return 1500;
  }

  const delayMs = Number(rawValue);

  if (!Number.isInteger(delayMs) || delayMs < 0) {
    throw new Error(
      'HARDCOVER_RATE_LIMIT_DELAY_MS must be a non-negative integer.'
    );
  }

  return delayMs;
};

const getRateLimitBatchSize = () => {
  const rawValue = process.env.HARDCOVER_RATE_LIMIT_BATCH_SIZE;

  if (rawValue === undefined || rawValue === '') {
    return 10;
  }

  const batchSize = Number(rawValue);

  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error(
      'HARDCOVER_RATE_LIMIT_BATCH_SIZE must be a positive integer.'
    );
  }

  return batchSize;
};

const getRateLimitMaxRetries = () => {
  const rawValue = process.env.HARDCOVER_RATE_LIMIT_MAX_RETRIES;

  if (rawValue === undefined || rawValue === '') {
    return 5;
  }

  const maxRetries = Number(rawValue);

  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new Error(
      'HARDCOVER_RATE_LIMIT_MAX_RETRIES must be a non-negative integer.'
    );
  }

  return maxRetries;
};

const getRateLimitBackoffBaseMs = () => {
  const rawValue = process.env.HARDCOVER_RATE_LIMIT_BACKOFF_BASE_MS;

  if (rawValue === undefined || rawValue === '') {
    return 5000;
  }

  const baseMs = Number(rawValue);

  if (!Number.isInteger(baseMs) || baseMs <= 0) {
    throw new Error(
      'HARDCOVER_RATE_LIMIT_BACKOFF_BASE_MS must be a positive integer.'
    );
  }

  return baseMs;
};

const getRecoveryLookupLimit = () => {
  const rawValue = process.env.HARDCOVER_RECOVERY_LOOKUP_LIMIT;

  if (rawValue === undefined || rawValue === '') {
    return 8;
  }

  const limit = Number(rawValue);

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(
      'HARDCOVER_RECOVERY_LOOKUP_LIMIT must be a positive integer.'
    );
  }

  return limit;
};

const getOpenLibraryRecoveryEnabled = () => {
  const rawValue = process.env.HARDCOVER_OPENLIBRARY_RECOVERY;

  if (rawValue === undefined || rawValue === '') {
    return true;
  }

  return rawValue === 'true' || rawValue === '1' || rawValue === 'yes';
};

const getOpenLibraryBaseUrl = () =>
  normalizeText(process.env.HARDCOVER_OPENLIBRARY_BASE_URL) ||
  'https://openlibrary.org';

const getLocalImportEnabled = () => {
  const rawValue = process.env.HARDCOVER_LOCAL_IMPORT;

  if (rawValue === undefined || rawValue === '') {
    return false;
  }

  return rawValue === 'true' || rawValue === '1' || rawValue === 'yes';
};

const getLocalDbImportEnabled = () => {
  const rawValue = process.env.HARDCOVER_LOCAL_DB_IMPORT;

  if (rawValue === undefined || rawValue === '') {
    return false;
  }

  return rawValue === 'true' || rawValue === '1' || rawValue === 'yes';
};

const getIdentifierFallbackEnabled = () => {
  const rawValue = process.env.HARDCOVER_IDENTIFIER_FALLBACK;

  if (rawValue === undefined || rawValue === '') {
    return true;
  }

  return rawValue === 'true' || rawValue === '1' || rawValue === 'yes';
};

const getMatchConcurrency = () => {
  const rawValue = process.env.HARDCOVER_MATCH_CONCURRENCY;

  if (rawValue === undefined || rawValue === '') {
    return 1;
  }

  const concurrency = Number(rawValue);

  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new Error('HARDCOVER_MATCH_CONCURRENCY must be a positive integer.');
  }

  return concurrency;
};

const getCheckpointInterval = () => {
  const rawValue = process.env.HARDCOVER_CHECKPOINT_INTERVAL;

  if (rawValue === undefined || rawValue === '') {
    return 1;
  }

  const interval = Number(rawValue);

  if (!Number.isInteger(interval) || interval <= 0) {
    throw new Error(
      'HARDCOVER_CHECKPOINT_INTERVAL must be a positive integer.'
    );
  }

  return interval;
};

const getCacheDedupeEnabled = () => {
  const rawValue = process.env.HARDCOVER_DEDUPE_TARGET_CACHE;

  if (rawValue === undefined || rawValue === '') {
    return true;
  }

  return rawValue === 'true' || rawValue === '1' || rawValue === 'yes';
};

const normalizeText = (value) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';

const normalizeComparableText = (value) => normalizeText(value).toLowerCase();

export const firstValue = (object, keys) => {
  for (const key of keys) {
    if (object && object[key] !== undefined && object[key] !== null) {
      return object[key];
    }
  }

  return undefined;
};

const normalizeId = (value) =>
  value === undefined || value === null ? undefined : String(value);

const findBookEditions = (book, editions) => {
  const bookId = normalizeId(
    firstValue(book, ['Id', 'id', 'BookId', 'bookId'])
  );

  return editions.filter((edition) => {
    const editionBookId = normalizeId(
      firstValue(edition, ['BookId', 'bookId', 'book_id'])
    );

    return bookId && editionBookId === bookId;
  });
};

const findAuthorForBook = (book, authors) => {
  const authorMetadataId = normalizeId(
    firstValue(book, [
      'AuthorMetadataId',
      'authorMetadataId',
      'AuthorMetadataID',
      'author_metadata_id',
    ])
  );
  const authorId = normalizeId(
    firstValue(book, ['AuthorId', 'authorId', 'AuthorID', 'author_id'])
  );

  return authors.find((candidate) => {
    const candidateMetadataId = normalizeId(
      firstValue(candidate, [
        'AuthorMetadataId',
        'authorMetadataId',
        'AuthorMetadataID',
        'author_metadata_id',
      ])
    );
    const candidateId = normalizeId(
      firstValue(candidate, [
        'Id',
        'id',
        'AuthorId',
        'authorId',
        'AuthorID',
        'author_id',
      ])
    );

    return (
      (authorMetadataId && candidateMetadataId === authorMetadataId) ||
      (authorId && candidateId === authorId)
    );
  });
};

export const extractIdentifiers = (book, editions) => {
  const candidates = [
    firstValue(book, ['Isbn13', 'ISBN13', 'isbn13']),
    firstValue(book, ['Isbn10', 'ISBN10', 'isbn10']),
    firstValue(book, ['Asin', 'ASIN', 'asin']),
    ...editions.flatMap((edition) => [
      firstValue(edition, ['Isbn13', 'ISBN13', 'isbn13']),
      firstValue(edition, ['Isbn10', 'ISBN10', 'isbn10']),
      firstValue(edition, ['Asin', 'ASIN', 'asin']),
    ]),
  ]
    .map((value) => normalizeText(String(value ?? '')))
    .filter(Boolean);

  return [...new Set(candidates)];
};

export const extractTagLabels = (book, tags) => {
  const tagIds = parseTags(firstValue(book, ['Tags', 'tags']));

  return tagIds
    .map((tagId) => findById(tags, tagId))
    .map((tag) => normalizeText(firstValue(tag, ['Label', 'label'])))
    .filter(Boolean);
};

const extractBookTitle = (book) =>
  normalizeText(
    firstValue(book, [
      'Title',
      'title',
      'CleanTitle',
      'cleanTitle',
      'Name',
      'name',
    ])
  );

const extractAuthorName = (book, authors, authorMetadata = []) => {
  const directAuthor = normalizeText(
    firstValue(book, [
      'AuthorName',
      'authorName',
      'AuthorTitle',
      'authorTitle',
      'Author',
      'author',
      'AuthorSort',
      'authorSort',
    ])
  );

  if (directAuthor) {
    return directAuthor;
  }

  const authorMetadataId = normalizeId(
    firstValue(book, [
      'AuthorMetadataId',
      'authorMetadataId',
      'AuthorMetadataID',
      'author_metadata_id',
    ])
  );
  const authorId = normalizeId(
    firstValue(book, ['AuthorId', 'authorId', 'AuthorID', 'author_id'])
  );
  const author = findAuthorForBook(
    {
      ...book,
      AuthorMetadataId: authorMetadataId,
      AuthorId: authorId,
    },
    authors
  );

  const authorName = normalizeText(
    firstValue(author, [
      'AuthorName',
      'authorName',
      'Name',
      'name',
      'Title',
      'title',
      'SortName',
      'sortName',
    ])
  );

  if (authorName) {
    return authorName;
  }

  const resolvedMetadataId = normalizeId(
    firstValue(author, [
      'AuthorMetadataId',
      'authorMetadataId',
      'AuthorMetadataID',
      'author_metadata_id',
    ]) ?? authorMetadataId
  );
  const metadata = authorMetadata.find((candidate) => {
    const candidateId = normalizeId(
      firstValue(candidate, [
        'Id',
        'id',
        'AuthorMetadataId',
        'authorMetadataId',
        'AuthorMetadataID',
        'author_metadata_id',
      ])
    );

    return resolvedMetadataId && candidateId === resolvedMetadataId;
  });

  return normalizeText(
    firstValue(metadata, [
      'AuthorName',
      'authorName',
      'Name',
      'name',
      'Title',
      'title',
      'SortName',
      'sortName',
    ])
  );
};

export const findById = (rows, id, idKeys = ['Id', 'id']) => {
  const normalizedId = normalizeId(id);

  if (!normalizedId) {
    return undefined;
  }

  return rows.find((row) =>
    idKeys.some((key) => normalizeId(row?.[key]) === normalizedId)
  );
};

const tagIdFromValue = (tag) => {
  if (Number.isInteger(tag)) {
    return tag;
  }

  if (typeof tag === 'string' && tag.trim()) {
    const parsed = Number(tag.trim());

    return Number.isInteger(parsed) ? parsed : undefined;
  }

  if (tag && typeof tag === 'object') {
    const parsed = Number(firstValue(tag, ['id', 'Id', 'tagId', 'TagId']));

    return Number.isInteger(parsed) ? parsed : undefined;
  }

  return undefined;
};

const pathWithTrailingSlash = (value) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return '';
  }

  return normalized.endsWith('/') ? normalized : `${normalized}/`;
};

const normalizePathComparable = (value) => {
  const normalized = normalizeText(value);

  if (normalized === '/') {
    return normalized;
  }

  return normalized.replace(/\/+$/, '');
};

const normalizeReadarrRootFolderPath = (value) => {
  const normalized = normalizeText(value).replace(/\\/g, '/');
  const pathPattern = /^\/[A-Za-z0-9._~:/@()+, -]+$/;

  if (!pathPattern.test(normalized)) {
    throw new Error(`Invalid Readarr root folder path: ${value}`);
  }

  const normalizedPath = path.posix.normalize(normalized);

  if (normalizedPath === '.' || normalizedPath.includes('/../')) {
    throw new Error(`Invalid Readarr root folder path: ${value}`);
  }

  return normalizedPath;
};

const deriveRootFolderPath = ({ book, author, rootFolders }) => {
  const direct = normalizeText(
    firstValue(book, [
      'RootFolderPath',
      'rootFolderPath',
      'RootFolder',
      'rootFolder',
      'RootFolderName',
      'rootFolderName',
      'Path',
      'path',
    ])
  );

  if (direct) {
    return direct;
  }

  const authorRoot = normalizeText(
    firstValue(author, ['RootFolderPath', 'rootFolderPath'])
  );

  if (authorRoot) {
    return authorRoot;
  }

  const authorPath = pathWithTrailingSlash(
    firstValue(author, ['Path', 'path'])
  );
  const matchingRootFolders = rootFolders
    .map((rootFolder) =>
      normalizeText(firstValue(rootFolder, ['Path', 'path']))
    )
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  return (
    matchingRootFolders.find((rootFolderPath) =>
      authorPath.startsWith(pathWithTrailingSlash(rootFolderPath))
    ) ?? normalizeText(firstValue(author, ['Path', 'path']))
  );
};

const ISBN10_REGEX = /^[0-9]{9}[0-9Xx]$/;
const ISBN13_REGEX = /^97[89][0-9]{10}$/;

const isIsbn = (identifier) =>
  ISBN10_REGEX.test(identifier) || ISBN13_REGEX.test(identifier);

const stripIsbnHyphens = (identifier) => identifier.replace(/-/g, '');

// Convert ISBN-10 to ISBN-13 using the standard algorithm.
const isbn10to13 = (isbn) => {
  const digits = isbn.replace(/[^0-9Xx]/g, '');
  if (digits.length !== 10) return null;

  const prefix = '978';
  const payload = prefix + digits.substring(0, 9);
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    sum += parseInt(payload[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;

  return payload + check;
};

// Convert ISBN-13 to ISBN-10 by stripping the 978 prefix and recalculating check.
const isbn13to10 = (isbn) => {
  const digits = isbn.replace(/[^0-9]/g, '');
  if (digits.length !== 13 || !digits.startsWith('978')) return null;

  const payload = digits.substring(3, 12);
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    sum += parseInt(payload[i]) * (10 - i);
  }
  const rem = sum % 11;
  const check = rem === 0 ? '0' : rem === 1 ? 'X' : String(11 - rem);

  return payload + check;
};

// Generate all lookup term variants for a single identifier.
// Returns an array of terms to try, ordered from most specific to least.
const lookupTermVariants = (identifier) => {
  const terms = new Set();

  if (!identifier) return [];

  const stripped = stripIsbnHyphens(String(identifier));

  if (isIsbn(stripped)) {
    // ISBN-10 variants
    if (ISBN10_REGEX.test(stripped)) {
      terms.add(`isbn:${stripped}`);
      terms.add(stripped);
      const converted = isbn10to13(stripped);
      if (converted) {
        terms.add(`isbn:${converted}`);
        terms.add(converted);
      }
    }

    // ISBN-13 variants
    if (ISBN13_REGEX.test(stripped)) {
      terms.add(`isbn:${stripped}`);
      terms.add(stripped);
      const converted = isbn13to10(stripped);
      if (converted) {
        terms.add(`isbn:${converted}`);
        terms.add(converted);
      }
    }
  } else {
    // Non-ISBN identifier (ASIN, Goodreads ID, etc.)
    terms.add(stripped);
    terms.add(`isbn:${stripped}`);
  }

  return [...terms].filter(Boolean);
};

const fetchWithTimeout = async (url, options = {}) => {
  const apiTimeoutMs = getApiTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), apiTimeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Request timed out after ${apiTimeoutMs}ms: ${url}`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const sleep = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

export const parseRetryAfter = (headerValue) => {
  if (!headerValue) {
    return 0;
  }

  // If it's a plain number (including "0"), it's seconds.
  const trimmed = headerValue.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return seconds * 1000;
  }

  // Otherwise, treat it as an HTTP-date (RFC 7231).
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    const remaining = dateMs - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  return 0;
};

export const addJitter = (delayMs) => {
  // ±25% random jitter to avoid thundering herd.
  const jitterRange = delayMs * 0.25;
  const jitter = jitterRange * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(delayMs + jitter));
};

const fetchWithRetry = async (url, options = {}) => {
  const maxRetries = getRateLimitMaxRetries();
  const backoffBaseMs = getRateLimitBackoffBaseMs();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetchWithTimeout(url, options);

    if (response.status !== 429) {
      return response;
    }

    const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));
    let delayMs;

    if (retryAfterMs > 0) {
      delayMs = addJitter(retryAfterMs);
    } else {
      delayMs = addJitter(backoffBaseMs * Math.pow(2, attempt));
    }

    console.error(
      `Rate limited (429) for ${url}. ` +
        `Retry attempt ${attempt + 1}/${maxRetries}. ` +
        `Waiting ${Math.round(delayMs / 1000)}s before retry.`
    );

    await sleep(delayMs);
  }

  throw new Error(`Rate limited after ${maxRetries + 1} attempts: ${url}`);
};

const lookupBook = async ({ baseUrl, apiKey, term }) => {
  const url = new URL('/api/v1/book/lookup', baseUrl);
  url.searchParams.set('term', term);

  const response = await fetchWithRetry(url, {
    headers: {
      'X-Api-Key': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Lookup failed for ${term}: ${response.status}`);
  }

  const body = await response.json();

  return Array.isArray(body) ? body : [];
};

const fetchJson = async (url, options = {}) => {
  const response = await fetchWithRetry(url, options);

  if (!response.ok) {
    const responseBody = await response.text().catch(() => '');

    throw new Error(
      `GET ${url} failed: ${response.status}${responseBody ? ` ${responseBody}` : ''}`
    );
  }

  return response.json();
};

const lookupCacheKey = ({ serviceType, term }) =>
  `${normalizeText(serviceType)}:${normalizeText(term)}`;

const checkpointKeyForSource = (source) =>
  `${source.serviceType}:${normalizeId(source.id) ?? normalizeComparableText(`${source.title}:${source.author}`)}`;

const emptyMatchCheckpoint = () => ({
  version: 1,
  matched: [],
  unmatched: [],
  ambiguous: [],
});

const readJsonIfExists = async (filePath, fallback) =>
  readJson(filePath).catch((error) => {
    if (error?.code === 'ENOENT') {
      return fallback;
    }

    throw error;
  });

const readLookupCache = async (migrationDir) =>
  readJsonIfExists(path.join(migrationDir, 'lookup-cache.json'), {});

const lookupCacheWrites = new Map();

const writeLookupCache = async (migrationDir, lookupCache) => {
  const previous = lookupCacheWrites.get(migrationDir) ?? Promise.resolve();
  const next = previous.then(() =>
    writeJson(path.join(migrationDir, 'lookup-cache.json'), lookupCache)
  );

  lookupCacheWrites.set(
    migrationDir,
    next.catch(() => {})
  );
  await next;
};

const lookupBookCached = async ({
  migrationDir,
  lookupCache,
  serviceType,
  baseUrl,
  apiKey,
  term,
}) => {
  const key = lookupCacheKey({ serviceType, term });

  if (Object.prototype.hasOwnProperty.call(lookupCache, key)) {
    return lookupCache[key];
  }

  const candidates = await lookupBook({ baseUrl, apiKey, term });
  lookupCache[key] = candidates;
  await writeLookupCache(migrationDir, lookupCache);

  return candidates;
};

const lookupBookCandidates = async ({
  migrationDir,
  lookupCache,
  serviceType,
  baseUrl,
  apiKey,
  source,
  profiles = [],
  includeSource = true,
}) => {
  const terms = [];
  const profileSources = includeSource ? [source, ...profiles] : profiles;

  for (const profile of profileSources) {
    if (profile.title && profile.author) {
      terms.push({ term: `${profile.title} ${profile.author}`, profile });
      terms.push({ term: `${profile.author} ${profile.title}`, profile });
    }

    for (const identifier of profile.identifiers ?? []) {
      for (const term of lookupTermVariants(identifier)) {
        terms.push({ term, profile });
      }
    }
  }

  const candidates = [];
  const seenTerms = new Set();
  const seenBooks = new Set();

  for (const entry of terms) {
    const normalizedTerm = normalizeText(entry.term);
    if (!normalizedTerm || seenTerms.has(normalizedTerm)) {
      continue;
    }
    seenTerms.add(normalizedTerm);

    const results = await lookupBookCached({
      migrationDir,
      lookupCache,
      serviceType,
      baseUrl,
      apiKey,
      term: normalizedTerm,
    });

    for (const candidate of results) {
      const key =
        normalizeId(candidate.foreignBookId) ?? JSON.stringify(candidate);
      if (seenBooks.has(key)) {
        continue;
      }
      seenBooks.add(key);
      candidates.push({
        candidate,
        lookupTerm: normalizedTerm,
        profile: entry.profile,
      });
    }
  }

  return candidates;
};

const postJson = async ({ baseUrl, apiKey, endpoint, body }) => {
  const url = new URL(`/api/v1${endpoint}`, baseUrl);
  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const responseBody = await response.text().catch(() => '');

    throw new Error(
      `POST ${endpoint} failed: ${response.status}${responseBody ? ` ${responseBody}` : ''}`
    );
  }

  return response.json();
};

const sqliteAvailable = async () => {
  try {
    await execFileAsync('sqlite3', ['--version']);
    return true;
  } catch {
    return false;
  }
};

const dedupeTargetCache = async (job) => {
  if (!getCacheDedupeEnabled() || !job.configDir) {
    return { ok: false, skipped: true };
  }

  const cacheDb = path.join(job.configDir, 'cache.db');

  try {
    await fs.access(cacheDb);
  } catch {
    return { ok: false, skipped: true };
  }

  if (!(await sqliteAvailable())) {
    return { ok: false, skipped: true };
  }

  const sql = `
    DELETE FROM HttpResponse
    WHERE Id NOT IN (
      SELECT MAX(Id)
      FROM HttpResponse
      GROUP BY Url
    );
    VACUUM;
  `;

  try {
    await execFileAsync('sqlite3', [cacheDb, sql], { timeout: 30000 });
    return { ok: true, cacheDb };
  } catch (error) {
    return {
      ok: false,
      cacheDb,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const classifyApplyFailure = (failure) => {
  const reason = normalizeText(failure?.reason);

  if (reason.includes('Sequence contains more than one element')) {
    return 'target_duplicate_http_cache';
  }

  if (reason.includes('Unexpected response fetching book data')) {
    return 'target_metadata_fetch_failed';
  }

  if (
    reason.includes('GoodreadsId') &&
    reason.includes('book with this ID was not found')
  ) {
    return 'target_book_id_not_found';
  }

  if (
    reason.includes('ForeignAuthorId') &&
    reason.includes('author with this ID was not found')
  ) {
    return 'target_author_id_not_found';
  }

  if (reason.includes('Object reference not set')) {
    return 'target_null_reference';
  }

  if (reason.includes('Request timed out')) {
    return 'target_timeout';
  }

  if (reason.includes('Local fallback failed')) {
    return 'local_fallback_rejected';
  }

  return 'other';
};

const applyFailureAction = (category) => {
  switch (category) {
    case 'target_duplicate_http_cache':
      return 'dedupe_target_cache_and_retry';
    case 'target_metadata_fetch_failed':
    case 'target_timeout':
      return 'retry';
    case 'target_author_id_not_found':
      return 'precreate_author_or_relookup';
    case 'target_book_id_not_found':
      return 'metadata_source_book_gap';
    case 'target_null_reference':
      return 'target_manual_review';
    case 'local_fallback_rejected':
      return 'target_needs_local_import_support';
    default:
      return 'inspect_failure';
  }
};

const extractAttemptedValue = (reason) => {
  const match = String(reason ?? '').match(/"attemptedValue":\s*"([^"]+)"/);

  return match?.[1];
};

const parseAuthorTitle = ({ title, authorTitle }) => {
  const normalizedTitle = normalizeComparableText(title);
  const rawAuthorTitle = normalizeText(authorTitle);

  if (!rawAuthorTitle || !normalizedTitle) {
    return undefined;
  }

  const titleIndex =
    normalizeComparableText(rawAuthorTitle).lastIndexOf(normalizedTitle);
  const rawAuthorName =
    titleIndex > 0
      ? rawAuthorTitle.slice(0, titleIndex).trim()
      : rawAuthorTitle;
  const [lastName, ...firstNameParts] = rawAuthorName
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (!lastName) {
    return undefined;
  }

  return firstNameParts.length
    ? `${firstNameParts.join(' ')} ${lastName}`
    : lastName;
};

const identifiersFromLookupResult = (result, source) => {
  const identifiers = [
    result.isbn13,
    result.isbn10,
    result.asin,
    result.foreignEditionId,
    ...(Array.isArray(result.editions)
      ? result.editions.flatMap((edition) => [
          edition.isbn13,
          edition.isbn10,
          edition.asin,
          edition.foreignEditionId,
        ])
      : []),
    ...(source.identifiers ?? []),
  ]
    .map((value) => normalizeText(String(value ?? '')))
    .filter(Boolean);

  return [...new Set(identifiers)];
};

const identifiersFromOpenLibraryDoc = (doc, source) => {
  const identifiers = [
    ...(Array.isArray(doc?.isbn) ? doc.isbn : []),
    ...(Array.isArray(source.identifiers) ? source.identifiers : []),
  ]
    .map((value) => normalizeText(String(value ?? '')))
    .filter(Boolean);

  return [...new Set(identifiers)];
};

const buildOpenLibraryRecoveredProfiles = async ({ item }) => {
  if (!getOpenLibraryRecoveryEnabled()) {
    return [];
  }

  const terms = [];

  if (item.source.title && item.source.author) {
    terms.push(`${item.source.title} ${item.source.author}`);
    terms.push(`${item.source.author} ${item.source.title}`);
  } else if (item.source.title) {
    terms.push(item.source.title);
  }

  for (const identifier of item.source.identifiers ?? []) {
    terms.push(...lookupTermVariants(identifier));
  }

  const profiles = [];
  const seenTerms = new Set();
  const seenProfiles = new Set();
  const lookupLimit = getRecoveryLookupLimit();

  for (const term of terms) {
    if (seenTerms.size >= lookupLimit) {
      break;
    }

    const normalizedTerm = normalizeText(term);

    if (!normalizedTerm || seenTerms.has(normalizedTerm)) {
      continue;
    }

    seenTerms.add(normalizedTerm);

    const url = new URL('/search.json', getOpenLibraryBaseUrl());
    url.searchParams.set('q', normalizedTerm);
    url.searchParams.set('limit', '10');

    const response = await fetchJson(url).catch(() => undefined);
    const docs = Array.isArray(response?.docs) ? response.docs : [];

    for (const doc of docs) {
      const title = normalizeText(doc?.title ?? item.source.title);
      const authors = Array.isArray(doc?.author_name)
        ? doc.author_name.map(normalizeText).filter(Boolean)
        : [];

      if (!title || !authors.length) {
        continue;
      }

      for (const author of authors.slice(0, 3)) {
        const identifiers = identifiersFromOpenLibraryDoc(doc, item.source);
        const key = `${normalizeComparableText(title)}:${normalizeComparableText(author)}:${identifiers.join(',')}`;

        if (seenProfiles.has(key)) {
          continue;
        }

        seenProfiles.add(key);
        profiles.push({
          title,
          author,
          identifiers,
          recoveredFrom: 'openlibrary',
          openLibraryLookupTerm: normalizedTerm,
          openLibraryWorkKey: normalizeText(doc?.key),
          openLibraryEditionKeys: Array.isArray(doc?.edition_key)
            ? doc.edition_key.map(normalizeText).filter(Boolean)
            : [],
        });
      }
    }
  }

  return profiles;
};

const buildSoftcoverRecoveredProfiles = async ({ item, job }) => {
  if (!job.softcoverBaseUrl || !job.softcoverApiKey) {
    return [];
  }

  const terms = [];

  if (item.source.title && item.source.author) {
    terms.push(`${item.source.title} ${item.source.author}`);
  }

  for (const identifier of item.source.identifiers ?? []) {
    terms.push(...lookupTermVariants(identifier));
  }

  const profiles = [];
  const seenTerms = new Set();
  const seenProfiles = new Set();
  const lookupLimit = getRecoveryLookupLimit();

  for (const term of terms) {
    if (seenTerms.size >= lookupLimit) {
      break;
    }

    const normalizedTerm = normalizeText(term);

    if (!normalizedTerm || seenTerms.has(normalizedTerm)) {
      continue;
    }

    seenTerms.add(normalizedTerm);

    const results = await lookupBook({
      baseUrl: job.softcoverBaseUrl,
      apiKey: job.softcoverApiKey,
      term: normalizedTerm,
    }).catch(() => []);

    for (const result of results) {
      const title = normalizeText(result.title ?? item.source.title);
      const author = normalizeText(
        result.author?.authorName ??
          result.authorName ??
          parseAuthorTitle({
            title,
            authorTitle: result.authorTitle,
          }) ??
          item.source.author
      );

      if (!title || !author) {
        continue;
      }

      const identifiers = identifiersFromLookupResult(result, item.source);
      const key = `${normalizeComparableText(title)}:${normalizeComparableText(author)}:${identifiers.join(',')}`;

      if (seenProfiles.has(key)) {
        continue;
      }

      seenProfiles.add(key);
      profiles.push({
        title,
        author,
        identifiers,
        recoveredFrom: 'softcover',
        softcoverLookupTerm: normalizedTerm,
      });
    }
  }

  return profiles;
};

const recoverUnmatchedWithOpenLibrary = async ({
  migrationDir,
  lookupCache,
  job,
  entries,
}) => {
  const recovered = [];
  const remaining = [];

  for (const entry of entries) {
    if (!entry?.source || !getOpenLibraryRecoveryEnabled()) {
      remaining.push(entry);
      continue;
    }

    const profiles = await buildOpenLibraryRecoveredProfiles({
      item: {
        source: entry.source,
      },
    });

    if (!profiles.length) {
      remaining.push(entry);
      continue;
    }

    const candidates = await lookupBookCandidates({
      migrationDir,
      lookupCache,
      serviceType: entry.source.serviceType,
      baseUrl: job.baseUrl,
      apiKey: job.apiKey,
      source: entry.source,
      profiles,
      includeSource: false,
    }).catch(() => []);

    let match;

    for (const { candidate, lookupTerm, profile } of candidates) {
      const decision = chooseStrictMatch({
        source: {
          ...entry.source,
          title: profile?.title ?? entry.source.title,
          author: profile?.author ?? entry.source.author,
          identifiers: profile?.identifiers ?? entry.source.identifiers,
        },
        candidates: [candidate],
        identifier:
          lookupTerm !== `${entry.source.title} ${entry.source.author}`,
      });

      if (decision.status === 'matched') {
        match = {
          source: entry.source,
          lookupTerm,
          reason: 'openlibrary_recovery',
          hardcover: decision.result,
          recoveredFrom: profile?.recoveredFrom,
          openLibraryLookupTerm: profile?.openLibraryLookupTerm,
        };
        break;
      }
    }

    if (match) {
      recovered.push(match);
    } else {
      remaining.push(entry);
    }
  }

  return { recovered, remaining };
};

const buildApplyFailureSummary = (failed) => {
  const byCategory = new Map();

  for (const failure of failed) {
    const category = classifyApplyFailure(failure);
    const existing = byCategory.get(category) ?? {
      category,
      count: 0,
      recommendedAction: applyFailureAction(category),
      attemptedValues: [],
      examples: [],
    };
    const attemptedValue = extractAttemptedValue(failure.reason);

    existing.count++;

    if (attemptedValue && !existing.attemptedValues.includes(attemptedValue)) {
      existing.attemptedValues.push(attemptedValue);
    }

    if (existing.examples.length < 10) {
      existing.examples.push({
        serviceType: failure.serviceType ?? failure.source?.serviceType,
        sourceId: failure.source?.id,
        title: failure.source?.title,
        author: failure.source?.author,
        attemptedValue,
      });
    }

    byCategory.set(category, existing);
  }

  return [...byCategory.values()].sort((a, b) => b.count - a.count);
};

const putJson = async ({ baseUrl, apiKey, endpoint, body }) => {
  const url = new URL(`/api/v1${endpoint}`, baseUrl);
  const response = await fetchWithRetry(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const responseBody = await response.text().catch(() => '');

    throw new Error(
      `PUT ${endpoint} failed: ${response.status}${responseBody ? ` ${responseBody}` : ''}`
    );
  }

  return response.json();
};

const getJson = async ({ baseUrl, apiKey, endpoint, searchParams }) => {
  const url = new URL(`/api/v1${endpoint}`, baseUrl);

  for (const [key, value] of Object.entries(searchParams ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetchWithRetry(url, {
    headers: {
      'X-Api-Key': apiKey,
    },
  });

  if (!response.ok) {
    const responseBody = await response.text().catch(() => '');

    throw new Error(
      `GET ${endpoint} failed: ${response.status}${responseBody ? ` ${responseBody}` : ''}`
    );
  }

  return response.json();
};

const resultTitle = (result) => normalizeComparableText(result?.title);

const resultAuthor = (result) =>
  normalizeComparableText(
    result?.author?.authorName ?? result?.authorTitle ?? result?.authorName
  );

// ---- Relaxed title comparison helpers ----

// Base normalization: lowercase, collapse whitespace, strip trailing period.
const normalizeRelaxedBase = (value) =>
  normalizeComparableText(value).replace(/\.+$/, '').trim();

// Strip apostrophes/right-quotes entirely (normalized + stripped variants).
const stripApostrophes = (value) => value.replace(/['\u2019\u2018\u02BC]/g, '');

// Strip leading articles ("a ", "an ", "the ").
const stripLeadingArticle = (value) => value.replace(/^(a |an |the )/i, '');

// Split on colon/semicolon, sort the parts alphabetically, rejoin, and trim.
// Handles swapped subtitle order (e.g. "Part 1: Siege" vs "Siege: Part 1").
const normalizeSplitSorted = (value) =>
  value
    .split(/[:;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .sort()
    .join(' ');

// Check whether one normalized title is a prefix of the other, indicating a
// subtitle difference (e.g. "Extra Lives" vs "Extra Lives: Why Video Games Matter").
const isPrefixMatch = (a, b) => {
  return a.length > 0 && b.length > 0 && (a.startsWith(b) || b.startsWith(a));
};

// Check whether one title's normalized form is contained wholly within the other
// as a substring (handles series prefix/suffix: "Dark Mirror" in "Star Trek: Dark Mirror").
const isContainedMatch = (a, b) => {
  if (a.length === 0 || b.length === 0) return false;
  if (a === b) return false;
  return a.includes(b) || b.includes(a);
};

// Generate all relaxed variants of a title for comparison.
// Returns an array of forms, ordered by specificity.
const relaxedTitleVariants = (value) => {
  const base = normalizeRelaxedBase(value);
  const noApos = stripApostrophes(base);
  const noArticle = stripLeadingArticle(base);
  const sorted = normalizeSplitSorted(base);

  const forms = new Set();

  // Exact base form
  forms.add(base);

  // With apostrophes stripped
  if (noApos !== base) forms.add(noApos);

  // With leading article stripped
  if (noArticle !== base) forms.add(noArticle);

  // With both article stripped AND apostrophes stripped
  const noArtNoApos = stripApostrophes(noArticle);
  if (
    noArtNoApos !== base &&
    noArtNoApos !== noApos &&
    noArtNoApos !== noArticle
  ) {
    forms.add(noArtNoApos);
  }

  // Prefix of each variant
  for (const variant of [...forms]) {
    // Strip common suffix patterns like " A Novel", subtitle from colon
    const colonIdx = variant.indexOf(':');
    if (colonIdx > 0) {
      forms.add(variant.substring(0, colonIdx).trim());
    }
    const semicolonIdx = variant.indexOf(';');
    if (semicolonIdx > 0) {
      forms.add(variant.substring(0, semicolonIdx).trim());
    }
  }

  // Split-sorted form (handles swapped subtitle order)
  if (sorted !== base) {
    forms.add(sorted);
    const sortedNoApos = stripApostrophes(sorted);
    if (sortedNoApos !== sorted) forms.add(sortedNoApos);
  }

  // Remove trailing " book x" or " part x" for clean prefix
  const trimmed = base
    .replace(/[-:,;]\s*(book\s+\d+|part\s+\d+|vol\.?\s*\d+|#\d+)\s*$/i, '')
    .trim();
  if (trimmed !== base && trimmed.length > 0) forms.add(trimmed);

  return [...forms];
};

// ---- End relaxed title comparison helpers ----

export const chooseStrictMatch = ({ source, candidates, identifier }) => {
  if (!candidates.length) {
    return { status: 'unmatched', reason: 'lookup_empty' };
  }

  const sourceTitle = normalizeComparableText(source.title);
  const sourceAuthor = normalizeComparableText(source.author);
  const exactCandidates = candidates.filter((candidate) => {
    const titleMatches = sourceTitle && resultTitle(candidate) === sourceTitle;
    const authorMatches =
      !sourceAuthor || resultAuthor(candidate) === sourceAuthor;

    return titleMatches && authorMatches;
  });

  if (exactCandidates.length === 1) {
    return {
      status: 'matched',
      reason: identifier
        ? 'identifier_exact_title_author'
        : 'title_author_exact',
      result: exactCandidates[0],
    };
  }

  if (exactCandidates.length > 1) {
    return {
      status: 'ambiguous',
      reason: 'multiple_exact_candidates',
      candidates: exactCandidates,
    };
  }

  // Fallback: when author matches, try a relaxed title comparison that accepts
  // subtitle differences, swapped subtitle order, leading articles, apostrophe
  // variants, series prefix/suffix, and minor punctuation.
  const sourceVariants = relaxedTitleVariants(source.title);
  const relaxedCandidates = candidates.filter((candidate) => {
    const authorMatches =
      !sourceAuthor || resultAuthor(candidate) === sourceAuthor;
    if (!authorMatches) {
      return false;
    }

    const candidateTitle = normalizeComparableText(candidate.title);
    if (!candidateTitle) {
      return false;
    }

    const candidateVariants = relaxedTitleVariants(candidate.title);

    // Check ANY variant matches (prefix, containment, or exact)
    for (const sv of sourceVariants) {
      if (!sv) continue;
      for (const cv of candidateVariants) {
        if (!cv) continue;
        if (sv === cv || isPrefixMatch(sv, cv) || isContainedMatch(sv, cv)) {
          return true;
        }
      }
    }

    return false;
  });

  if (relaxedCandidates.length === 1) {
    return {
      status: 'matched',
      reason: identifier
        ? 'identifier_prefix_title_author'
        : 'title_author_prefix',
      result: relaxedCandidates[0],
    };
  }

  if (relaxedCandidates.length > 1) {
    return {
      status: 'ambiguous',
      reason: 'multiple_prefix_candidates',
      candidates: relaxedCandidates,
    };
  }

  return {
    status: candidates.length === 1 ? 'unmatched' : 'ambiguous',
    reason: identifier
      ? 'identifier_without_exact_title_author'
      : 'no_exact_title_author',
    candidates,
  };
};

export const buildSourceBook = ({ inventory, book }) => {
  const editions = Array.isArray(inventory.editions) ? inventory.editions : [];
  const authors = Array.isArray(inventory.authors) ? inventory.authors : [];
  const authorMetadata = Array.isArray(inventory.authorMetadata)
    ? inventory.authorMetadata
    : [];
  const qualityProfiles = Array.isArray(inventory.qualityProfiles)
    ? inventory.qualityProfiles
    : [];
  const metadataProfiles = Array.isArray(inventory.metadataProfiles)
    ? inventory.metadataProfiles
    : [];
  const tags = Array.isArray(inventory.tags) ? inventory.tags : [];
  const rootFolders = Array.isArray(inventory.rootFolders)
    ? inventory.rootFolders
    : [];
  const bookEditions = findBookEditions(book, editions);
  const identifiers = extractIdentifiers(book, bookEditions);
  const authorRecord = findAuthorForBook(book, authors);
  const qualityProfileId =
    firstValue(book, [
      'QualityProfileId',
      'qualityProfileId',
      'QualityProfileID',
      'quality_profile_id',
    ]) ??
    firstValue(authorRecord, [
      'QualityProfileId',
      'qualityProfileId',
      'QualityProfileID',
      'quality_profile_id',
    ]);
  const metadataProfileId =
    firstValue(book, [
      'MetadataProfileId',
      'metadataProfileId',
      'MetadataProfileID',
      'metadata_profile_id',
    ]) ??
    firstValue(authorRecord, [
      'MetadataProfileId',
      'metadataProfileId',
      'MetadataProfileID',
      'metadata_profile_id',
    ]);
  const qualityProfile = findById(qualityProfiles, qualityProfileId);
  const metadataProfile = findById(metadataProfiles, metadataProfileId);
  const sourceTags =
    firstValue(book, ['Tags', 'tags']) ??
    firstValue(authorRecord, ['Tags', 'tags']);

  return {
    serviceType: inventory.serviceType,
    id: firstValue(book, ['Id', 'id', 'BookId', 'bookId']),
    title: extractBookTitle(book),
    author: extractAuthorName(book, authors, authorMetadata),
    rootFolderPath: deriveRootFolderPath({
      book,
      author: authorRecord,
      rootFolders,
    }),
    qualityProfileId,
    qualityProfileName: normalizeText(
      firstValue(qualityProfile, ['Name', 'name'])
    ),
    metadataProfileId,
    metadataProfileName: normalizeText(
      firstValue(metadataProfile, ['Name', 'name'])
    ),
    monitored: firstValue(book, ['Monitored', 'monitored']),
    tags: sourceTags,
    tagLabels: extractTagLabels({ ...book, Tags: sourceTags }, tags),
    identifiers,
  };
};

export const buildInventorySources = (inventory) => {
  const books = Array.isArray(inventory.books) ? inventory.books : [];

  return books.map((book) => buildSourceBook({ inventory, book }));
};

const matchCheckpointPath = ({ migrationDir, serviceType }) =>
  path.join(migrationDir, `${serviceType}-match-checkpoint.json`);

const normalizeCheckpoint = (checkpoint) => ({
  ...emptyMatchCheckpoint(),
  ...(checkpoint && typeof checkpoint === 'object' ? checkpoint : {}),
  matched: Array.isArray(checkpoint?.matched) ? checkpoint.matched : [],
  unmatched: Array.isArray(checkpoint?.unmatched) ? checkpoint.unmatched : [],
  ambiguous: Array.isArray(checkpoint?.ambiguous) ? checkpoint.ambiguous : [],
});

const checkpointProcessedKeys = (checkpoint) => {
  const keys = new Set();

  for (const bucket of [
    checkpoint.matched,
    checkpoint.unmatched,
    checkpoint.ambiguous,
  ]) {
    for (const entry of bucket) {
      if (entry?.source) {
        keys.add(checkpointKeyForSource(entry.source));
      }
    }
  }

  return keys;
};

const writeMatchCheckpoint = async ({
  migrationDir,
  serviceType,
  checkpoint,
}) => {
  await writeJson(
    matchCheckpointPath({ migrationDir, serviceType }),
    checkpoint
  );
};

const matchInventory = async ({
  migrationDir,
  inventory,
  baseUrl,
  apiKey,
  lookupCache,
}) => {
  const serviceType = inventory.serviceType ?? 'unknown';
  const checkpoint = normalizeCheckpoint(
    await readJsonIfExists(
      matchCheckpointPath({ migrationDir, serviceType }),
      emptyMatchCheckpoint()
    )
  );
  const matched = checkpoint.matched;
  const unmatched = checkpoint.unmatched;
  const ambiguous = checkpoint.ambiguous;
  const processedKeys = checkpointProcessedKeys(checkpoint);
  const maxBooks = getMigrationMaxBooks();
  const books = (Array.isArray(inventory.books) ? inventory.books : []).slice(
    0,
    maxBooks
  );
  const batchSize = getRateLimitBatchSize();
  const delayMs = getRateLimitDelayMs();
  const checkpointInterval = getCheckpointInterval();
  const identifierFallback = getIdentifierFallbackEnabled();
  const concurrency = getMatchConcurrency();
  let requestCount = 0;
  let processedCount = processedKeys.size;
  let checkpointDirtyCount = 0;
  let checkpointWrite = Promise.resolve();
  const totalBooks = books.length;

  const throttleIfNeeded = async () => {
    if (batchSize > 0 && requestCount > 0 && requestCount % batchSize === 0) {
      console.error(
        `[match] Batch limit reached (${requestCount} requests). ` +
          `Pausing ${delayMs}ms before next batch...`
      );
      await sleep(delayMs);
    }
  };

  const logProgress = () => {
    processedCount++;
    if (
      processedCount % Math.max(1, Math.floor(totalBooks / 10)) === 0 ||
      processedCount === totalBooks
    ) {
      const pct = Math.round((processedCount / totalBooks) * 100);
      console.error(
        `[match] Progress: ${processedCount}/${totalBooks} books (${pct}%) - ` +
          `matched=${matched.length}, unmatched=${unmatched.length}, ambiguous=${ambiguous.length}`
      );
    }
  };

  console.error(
    `[match] ${serviceType}: ${processedKeys.size}/${totalBooks} books already checkpointed.`
  );
  console.error(`[match] ${serviceType}: concurrency=${concurrency}`);

  const flushCheckpoint = async (force = false) => {
    if (!force && checkpointDirtyCount < checkpointInterval) {
      return;
    }

    checkpointDirtyCount = 0;
    checkpointWrite = checkpointWrite.then(() =>
      writeMatchCheckpoint({ migrationDir, serviceType, checkpoint })
    );
    await checkpointWrite;
  };

  const processBook = async (book) => {
    const source = buildSourceBook({ inventory, book });
    const processedKey = checkpointKeyForSource(source);

    if (processedKeys.has(processedKey)) {
      return;
    }

    if (!source.title) {
      unmatched.push({ source, reason: 'missing_source_title' });
      processedKeys.add(processedKey);
      logProgress();
      checkpointDirtyCount++;
      await flushCheckpoint();
      return;
    }

    let decision;
    let lookupTerm;

    if (source.author) {
      lookupTerm = `${source.title} ${source.author}`;

      try {
        await throttleIfNeeded();
        requestCount++;
        const titleAuthorCandidates = await lookupBookCached({
          migrationDir,
          lookupCache,
          serviceType,
          baseUrl,
          apiKey,
          term: lookupTerm,
        });
        decision = chooseStrictMatch({
          source,
          candidates: titleAuthorCandidates,
        });
      } catch (error) {
        decision = {
          status: 'unmatched',
          reason: 'lookup_failed',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    // Collect all identifier variants to try (ISBN-10, ISBN-13, both with/without
    // hyphens, with/without "isbn:" prefix, etc.).
    const allTerms = new Set();
    for (const identifier of source.identifiers) {
      for (const variant of lookupTermVariants(identifier)) {
        allTerms.add(variant);
      }
    }

    for (const term of identifierFallback ? allTerms : []) {
      if (decision?.status === 'matched') {
        break;
      }

      lookupTerm = term;
      let candidates;

      try {
        await throttleIfNeeded();
        requestCount++;
        candidates = await lookupBookCached({
          migrationDir,
          lookupCache,
          serviceType,
          baseUrl,
          apiKey,
          term: lookupTerm,
        });
      } catch (error) {
        decision = {
          status: 'unmatched',
          reason: 'lookup_failed',
          error: error instanceof Error ? error.message : String(error),
        };
        break;
      }

      decision = chooseStrictMatch({ source, candidates, identifier: term });

      if (decision.status === 'matched') {
        break;
      }
    }

    if (!decision) {
      unmatched.push({ source, reason: 'missing_identifier_or_author' });
    } else if (decision.status === 'matched') {
      matched.push({
        source,
        lookupTerm,
        reason: decision.reason,
        hardcover: decision.result,
      });
    } else if (decision.status === 'ambiguous') {
      ambiguous.push({
        source,
        lookupTerm,
        reason: decision.reason,
        candidates: decision.candidates,
      });
    } else {
      unmatched.push({
        source,
        lookupTerm,
        reason: decision.reason,
        error: decision.error,
        candidates: decision.candidates,
      });
    }

    processedKeys.add(processedKey);
    logProgress();
    checkpointDirtyCount++;
    await flushCheckpoint();
  };

  const pendingBooks = books.filter((book) => {
    const source = buildSourceBook({ inventory, book });
    return !processedKeys.has(checkpointKeyForSource(source));
  });
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, pendingBooks.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < pendingBooks.length) {
      const book = pendingBooks[nextIndex];
      nextIndex++;
      await processBook(book);
    }
  });

  await Promise.all(workers);
  await checkpointWrite;

  if (checkpointDirtyCount > 0) {
    await flushCheckpoint(true);
  }

  return { matched, unmatched, ambiguous };
};

export function parseTags(value) {
  if (Array.isArray(value)) {
    return value.map(tagIdFromValue).filter((tag) => tag !== undefined);
  }

  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    return Array.isArray(parsed)
      ? parsed.map(tagIdFromValue).filter((tag) => tag !== undefined)
      : [];
  } catch {
    return value
      .split(',')
      .map((tag) => Number(tag.trim()))
      .filter((tag) => Number.isInteger(tag));
  }
}

const boolFromSource = (value, fallback = true) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    return !['0', 'false', 'False'].includes(value);
  }

  return fallback;
};

// Synthesize a Hardcover-compatible entry from Readarr source metadata for
// books that were not found in the Hardcover API.  Uses deterministic local
// IDs derived from ISBN or a hash of title+author so the entry can be added
// as-is to a Bookshelf target.  The target will attempt to fetch metadata
// from Hardcover for this ID and fail gracefully, retaining the provided
// fields.
const synthesizeLocalEntry = (source) => {
  // Use the first ISBN-13 as the primary foreign identifier when available;
  // otherwise derive a stable ID from the title+author.
  const isbn13 = source.identifiers.find(
    (id) => id.length === 13 && /^97[89]/.test(id)
  );
  const fallbackId = `local:${normalizeComparableText(`${source.title}:${source.author}`).replace(/\s+/g, '-')}`;

  const foreignBookId = isbn13 ? `isbn:${isbn13}` : fallbackId;
  const foreignAuthorId = `local:${normalizeComparableText(source.author).replace(/\s+/g, '-')}`;

  // Build at least one edition so the rebuild validation passes.
  const editionIsbn = source.identifiers[0] || fallbackId;
  const foreignEditionId = isIsbn(stripIsbnHyphens(editionIsbn))
    ? `isbn:${stripIsbnHyphens(editionIsbn)}`
    : editionIsbn;

  return {
    foreignBookId,
    title: source.title,
    author: {
      foreignAuthorId,
      authorName: source.author,
    },
    editions: [
      {
        foreignEditionId,
        title: source.title,
        monitored: boolFromSource(source.monitored, true),
      },
    ],
  };
};

const sqliteQuote = (value) => {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  return `'${String(value).replaceAll("'", "''")}'`;
};

const slugifyLocal = (value) =>
  normalizeComparableText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';

const directInsertLocalBook = async ({ item, job, targetIds, tags }) => {
  if (!job.configDir) {
    throw new Error('HARDCOVER_LOCAL_DB_IMPORT requires target config dir.');
  }

  const dbPath = path.join(job.configDir, 'readarr.db');
  await fs.access(dbPath);

  const source = item.source;
  const local = synthesizeLocalEntry(source);
  const now = new Date().toISOString();
  const authorName = normalizeText(source.author);
  const title = normalizeText(source.title);
  const authorSlug = `local-${slugifyLocal(authorName)}`;
  const bookSlug = `local-${item.serviceType}-${normalizeId(source.id) ?? slugifyLocal(`${title}-${authorName}`)}`;
  const authorForeignId = `local:${item.serviceType}:${slugifyLocal(authorName)}`;
  const bookForeignId = `local:${item.serviceType}:${normalizeId(source.id) ?? slugifyLocal(`${title}-${authorName}`)}`;
  const editionForeignId = `${bookForeignId}:edition`;
  const isbn13 = source.identifiers?.find((id) =>
    ISBN13_REGEX.test(stripIsbnHyphens(id))
  );
  const authorPath = path.posix.join(
    normalizeText(source.rootFolderPath) || '/data/books',
    authorName.replace(/[\\/]+/g, ' ').trim()
  );
  const monitored = boolFromSource(source.monitored, true) ? 1 : 0;
  const tagJson = JSON.stringify(tags ?? []);
  const addOptions = JSON.stringify({
    monitor: 'none',
    searchForMissingBooks: false,
  });
  const ratings = JSON.stringify({ votes: 0, value: 0, popularity: 0 });

  const sql = `
    BEGIN IMMEDIATE;

    INSERT OR IGNORE INTO AuthorMetadata
      (ForeignAuthorId, TitleSlug, Name, Overview, Disambiguation, Gender, Hometown, Born, Died, Status, Images, Links, Genres, Ratings, Aliases, SortName, NameLastFirst, SortNameLastFirst)
    VALUES
      (${sqliteQuote(authorForeignId)}, ${sqliteQuote(authorSlug)}, ${sqliteQuote(authorName)}, NULL, NULL, NULL, NULL, NULL, NULL, 0, '[]', '[]', '[]', ${sqliteQuote(ratings)}, '[]', ${sqliteQuote(normalizeComparableText(authorName))}, ${sqliteQuote(authorName)}, ${sqliteQuote(normalizeComparableText(authorName))});

    INSERT OR IGNORE INTO Authors
      (CleanName, Path, Monitored, LastInfoSync, QualityProfileId, Tags, Added, AddOptions, MetadataProfileId, AuthorMetadataId, MonitorNewItems)
    SELECT
      ${sqliteQuote(normalizeComparableText(authorName))},
      ${sqliteQuote(authorPath)},
      0,
      ${sqliteQuote(now)},
      ${Number(targetIds.qualityProfileId)},
      ${sqliteQuote(tagJson)},
      ${sqliteQuote(now)},
      ${sqliteQuote(addOptions)},
      ${Number(targetIds.metadataProfileId)},
      Id,
      0
    FROM AuthorMetadata
    WHERE ForeignAuthorId = ${sqliteQuote(authorForeignId)};

    INSERT OR IGNORE INTO Books
      (AuthorMetadataId, ForeignBookId, TitleSlug, Title, ReleaseDate, Links, Genres, Ratings, CleanTitle, Monitored, AnyEditionOk, LastInfoSync, Added, AddOptions, RelatedBooks, LastSearchTime)
    SELECT
      Id,
      ${sqliteQuote(bookForeignId)},
      ${sqliteQuote(bookSlug)},
      ${sqliteQuote(title)},
      NULL,
      '[]',
      '[]',
      ${sqliteQuote(ratings)},
      ${sqliteQuote(normalizeComparableText(title))},
      ${monitored},
      1,
      ${sqliteQuote(now)},
      ${sqliteQuote(now)},
      ${sqliteQuote(addOptions)},
      '[]',
      NULL
    FROM AuthorMetadata
    WHERE ForeignAuthorId = ${sqliteQuote(authorForeignId)};

    INSERT OR IGNORE INTO Editions
      (BookId, ForeignEditionId, Isbn13, Asin, Title, TitleSlug, Language, Overview, Format, IsEbook, Disambiguation, Publisher, PageCount, ReleaseDate, Images, Links, Ratings, Monitored, ManualAdd)
    SELECT
      Id,
      ${sqliteQuote(editionForeignId)},
      ${sqliteQuote(isbn13 ? stripIsbnHyphens(isbn13) : null)},
      NULL,
      ${sqliteQuote(title)},
      ${sqliteQuote(`${bookSlug}-edition`)},
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      '[]',
      '[]',
      ${sqliteQuote(ratings)},
      ${monitored},
      1
    FROM Books
    WHERE ForeignBookId = ${sqliteQuote(bookForeignId)};

    COMMIT;
  `;

  await execFileAsync('sqlite3', [dbPath, sql], { timeout: 30000 });

  const { stdout } = await execFileAsync(
    'sqlite3',
    [
      dbPath,
      `select Id from Books where ForeignBookId = ${sqliteQuote(bookForeignId)} limit 1;`,
    ],
    { timeout: 30000 }
  );
  const id = Number(stdout.trim());

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Local DB import did not create book: ${title}`);
  }

  return {
    id,
    title,
    foreignBookId: bookForeignId,
    foreignEditionId: editionForeignId,
    localDbImport: true,
    localEntry: local,
  };
};

const sqliteScalar = async ({ dbPath, sql }) => {
  const { stdout } = await execFileAsync('sqlite3', [dbPath, sql], {
    timeout: 30000,
  });

  return normalizeText(stdout.trim().split('\n')[0]);
};

const localBookForeignIdForSource = (source) =>
  `local:${source.serviceType}:${normalizeId(source.id) ?? slugifyLocal(`${source.title}-${source.author}`)}`;

const localAuthorForeignIdForSource = (source) =>
  `local:${source.serviceType}:${slugifyLocal(source.author)}`;

const reconcileLocalBookInDb = async ({ job, applied, hardcover }) => {
  if (!job.configDir) {
    return {
      ok: false,
      reason: 'target_config_dir_not_provided',
    };
  }

  const dbPath = path.join(job.configDir, 'readarr.db');
  await fs.access(dbPath);

  const source = applied.source;
  const localBookForeignId = localBookForeignIdForSource(source);
  const localAuthorForeignId = localAuthorForeignIdForSource(source);
  const nativeBookForeignId = normalizeId(hardcover.foreignBookId);
  const nativeAuthorForeignId = normalizeId(hardcover.author?.foreignAuthorId);
  const nativeEditionForeignId = normalizeId(
    hardcover.editions?.[0]?.foreignEditionId
  );

  if (
    !nativeBookForeignId ||
    !nativeAuthorForeignId ||
    !nativeEditionForeignId
  ) {
    return {
      ok: false,
      reason: 'native_candidate_missing_required_ids',
    };
  }

  const localBookId = Number(
    await sqliteScalar({
      dbPath,
      sql: `select Id from Books where ForeignBookId = ${sqliteQuote(localBookForeignId)} limit 1;`,
    })
  );

  if (!Number.isInteger(localBookId) || localBookId <= 0) {
    return {
      ok: false,
      reason: 'local_shadow_book_not_found',
      localBookForeignId,
    };
  }

  const duplicateBookId = Number(
    await sqliteScalar({
      dbPath,
      sql: `select Id from Books where ForeignBookId = ${sqliteQuote(nativeBookForeignId)} and Id <> ${Number(localBookId)} limit 1;`,
    })
  );

  if (Number.isInteger(duplicateBookId) && duplicateBookId > 0) {
    return {
      ok: false,
      reason: 'native_duplicate_book_exists',
      duplicateBookId,
      nativeBookForeignId,
    };
  }

  const nativeAuthorMetadataId = Number(
    await sqliteScalar({
      dbPath,
      sql: `select Id from AuthorMetadata where ForeignAuthorId = ${sqliteQuote(nativeAuthorForeignId)} limit 1;`,
    })
  );
  const localAuthorMetadataId = Number(
    await sqliteScalar({
      dbPath,
      sql: `select Id from AuthorMetadata where ForeignAuthorId = ${sqliteQuote(localAuthorForeignId)} limit 1;`,
    })
  );
  const targetAuthorMetadataId =
    Number.isInteger(nativeAuthorMetadataId) && nativeAuthorMetadataId > 0
      ? nativeAuthorMetadataId
      : localAuthorMetadataId;

  if (
    !Number.isInteger(targetAuthorMetadataId) ||
    targetAuthorMetadataId <= 0
  ) {
    return {
      ok: false,
      reason: 'local_author_metadata_not_found',
      localAuthorForeignId,
    };
  }

  const edition = hardcover.editions?.[0] ?? {};
  const isbn13 = normalizeText(edition.isbn13 ?? edition.ISBN13);
  const title = normalizeText(hardcover.title ?? source.title);
  const authorName = normalizeText(
    hardcover.author?.authorName ?? hardcover.author?.name ?? source.author
  );
  const authorSlug = `hardcover-${slugifyLocal(authorName)}`;
  const bookSlug = `hardcover-${slugifyLocal(title)}-${slugifyLocal(nativeBookForeignId)}`;

  const sql = `
    BEGIN IMMEDIATE;

    UPDATE AuthorMetadata
    SET
      ForeignAuthorId = ${sqliteQuote(nativeAuthorForeignId)},
      TitleSlug = ${sqliteQuote(authorSlug)},
      Name = ${sqliteQuote(authorName)},
      SortName = ${sqliteQuote(normalizeComparableText(authorName))},
      NameLastFirst = ${sqliteQuote(authorName)},
      SortNameLastFirst = ${sqliteQuote(normalizeComparableText(authorName))}
    WHERE Id = ${Number(targetAuthorMetadataId)}
      AND NOT EXISTS (
        SELECT 1 FROM AuthorMetadata
        WHERE ForeignAuthorId = ${sqliteQuote(nativeAuthorForeignId)}
          AND Id <> ${Number(targetAuthorMetadataId)}
      );

    UPDATE Books
    SET
      AuthorMetadataId = ${Number(targetAuthorMetadataId)},
      ForeignBookId = ${sqliteQuote(nativeBookForeignId)},
      TitleSlug = ${sqliteQuote(bookSlug)},
      Title = ${sqliteQuote(title)},
      CleanTitle = ${sqliteQuote(normalizeComparableText(title))},
      LastInfoSync = ${sqliteQuote(new Date().toISOString())}
    WHERE Id = ${Number(localBookId)};

    UPDATE Editions
    SET
      ForeignEditionId = ${sqliteQuote(nativeEditionForeignId)},
      Isbn13 = ${sqliteQuote(isbn13 || null)},
      Title = ${sqliteQuote(normalizeText(edition.title ?? title))},
      TitleSlug = ${sqliteQuote(`${bookSlug}-edition`)}
    WHERE BookId = ${Number(localBookId)};

    COMMIT;
  `;

  await execFileAsync('sqlite3', [dbPath, sql], { timeout: 30000 });

  return {
    ok: true,
    bookId: localBookId,
    oldForeignBookId: localBookForeignId,
    newForeignBookId: nativeBookForeignId,
    newForeignAuthorId: nativeAuthorForeignId,
    newForeignEditionId: nativeEditionForeignId,
  };
};

const buildAddPayload = (match) => {
  const rootFolderPath = normalizeText(match.source.rootFolderPath);
  const qualityProfileId = Number(match.source.qualityProfileId || 0);
  const metadataProfileId = Number(match.source.metadataProfileId || 0) || 1;
  const monitored = boolFromSource(match.source.monitored, true);
  const hardcover = match.hardcover;

  return {
    serviceType: match.source.serviceType,
    source: match.source,
    lookupTerm: match.lookupTerm,
    addBook: {
      ...hardcover,
      monitored,
      qualityProfileId,
      metadataProfileId,
      rootFolderPath,
      tags: [],
      author: {
        ...hardcover.author,
        rootFolderPath,
        qualityProfileId,
        metadataProfileId,
        monitored: false,
        addOptions: {
          monitor: 'none',
          searchForMissingBooks: false,
        },
        manualAdd: true,
      },
      editions: Array.isArray(hardcover.editions) ? hardcover.editions : [],
      addOptions: {
        searchForNewBook: false,
      },
    },
  };
};

const validateRebuildSource = (match) => {
  const missing = [];

  if (!normalizeText(match.source.rootFolderPath)) {
    missing.push('rootFolderPath');
  }

  if (!Number(match.source.qualityProfileId || 0)) {
    missing.push('qualityProfileId');
  }

  if (!match.hardcover?.foreignBookId) {
    missing.push('hardcover.foreignBookId');
  }

  if (!match.hardcover?.author?.foreignAuthorId) {
    missing.push('hardcover.author.foreignAuthorId');
  }

  if (
    !Array.isArray(match.hardcover?.editions) ||
    !match.hardcover.editions.length
  ) {
    missing.push('hardcover.editions');
  }

  return missing;
};

export const buildRebuildArtifacts = (matched) => {
  const rebuildPayload = [];
  const rebuildBlocked = [];

  for (const match of matched) {
    const missing = validateRebuildSource(match);

    if (missing.length) {
      rebuildBlocked.push({
        source: match.source,
        lookupTerm: match.lookupTerm,
        reason: 'missing_required_rebuild_fields',
        missing,
      });
      continue;
    }

    rebuildPayload.push(buildAddPayload(match));
  }

  return { rebuildPayload, rebuildBlocked };
};

const applyRebuildPayload = async ({ migrationDir, jobs }) => {
  const rebuildPayload = await readJson(
    path.join(migrationDir, 'rebuild-payload.json')
  );
  const lookupCache = await readLookupCache(migrationDir);
  const applied = await readJsonIfExists(
    path.join(migrationDir, 'applied-books.json'),
    []
  );
  const failed = [];
  const appliedKeys = new Set(
    applied
      .map((item) =>
        item?.source ? checkpointKeyForSource(item.source) : undefined
      )
      .filter(Boolean)
  );
  const monitorUpdates = new Map();
  const targetCache = new Map();
  const authorCache = new Map();
  const batchSize = getRateLimitBatchSize();
  const delayMs = getRateLimitDelayMs();
  let requestCount = 0;
  const totalItems = rebuildPayload.length;

  const throttleIfNeeded = async () => {
    if (batchSize > 0 && requestCount > 0 && requestCount % batchSize === 0) {
      console.error(
        `[apply] Batch limit reached (${requestCount} requests). ` +
          `Pausing ${delayMs}ms before next batch...`
      );
      await sleep(delayMs);
    }
  };

  const logProgress = (index) => {
    const processedCount = index + 1;
    if (
      totalItems <= 1 ||
      processedCount % Math.max(1, Math.floor(totalItems / 10)) === 0 ||
      processedCount === totalItems
    ) {
      const pct = Math.round((processedCount / totalItems) * 100);
      console.error(
        `[apply] Progress: ${processedCount}/${totalItems} books (${pct}%) - ` +
          `applied=${applied.length}, failed=${failed.length}`
      );
    }
  };

  const logItemRetry = (index, item, message) => {
    const processedCount = index + 1;
    console.error(
      `[apply] ${message}: ${processedCount}/${totalItems} ` +
        `${item.serviceType} "${item.source.title}" by ${item.source.author}`
    );
  };

  const getTargetConfig = async (job) => {
    if (targetCache.has(job.serviceType)) {
      return targetCache.get(job.serviceType);
    }

    const [qualityProfiles, metadataProfiles, rootFolders, tags] =
      await Promise.all([
        getJson({
          baseUrl: job.baseUrl,
          apiKey: job.apiKey,
          endpoint: '/qualityProfile',
        }),
        getJson({
          baseUrl: job.baseUrl,
          apiKey: job.apiKey,
          endpoint: '/metadataProfile',
        }).catch(() => []),
        getJson({
          baseUrl: job.baseUrl,
          apiKey: job.apiKey,
          endpoint: '/rootfolder',
        }),
        getJson({
          baseUrl: job.baseUrl,
          apiKey: job.apiKey,
          endpoint: '/tag',
        }).catch(() => []),
      ]);
    const config = {
      qualityProfiles: Array.isArray(qualityProfiles) ? qualityProfiles : [],
      metadataProfiles: Array.isArray(metadataProfiles) ? metadataProfiles : [],
      rootFolders: Array.isArray(rootFolders) ? rootFolders : [],
      tags: Array.isArray(tags) ? tags : [],
    };

    targetCache.set(job.serviceType, config);

    return config;
  };

  const resolveTargetIds = async (item, job, targetConfig) => {
    const rootFolderPath = normalizeReadarrRootFolderPath(
      item.addBook.rootFolderPath
    );
    const qualityProfile = item.source.qualityProfileName
      ? targetConfig.qualityProfiles.find(
          (profile) =>
            normalizeComparableText(profile.name ?? profile.Name) ===
            normalizeComparableText(item.source.qualityProfileName)
        )
      : findById(targetConfig.qualityProfiles, item.addBook.qualityProfileId, [
          'id',
          'Id',
        ]);
    const metadataProfile = item.source.metadataProfileName
      ? targetConfig.metadataProfiles.find(
          (profile) =>
            normalizeComparableText(profile.name ?? profile.Name) ===
            normalizeComparableText(item.source.metadataProfileName)
        )
      : findById(
          targetConfig.metadataProfiles,
          item.addBook.metadataProfileId,
          ['id', 'Id']
        );
    let rootFolder = targetConfig.rootFolders.find(
      (folder) =>
        normalizePathComparable(folder.path ?? folder.Path) ===
        normalizePathComparable(rootFolderPath)
    );
    const missing = [];

    if (!qualityProfile?.id && !qualityProfile?.Id) {
      missing.push(
        `qualityProfile:${item.source.qualityProfileName || item.addBook.qualityProfileId}`
      );
    }

    if (!metadataProfile?.id && !metadataProfile?.Id) {
      missing.push(
        `metadataProfile:${item.source.metadataProfileName || item.addBook.metadataProfileId}`
      );
    }

    if (!rootFolder) {
      const createdRootFolder = await postJson({
        baseUrl: job.baseUrl,
        apiKey: job.apiKey,
        endpoint: '/rootfolder',
        body: {
          path: rootFolderPath,
          name: rootFolderPath.split('/').filter(Boolean).pop() ?? 'Books',
          defaultQualityProfileId: Number(
            qualityProfile.id ?? qualityProfile.Id
          ),
          defaultMetadataProfileId: Number(
            metadataProfile.id ?? metadataProfile.Id
          ),
          defaultMonitorOption: 0,
          defaultNewItemMonitorOption: 0,
          defaultTags: [],
          isCalibreLibrary: false,
          calibreSettings: {},
        },
      });
      targetConfig.rootFolders.push(createdRootFolder);
    }

    if (missing.length) {
      throw new Error(`Target configuration missing ${missing.join(', ')}`);
    }

    return {
      qualityProfileId: Number(qualityProfile.id ?? qualityProfile.Id),
      metadataProfileId: Number(metadataProfile.id ?? metadataProfile.Id),
      rootFolderPath,
    };
  };

  const resolveTargetTags = async (item, job, targetConfig) => {
    const labels = Array.isArray(item.source.tagLabels)
      ? item.source.tagLabels
      : [];
    const tagIds = [];

    for (const label of labels) {
      const existing = targetConfig.tags.find(
        (tag) =>
          normalizeComparableText(tag.label ?? tag.Label) ===
          normalizeComparableText(label)
      );

      if (existing?.id || existing?.Id) {
        tagIds.push(Number(existing.id ?? existing.Id));
        continue;
      }

      const created = await postJson({
        baseUrl: job.baseUrl,
        apiKey: job.apiKey,
        endpoint: '/tag',
        body: { label },
      });
      targetConfig.tags.push(created);
      tagIds.push(Number(created.id ?? created.Id));
    }

    return tagIds;
  };

  const isMissingForeignAuthorError = (err) => {
    const message = err instanceof Error ? err.message : String(err);

    return (
      message.includes('ForeignAuthorId') &&
      message.includes('author with this ID was not found')
    );
  };

  const isInvalidForeignBookError = (err) => {
    const message = err instanceof Error ? err.message : String(err);

    return (
      message.includes('GoodreadsId') &&
      message.includes('book with this ID was not found')
    );
  };

  const isInvalidForeignAuthorError = (err) => {
    const message = err instanceof Error ? err.message : String(err);

    return (
      message.includes('ForeignAuthorId') &&
      message.includes('author with this ID was not found')
    );
  };

  const isTargetMetadataFetchError = (err) => {
    const message = err instanceof Error ? err.message : String(err);

    return (
      message.includes('Unexpected response fetching book data') ||
      message.includes('Sequence contains no matching element')
    );
  };

  const isDuplicateCacheError = (err) => {
    const message = err instanceof Error ? err.message : String(err);

    return message.includes('Sequence contains more than one element');
  };

  const buildLocalFallbackAddBook = ({ item, targetIds, tags }) => {
    const local = synthesizeLocalEntry(item.source);

    return {
      ...buildAddPayload({
        source: item.source,
        lookupTerm: `local:${item.source.title} ${item.source.author}`,
        hardcover: local,
      }).addBook,
      qualityProfileId: targetIds.qualityProfileId,
      metadataProfileId: targetIds.metadataProfileId,
      tags,
      author: {
        ...local.author,
        rootFolderPath: targetIds.rootFolderPath,
        qualityProfileId: targetIds.qualityProfileId,
        metadataProfileId: targetIds.metadataProfileId,
        monitored: false,
        addOptions: {
          monitor: 'none',
          searchForMissingBooks: false,
        },
        manualAdd: true,
      },
    };
  };

  const getTargetAuthors = async (job) => {
    if (authorCache.has(job.serviceType)) {
      return authorCache.get(job.serviceType);
    }

    await throttleIfNeeded();
    requestCount++;
    const authors = await getJson({
      baseUrl: job.baseUrl,
      apiKey: job.apiKey,
      endpoint: '/author',
    });
    const normalized = Array.isArray(authors) ? authors : [];
    authorCache.set(job.serviceType, normalized);

    return normalized;
  };

  const ensureTargetAuthor = async ({ item, job, targetIds }) => {
    const foreignAuthorId = normalizeId(item.addBook.author?.foreignAuthorId);

    if (!foreignAuthorId) {
      return;
    }

    const authors = await getTargetAuthors(job);
    const existing = authors.find(
      (author) =>
        normalizeId(author.foreignAuthorId ?? author.ForeignAuthorId) ===
        foreignAuthorId
    );

    if (existing) {
      return;
    }

    const authorName = normalizeText(
      item.addBook.author?.authorName ?? item.source.author
    );

    await throttleIfNeeded();
    requestCount++;
    const lookupResults = await getJson({
      baseUrl: job.baseUrl,
      apiKey: job.apiKey,
      endpoint: '/author/lookup',
      searchParams: { term: authorName || foreignAuthorId },
    });
    const lookupAuthor = (
      Array.isArray(lookupResults) ? lookupResults : []
    ).find(
      (author) =>
        normalizeId(author.foreignAuthorId ?? author.ForeignAuthorId) ===
        foreignAuthorId
    );

    if (!lookupAuthor) {
      return;
    }

    const authorPayload = {
      ...lookupAuthor,
      qualityProfileId: targetIds.qualityProfileId,
      metadataProfileId: targetIds.metadataProfileId,
      rootFolderPath: targetIds.rootFolderPath,
      monitored: false,
      monitorNewItems: 'none',
      tags: [],
      addOptions: {
        monitor: 'none',
        searchForMissingBooks: false,
      },
      manualAdd: true,
    };

    await throttleIfNeeded();
    requestCount++;
    const created = await postJson({
      baseUrl: job.baseUrl,
      apiKey: job.apiKey,
      endpoint: '/author',
      body: authorPayload,
    });
    authors.push(created);
  };

  const buildRecoveredAddBook = async ({
    item,
    job,
    targetIds,
    tags,
    rejectedIds,
  }) => {
    const softcoverProfiles = await buildSoftcoverRecoveredProfiles({
      item,
      job,
    });
    const openLibraryProfiles = softcoverProfiles.length
      ? []
      : await buildOpenLibraryRecoveredProfiles({
          item,
        });
    const candidates = await lookupBookCandidates({
      migrationDir,
      lookupCache,
      serviceType: item.serviceType,
      baseUrl: job.baseUrl,
      apiKey: job.apiKey,
      source: item.source,
      profiles: [...softcoverProfiles, ...openLibraryProfiles],
      includeSource: false,
    });
    const usableCandidates = candidates.filter(({ candidate }) => {
      const foreignBookId = normalizeId(candidate.foreignBookId);

      return foreignBookId && !rejectedIds.has(foreignBookId);
    });

    for (const { candidate, lookupTerm, profile } of usableCandidates) {
      const matchSource = {
        ...item.source,
        title: profile?.title ?? item.source.title,
        author: profile?.author ?? item.source.author,
        identifiers: profile?.identifiers ?? item.source.identifiers,
      };
      const decision = chooseStrictMatch({
        source: matchSource,
        candidates: [candidate],
        identifier: lookupTerm !== `${item.source.title} ${item.source.author}`,
      });

      if (decision.status !== 'matched') {
        continue;
      }

      return {
        lookupTerm,
        addBook: {
          ...buildAddPayload({
            source: item.source,
            lookupTerm,
            hardcover: decision.result,
          }).addBook,
          qualityProfileId: targetIds.qualityProfileId,
          metadataProfileId: targetIds.metadataProfileId,
          tags,
          author: {
            ...decision.result.author,
            rootFolderPath: targetIds.rootFolderPath,
            qualityProfileId: targetIds.qualityProfileId,
            metadataProfileId: targetIds.metadataProfileId,
            monitored: false,
            addOptions: {
              monitor: 'none',
              searchForMissingBooks: false,
            },
            manualAdd: true,
          },
        },
      };
    }

    return undefined;
  };

  for (const job of jobs) {
    await dedupeTargetCache(job);
  }

  for (let i = 0; i < rebuildPayload.length; i++) {
    const item = rebuildPayload[i];
    const appliedKey = checkpointKeyForSource(item.source);

    if (appliedKeys.has(appliedKey)) {
      logProgress(i);
      continue;
    }

    const job = jobs.find(
      (candidate) => candidate.serviceType === item.serviceType
    );

    if (!job?.apiKey) {
      failed.push({
        source: item.source,
        serviceType: item.serviceType,
        reason: 'hardcover_api_key_not_provided',
      });
      logProgress(i);
      continue;
    }

    const isRecoverableConstraintError = (err) => {
      const message = err instanceof Error ? err.message : String(err);
      return (
        message.includes('409') &&
        message.includes('UNIQUE constraint') &&
        (message.includes('ForeignEditionId') || message.includes('TitleSlug'))
      );
    };

    let addBook;
    let postSucceeded = false;
    let result;
    let targetIds;
    let tags;

    try {
      await throttleIfNeeded();
      requestCount++;
      const targetConfig = await getTargetConfig(job);
      targetIds = await resolveTargetIds(item, job, targetConfig);
      tags = await resolveTargetTags(item, job, targetConfig);
      addBook = {
        ...item.addBook,
        qualityProfileId: targetIds.qualityProfileId,
        metadataProfileId: targetIds.metadataProfileId,
        tags,
        author: {
          ...item.addBook.author,
          qualityProfileId: targetIds.qualityProfileId,
          metadataProfileId: targetIds.metadataProfileId,
        },
      };
      const postBook = async () => {
        await throttleIfNeeded();
        requestCount++;
        return postJson({
          baseUrl: job.baseUrl,
          apiKey: job.apiKey,
          endpoint: '/book',
          body: addBook,
        });
      };
      const rejectedIds = new Set();
      const recoverViaSoftcover = async () => {
        const rejectedId = normalizeId(addBook.foreignBookId);
        if (rejectedId) {
          rejectedIds.add(rejectedId);
        }
        const recovered = await buildRecoveredAddBook({
          item,
          job,
          targetIds,
          tags,
          rejectedIds,
        });

        if (!recovered) {
          return false;
        }

        addBook = recovered.addBook;
        result = await postBook();
        return true;
      };
      try {
        try {
          result = await postBook();
        } catch (postError) {
          if (isDuplicateCacheError(postError)) {
            await dedupeTargetCache(job);
            result = await postBook();
          } else if (isMissingForeignAuthorError(postError)) {
            logItemRetry(i, item, 'recovering missing target author');
            try {
              await ensureTargetAuthor({ item, job, targetIds });
              result = await postBook();
            } catch (authorRecoveryError) {
              if (
                !isInvalidForeignAuthorError(authorRecoveryError) &&
                !isTargetMetadataFetchError(authorRecoveryError)
              ) {
                throw authorRecoveryError;
              }

              logItemRetry(
                i,
                item,
                'recovering missing target author via softcover remap'
              );
              if (!(await recoverViaSoftcover())) {
                throw authorRecoveryError;
              }
            }
          } else if (
            isInvalidForeignBookError(postError) ||
            isTargetMetadataFetchError(postError)
          ) {
            logItemRetry(i, item, 'recovering via softcover remap');
            if (!(await recoverViaSoftcover())) {
              throw postError;
            }
          } else {
            throw postError;
          }
        }
      } catch (recoveredPostError) {
        if (!getLocalImportEnabled()) {
          throw recoveredPostError;
        }

        const originalReason =
          recoveredPostError instanceof Error
            ? recoveredPostError.message
            : String(recoveredPostError);
        addBook = buildLocalFallbackAddBook({ item, targetIds, tags });
        try {
          result = await postBook();
        } catch (localPostError) {
          const localReason =
            localPostError instanceof Error
              ? localPostError.message
              : String(localPostError);
          throw new Error(
            `${originalReason}\nLocal fallback failed: ${localReason}`
          );
        }
      }
      postSucceeded = true;
    } catch (postError) {
      // 409 constraint on ForeignEditionId means the edition already exists in
      // the target (another book from the same author was added earlier in this
      // run, expanding the author into many unmonitored books). The book may
      // already be in the target; recover by looking it up post-facto.
      if (!isRecoverableConstraintError(postError)) {
        if (getLocalDbImportEnabled() && targetIds && tags) {
          try {
            result = await directInsertLocalBook({
              item,
              job,
              targetIds,
              tags,
            });
            postSucceeded = true;
          } catch (localDbError) {
            failed.push({
              source: item.source,
              serviceType: item.serviceType,
              reason:
                `${postError instanceof Error ? postError.message : String(postError)}\n` +
                `Local DB import failed: ${
                  localDbError instanceof Error
                    ? localDbError.message
                    : String(localDbError)
                }`,
            });
            logProgress(i);
            continue;
          }
        } else {
          failed.push({
            source: item.source,
            serviceType: item.serviceType,
            reason:
              postError instanceof Error
                ? postError.message
                : String(postError),
          });
          logProgress(i);
          continue;
        }
      }
    }

    // Resolve the target book ID from POST result or by searching the target.
    let targetBookId;

    try {
      // If POST succeeded, prefer the returned id immediately.
      if (postSucceeded && result) {
        targetBookId = result.id ?? result.Id;
      }

      // If we still don't have an id (409 path), search the target.
      if (targetBookId === undefined) {
        await throttleIfNeeded();
        requestCount++;
        const targetBooks = await getJson({
          baseUrl: job.baseUrl,
          apiKey: job.apiKey,
          endpoint: '/book',
        });
        const targetBook = (Array.isArray(targetBooks) ? targetBooks : []).find(
          (book) =>
            normalizeId(book.foreignBookId ?? book.ForeignBookId) ===
              normalizeId(item.addBook.foreignBookId) ||
            normalizeComparableText(book.title ?? book.Title) ===
              normalizeComparableText(
                item.addBook.title ?? addBook?.title ?? ''
              )
        );

        targetBookId = targetBook?.id ?? targetBook?.Id;
      }

      if (targetBookId !== undefined) {
        const monitorKey = `${job.serviceType}:${boolFromSource(
          item.source.monitored,
          true
        )}`;
        const existing = monitorUpdates.get(monitorKey) ?? {
          job,
          monitored: boolFromSource(item.source.monitored, true),
          bookIds: [],
        };
        existing.bookIds.push(Number(targetBookId));
        monitorUpdates.set(monitorKey, existing);

        applied.push({
          source: item.source,
          serviceType: item.serviceType,
          hardcoverBookId: targetBookId,
          title: result?.title ?? item.addBook.title,
          foreignBookId:
            result?.foreignBookId ??
            result?.ForeignBookId ??
            addBook?.foreignBookId,
          localDbImport: result?.localDbImport === true,
        });
        appliedKeys.add(appliedKey);
      } else {
        failed.push({
          source: item.source,
          serviceType: item.serviceType,
          reason: 'not_found_in_target_after_post',
        });
      }
    } catch (lookupError) {
      failed.push({
        source: item.source,
        serviceType: item.serviceType,
        reason:
          lookupError instanceof Error
            ? lookupError.message
            : String(lookupError),
      });
    }

    logProgress(i);
  }

  for (const update of monitorUpdates.values()) {
    try {
      const bookIds = [...new Set(update.bookIds)];
      await putJson({
        baseUrl: update.job.baseUrl,
        apiKey: update.job.apiKey,
        endpoint: '/book/monitor',
        body: {
          bookIds,
          monitored: update.monitored,
        },
      });

      if (update.monitored) {
        await sleep(1000);
        const books = await getJson({
          baseUrl: update.job.baseUrl,
          apiKey: update.job.apiKey,
          endpoint: '/book',
        });
        const stillUnmonitored = bookIds.filter((bookId) => {
          const book = (Array.isArray(books) ? books : []).find(
            (candidate) => Number(candidate.id ?? candidate.Id) === bookId
          );

          return book && book.monitored !== true && book.Monitored !== true;
        });

        if (stillUnmonitored.length) {
          await putJson({
            baseUrl: update.job.baseUrl,
            apiKey: update.job.apiKey,
            endpoint: '/book/monitor',
            body: {
              bookIds: stillUnmonitored,
              monitored: true,
            },
          });
        }
      }
    } catch (error) {
      failed.push({
        serviceType: update.job.serviceType,
        reason: error instanceof Error ? error.message : String(error),
        bookIds: update.bookIds,
      });
    }
  }

  await writeJson(path.join(migrationDir, 'applied-books.json'), applied);
  await writeJson(path.join(migrationDir, 'apply-failures.json'), failed);
  await writeJson(
    path.join(migrationDir, 'apply-failure-summary.json'),
    buildApplyFailureSummary(failed)
  );

  const report = await readJson(
    path.join(migrationDir, 'migration-report.json')
  );
  report.status = failed.length ? 'apply_incomplete' : 'apply_complete';
  report.applyCounts = {
    applied: applied.length,
    failed: failed.length,
  };
  await writeJson(path.join(migrationDir, 'migration-report.json'), report);
};

const classifyProvider = (metadataSource) => {
  const normalized = normalizeComparableText(metadataSource);

  if (normalized.includes('hardcover')) {
    return 'hardcover';
  }

  if (
    normalized.includes('goodreads') ||
    normalized.includes('rreading-glasses') ||
    normalized.includes('127.0.0.1:8790') ||
    normalized.includes('localhost:8790')
  ) {
    return 'softcover';
  }

  return 'unknown';
};

const validateTarget = async ({ migrationDir, jobs }) => {
  const applied = await readJson(
    path.join(migrationDir, 'applied-books.json')
  ).catch(() => []);
  const validation = [];
  const validationLookupTerm = getValidationLookupTerm();
  const validationLookupRetries = getValidationLookupRetries();
  const validationLookupRetryDelayMs = getValidationLookupRetryDelayMs();

  const getValidationLookup = async (job) => {
    let lookup = [];

    for (let attempt = 0; attempt <= validationLookupRetries; attempt++) {
      lookup = await getJson({
        baseUrl: job.baseUrl,
        apiKey: job.apiKey,
        endpoint: '/book/lookup',
        searchParams: { term: validationLookupTerm },
      }).catch(() => []);

      if (Array.isArray(lookup) && lookup.length > 0) {
        break;
      }

      if (attempt < validationLookupRetries) {
        await sleep(validationLookupRetryDelayMs);
      }
    }

    return lookup;
  };

  for (const job of jobs) {
    if (!job.apiKey) {
      validation.push({
        serviceType: job.serviceType,
        ok: false,
        reason: 'hardcover_api_key_not_provided',
      });
      continue;
    }

    try {
      const [development, books, lookup] = await Promise.all([
        getJson({
          baseUrl: job.baseUrl,
          apiKey: job.apiKey,
          endpoint: '/config/development',
        }).catch((error) => ({ error: String(error) })),
        getJson({
          baseUrl: job.baseUrl,
          apiKey: job.apiKey,
          endpoint: '/book',
        }),
        getValidationLookup(job),
      ]);
      const provider = classifyProvider(development?.metadataSource);
      const appliedForService = applied.filter(
        (item) => item.serviceType === job.serviceType
      );
      const bookIds = new Set(
        (Array.isArray(books) ? books : []).map((book) => Number(book.id))
      );
      const missingApplied = appliedForService.filter(
        (item) =>
          item.hardcoverBookId !== undefined &&
          !bookIds.has(Number(item.hardcoverBookId))
      );
      const lookupResults = Array.isArray(lookup) ? lookup : [];

      validation.push({
        serviceType: job.serviceType,
        ok:
          provider === 'hardcover' &&
          missingApplied.length === 0 &&
          lookupResults.length > 0,
        provider,
        metadataSource: development?.metadataSource,
        bookCount: Array.isArray(books) ? books.length : 0,
        appliedCount: appliedForService.length,
        missingApplied,
        lookupTerm: validationLookupTerm,
        lookupCount: lookupResults.length,
      });
    } catch (error) {
      validation.push({
        serviceType: job.serviceType,
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await writeJson(
    path.join(migrationDir, 'validation-report.json'),
    validation
  );

  const report = await readJson(
    path.join(migrationDir, 'migration-report.json')
  );
  const ok = validation.every((result) => result.ok);
  report.status = ok ? 'validation_complete' : 'validation_failed';
  report.validation = {
    ok,
    services: validation.map((result) => ({
      serviceType: result.serviceType,
      ok: result.ok,
      provider: result.provider,
      lookupCount: result.lookupCount,
      lookupTerm: result.lookupTerm,
      missingAppliedCount: result.missingApplied?.length ?? 0,
      reason: result.reason,
    })),
  };
  await writeJson(path.join(migrationDir, 'migration-report.json'), report);
};

const reconcileLocalImports = async ({ migrationDir, jobs }) => {
  const applied = await readJsonIfExists(
    path.join(migrationDir, 'applied-books.json'),
    []
  );
  const lookupCache = await readLookupCache(migrationDir);
  const report = [];

  for (const item of applied.filter((entry) => entry?.localDbImport === true)) {
    const job = jobs.find(
      (candidate) => candidate.serviceType === item.serviceType
    );

    if (!job?.apiKey) {
      report.push({
        source: item.source,
        serviceType: item.serviceType,
        ok: false,
        reason: 'hardcover_api_key_not_provided',
      });
      continue;
    }

    const softcoverProfiles = await buildSoftcoverRecoveredProfiles({
      item,
      job,
    });
    const openLibraryProfiles = softcoverProfiles.length
      ? []
      : await buildOpenLibraryRecoveredProfiles({ item });
    const candidates = await lookupBookCandidates({
      migrationDir,
      lookupCache,
      serviceType: item.serviceType,
      baseUrl: job.baseUrl,
      apiKey: job.apiKey,
      source: item.source,
      profiles: [item.source, ...softcoverProfiles, ...openLibraryProfiles],
      includeSource: false,
    }).catch((error) => {
      report.push({
        source: item.source,
        serviceType: item.serviceType,
        ok: false,
        reason: 'lookup_failed',
        error: error instanceof Error ? error.message : String(error),
      });

      return [];
    });

    let match;

    for (const { candidate, lookupTerm, profile } of candidates) {
      const decision = chooseStrictMatch({
        source: {
          ...item.source,
          title: profile?.title ?? item.source.title,
          author: profile?.author ?? item.source.author,
          identifiers: profile?.identifiers ?? item.source.identifiers,
        },
        candidates: [candidate],
        identifier: lookupTerm !== `${item.source.title} ${item.source.author}`,
      });

      if (decision.status === 'matched') {
        match = {
          lookupTerm,
          hardcover: decision.result,
          recoveredFrom: profile?.recoveredFrom,
        };
        break;
      }
    }

    if (!match) {
      report.push({
        source: item.source,
        serviceType: item.serviceType,
        ok: false,
        reason: 'native_match_not_found',
      });
      continue;
    }

    const result = await reconcileLocalBookInDb({
      job,
      applied: item,
      hardcover: match.hardcover,
    }).catch((error) => ({
      ok: false,
      reason: 'db_reconcile_failed',
      error: error instanceof Error ? error.message : String(error),
    }));

    report.push({
      source: item.source,
      serviceType: item.serviceType,
      lookupTerm: match.lookupTerm,
      recoveredFrom: match.recoveredFrom,
      ...result,
    });
  }

  await writeJson(
    path.join(migrationDir, 'local-reconciliation-report.json'),
    report
  );

  const reconciled = new Set(
    report
      .filter((entry) => entry.ok)
      .map((entry) => checkpointKeyForSource(entry.source))
  );
  const nextApplied = applied.map((entry) =>
    reconciled.has(checkpointKeyForSource(entry.source))
      ? { ...entry, localDbImport: false, reconciledFromLocal: true }
      : entry
  );

  await writeJson(path.join(migrationDir, 'applied-books.json'), nextApplied);
  console.log(
    `Local reconciliation: reconciled=${report.filter((entry) => entry.ok).length}, remaining=${report.filter((entry) => !entry.ok).length}`
  );
};

const checkCutoverReadiness = async ({ migrationDir }) => {
  const [report, applyFailures, validation] = await Promise.all([
    readJson(path.join(migrationDir, 'migration-report.json')),
    readJson(path.join(migrationDir, 'apply-failures.json')).catch(() => []),
    readJson(path.join(migrationDir, 'validation-report.json')).catch(() => []),
  ]);
  const rebuildBlocked = await readJson(
    path.join(migrationDir, 'rebuild-blocked.json')
  ).catch(() => []);
  const reasons = [];

  if (report.status !== 'validation_complete') {
    reasons.push(`migration_status_${report.status ?? 'unknown'}`);
  }

  if (report.validation?.ok !== true) {
    reasons.push('validation_not_ok');
  }

  if (Array.isArray(applyFailures) && applyFailures.length > 0) {
    reasons.push('apply_failures_present');
  }

  if (Array.isArray(rebuildBlocked) && rebuildBlocked.length > 0) {
    reasons.push('rebuild_blocked_present');
  }

  const failedServices = Array.isArray(validation)
    ? validation.filter((item) => !item.ok)
    : [];

  if (failedServices.length > 0) {
    reasons.push('failed_service_validation_present');
  }

  const decision = {
    ok: reasons.length === 0,
    reasons,
    status: report.status,
    validation: report.validation,
    applyCounts: report.applyCounts,
  };

  await writeJson(path.join(migrationDir, 'cutover-decision.json'), decision);

  if (!decision.ok) {
    throw new Error(`Cutover not ready: ${reasons.join(', ')}`);
  }
};

const readJson = async (filePath) =>
  JSON.parse(await fs.readFile(filePath, 'utf8'));

const writeJson = async (filePath, value) => {
  await fs.writeFile(`${filePath}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(`${filePath}.tmp`, filePath);
};

const printSummary = async ({ migrationDir }) => {
  const report = await readJson(
    path.join(migrationDir, 'migration-report.json')
  );
  const decision = await readJson(
    path.join(migrationDir, 'cutover-decision.json')
  ).catch(() => undefined);

  console.log(`Migration status: ${report.status ?? 'unknown'}`);

  if (report.counts) {
    console.log(
      `Match counts: matched=${report.counts.matched ?? 0}, local=${report.counts.localImported ?? 0}, unmatched=${report.counts.unmatched ?? 0}, ambiguous=${report.counts.ambiguous ?? 0}, rebuildPayload=${report.counts.rebuildPayload ?? 0}, rebuildBlocked=${report.counts.rebuildBlocked ?? 0}`
    );
  }

  if (report.applyCounts) {
    console.log(
      `Apply counts: applied=${report.applyCounts.applied ?? 0}, failed=${report.applyCounts.failed ?? 0}`
    );
  }

  if (report.validation) {
    console.log(`Validation: ${report.validation.ok ? 'ok' : 'failed'}`);
  }

  if (decision) {
    console.log(
      `Cutover ready: ${decision.ok ? 'yes' : `no (${(decision.reasons ?? []).join(', ') || 'unknown'})`}`
    );
  }
};

const main = async () => {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const validate = args.includes('--validate');
  const cutoverCheck = args.includes('--cutover-check');
  const summary = args.includes('--summary');
  const reconcileLocal = args.includes('--reconcile-local');
  const localDbImport = args.includes('--local-db-import');
  const migrationDir = args.find(
    (arg) =>
      arg !== '--apply' &&
      arg !== '--validate' &&
      arg !== '--cutover-check' &&
      arg !== '--summary' &&
      arg !== '--reconcile-local' &&
      arg !== '--local-db-import'
  );

  if (!migrationDir) {
    throw new Error(
      'Usage: bookshelf-hardcover-migration.mjs [--apply|--validate|--cutover-check|--summary|--reconcile-local] [--local-db-import] <migration-dir>'
    );
  }

  if (localDbImport) {
    process.env.HARDCOVER_LOCAL_DB_IMPORT = 'true';
  }

  getApiTimeoutMs();

  const jobs = [
    {
      serviceType: 'ebook',
      inventoryFile: 'ebook-inventory.json',
      baseUrl:
        process.env.HARDCOVER_EBOOK_BASE_URL ??
        `http://127.0.0.1:${process.env.BOOKSHELF_EBOOKS_PORT ?? '8787'}`,
      apiKey: process.env.HARDCOVER_EBOOK_API_KEY ?? process.env.EBOOK_API_KEY,
      configDir:
        process.env.HARDCOVER_EBOOK_CONFIG_DIR ??
        process.env.BOOKSHELF_EBOOKS_CONFIG_DIR,
      softcoverBaseUrl:
        process.env.HARDCOVER_SOFTCOVER_EBOOK_BASE_URL ??
        process.env.SOFTCOVER_EBOOK_BASE_URL,
      softcoverApiKey:
        process.env.HARDCOVER_SOFTCOVER_EBOOK_API_KEY ??
        process.env.SOFTCOVER_EBOOK_API_KEY ??
        process.env.HARDCOVER_EBOOK_API_KEY ??
        process.env.EBOOK_API_KEY,
    },
    {
      serviceType: 'audiobook',
      inventoryFile: 'audiobook-inventory.json',
      baseUrl:
        process.env.HARDCOVER_AUDIOBOOK_BASE_URL ??
        `http://127.0.0.1:${process.env.BOOKSHELF_AUDIOBOOKS_PORT ?? '8788'}`,
      apiKey:
        process.env.HARDCOVER_AUDIOBOOK_API_KEY ??
        process.env.AUDIOBOOK_API_KEY,
      configDir:
        process.env.HARDCOVER_AUDIOBOOK_CONFIG_DIR ??
        process.env.BOOKSHELF_AUDIOBOOKS_CONFIG_DIR,
      softcoverBaseUrl:
        process.env.HARDCOVER_SOFTCOVER_AUDIOBOOK_BASE_URL ??
        process.env.SOFTCOVER_AUDIOBOOK_BASE_URL,
      softcoverApiKey:
        process.env.HARDCOVER_SOFTCOVER_AUDIOBOOK_API_KEY ??
        process.env.SOFTCOVER_AUDIOBOOK_API_KEY ??
        process.env.HARDCOVER_AUDIOBOOK_API_KEY ??
        process.env.AUDIOBOOK_API_KEY,
    },
  ];

  if (apply) {
    await applyRebuildPayload({ migrationDir, jobs });
    return;
  }

  if (validate) {
    await validateTarget({ migrationDir, jobs });
    return;
  }

  if (cutoverCheck) {
    await checkCutoverReadiness({ migrationDir });
    return;
  }

  if (summary) {
    await printSummary({ migrationDir });
    return;
  }

  if (reconcileLocal) {
    await reconcileLocalImports({ migrationDir, jobs });
    return;
  }

  const allMatched = [];
  const allUnmatched = [];
  const allAmbiguous = [];
  const lookupCache = await readLookupCache(migrationDir);

  for (const job of jobs) {
    const inventory = await readJson(
      path.join(migrationDir, job.inventoryFile)
    );
    const serviceType = inventory.serviceType ?? job.serviceType;

    if (!job.apiKey) {
      const checkpoint = normalizeCheckpoint(
        await readJsonIfExists(
          matchCheckpointPath({ migrationDir, serviceType }),
          emptyMatchCheckpoint()
        )
      );
      const processedKeys = checkpointProcessedKeys(checkpoint);
      checkpoint.unmatched.push(
        ...buildInventorySources(inventory)
          .map((source) => ({
            source,
            reason: 'hardcover_api_key_not_provided',
          }))
          .filter(
            (entry) => !processedKeys.has(checkpointKeyForSource(entry.source))
          )
      );
      await writeMatchCheckpoint({ migrationDir, serviceType, checkpoint });
      allMatched.push(...checkpoint.matched);
      allUnmatched.push(...checkpoint.unmatched);
      allAmbiguous.push(...checkpoint.ambiguous);
      continue;
    }

    const result = await matchInventory({
      migrationDir,
      inventory,
      baseUrl: job.baseUrl,
      apiKey: job.apiKey,
      lookupCache,
    });

    const openLibraryRecovery = await recoverUnmatchedWithOpenLibrary({
      migrationDir,
      lookupCache,
      job,
      entries: result.unmatched,
    });

    allMatched.push(...result.matched, ...openLibraryRecovery.recovered);
    allUnmatched.push(...openLibraryRecovery.remaining);
    allAmbiguous.push(...result.ambiguous);
  }

  await writeJson(path.join(migrationDir, 'matched-books.json'), allMatched);
  await writeJson(
    path.join(migrationDir, 'unmatched-books.json'),
    allUnmatched
  );
  await writeJson(
    path.join(migrationDir, 'ambiguous-books.json'),
    allAmbiguous
  );
  const localEntries = [];

  if (getLocalImportEnabled()) {
    for (const entry of allUnmatched) {
      if (!entry.source) continue;

      const local = synthesizeLocalEntry(entry.source);

      localEntries.push({
        status: 'matched',
        reason: 'local_synthesis',
        source: entry.source,
        hardcover: local,
        lookupTerm: `local:${entry.source.title} ${entry.source.author}`,
      });
    }

    allMatched.push(...localEntries);
  }

  await writeJson(path.join(migrationDir, 'matched-books.json'), allMatched);

  const { rebuildPayload, rebuildBlocked } = buildRebuildArtifacts(allMatched);
  await writeJson(
    path.join(migrationDir, 'rebuild-payload.json'),
    rebuildPayload
  );
  await writeJson(
    path.join(migrationDir, 'rebuild-blocked.json'),
    rebuildBlocked
  );

  const report = await readJson(
    path.join(migrationDir, 'migration-report.json')
  );
  report.status = 'matching_complete';
  report.counts = {
    matched: allMatched.length,
    localImported: localEntries.length,
    unmatched: allUnmatched.length,
    ambiguous: allAmbiguous.length,
    rebuildPayload: rebuildPayload.length,
    rebuildBlocked: rebuildBlocked.length,
  };
  report.matchingPolicy =
    'Layered matching: exact title+author first; optional ISBN/ASIN fallback with ISBN-10/13 conversion; relaxed prefix/subtitle/colon/containment matching only when author agrees; resumable checkpoints and lookup cache are preserved across runs. Apply recovery preserves prior successes, retries transient target failures, pre-creates missing target authors, remaps rejected records through optional softcover and OpenLibrary recovery profiles, can synthesize local API entries for unmatched books when HARDCOVER_LOCAL_IMPORT is enabled, and can use deterministic direct DB local records as a final opt-in fallback when HARDCOVER_LOCAL_DB_IMPORT is enabled.';
  await writeJson(path.join(migrationDir, 'migration-report.json'), report);
  await readJsonIfExists(
    path.join(migrationDir, 'applied-books.json'),
    null
  ).then((existing) =>
    existing === null
      ? writeJson(path.join(migrationDir, 'applied-books.json'), [])
      : undefined
  );
  await readJsonIfExists(
    path.join(migrationDir, 'apply-failures.json'),
    null
  ).then((existing) =>
    existing === null
      ? writeJson(path.join(migrationDir, 'apply-failures.json'), [])
      : undefined
  );
  await writeJson(path.join(migrationDir, 'validation-report.json'), []);
  await writeJson(path.join(migrationDir, 'cutover-decision.json'), {
    ok: false,
    reasons: ['validation_not_run'],
  });
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
