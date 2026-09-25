import PlexTvAPI, {
  MAX_PLEX_WATCHLIST_PAGE_SIZE,
  type PlexWatchlistItem,
} from '@server/api/plextv';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import {
  BlocklistedMediaError,
  DuplicateMediaRequestError,
  MediaRequest,
  NoSeasonsAvailableError,
  QuotaRestrictedError,
  RequestPermissionError,
} from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { runUserSecurityMutation } from '@server/lib/userSecurityMutation';
import logger from '@server/logger';
import type { MediaServerUserAuthoritySnapshot } from './mediaServerUserAuthority';
import { Permission } from './permissions';
import { forEachPlexTokenUser } from './plexTokenUserBatches';

export const MAX_PLEX_WATCHLIST_SYNC_ITEMS = 200;

export const fetchPlexWatchlistForSync = async (
  plexTv: Pick<PlexTvAPI, 'getWatchlist'>
): Promise<{
  items: PlexWatchlistItem[];
  totalSize: number;
  truncated: boolean;
}> => {
  const items: PlexWatchlistItem[] = [];
  let offset = 0;
  let totalSize = 0;

  do {
    const size = Math.min(
      MAX_PLEX_WATCHLIST_PAGE_SIZE,
      MAX_PLEX_WATCHLIST_SYNC_ITEMS - offset
    );
    const page = await plexTv.getWatchlist({ offset, size });
    totalSize = Math.max(totalSize, page.totalSize);
    items.push(...page.items.slice(0, size));
    offset += size;
  } while (offset < totalSize && offset < MAX_PLEX_WATCHLIST_SYNC_ITEMS);

  return {
    items: dedupePlexWatchlistItems(items).slice(
      0,
      MAX_PLEX_WATCHLIST_SYNC_ITEMS
    ),
    totalSize,
    truncated: totalSize > MAX_PLEX_WATCHLIST_SYNC_ITEMS,
  };
};

const dedupePlexWatchlistItems = (
  items: PlexWatchlistItem[]
): PlexWatchlistItem[] => {
  const seen = new Set<string>();

  return items.filter((item) => {
    const mediaType = item.type === 'show' ? MediaType.TV : MediaType.MOVIE;
    const key = `${mediaType}:${item.tmdbId}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

class WatchlistSync {
  public async syncWatchlist() {
    await forEachPlexTokenUser((user) => this.syncUserWatchlist(user));
  }

  private async syncUserWatchlist(user: User) {
    const admitted = await runUserSecurityMutation(user.id, async () => {
      const activeUser = await getRepository(User)
        .createQueryBuilder('user')
        .addSelect('user.plexToken')
        .leftJoinAndSelect('user.settings', 'settings')
        .where('user.id = :userId', { userId: user.id })
        .getOne();
      if (!activeUser?.plexToken) {
        logger.warn(
          'Skipping user watchlist sync for user without plex token',
          {
            label: 'Plex Watchlist Sync',
            userId: user.id,
          }
        );
        return undefined;
      }

      if (
        !activeUser.hasPermission(
          [
            Permission.AUTO_REQUEST,
            Permission.AUTO_REQUEST_MOVIE,
            Permission.AUTO_REQUEST_TV,
            Permission.AUTO_REQUEST_MUSIC,
            Permission.AUTO_REQUEST_BOOK,
            Permission.AUTO_REQUEST_COMIC,
          ],
          { type: 'or' }
        ) ||
        (!activeUser.settings?.watchlistSyncMovies &&
          !activeUser.settings?.watchlistSyncTv &&
          !activeUser.settings?.watchlistSyncMusic &&
          !activeUser.settings?.watchlistSyncBooks &&
          !activeUser.settings?.watchlistSyncComics)
      ) {
        return undefined;
      }

      return {
        user: activeUser,
        authoritySnapshot: {
          userId: activeUser.id,
          type: 'plex',
          plexToken: activeUser.plexToken,
        } satisfies MediaServerUserAuthoritySnapshot,
        response: await fetchPlexWatchlistForSync(
          new PlexTvAPI(activeUser.plexToken)
        ),
      };
    });
    if (!admitted) return;

    user = admitted.user;
    const authoritySnapshot = admitted.authoritySnapshot;
    const response = admitted.response;
    if (response.truncated) {
      logger.warn('Plex watchlist sync reached its per-user item limit', {
        label: 'Plex Watchlist Sync',
        userId: user.id,
        totalSize: response.totalSize,
        itemLimit: MAX_PLEX_WATCHLIST_SYNC_ITEMS,
      });
    }
    const watchlistItems = response.items;

    const mediaItems = await Media.getRelatedMedia(
      user,
      watchlistItems.map((i) => ({
        tmdbId: i.tmdbId,
        mediaType: i.type === 'show' ? MediaType.TV : MediaType.MOVIE,
      }))
    );

    const watchlistTmdbIds = watchlistItems.map((i) => i.tmdbId);

    const requestRepository = getRepository(MediaRequest);
    const existingAutoRequests: MediaRequest[] =
      watchlistTmdbIds.length > 0
        ? await requestRepository
            .createQueryBuilder('request')
            .leftJoinAndSelect('request.media', 'media')
            .where('request.requestedBy = :userId', { userId: user.id })
            .andWhere('request.isAutoRequest = true')
            .andWhere('media.tmdbId IN (:...tmdbIds)', {
              tmdbIds: watchlistTmdbIds,
            })
            .getMany()
        : [];

    const autoRequestedTmdbIds = new Set(
      existingAutoRequests
        .filter(
          (r) => r.media != null && r.media.status !== MediaStatus.DELETED
        )
        .map((r) => `${r.media.mediaType}:${r.media.tmdbId}`)
    );

    const unavailableItems = watchlistItems.filter((i) => {
      const itemMediaType = i.type === 'show' ? MediaType.TV : MediaType.MOVIE;

      return (
        !autoRequestedTmdbIds.has(`${itemMediaType}:${i.tmdbId}`) &&
        !mediaItems.find(
          (m) =>
            m.tmdbId === i.tmdbId &&
            m.mediaType === itemMediaType &&
            (m.status === MediaStatus.BLOCKLISTED ||
              (itemMediaType === MediaType.MOVIE &&
                m.status !== MediaStatus.UNKNOWN &&
                m.status !== MediaStatus.DELETED) ||
              (itemMediaType === MediaType.TV &&
                m.status === MediaStatus.AVAILABLE))
        )
      );
    });

    for (const mediaItem of unavailableItems) {
      try {
        if (mediaItem.type === 'show' && !mediaItem.tvdbId) {
          throw new Error('Missing TVDB ID from Plex Metadata');
        }

        // Check if they have auto-request permissons and watchlist sync
        // enabled for the media type
        if (
          ((!user.hasPermission(
            [Permission.AUTO_REQUEST, Permission.AUTO_REQUEST_MOVIE],
            { type: 'or' }
          ) ||
            !user.settings?.watchlistSyncMovies) &&
            mediaItem.type === 'movie') ||
          ((!user.hasPermission(
            [Permission.AUTO_REQUEST, Permission.AUTO_REQUEST_TV],
            { type: 'or' }
          ) ||
            !user.settings?.watchlistSyncTv) &&
            mediaItem.type === 'show')
        ) {
          continue;
        }

        await MediaRequest.request(
          {
            mediaId: mediaItem.tmdbId,
            mediaType:
              mediaItem.type === 'show' ? MediaType.TV : MediaType.MOVIE,
            seasons: mediaItem.type === 'show' ? 'all' : undefined,
            tvdbId: mediaItem.tvdbId,
            is4k: false,
          },
          user,
          {
            expectedMediaServerUserAuthority: authoritySnapshot,
            isAutoRequest: true,
          }
        );

        logger.info("Created media request from user's Plex Watchlist", {
          label: 'Watchlist Sync',
          userId: user.id,
          mediaTitle: mediaItem.title,
        });
      } catch (e) {
        if (!(e instanceof Error)) {
          continue;
        }

        switch (e.constructor) {
          // During watchlist sync, these errors aren't necessarily
          // a problem with Seerr. Since we are auto syncing these constantly, it's
          // possible they are unexpectedly at their quota limit, for example. So we'll
          // instead log these as debug messages.
          case RequestPermissionError:
          case DuplicateMediaRequestError:
          case QuotaRestrictedError:
          case NoSeasonsAvailableError:
            logger.debug('Failed to create media request from watchlist', {
              label: 'Watchlist Sync',
              userId: user.id,
              mediaTitle: mediaItem.title,
              errorMessage: e.message,
            });
            break;
          // Blocklisted media should be silently ignored during watchlist sync to avoid spam
          case BlocklistedMediaError:
            break;
          default:
            logger.error('Failed to create media request from watchlist', {
              label: 'Watchlist Sync',
              userId: user.id,
              mediaTitle: mediaItem.title,
              errorMessage: e.message,
            });
        }
      }
    }
  }
}

const watchlistSync = new WatchlistSync();

export default watchlistSync;
