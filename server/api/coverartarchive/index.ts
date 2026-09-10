import ExternalAPI, {
  DEFAULT_EXTERNAL_API_TIMEOUT_MS,
} from '@server/api/externalapi';
import { getRepository } from '@server/datasource';
import MetadataAlbum from '@server/entity/MetadataAlbum';
import cacheManager from '@server/lib/cache';
import {
  isValidMusicBrainzResourceId,
  normalizeMusicBrainzId,
  prepareMusicBrainzBatchIds,
} from '@server/lib/externalIds';
import logger from '@server/logger';
import { mapWithConcurrency } from '@server/utils/concurrency';
import {
  createSafeHttpUrl,
  stringifySafeHttpUrl,
} from '@server/utils/security';
import axios from 'axios';
import { In } from 'typeorm';
import type { CoverArtResponse } from './interfaces';
import { formatCoverArtArchiveThumbnailUrl } from './urls';

const MAX_COVER_ART_IMAGES = 100;
const MAX_COVER_ART_IDENTIFIER_LENGTH = 256;
const MAX_ARCHIVE_ORG_REDIRECTS = 4;

const isArchiveOrgHostname = (hostname: string): boolean =>
  hostname === 'coverartarchive.org' ||
  hostname === 'archive.org' ||
  hostname.endsWith('.archive.org');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const boundedIdentifier = (value: unknown): number | string | undefined => {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const identifier = value.slice(0, MAX_COVER_ART_IDENTIFIER_LENGTH);
  return identifier ? identifier : undefined;
};

class CoverArtArchive extends ExternalAPI {
  private readonly CACHE_TTL = 43200;
  private readonly STALE_THRESHOLD = 30 * 24 * 60 * 60 * 1000;
  static readonly BATCH_FETCH_CONCURRENCY = 5;

  constructor() {
    super(
      'https://coverartarchive.org',
      {},
      {
        nodeCache: cacheManager.getCache('coverartarchive').data,
        rateLimit: {
          maxRequests: 20,
          maxRPS: 50,
        },
      }
    );
  }

  private isMetadataStale(metadata: MetadataAlbum | null): boolean {
    if (!metadata) return true;
    return Date.now() - metadata.updatedAt.getTime() > this.STALE_THRESHOLD;
  }

  private createEmptyResponse(id: string): CoverArtResponse {
    return { images: [], release: `/release/${id}` };
  }

  private createCachedResponse(url: string, id: string): CoverArtResponse {
    return {
      images: [
        {
          approved: true,
          front: true,
          id: 0,
          thumbnails: { 250: url },
        },
      ],
      release: `/release/${id}`,
    };
  }

  public async getCoverArtFromCache(
    id: string
  ): Promise<string | null | undefined> {
    const albumId = normalizeMusicBrainzId(id);

    try {
      const metadata = await getRepository(MetadataAlbum).findOne({
        where: { mbAlbumId: albumId },
        select: ['caaUrl'],
      });
      return metadata?.caaUrl;
    } catch (error) {
      logger.error('Failed to fetch cover art from cache', {
        label: 'CoverArtArchive',
        id: albumId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  public async getCoverArt(id: string): Promise<CoverArtResponse> {
    const albumId = normalizeMusicBrainzId(id);

    try {
      const metadata = await getRepository(MetadataAlbum).findOne({
        where: { mbAlbumId: albumId },
        select: ['caaUrl', 'updatedAt'],
      });

      if (metadata?.caaUrl) {
        return this.createCachedResponse(metadata.caaUrl, albumId);
      }

      if (metadata && !this.isMetadataStale(metadata)) {
        return this.createEmptyResponse(albumId);
      }

      return await this.fetchCoverArt(albumId);
    } catch (error) {
      logger.error('Failed to get cover art', {
        label: 'CoverArtArchive',
        id: albumId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return this.createEmptyResponse(albumId);
    }
  }

  // Cover Art Archive's metadata endpoints redirect to archive.org's own
  // storage, which itself redirects again to a per-request Internet Archive
  // CDN subdomain (e.g. dn710405.ca.archive.org) to serve the actual
  // payload. ExternalAPI's hardened axios instance refuses to follow any
  // cross-origin redirect at all — that guard is baked into the instance's
  // `beforeRedirect` hook and fires regardless of per-request
  // `maxRedirects`, so it can't be selectively relaxed per call.
  //
  // Follow this specific, known chain manually with a plain, unwrapped
  // axios client instead: validate each hop is a safe, non-private URL
  // (createSafeHttpUrl) and stays within coverartarchive.org/archive.org
  // (including its dynamic CDN subdomains) before following it, bounded to
  // a small number of hops.
  private async fetchReleaseGroupMetadata(albumId: string): Promise<unknown> {
    let url = `https://coverartarchive.org/release-group/${encodeURIComponent(albumId)}`;

    for (let hop = 0; hop <= MAX_ARCHIVE_ORG_REDIRECTS; hop++) {
      const safeUrl = await createSafeHttpUrl(url);
      if (!safeUrl) {
        throw new Error('Cover Art Archive redirect target is not a safe URL');
      }

      try {
        const response = await axios.get(stringifySafeHttpUrl(safeUrl), {
          maxRedirects: 0,
          timeout: DEFAULT_EXTERNAL_API_TIMEOUT_MS,
        });
        return response.data;
      } catch (error) {
        if (!axios.isAxiosError(error) || !error.response) {
          throw error;
        }
        const { status, headers } = error.response;
        if (status < 300 || status >= 400) {
          throw error;
        }
        const location = headers?.location;
        if (typeof location !== 'string') {
          throw error;
        }
        const nextUrl = new URL(location, url);
        if (!isArchiveOrgHostname(nextUrl.hostname)) {
          throw error;
        }
        url = nextUrl.href;
      }
    }

    throw new Error('Too many redirects resolving Cover Art Archive metadata');
  }

  private async fetchCoverArt(id: string): Promise<CoverArtResponse> {
    const albumId = normalizeMusicBrainzId(id);

    if (!isValidMusicBrainzResourceId(albumId)) {
      return this.createEmptyResponse(albumId);
    }

    try {
      const rawData = await this.fetchReleaseGroupMetadata(albumId);

      if (!isRecord(rawData)) {
        throw new Error('Invalid Cover Art Archive response');
      }

      const release =
        typeof rawData.release === 'string'
          ? rawData.release.slice(0, MAX_COVER_ART_IDENTIFIER_LENGTH)
          : `/release/${albumId}`;

      const releaseMBID = release.split('/').filter(Boolean).pop() ?? albumId;
      const images = (Array.isArray(rawData.images) ? rawData.images : [])
        .slice(0, MAX_COVER_ART_IMAGES)
        .flatMap((value) => {
          if (!isRecord(value)) {
            return [];
          }

          const id = boundedIdentifier(value.id);
          if (id === undefined) {
            return [];
          }

          const fullUrl = formatCoverArtArchiveThumbnailUrl(releaseMBID, id);

          return [
            {
              approved: value.approved === true,
              front: value.front === true,
              id,
              thumbnails: { 250: fullUrl },
            },
          ];
        });
      const data: CoverArtResponse = { images, release };

      const frontImage = data.images.find((image) => image.front);
      if (frontImage) {
        await getRepository(MetadataAlbum)
          .upsert(
            {
              mbAlbumId: albumId,
              caaUrl: frontImage.thumbnails[250],
            },
            { conflictPaths: ['mbAlbumId'] }
          )
          .catch((e) => {
            logger.error('Failed to save album metadata', {
              label: 'CoverArtArchive',
              error: e instanceof Error ? e.message : 'Unknown error',
            });
          });
      }

      return data;
    } catch (error) {
      // Only a confirmed "no cover art for this release" response (Cover
      // Art Archive returns 404) should be cached as a negative result.
      // Transient failures (timeouts, DNS errors, 5xx) must not poison the
      // cache for up to STALE_THRESHOLD (30 days) — leave no metadata row
      // so the next request retries instead of serving a stale empty
      // response for something that may already be fetchable again.
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        await getRepository(MetadataAlbum).upsert(
          { mbAlbumId: albumId, caaUrl: null },
          { conflictPaths: ['mbAlbumId'] }
        );
      } else {
        logger.warn(
          'Transient failure fetching cover art, will retry on next request',
          {
            label: 'CoverArtArchive',
            id: albumId,
            errorMessage:
              error instanceof Error ? error.message : 'Unknown error',
          }
        );
      }
      return this.createEmptyResponse(albumId);
    }
  }

  public async batchGetCoverArt(
    ids: string[]
  ): Promise<Record<string, string | null>> {
    if (!ids.length) return {};

    const validIds = prepareMusicBrainzBatchIds(ids).filter(
      (id) =>
        typeof id === 'string' &&
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
          id
        )
    );

    if (!validIds.length) return {};

    const resultsMap = new Map<string, string | null>();
    const idsToFetch: string[] = [];

    const metadataRepository = getRepository(MetadataAlbum);
    const existingMetadata = await metadataRepository.find({
      where: { mbAlbumId: In(validIds) },
      select: ['mbAlbumId', 'caaUrl', 'updatedAt'],
    });

    const metadataMap = new Map(
      existingMetadata.map((metadata) => [
        normalizeMusicBrainzId(metadata.mbAlbumId),
        metadata,
      ])
    );

    for (const id of validIds) {
      const metadata = metadataMap.get(id);

      if (metadata?.caaUrl) {
        resultsMap.set(id, metadata.caaUrl);
      } else if (metadata && !this.isMetadataStale(metadata)) {
        resultsMap.set(id, null);
      } else {
        idsToFetch.push(id);
      }
    }

    if (idsToFetch.length > 0) {
      await mapWithConcurrency(
        idsToFetch,
        CoverArtArchive.BATCH_FETCH_CONCURRENCY,
        async (id) => {
          try {
            const response = await this.fetchCoverArt(id);
            const frontImage = response.images.find((img) => img.front);
            resultsMap.set(id, frontImage?.thumbnails?.[250] || null);
            return true;
          } catch (error) {
            logger.error('Failed to fetch cover art', {
              label: 'CoverArtArchive',
              id,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
            resultsMap.set(id, null);
            return false;
          }
        }
      );
    }

    const results: Record<string, string | null> = {};
    for (const [key, value] of resultsMap.entries()) {
      results[key] = value;
    }

    return results;
  }
}

export default CoverArtArchive;
