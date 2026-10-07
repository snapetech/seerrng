import { getRepository } from '@server/datasource';
import { ExternalRequestList } from '@server/entity/ExternalRequestList';
import { User } from '@server/entity/User';
import {
  MAX_EXTERNAL_REQUEST_LISTS_PER_USER,
  fetchHardcoverToRead,
  parseExternalRequestListUrl,
  syncExternalRequestList,
} from '@server/lib/externalRequestLists';
import { isAuthenticated } from '@server/middleware/auth';
import { isUniqueConstraintError } from '@server/utils/databaseError';
import { parsePositiveRouteId } from '@server/utils/routeId';
import { Router } from 'express';

const externalRequestListRoutes = Router();
const maxRequestListId = 1_000_000_000;

const filterExternalRequestList = (list: ExternalRequestList) => ({
  id: list.id,
  provider: list.provider,
  sourceUrl: list.sourceUrl,
  lastSyncedAt: list.lastSyncedAt ?? null,
  lastSyncError: list.lastSyncError ?? null,
});

externalRequestListRoutes.use(isAuthenticated());

externalRequestListRoutes.get('/', async (req, res, next) => {
  try {
    const lists = await getRepository(ExternalRequestList).find({
      where: { user: { id: req.user!.id } },
      order: { id: 'ASC' },
    });
    return res.status(200).json(lists.map(filterExternalRequestList));
  } catch (error) {
    return next({
      status: 500,
      message:
        error instanceof Error
          ? error.message
          : 'Unable to retrieve external request lists.',
    });
  }
});

externalRequestListRoutes.post('/', async (req, res, next) => {
  if (
    !req.body ||
    typeof req.body !== 'object' ||
    Array.isArray(req.body) ||
    Object.keys(req.body).length !== 1 ||
    !Object.hasOwn(req.body, 'url')
  ) {
    return next({ status: 400, message: 'Provide one public list URL.' });
  }

  const source = parseExternalRequestListUrl(req.body.url);
  if (!source) {
    return next({
      status: 400,
      message:
        'Use a public IMDb watchlist URL or a Goodreads to-read shelf URL.',
    });
  }

  try {
    const repository = getRepository(ExternalRequestList);
    const currentCount = await repository.count({
      where: { user: { id: req.user!.id } },
    });
    if (currentCount >= MAX_EXTERNAL_REQUEST_LISTS_PER_USER) {
      return next({
        status: 400,
        message: `You can add up to ${MAX_EXTERNAL_REQUEST_LISTS_PER_USER} external lists.`,
      });
    }

    const list = await repository.save(
      new ExternalRequestList({
        user: req.user!,
        provider: source.provider,
        sourceId: source.sourceId,
        sourceUrl: source.sourceUrl,
        processedItemIds: [],
      })
    );
    return res.status(201).json(filterExternalRequestList(list));
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return next({ status: 409, message: 'This list is already connected.' });
    }
    return next({
      status: 500,
      message:
        error instanceof Error
          ? error.message
          : 'Unable to save the external request list.',
    });
  }
});

externalRequestListRoutes.post('/hardcover', async (req, res, next) => {
  const tokenValue = req.body?.apiToken;
  if (
    !req.body ||
    typeof req.body !== 'object' ||
    Array.isArray(req.body) ||
    Object.keys(req.body).length !== 1 ||
    typeof tokenValue !== 'string' ||
    tokenValue.trim().length < 16 ||
    tokenValue.length > 4096 ||
    /[\r\n\0]/.test(tokenValue)
  ) {
    return next({
      status: 400,
      message: 'Provide a valid Hardcover API token.',
    });
  }
  const token = tokenValue.trim().replace(/^Bearer\s+/i, '');

  try {
    const items = await fetchHardcoverToRead(token.trim());
    const repository = getRepository(ExternalRequestList);
    const existing = await repository.findOne({
      where: {
        user: { id: req.user!.id },
        sourceId: 'hardcover:me:want-to-read',
      },
    });
    if (!existing) {
      const count = await repository.count({
        where: { user: { id: req.user!.id } },
      });
      if (count >= MAX_EXTERNAL_REQUEST_LISTS_PER_USER) {
        return next({
          status: 400,
          message: `You can add up to ${MAX_EXTERNAL_REQUEST_LISTS_PER_USER} external lists.`,
        });
      }
    }
    const list = await repository.save(
      Object.assign(existing ?? new ExternalRequestList(), {
        user: req.user!,
        provider: 'hardcover' as const,
        sourceId: 'hardcover:me:want-to-read',
        sourceUrl: 'https://hardcover.app/books/want-to-read',
        apiToken: token.trim(),
        processedItemIds: existing?.processedItemIds ?? [],
      })
    );
    return res.status(existing ? 200 : 201).json({
      ...filterExternalRequestList(list),
      validatedBooks: items.length,
    });
  } catch (error) {
    return next({
      status: 400,
      message:
        error instanceof Error
          ? error.message
          : 'Hardcover could not validate this token.',
    });
  }
});

externalRequestListRoutes.post<{ listId: string }>(
  '/:listId/sync',
  async (req, res, next) => {
    const listId = parsePositiveRouteId(req.params.listId, maxRequestListId);
    if (!listId) return next({ status: 404, message: 'List not found.' });

    try {
      const list = await getRepository(ExternalRequestList)
        .createQueryBuilder('list')
        .leftJoinAndSelect('list.user', 'user')
        .addSelect('list.apiToken')
        .where('list.id = :listId', { listId })
        .andWhere('user.id = :userId', { userId: req.user!.id })
        .getOne();
      if (!list) return next({ status: 404, message: 'List not found.' });

      const user = await getRepository(User).findOne({
        where: { id: req.user!.id },
      });
      if (!user) return next({ status: 404, message: 'User not found.' });

      const result = await syncExternalRequestList(list, user);
      return res.status(200).json(result);
    } catch (error) {
      return next({
        status: 500,
        message:
          error instanceof Error
            ? error.message
            : 'Unable to sync the external request list.',
      });
    }
  }
);

externalRequestListRoutes.delete<{ listId: string }>(
  '/:listId',
  async (req, res, next) => {
    const listId = parsePositiveRouteId(req.params.listId, maxRequestListId);
    if (!listId) return next({ status: 404, message: 'List not found.' });

    try {
      const repository = getRepository(ExternalRequestList);
      const list = await repository.findOne({
        where: { id: listId, user: { id: req.user!.id } },
      });
      if (!list) return next({ status: 404, message: 'List not found.' });
      await repository.remove(list);
      return res.status(204).send();
    } catch (error) {
      return next({
        status: 500,
        message:
          error instanceof Error
            ? error.message
            : 'Unable to remove the external request list.',
      });
    }
  }
);

export default externalRequestListRoutes;
