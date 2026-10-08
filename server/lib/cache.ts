import NodeCache from 'node-cache';
import { serialize } from 'node:v8';

export type AvailableCacheIds =
  | 'tmdb'
  | 'tmdbscan'
  | 'radarr'
  | 'sonarr'
  | 'sportarr'
  | 'rt'
  | 'imdb'
  | 'github'
  | 'plexguid'
  | 'plextv'
  | 'plexwatchlist'
  | 'tvdb'
  | 'tvmaze'
  | 'lidarr'
  | 'readarr'
  | 'musicbrainz'
  | 'listenbrainz'
  | 'coverartarchive'
  | 'openlibrary'
  | 'comicvine'
  | 'metron'
  | 'questarr'
  | 'romarr'
  | 'googlebooks'
  | 'wikidata'
  | 'tadb'
  | 'associations'
  | 'trakt'
  | 'anilist'
  | 'simkl'
  | 'personallibrary'
  | 'mdblist';

const DEFAULT_TTL = 300;
const DEFAULT_CHECK_PERIOD = 120;
export const DEFAULT_MAX_CACHE_KEYS = 10_000;
export const DEFAULT_MAX_CACHE_BYTES = 64 * 1024 * 1024;

const TMDB_MAX_KEYS = 1000;
const TMDB_SCAN_MAX_KEYS = 2000;
const RADARR_MAX_KEYS = 64;
const SONARR_MAX_KEYS = 64;
const RT_MAX_KEYS = 500;
const IMDB_MAX_KEYS = 500;
const GITHUB_MAX_KEYS = 16;
const PLEX_TV_MAX_KEYS = 5000;
const PLEX_WATCHLIST_MAX_KEYS = 500;
const TVDB_MAX_KEYS = 500;
const GOOGLE_BOOKS_MAX_KEYS = 1000;

export interface CacheStats {
  hits: number;
  misses: number;
  keys: number;
  ksize: number;
  vsize: number;
}

export interface CacheStore {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttl?: number): boolean;
  del(key: string): number;
  getTtl(key: string): number | undefined;
  getStats(): CacheStats;
  flushAll(): void;
}

export const estimateCacheEntryBytes = (key: string, value: unknown): number =>
  Buffer.byteLength(key, 'utf8') + serialize(value).byteLength;

export class Cache {
  public id: AvailableCacheIds;
  public data: NodeCache;
  public name: string;
  private readonly keyOrder = new Map<string, undefined>();
  private readonly keyBytes = new Map<string, number>();
  private readonly maxKeys: number;
  private readonly maxBytes: number;
  private totalBytes = 0;

  constructor(
    id: AvailableCacheIds,
    name: string,
    options: {
      stdTtl?: number;
      checkPeriod?: number;
      maxKeys?: number;
      maxBytes?: number;
    } = {}
  ) {
    this.id = id;
    this.name = name;
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_CACHE_KEYS;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_CACHE_BYTES;
    if (!Number.isSafeInteger(this.maxKeys) || this.maxKeys <= 0) {
      throw new Error('Cache key limit must be a positive integer.');
    }
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes <= 0) {
      throw new Error('Cache byte limit must be a positive integer.');
    }
    this.data = new NodeCache({
      stdTTL: options.stdTtl ?? DEFAULT_TTL,
      checkperiod: options.checkPeriod ?? DEFAULT_CHECK_PERIOD,
    });
    this.data.on('set', (key: string, value: unknown) => {
      this.totalBytes -= this.keyBytes.get(key) ?? 0;
      let entryBytes: number;
      try {
        entryBytes = estimateCacheEntryBytes(key, value);
      } catch {
        entryBytes = this.maxBytes + 1;
      }
      this.keyBytes.set(key, entryBytes);
      this.totalBytes += entryBytes;
      this.keyOrder.delete(key);
      this.keyOrder.set(key, undefined);

      while (
        this.keyOrder.size > this.maxKeys ||
        this.totalBytes > this.maxBytes
      ) {
        const oldestKey = this.keyOrder.keys().next().value;
        if (oldestKey === undefined) {
          break;
        }
        this.data.del(oldestKey);
      }
    });
    const forgetKey = (key: string) => {
      this.keyOrder.delete(key);
      this.totalBytes -= this.keyBytes.get(key) ?? 0;
      this.keyBytes.delete(key);
    };
    this.data.on('del', forgetKey);
    this.data.on('expired', forgetKey);
    this.data.on('flush', () => {
      this.keyOrder.clear();
      this.keyBytes.clear();
      this.totalBytes = 0;
    });
  }

  public getStats() {
    return this.data.getStats();
  }

  public flush(): void {
    this.data.flushAll();
  }
}

class CacheManager {
  private availableCaches: Record<AvailableCacheIds, Cache> = {
    trakt: new Cache('trakt', 'Trakt API', {
      maxKeys: 500,
      maxBytes: 8 * 1024 * 1024,
    }),
    anilist: new Cache('anilist', 'AniList API', {
      maxKeys: 500,
      maxBytes: 8 * 1024 * 1024,
    }),
    simkl: new Cache('simkl', 'Simkl API', {
      maxKeys: 500,
      maxBytes: 8 * 1024 * 1024,
    }),
    personallibrary: new Cache('personallibrary', 'Personal media libraries', {
      stdTtl: 30,
      maxKeys: 1000,
      maxBytes: 16 * 1024 * 1024,
    }),
    mdblist: new Cache('mdblist', 'MDBList API', {
      stdTtl: 172800,
      maxKeys: 500,
      maxBytes: 8 * 1024 * 1024,
    }),
    tmdb: new Cache('tmdb', 'The Movie Database API', {
      stdTtl: 21600,
      maxKeys: TMDB_MAX_KEYS,
    }),
    tmdbscan: new Cache('tmdbscan', 'The Movie Database API (Library Scans)', {
      stdTtl: 900,
      maxKeys: TMDB_SCAN_MAX_KEYS,
    }),
    radarr: new Cache('radarr', 'Radarr API', { maxKeys: RADARR_MAX_KEYS }),
    sonarr: new Cache('sonarr', 'Sonarr API', { maxKeys: SONARR_MAX_KEYS }),
    sportarr: new Cache('sportarr', 'Sportarr API'),
    rt: new Cache('rt', 'Rotten Tomatoes API', {
      stdTtl: 43200,
      maxKeys: RT_MAX_KEYS,
    }),
    imdb: new Cache('imdb', 'IMDB Radarr Proxy', {
      stdTtl: 43200,
      maxKeys: IMDB_MAX_KEYS,
    }),
    github: new Cache('github', 'GitHub API', {
      stdTtl: 21600,
      maxKeys: GITHUB_MAX_KEYS,
    }),
    plextv: new Cache('plextv', 'Plex TV', {
      stdTtl: 86400 * 7, // 1 week cache
      maxKeys: PLEX_TV_MAX_KEYS,
    }),
    plexwatchlist: new Cache('plexwatchlist', 'Plex Watchlist', {
      maxKeys: PLEX_WATCHLIST_MAX_KEYS,
    }),
    tvdb: new Cache('tvdb', 'The TVDB API', {
      stdTtl: 21600,
      maxKeys: TVDB_MAX_KEYS,
    }),
    tvmaze: new Cache('tvmaze', 'TVmaze API', {
      stdTtl: 3600,
      maxKeys: 1000,
      maxBytes: 16 * 1024 * 1024,
    }),
    plexguid: new Cache('plexguid', 'Plex GUID', {
      stdTtl: 86400 * 7,
      checkPeriod: 60 * 30,
    }),
    lidarr: new Cache('lidarr', 'Lidarr API'),
    readarr: new Cache('readarr', 'Bookshelf API'),
    musicbrainz: new Cache('musicbrainz', 'MusicBrainz API', {
      stdTtl: 21600,
      checkPeriod: 60 * 30,
    }),
    listenbrainz: new Cache('listenbrainz', 'ListenBrainz API', {
      stdTtl: 21600,
      checkPeriod: 60 * 30,
    }),
    coverartarchive: new Cache('coverartarchive', 'Cover Art Archive API', {
      stdTtl: 43200,
      checkPeriod: 60 * 30,
    }),
    openlibrary: new Cache('openlibrary', 'Open Library API', {
      stdTtl: 43200,
      checkPeriod: 60 * 30,
    }),
    comicvine: new Cache('comicvine', 'ComicVine API', {
      stdTtl: 43200,
      checkPeriod: 60 * 30,
    }),
    metron: new Cache('metron', 'Metron API', {
      stdTtl: 43200,
      checkPeriod: 60 * 30,
    }),
    questarr: new Cache('questarr', 'QuestarrNG catalog', {
      stdTtl: 600,
      maxKeys: 500,
      maxBytes: 16 * 1024 * 1024,
    }),
    romarr: new Cache('romarr', 'ROMarrNG systems', {
      stdTtl: 300,
      maxKeys: 32,
      maxBytes: 4 * 1024 * 1024,
    }),
    googlebooks: new Cache('googlebooks', 'Google Books API', {
      stdTtl: 900,
      maxKeys: GOOGLE_BOOKS_MAX_KEYS,
      checkPeriod: 60 * 5,
    }),
    wikidata: new Cache('wikidata', 'Wikidata API', {
      stdTtl: 43200,
      checkPeriod: 60 * 30,
    }),
    tadb: new Cache('tadb', 'TheAudioDB API', {
      stdTtl: 43200,
      checkPeriod: 60 * 30,
    }),
    associations: new Cache('associations', 'Cross-Medium Associations', {
      stdTtl: 43200,
      checkPeriod: 60 * 30,
    }),
  };

  public getCache(id: AvailableCacheIds): Cache {
    return this.availableCaches[id];
  }

  public getAllCaches(): Record<string, Cache> {
    return this.availableCaches;
  }
}

const cacheManager = new CacheManager();

export const isAvailableCacheId = (id: string): id is AvailableCacheIds =>
  Object.prototype.hasOwnProperty.call(cacheManager.getAllCaches(), id);

export default cacheManager;
