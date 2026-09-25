import {
  DuplicateWatchlistRequestError,
  NotFoundError,
  Watchlist,
  WatchlistActorUnavailableError,
} from '@server/entity/Watchlist';
import logger from '@server/logger';
import { filterEntityResponse } from '@server/utils/entityResponse';
import { parsePositiveRouteId } from '@server/utils/routeId';
import { Router } from 'express';
import { QueryFailedError } from 'typeorm';

import { MediaType } from '@server/constants/media';
import { watchlistCreate } from '@server/interfaces/api/watchlistCreate';
import {
  isValidExternalMediaId,
  isValidMusicBrainzResourceId,
  isValidOpenLibraryResourceId,
  normalizeExternalMediaId,
  normalizeMusicBrainzId,
} from '@server/lib/externalIds';
import { UserMutationActorUnauthorizedError } from '@server/lib/userSecurityMutation';

const watchlistRoutes = Router();
const maxWatchlistId = 1_000_000_000;
const maxWatchlistExternalIdLength = 512;

const parseWatchlistNumericId = (id: unknown): number | undefined =>
  parsePositiveRouteId(id, maxWatchlistId);

const parseWatchlistExternalId = (id: unknown): string | undefined => {
  if (typeof id !== 'string') {
    return undefined;
  }

  const trimmed = id.trim();

  return trimmed.length > 0 && trimmed.length <= maxWatchlistExternalIdLength
    ? trimmed
    : undefined;
};

watchlistRoutes.post<never, Watchlist, Watchlist>(
  '/',
  async (req, res, next) => {
    let logPayload: { mediaType?: unknown; tmdbId?: unknown } = {};

    try {
      if (!req.user) {
        return next({
          status: 401,
          message: 'You must be logged in to add watchlist.',
        });
      }
      const parsedBody = watchlistCreate.safeParse(req.body);
      if (!parsedBody.success) {
        return next({ status: 400, message: 'Invalid watchlist payload.' });
      }
      const values = {
        ...parsedBody.data,
        mbId: parsedBody.data.mbId
          ? normalizeMusicBrainzId(parsedBody.data.mbId)
          : undefined,
        externalId: parsedBody.data.externalId
          ? normalizeExternalMediaId(
              parsedBody.data.externalId,
              parsedBody.data.mediaType
            )
          : undefined,
      };
      logPayload = {
        mediaType: values.mediaType,
        tmdbId: values.tmdbId,
      };

      const request = await Watchlist.createWatchlist(
        {
          watchlistRequest: values,
          user: req.user,
        },
        {
          expectedCredentialVersion:
            req.session?.userId === req.user.id
              ? (req.session.credentialVersion ?? 0)
              : undefined,
        }
      );
      return res.status(201).json(filterEntityResponse(request, req.user));
    } catch (error) {
      if (!(error instanceof Error)) {
        logger.error('Unexpected non-error thrown while creating watchlist', {
          label: 'Watchlist',
          thrownValue: String(error),
        });
        return next({ status: 500, message: 'Unable to create watchlist.' });
      }

      switch (error.constructor) {
        case UserMutationActorUnauthorizedError:
        case WatchlistActorUnavailableError:
          return next({ status: 403, message: 'Access denied.' });
        case QueryFailedError:
          logger.warn('Something wrong with data watchlist', {
            tmdbId: logPayload.tmdbId,
            mediaType: logPayload.mediaType,
            label: 'Watchlist',
          });
          return next({ status: 409, message: 'Something wrong' });
        case DuplicateWatchlistRequestError:
          return next({ status: 409, message: error.message });
        default:
          return next({ status: 500, message: error.message });
      }
    }
  }
);

watchlistRoutes.delete('/:mediaId', async (req, res, next) => {
  if (!req.user) {
    return next({
      status: 401,
      message: 'You must be logged in to delete watchlist data.',
    });
  }
  try {
    const mediaType = req.query.mediaType;
    if (
      mediaType !== MediaType.MOVIE &&
      mediaType !== MediaType.TV &&
      mediaType !== MediaType.MUSIC &&
      mediaType !== MediaType.BOOK &&
      mediaType !== MediaType.COMIC &&
      mediaType !== MediaType.MAGAZINE
    ) {
      return next({
        status: 400,
        message: 'Invalid mediaType query parameter.',
      });
    }

    const parsedMediaId =
      mediaType === MediaType.MUSIC ||
      mediaType === MediaType.BOOK ||
      mediaType === MediaType.COMIC ||
      mediaType === MediaType.MAGAZINE
        ? parseWatchlistExternalId(req.params.mediaId)
        : parseWatchlistNumericId(req.params.mediaId);

    if (parsedMediaId === undefined) {
      return next({ status: 400, message: 'Invalid mediaId parameter.' });
    }

    const mediaId =
      mediaType === MediaType.MUSIC
        ? normalizeMusicBrainzId(parsedMediaId as string)
        : mediaType === MediaType.BOOK ||
            mediaType === MediaType.COMIC ||
            mediaType === MediaType.MAGAZINE
          ? normalizeExternalMediaId(parsedMediaId as string, mediaType)
          : parsedMediaId;
    if (
      mediaType === MediaType.MUSIC &&
      !isValidMusicBrainzResourceId(mediaId as string)
    ) {
      return next({ status: 400, message: 'Invalid mediaId parameter.' });
    }
    if (
      mediaType === MediaType.BOOK &&
      !isValidOpenLibraryResourceId(mediaId as string)
    ) {
      return next({ status: 400, message: 'Invalid mediaId parameter.' });
    }
    if (
      mediaType === MediaType.COMIC &&
      !isValidExternalMediaId(mediaId as string, MediaType.COMIC)
    ) {
      return next({ status: 400, message: 'Invalid mediaId parameter.' });
    }
    if (
      mediaType === MediaType.MAGAZINE &&
      !isValidExternalMediaId(mediaId as string, MediaType.MAGAZINE)
    ) {
      return next({ status: 400, message: 'Invalid mediaId parameter.' });
    }

    await Watchlist.deleteWatchlist(mediaId, mediaType, req.user, {
      expectedCredentialVersion:
        req.session?.userId === req.user.id
          ? (req.session.credentialVersion ?? 0)
          : undefined,
    });
    return res.status(204).send();
  } catch (e) {
    if (
      e instanceof UserMutationActorUnauthorizedError ||
      e instanceof WatchlistActorUnavailableError
    ) {
      return next({ status: 403, message: 'Access denied.' });
    }
    if (e instanceof NotFoundError) {
      return next({
        status: 404,
        message: e.message,
      });
    }
    return next({ status: 500, message: e.message });
  }
});

export default watchlistRoutes;
