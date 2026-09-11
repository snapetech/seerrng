import animeList from '@server/api/animelist';
import { getMetadataProvider } from '@server/api/metadata';
import MusicBrainz from '@server/api/musicbrainz';
import OpenLibraryAPI from '@server/api/openlibrary';
import PlexAPI, {
  MAX_PLEX_LIBRARY_ITEMS,
  type PlexLibraryItem,
  type PlexMetadata,
} from '@server/api/plexapi';
import TheMovieDb from '@server/api/themoviedb';
import { ANIME_KEYWORD_ID } from '@server/api/themoviedb/constants';
import type {
  TmdbKeyword,
  TmdbTvDetails,
} from '@server/api/themoviedb/interfaces';
import { MediaIdentifierProvider } from '@server/entity/MediaIdentifier';
import { resolveOpenLibraryIdentifiersForPlexAudiobook } from '@server/lib/bookIdentifierResolver';
import cacheManager from '@server/lib/cache';
import {
  ConfigurationAuthorityChangedError,
  captureConfigurationAuthority,
  runWithConfigurationAdmission,
  runWithConfigurationSnapshot,
  type ConfigurationAuthoritySnapshot,
} from '@server/lib/configurationAdmission';
import {
  isValidMusicBrainzResourceId,
  normalizeMusicBrainzId,
} from '@server/lib/externalIds';
import { normalizeValidIsbn } from '@server/lib/isbn';
import {
  MediaServerUserAuthorityChangedError,
  captureMediaServerUserAuthority,
  runWithMediaServerUserAuthority,
  type MediaServerUserAuthoritySnapshot,
} from '@server/lib/mediaServerUserAuthority';
import type {
  MediaIds,
  ProcessableSeason,
  RunnableScanner,
  StatusBase,
} from '@server/lib/scanners/baseScanner';
import BaseScanner from '@server/lib/scanners/baseScanner';
import type { Library, PlexSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { mapWithConcurrency } from '@server/utils/concurrency';
import { uniqWith } from 'lodash';
import { createHash } from 'node:crypto';

const imdbRegex = new RegExp(/imdb:\/\/(tt[0-9]+)/);
const tmdbRegex = new RegExp(/tmdb:\/\/([0-9]+)/);
const tvdbRegex = new RegExp(/tvdb:\/\/([0-9]+)/);
const tmdbShowRegex = new RegExp(/themoviedb:\/\/([0-9]+)/);
const plexRegex = new RegExp(/plex:\/\//);
const plexCustomProviderRegex = new RegExp(
  /tv\.plex\.agents\.custom(\.[a-zA-Z0-9]+)+:\/\//
);
// Hama agent uses ASS naming, see details here:
// https://github.com/ZeroQI/Absolute-Series-Scanner/blob/master/README.md#forcing-the-movieseries-id
const hamaTvdbRegex = new RegExp(/hama:\/\/tvdb[0-9]?-([0-9]+)/);
const hamaAnidbRegex = new RegExp(/hama:\/\/anidb[0-9]?-([0-9]+)/);
const HAMA_AGENT = 'com.plexapp.agents.hama';
export const PLEX_SCAN_PAGE_SIZE = 50;
export const PLEX_SCAN_ITEM_CONCURRENCY = 10;

export const getBoundedPlexScanTotal = (
  declaredTotal: unknown,
  start: number,
  itemCount: number,
  pageSize = PLEX_SCAN_PAGE_SIZE
): number => {
  const observedEnd = Math.max(0, start) + Math.max(0, itemCount);
  const safePageSize =
    Number.isSafeInteger(pageSize) && pageSize > 0
      ? Math.min(pageSize, PLEX_SCAN_PAGE_SIZE)
      : PLEX_SCAN_PAGE_SIZE;
  const total =
    Number.isSafeInteger(declaredTotal) &&
    (declaredTotal as number) >= observedEnd
      ? (declaredTotal as number)
      : observedEnd + (itemCount >= safePageSize ? safePageSize : 0);

  return Math.min(total, MAX_PLEX_LIBRARY_ITEMS);
};

export const preparePlexLibraryPageItems = (
  value: unknown,
  limit = PLEX_SCAN_PAGE_SIZE
): PlexLibraryItem[] =>
  Array.isArray(value)
    ? value.slice(
        0,
        Number.isSafeInteger(limit) && limit > 0
          ? Math.min(limit, PLEX_SCAN_PAGE_SIZE)
          : PLEX_SCAN_PAGE_SIZE
      )
    : [];

export const dedupePlexRecentlyAddedItems = (
  items: PlexLibraryItem[],
  libraryType: Library['type']
): PlexLibraryItem[] =>
  uniqWith(items, (mediaA, mediaB) => {
    // Plex album records use parentRatingKey for the artist, so grouping
    // albums by parent would drop every later album by the same artist.
    if (libraryType === 'music' || libraryType === 'book') {
      return mediaA.ratingKey === mediaB.ratingKey;
    }

    if (mediaA.grandparentRatingKey && mediaB.grandparentRatingKey) {
      return mediaA.grandparentRatingKey === mediaB.grandparentRatingKey;
    }

    if (mediaA.parentRatingKey && mediaB.parentRatingKey) {
      return mediaA.parentRatingKey === mediaB.parentRatingKey;
    }

    return mediaA.ratingKey === mediaB.ratingKey;
  });

export const getPlexGuidCacheKey = (
  plex: Pick<PlexSettings, 'machineId' | 'ip' | 'port' | 'useSsl'>,
  ratingKey: string
): string => {
  const serverIdentity =
    plex.machineId?.trim() ||
    `${plex.useSsl ? 'https' : 'http'}://${plex.ip}:${plex.port}`;
  return `plexguid:${createHash('sha256')
    .update(JSON.stringify([serverIdentity, ratingKey]))
    .digest('hex')}`;
};

type SyncStatus = StatusBase & {
  currentLibrary: Library;
  libraries: Library[];
};

export class PlexScanner
  extends BaseScanner<PlexLibraryItem>
  implements RunnableScanner<SyncStatus>
{
  private plexClient: PlexAPI;
  private libraries: Library[];
  private currentLibrary: Library;
  private isRecentOnly = false;
  private musicbrainz = new MusicBrainz();
  private openLibrary = new OpenLibraryAPI();
  private configurationSnapshot: ConfigurationAuthoritySnapshot;
  private plexSettingsSnapshot: PlexSettings;
  private ownerAuthoritySnapshot: MediaServerUserAuthoritySnapshot;

  public constructor(isRecentOnly = false) {
    super('Plex Scan', { bundleSize: PLEX_SCAN_PAGE_SIZE });
    this.isRecentOnly = isRecentOnly;
  }

  public status(): SyncStatus {
    return {
      running: this.running,
      progress: this.progress,
      total: this.totalSize ?? 0,
      currentLibrary: this.currentLibrary,
      libraries: this.libraries,
    };
  }

  public async run(): Promise<void> {
    const settings = getSettings();
    const sessionId = this.startRun();
    if (!sessionId) {
      return;
    }
    try {
      await runWithConfigurationAdmission('plex', async () => {
        const currentSettings = getSettings();
        this.plexSettingsSnapshot = structuredClone(currentSettings.plex);
        this.configurationSnapshot = captureConfigurationAuthority(
          'plex',
          currentSettings
        );
      });
      this.ownerAuthoritySnapshot = await captureMediaServerUserAuthority(
        1,
        'plex'
      );
      if (!this.ownerAuthoritySnapshot.plexToken) {
        return this.log('No admin configured. Plex scan skipped.', 'warn');
      }

      this.plexClient = new PlexAPI({
        plexToken: this.ownerAuthoritySnapshot.plexToken,
        plexSettings: this.plexSettingsSnapshot,
      });

      this.libraries = this.plexSettingsSnapshot.libraries.filter(
        (library) => library.enabled
      );

      const hasHama = await this.withConfigurationSnapshot(() =>
        this.hasHamaAgent()
      );
      if (hasHama) {
        await animeList.sync();
      }

      if (this.isRecentOnly) {
        for (const library of this.libraries) {
          const libraryType = library.type;
          this.currentLibrary = library;
          this.log(
            `Beginning to process recently added for library: ${library.name}`,
            'info',
            { lastScan: library.lastScan }
          );
          const libraryItems = await this.withConfigurationSnapshot(() =>
            this.plexClient.getRecentlyAdded(
              library.id,
              library.lastScan
                ? {
                    // We remove 10 minutes from the last scan as a buffer
                    addedAt: library.lastScan - 1000 * 60 * 10,
                  }
                : undefined,
              libraryType
            )
          );

          // Bundle items up by rating keys.
          this.items = dedupePlexRecentlyAddedItems(libraryItems, libraryType);

          await this.loop(this.processItem.bind(this), { sessionId });

          // After run completes, update last scan time
          await this.withConfigurationSnapshot(() =>
            settings.persistSection('plex', (current) => ({
              ...current,
              libraries: current.libraries.map((lib) => {
                if (lib.id === library.id) {
                  return {
                    ...lib,
                    lastScan: Date.now(),
                  };
                }
                return lib;
              }),
            }))
          );
        }
      } else {
        for (const library of this.libraries) {
          this.currentLibrary = library;
          this.log(`Beginning to process library: ${library.name}`, 'info');
          await this.paginateLibrary(library, { sessionId });
        }
      }
      this.log(
        this.isRecentOnly
          ? 'Recently Added Scan Complete'
          : 'Full Scan Complete',
        'info'
      );
    } catch (e) {
      this.log('Scan interrupted', 'error', {
        errorMessage: e.message,
      });
    } finally {
      this.endRun(sessionId);
    }
  }

  private async paginateLibrary(
    library: Library,
    { start = 0, sessionId }: { start?: number; sessionId: string }
  ) {
    if (!this.running) {
      throw new Error('Sync was aborted.');
    }

    if (this.sessionId !== sessionId) {
      throw new Error('New session was started. Old session aborted.');
    }

    const response = await this.withConfigurationSnapshot(() =>
      this.plexClient.getLibraryContents(library.id, {
        size: this.protectedBundleSize,
        offset: start,
        libraryType: library.type,
      })
    );

    const pageItems = preparePlexLibraryPageItems(
      response.items,
      this.protectedBundleSize
    );
    this.progress = start;
    this.totalSize = getBoundedPlexScanTotal(
      response.totalSize,
      start,
      pageItems.length,
      this.protectedBundleSize
    );

    if (pageItems.length === 0) {
      return;
    }

    await mapWithConcurrency(
      pageItems,
      PLEX_SCAN_ITEM_CONCURRENCY,
      async (item) => this.processItem(item)
    );

    const nextStart = start + this.protectedBundleSize;
    if (
      pageItems.length < this.protectedBundleSize ||
      nextStart >= this.totalSize ||
      nextStart >= MAX_PLEX_LIBRARY_ITEMS
    ) {
      return;
    }

    await new Promise<void>((resolve, reject) =>
      setTimeout(() => {
        this.paginateLibrary(library, {
          start: nextStart,
          sessionId,
        })
          .then(() => resolve())
          .catch((e) => reject(e instanceof Error ? e : new Error(String(e))));
      }, this.protectedUpdateRate)
    );
  }

  private async processItem(plexitem: PlexLibraryItem) {
    try {
      if (plexitem.type === 'movie') {
        await this.processPlexMovie(plexitem);
      } else if (
        plexitem.type === 'show' ||
        plexitem.type === 'episode' ||
        plexitem.type === 'season'
      ) {
        await this.processPlexShow(plexitem);
      } else if (plexitem.type === 'album') {
        if (this.currentLibrary?.type === 'book') {
          await this.processPlexAudiobookAlbum(plexitem);
        } else {
          await this.processPlexAlbum(plexitem);
        }
      }
    } catch (e) {
      if (
        e instanceof ConfigurationAuthorityChangedError ||
        e instanceof MediaServerUserAuthorityChangedError
      ) {
        throw e;
      }
      this.log('Failed to process Plex media', 'error', {
        errorMessage: e.message,
        title: plexitem.title,
      });
    }
  }

  private async processPlexMovie(plexitem: PlexLibraryItem) {
    const mediaIds = await this.getMediaIds(plexitem);

    const has4k = plexitem.Media.some(
      (media) => media.videoResolution === '4k'
    );

    await this.processMovie(mediaIds.tmdbId, {
      is4k: has4k && this.enable4kMovie,
      mediaAddedAt: new Date(plexitem.addedAt * 1000),
      ratingKey: plexitem.ratingKey,
      title: plexitem.title,
      mutationGuard: (callback) => this.withConfigurationSnapshot(callback),
      outerMutationGuard: (callback) => this.withOwnerAuthority(callback),
    });
  }

  private async processPlexMovieByTmdbId(
    plexitem: PlexMetadata,
    tmdbId: number
  ) {
    const has4k = plexitem.Media.some(
      (media) => media.videoResolution === '4k'
    );

    await this.processMovie(tmdbId, {
      is4k: has4k && this.enable4kMovie,
      mediaAddedAt: new Date(plexitem.addedAt * 1000),
      ratingKey: plexitem.ratingKey,
      title: plexitem.title,
      mutationGuard: (callback) => this.withConfigurationSnapshot(callback),
      outerMutationGuard: (callback) => this.withOwnerAuthority(callback),
    });
  }

  private async getTvShow({
    tmdbId,
    tvdbId,
  }: {
    tmdbId?: number;
    tvdbId?: number;
  }): Promise<TmdbTvDetails> {
    let tvShow;

    if (tmdbId) {
      tvShow = await this.tmdb.getTvShow({
        tvId: Number(tmdbId),
      });
    } else if (tvdbId) {
      tvShow = await this.tmdb.getShowByTvdbId({
        tvdbId: Number(tvdbId),
      });
    } else {
      throw new Error('No ID provided');
    }

    const metadataProvider = tvShow.keywords.results.some(
      (keyword: TmdbKeyword) => keyword.id === ANIME_KEYWORD_ID
    )
      ? await getMetadataProvider('anime')
      : await getMetadataProvider('tv');

    if (!(metadataProvider instanceof TheMovieDb)) {
      tvShow = await metadataProvider.getTvShow({
        tvId: Number(tmdbId),
      });
    }

    return tvShow;
  }

  private async processPlexShow(plexitem: PlexLibraryItem) {
    const ratingKey =
      plexitem.grandparentRatingKey ??
      plexitem.parentRatingKey ??
      plexitem.ratingKey;
    const metadata = await this.plexClient.getMetadata(ratingKey, {
      includeChildren: true,
    });

    const mediaIds = await this.getMediaIds(metadata);

    // If the media is from HAMA, and doesn't have a TVDb ID, we will treat it
    // as a special HAMA movie
    if (mediaIds.tmdbId && !mediaIds.tvdbId && mediaIds.isHama) {
      await this.processHamaMovie(metadata, mediaIds.tmdbId);
      return;
    }

    // If the media is from HAMA and we have a TVDb ID, we will attempt
    // to process any specials that may exist
    if (mediaIds.tvdbId && mediaIds.isHama) {
      await this.processHamaSpecials(metadata, mediaIds.tvdbId);
    }

    const tvShow = await this.getTvShow({
      tmdbId: mediaIds.tmdbId,
    });

    const seasons = tvShow.seasons;
    const processableSeasons: ProcessableSeason[] = [];

    const settings = getSettings();
    const filteredSeasons = settings.main.enableSpecialEpisodes
      ? seasons
      : seasons.filter((sn) => sn.season_number !== 0);

    for (const season of filteredSeasons) {
      const matchedPlexSeason = metadata.Children?.Metadata.find(
        (md) => Number(md.index) === season.season_number
      );

      if (matchedPlexSeason) {
        // If we have a matched Plex season, get its children metadata so we can check details
        const episodes = await this.plexClient.getChildrenMetadata(
          matchedPlexSeason.ratingKey
        );
        // Total episodes that are in standard definition (not 4k)
        const totalStandard = episodes.filter((episode) =>
          !this.enable4kShow
            ? true
            : episode.Media.some((media) => media.videoResolution !== '4k')
        ).length;

        // Total episodes that are in 4k
        const total4k = this.enable4kShow
          ? episodes.filter((episode) =>
              episode.Media.some((media) => media.videoResolution === '4k')
            ).length
          : 0;

        processableSeasons.push({
          seasonNumber: season.season_number,
          episodes: totalStandard,
          episodes4k: total4k,
          totalEpisodes: season.episode_count,
        });
      } else {
        processableSeasons.push({
          seasonNumber: season.season_number,
          episodes: 0,
          episodes4k: 0,
          totalEpisodes: season.episode_count,
        });
      }
    }

    await this.processShow(
      mediaIds.tmdbId,
      mediaIds.tvdbId ?? tvShow.external_ids.tvdb_id,
      processableSeasons,
      {
        mediaAddedAt: new Date(metadata.addedAt * 1000),
        ratingKey: ratingKey,
        title: metadata.title,
        mutationGuard: (callback) => this.withConfigurationSnapshot(callback),
        outerMutationGuard: (callback) => this.withOwnerAuthority(callback),
      }
    );
  }

  // Plex's music agent (unlike its movie/tv agents) puts a matched external
  // ID directly on the item's singular `guid` field, e.g.
  // "mbid://<release-id>" -- observed on a live server, it does not
  // populate the `Guid[]` array the way movie/show agents do. We check
  // both: the singular field as the primary (observed) case, `Guid[]` as a
  // defensive fallback in case an agent variant does populate it.
  private extractPlexGuidValue(
    plexitem: Pick<PlexLibraryItem, 'guid' | 'Guid'>,
    scheme: string
  ): string | undefined {
    if (plexitem.guid.startsWith(scheme)) {
      return plexitem.guid.slice(scheme.length);
    }
    const match = plexitem.Guid?.find((guid) => guid.id.startsWith(scheme));
    return match?.id.slice(scheme.length);
  }

  private async getMusicBrainzReleaseGroupIdFromPlexAlbum(
    plexitem: PlexLibraryItem
  ): Promise<string | undefined> {
    const rawMbid = this.extractPlexGuidValue(plexitem, 'mbid://');
    if (!rawMbid) {
      return undefined;
    }

    const rawId = normalizeMusicBrainzId(rawMbid);
    if (!isValidMusicBrainzResourceId(rawId)) {
      return undefined;
    }

    // Plex tags albums with a MusicBrainz ID but does not distinguish a
    // release from a release-group. Try it as a release-group first; if
    // MusicBrainz doesn't recognize it as one, resolve it as a release ID
    // (mirrors the same fallback the Jellyfin scanner uses).
    try {
      await this.musicbrainz.getReleaseGroupDetails({
        releaseGroupId: rawId,
      });
      return rawId;
    } catch {
      // Not a release-group ID -- fall through to resolve as a release ID.
    }

    const resolvedReleaseGroupId = normalizeMusicBrainzId(
      (await this.musicbrainz.getReleaseGroup({ releaseId: rawId })) ?? ''
    );
    return isValidMusicBrainzResourceId(resolvedReleaseGroupId)
      ? resolvedReleaseGroupId
      : undefined;
  }

  private async processPlexAlbum(plexitem: PlexLibraryItem) {
    const mbId = await this.getMusicBrainzReleaseGroupIdFromPlexAlbum(plexitem);
    if (!mbId) {
      this.log(
        'No MusicBrainz release group ID found for this album. Skipping',
        'debug',
        { ratingKey: plexitem.ratingKey, title: plexitem.title }
      );
      return;
    }

    await this.processMusic(mbId, {
      mediaAddedAt: new Date(plexitem.addedAt * 1000),
      ratingKey: plexitem.ratingKey,
      title: plexitem.title,
      mutationGuard: (callback) => this.withConfigurationSnapshot(callback),
      outerMutationGuard: (callback) => this.withOwnerAuthority(callback),
    });
  }

  private async processPlexAudiobookAlbum(plexitem: PlexLibraryItem) {
    const author = plexitem.parentTitle;
    const title = plexitem.title;

    const rawIsbn = normalizeValidIsbn(
      this.extractPlexGuidValue(plexitem, 'isbn://')
    );

    const resolved = rawIsbn
      ? [{ provider: MediaIdentifierProvider.ISBN, value: rawIsbn }]
      : await resolveOpenLibraryIdentifiersForPlexAudiobook(
          title,
          author,
          this.openLibrary
        );

    const [primary, ...secondaryIdentifiers] = resolved;
    if (!primary) {
      this.log(
        'Unable to resolve a book identifier for this Plex audiobook. Skipping',
        'debug',
        { ratingKey: plexitem.ratingKey, title, author }
      );
      return;
    }

    await this.processBook(primary.provider, primary.value, {
      mediaAddedAt: new Date(plexitem.addedAt * 1000),
      ratingKey: plexitem.ratingKey,
      title,
      bookServiceType: 'audiobook',
      secondaryIdentifiers,
      mutationGuard: (callback) => this.withConfigurationSnapshot(callback),
      outerMutationGuard: (callback) => this.withOwnerAuthority(callback),
    });
  }

  private async getMediaIds(plexitem: PlexLibraryItem): Promise<MediaIds> {
    let mediaIds: Partial<MediaIds> = {};
    // Check if item is using new plex movie/tv agent
    if (
      plexitem.guid.match(plexRegex) ||
      plexitem.guid.match(plexCustomProviderRegex)
    ) {
      const guidCache = cacheManager.getCache('plexguid');
      const guidCacheKey = getPlexGuidCacheKey(
        this.plexSettingsSnapshot,
        plexitem.ratingKey
      );

      const cachedGuids = guidCache.data.get<MediaIds>(guidCacheKey);

      if (cachedGuids) {
        this.log('GUIDs are cached. Skipping metadata request.', 'debug', {
          mediaIds: cachedGuids,
          title: plexitem.title,
        });
        mediaIds = cachedGuids;
      }

      const metadata =
        plexitem.Guid && plexitem.Guid.length > 0
          ? plexitem
          : await this.plexClient.getMetadata(plexitem.ratingKey);

      // If there is no Guid field at all, then we bail
      if (!metadata.Guid) {
        throw new Error(
          'No Guid metadata for this title. Skipping. (Try refreshing the metadata in Plex for this media!)'
        );
      }

      // Map all IDs to MediaId object
      metadata.Guid.forEach((ref) => {
        if (ref.id.match(imdbRegex)) {
          mediaIds.imdbId = ref.id.match(imdbRegex)?.[1] ?? undefined;
        } else if (ref.id.match(tmdbRegex)) {
          const tmdbMatch = ref.id.match(tmdbRegex)?.[1];
          mediaIds.tmdbId = Number(tmdbMatch);
        } else if (ref.id.match(tvdbRegex)) {
          const tvdbMatch = ref.id.match(tvdbRegex)?.[1];
          mediaIds.tvdbId = Number(tvdbMatch);
        }
      });

      // If we got an IMDb ID, but no TMDB ID, lookup the TMDB ID with the IMDb ID
      if (mediaIds.imdbId && !mediaIds.tmdbId) {
        const tmdbMedia = await this.tmdb.getMediaByImdbId({
          imdbId: mediaIds.imdbId,
        });
        mediaIds.tmdbId = tmdbMedia.id;
      }

      if (mediaIds.tvdbId && !mediaIds.tmdbId) {
        const show = await this.tmdb.getShowByTvdbId({
          tvdbId: mediaIds.tvdbId,
        });
        mediaIds.tmdbId = show.id;
      }

      // Cache GUIDs
      guidCache.data.set(guidCacheKey, mediaIds);

      // Check if the agent is IMDb
    } else if (plexitem.guid.match(imdbRegex)) {
      const imdbMatch = plexitem.guid.match(imdbRegex);
      if (imdbMatch) {
        mediaIds.imdbId = imdbMatch[1];
        const tmdbMedia = await this.tmdb.getMediaByImdbId({
          imdbId: mediaIds.imdbId,
        });
        mediaIds.tmdbId = tmdbMedia.id;
      }
      // Check if the agent is TMDB
    } else if (plexitem.guid.match(tmdbRegex)) {
      const tmdbMatch = plexitem.guid.match(tmdbRegex);
      if (tmdbMatch) {
        mediaIds.tmdbId = Number(tmdbMatch[1]);
      }
      // Check if the agent is TVDb
    } else if (plexitem.guid.match(tvdbRegex)) {
      const matchedtvdb = plexitem.guid.match(tvdbRegex);

      // If we can find a tvdb Id, use it to get the full tmdb show details
      if (matchedtvdb) {
        const show = await this.tmdb.getShowByTvdbId({
          tvdbId: Number(matchedtvdb[1]),
        });

        mediaIds.tvdbId = Number(matchedtvdb[1]);
        mediaIds.tmdbId = show.id;
      }
      // Check if the agent (for shows) is TMDB
    } else if (plexitem.guid.match(tmdbShowRegex)) {
      const matchedtmdb = plexitem.guid.match(tmdbShowRegex);
      if (matchedtmdb) {
        mediaIds.tmdbId = Number(matchedtmdb[1]);
      }
      // Check for HAMA (with TVDb guid)
    } else if (plexitem.guid.match(hamaTvdbRegex)) {
      const matchedtvdb = plexitem.guid.match(hamaTvdbRegex);

      if (matchedtvdb) {
        const show = await this.tmdb.getShowByTvdbId({
          tvdbId: Number(matchedtvdb[1]),
        });

        mediaIds.tvdbId = Number(matchedtvdb[1]);
        mediaIds.tmdbId = show.id;
        // Set isHama to true, so we can know to add special processing to this item
        mediaIds.isHama = true;
      }
      // Check for HAMA (with anidb guid)
    } else if (plexitem.guid.match(hamaAnidbRegex)) {
      const matchedhama = plexitem.guid.match(hamaAnidbRegex);

      if (!animeList.isLoaded()) {
        this.log(
          `Hama ID ${plexitem.guid} detected, but library agent is not set to Hama`,
          'warn',
          { title: plexitem.title }
        );
      } else if (matchedhama) {
        const anidbId = Number(matchedhama[1]);
        const result = animeList.getFromAnidbId(anidbId);
        let tvShow: TmdbTvDetails | null = null;

        // Set isHama to true, so we can know to add special processing to this item
        mediaIds.isHama = true;

        // First try to lookup the show by TVDb ID
        if (result?.tvdbId) {
          const extResponse = await this.tmdb.getByExternalId({
            externalId: result.tvdbId,
            type: 'tvdb',
          });
          if (extResponse.tv_results[0]) {
            tvShow = await this.tmdb.getTvShow({
              tvId: extResponse.tv_results[0].id,
            });
            mediaIds.tvdbId = result.tvdbId;
            mediaIds.tmdbId = tvShow.id;
          } else {
            this.log(
              `Missing TVDB ${result.tvdbId} entry in TMDB for AniDB ${anidbId}`
            );
          }
        }

        if (!tvShow) {
          // if lookup of tvshow above failed, then try movie with tmdbid/imdbid
          // note - some tv shows have imdbid set too, that's why this need to go second
          if (result?.tmdbId) {
            mediaIds.tmdbId = result.tmdbId;
            mediaIds.imdbId = result?.imdbId;
          } else if (result?.imdbId) {
            const tmdbMovie = await this.tmdb.getMediaByImdbId({
              imdbId: result.imdbId,
            });
            mediaIds.tmdbId = tmdbMovie.id;
            mediaIds.imdbId = result.imdbId;
          }
        }
      }
    }

    if (!mediaIds.tmdbId) {
      throw new Error('Unable to find TMDB ID');
    }

    // We check above if we have the TMDB ID, so we can safely assert the type below
    return mediaIds as MediaIds;
  }

  // movies with hama agent actually are tv shows with at least one episode in it
  // try to get first episode of any season - cannot hardcode season or episode number
  // because sometimes user can have it in other season/ep than s01e01
  private async processHamaMovie(metadata: PlexMetadata, tmdbId: number) {
    const season = metadata.Children?.Metadata[0];
    if (season) {
      const episodes = await this.plexClient.getChildrenMetadata(
        season.ratingKey
      );
      if (episodes) {
        await this.processPlexMovieByTmdbId(episodes[0], tmdbId);
      }
    }
  }

  // this adds all movie episodes from specials season for Hama agent
  private async processHamaSpecials(metadata: PlexMetadata, tvdbId: number) {
    const specials = metadata.Children?.Metadata.find(
      (md) => Number(md.index) === 0
    );
    if (specials) {
      const episodes = await this.plexClient.getChildrenMetadata(
        specials.ratingKey
      );
      if (episodes) {
        for (const episode of episodes) {
          const special = animeList.getSpecialEpisode(tvdbId, episode.index);
          if (special) {
            if (special.tmdbId) {
              await this.processPlexMovieByTmdbId(episode, special.tmdbId);
            } else if (special.imdbId) {
              const tmdbMovie = await this.tmdb.getMediaByImdbId({
                imdbId: special.imdbId,
              });
              await this.processPlexMovieByTmdbId(episode, tmdbMovie.id);
            }
          }
        }
      }
    }
  }

  // checks if any of this.libraries has Hama agent set in Plex
  private async hasHamaAgent() {
    const plexLibraries = await this.plexClient.getLibraries();
    return this.libraries.some((library) =>
      plexLibraries.some(
        (plexLibrary) =>
          plexLibrary.agent === HAMA_AGENT && library.id === plexLibrary.key
      )
    );
  }

  private withConfigurationSnapshot<Result>(
    callback: () => Promise<Result>
  ): Promise<Result> {
    return runWithConfigurationSnapshot(this.configurationSnapshot, callback);
  }

  private withOwnerAuthority<Result>(
    callback: () => Promise<Result>
  ): Promise<Result> {
    return runWithMediaServerUserAuthority(
      this.ownerAuthoritySnapshot,
      callback
    );
  }
}

export const plexFullScanner = new PlexScanner();
export const plexRecentScanner = new PlexScanner(true);
