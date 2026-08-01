import {
  IssueStatus,
  IssueType,
  MAX_ISSUE_COMMENTS,
  MAX_ISSUE_MESSAGE_LENGTH,
} from '@server/constants/issue';
import { getRepository } from '@server/datasource';
import Issue from '@server/entity/Issue';
import IssueComment from '@server/entity/IssueComment';
import Media from '@server/entity/Media';
import type { IssueResultsResponse } from '@server/interfaces/api/issueInterfaces';
import { hydrateIssueRelations } from '@server/lib/issueHydration';
import issueMutationCoordinator from '@server/lib/issueMutation';
import { Permission } from '@server/lib/permissions';
import {
  UserMutationActorUnauthorizedError,
  runAuthorizedUserSecurityMutation,
} from '@server/lib/userSecurityMutation';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { authorizedRouteAccess } from '@server/middleware/authorizedMutation';
import { filterEntityResponse } from '@server/utils/entityResponse';
import {
  parseOptionalPositiveInt,
  parsePageParams,
} from '@server/utils/pagination';
import { parsePositiveRouteId } from '@server/utils/routeId';
import {
  parseBoundedString,
  parseOptionalAllowedString,
  parseOptionalNonNegativeInteger,
} from '@server/utils/validation';
import { Router } from 'express';

const issueRoutes = Router();
const MAX_ISSUE_ROUTE_ID = 1_000_000_000;
const issueSortFields = ['added', 'modified'] as const;
const issueStatusFilters = ['open', 'resolved'] as const;

const parseIssueStatusAction = (status: unknown): IssueStatus | undefined => {
  switch (status) {
    case 'resolved':
      return IssueStatus.RESOLVED;
    case 'open':
      return IssueStatus.OPEN;
    default:
      return undefined;
  }
};

const parseIssueBodyId = (value: unknown, fieldName: string) => {
  const parsed = parseOptionalNonNegativeInteger(value, MAX_ISSUE_ROUTE_ID);
  return parsed && parsed > 0
    ? { value: parsed }
    : { error: `${fieldName} must be a valid ID.` };
};

const parseIssueBodyOptionalIndex = (value: unknown, fieldName: string) => {
  if (value === undefined || value === null || value === '') {
    return { value: 0 };
  }

  const parsed = parseOptionalNonNegativeInteger(value, MAX_ISSUE_ROUTE_ID);
  return parsed === undefined
    ? { error: `${fieldName} must be a non-negative integer.` }
    : { value: parsed };
};

const parseIssueBodyType = (value: unknown) => {
  const parsed = parseOptionalNonNegativeInteger(value, IssueType.OTHER);
  return parsed && Object.values(IssueType).includes(parsed)
    ? { value: parsed as IssueType }
    : { error: 'Issue type must be valid.' };
};

const parseIssueBodyObject = (
  body: unknown
): { value: Record<string, unknown> } | { error: string } => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Issue body must be an object.' };
  }

  return { value: body as Record<string, unknown> };
};

issueRoutes.get<
  Record<string, string>,
  IssueResultsResponse | { status: number; message: string }
>(
  '/',
  isAuthenticated(
    [
      Permission.MANAGE_ISSUES,
      Permission.VIEW_ISSUES,
      Permission.CREATE_ISSUES,
    ],
    { type: 'or' }
  ),
  authorizedRouteAccess([
    Permission.MANAGE_ISSUES,
    Permission.VIEW_ISSUES,
    Permission.CREATE_ISSUES,
  ]),
  async (req, res, next) => {
    const { pageSize, skip } = parsePageParams(req.query, {
      take: 10,
      maxTake: 100,
    });
    const createdBy = parseOptionalPositiveInt(req.query.createdBy) ?? null;
    const parsedSort = parseOptionalAllowedString(req.query.sort, {
      fieldName: 'Sort',
      allowedValues: issueSortFields,
      maxLength: 32,
    });
    if ('error' in parsedSort) {
      return next({ status: 400, message: parsedSort.error });
    }

    const parsedFilter = parseOptionalAllowedString(req.query.filter, {
      fieldName: 'Filter',
      allowedValues: issueStatusFilters,
      maxLength: 32,
    });
    if ('error' in parsedFilter) {
      return next({ status: 400, message: parsedFilter.error });
    }

    let sortFilter: string;

    switch (parsedSort.value) {
      case 'modified':
        sortFilter = 'issue.updatedAt';
        break;
      default:
        sortFilter = 'issue.createdAt';
    }

    let statusFilter: IssueStatus[];

    switch (parsedFilter.value) {
      case 'open':
        statusFilter = [IssueStatus.OPEN];
        break;
      case 'resolved':
        statusFilter = [IssueStatus.RESOLVED];
        break;
      default:
        statusFilter = [IssueStatus.OPEN, IssueStatus.RESOLVED];
    }

    let query = getRepository(Issue)
      .createQueryBuilder('issue')
      .leftJoinAndSelect('issue.createdBy', 'createdBy')
      .leftJoinAndSelect('issue.media', 'media')
      .leftJoinAndSelect('issue.modifiedBy', 'modifiedBy')
      .where('issue.status IN (:...issueStatus)', {
        issueStatus: statusFilter,
      });

    if (
      !req.user?.hasPermission(
        [Permission.MANAGE_ISSUES, Permission.VIEW_ISSUES],
        { type: 'or' }
      )
    ) {
      if (createdBy && createdBy !== req.user?.id) {
        return next({
          status: 403,
          message:
            'You do not have permission to view issues reported by other users',
        });
      }
      query = query.andWhere('createdBy.id = :id', { id: req.user?.id });
    } else if (createdBy) {
      query = query.andWhere('createdBy.id = :id', { id: createdBy });
    }

    const [issueRows, issueCount] = await query
      .orderBy(sortFilter, 'DESC')
      .take(pageSize)
      .skip(skip)
      .getManyAndCount();
    const issues = await hydrateIssueRelations(issueRows);

    return res.status(200).json({
      pageInfo: {
        pages: Math.ceil(issueCount / pageSize),
        pageSize,
        results: issueCount,
        page: Math.ceil(skip / pageSize) + 1,
      },
      results: filterEntityResponse(issues, req.user),
    });
  }
);

issueRoutes.post<
  Record<string, string>,
  Issue,
  {
    message: string;
    mediaId: number;
    issueType: number;
    problemSeason: number;
    problemEpisode: number;
  }
>(
  '/',
  isAuthenticated([Permission.MANAGE_ISSUES, Permission.CREATE_ISSUES], {
    type: 'or',
  }),
  async (req, res, next) => {
    // Satisfy typescript here. User is set, we assure you!
    if (!req.user) {
      return next({ status: 500, message: 'User missing from request.' });
    }

    const issueRepository = getRepository(Issue);
    const mediaRepository = getRepository(Media);
    const parsedBody = parseIssueBodyObject(req.body);
    if ('error' in parsedBody) {
      return next({ status: 400, message: parsedBody.error });
    }
    const body = parsedBody.value;
    const parsedMessage = parseBoundedString(body.message, {
      fieldName: 'Issue message',
      maxLength: MAX_ISSUE_MESSAGE_LENGTH,
    });

    if ('error' in parsedMessage) {
      return next({ status: 400, message: parsedMessage.error });
    }
    const mediaId = parseIssueBodyId(body.mediaId, 'Media ID');
    if ('error' in mediaId) {
      return next({ status: 400, message: mediaId.error });
    }
    const issueType = parseIssueBodyType(body.issueType);
    if ('error' in issueType) {
      return next({ status: 400, message: issueType.error });
    }
    const problemSeason = parseIssueBodyOptionalIndex(
      body.problemSeason,
      'Problem season'
    );
    if ('error' in problemSeason) {
      return next({ status: 400, message: problemSeason.error });
    }
    const problemEpisode = parseIssueBodyOptionalIndex(
      body.problemEpisode,
      'Problem episode'
    );
    if ('error' in problemEpisode) {
      return next({ status: 400, message: problemEpisode.error });
    }

    const media = await mediaRepository.findOne({
      where: { id: mediaId.value },
    });

    if (!media) {
      return next({ status: 404, message: 'Media does not exist.' });
    }

    try {
      const newIssue = await runAuthorizedUserSecurityMutation(
        req.user.id,
        req.user.id,
        [Permission.MANAGE_ISSUES, Permission.CREATE_ISSUES],
        async (actor) =>
          issueRepository.save(
            new Issue({
              createdBy: actor,
              issueType: issueType.value,
              problemSeason: problemSeason.value,
              problemEpisode: problemEpisode.value,
              media,
              comments: [
                new IssueComment({
                  user: actor,
                  message: parsedMessage.value,
                }),
              ],
            })
          )
      );

      return res.status(200).json(filterEntityResponse(newIssue, req.user));
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError) {
        return next({
          status: 403,
          message: 'You no longer have permission to create issues.',
        });
      }
      throw e;
    }
  }
);

issueRoutes.get(
  '/count',
  isAuthenticated(
    [
      Permission.MANAGE_ISSUES,
      Permission.VIEW_ISSUES,
      Permission.CREATE_ISSUES,
    ],
    { type: 'or' }
  ),
  authorizedRouteAccess([
    Permission.MANAGE_ISSUES,
    Permission.VIEW_ISSUES,
    Permission.CREATE_ISSUES,
  ]),
  async (req, res, next) => {
    const issueRepository = getRepository(Issue);

    try {
      const restrictToOwnIssues = !req.user?.hasPermission(
        [Permission.MANAGE_ISSUES, Permission.VIEW_ISSUES],
        { type: 'or' }
      );
      const createVisibleIssueQuery = () => {
        const query = issueRepository.createQueryBuilder('issue');

        return restrictToOwnIssues
          ? query
              .innerJoin('issue.createdBy', 'createdBy')
              .where('createdBy.id = :userId', { userId: req.user?.id })
          : query;
      };
      const countBy = (field: 'issueType' | 'status', value: number) =>
        createVisibleIssueQuery()
          .andWhere(`issue.${field} = :value`, { value })
          .getCount();

      const [
        totalCount,
        videoCount,
        audioCount,
        subtitlesCount,
        othersCount,
        openCount,
        closedCount,
      ] = await Promise.all([
        createVisibleIssueQuery().getCount(),
        countBy('issueType', IssueType.VIDEO),
        countBy('issueType', IssueType.AUDIO),
        countBy('issueType', IssueType.SUBTITLES),
        countBy('issueType', IssueType.OTHER),
        countBy('status', IssueStatus.OPEN),
        countBy('status', IssueStatus.RESOLVED),
      ]);

      return res.status(200).json({
        total: totalCount,
        video: videoCount,
        audio: audioCount,
        subtitles: subtitlesCount,
        others: othersCount,
        open: openCount,
        closed: closedCount,
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving issue counts.', {
        label: 'API',
        errorMessage: e.message,
      });
      next({ status: 500, message: 'Unable to retrieve issue counts.' });
    }
  }
);

issueRoutes.get<{ issueId: string }>(
  '/:issueId',
  isAuthenticated(
    [
      Permission.MANAGE_ISSUES,
      Permission.VIEW_ISSUES,
      Permission.CREATE_ISSUES,
    ],
    { type: 'or' }
  ),
  authorizedRouteAccess([
    Permission.MANAGE_ISSUES,
    Permission.VIEW_ISSUES,
    Permission.CREATE_ISSUES,
  ]),
  async (req, res, next) => {
    const issueRepository = getRepository(Issue);
    const issueId = parsePositiveRouteId(req.params.issueId);
    if (!issueId) {
      return next({ status: 404, message: 'Issue not found.' });
    }
    // Satisfy typescript here. User is set, we assure you!
    if (!req.user) {
      return next({ status: 500, message: 'User missing from request.' });
    }
    try {
      const issue = await issueRepository.findOneOrFail({
        where: { id: issueId },
        relations: {
          comments: { user: true },
          createdBy: true,
          modifiedBy: true,
          media: { identifiers: true },
        },
        relationLoadStrategy: 'query',
      });

      if (
        issue.createdBy.id !== req.user.id &&
        !req.user.hasPermission(
          [Permission.MANAGE_ISSUES, Permission.VIEW_ISSUES],
          { type: 'or' }
        )
      ) {
        return next({
          status: 403,
          message: 'You do not have permission to view this issue.',
        });
      }

      return res.status(200).json(filterEntityResponse(issue, req.user));
    } catch (e) {
      logger.debug('Failed to retrieve issue.', {
        label: 'API',
        errorMessage: e.message,
      });
      next({ status: 404, message: 'Issue not found.' });
    }
  }
);

issueRoutes.post<{ issueId: string }, Issue, { message: string }>(
  '/:issueId/comment',
  isAuthenticated([Permission.MANAGE_ISSUES, Permission.CREATE_ISSUES], {
    type: 'or',
  }),
  async (req, res, next) => {
    const issueId = parsePositiveRouteId(req.params.issueId);
    if (!issueId) {
      return next({ status: 404, message: 'Issue not found.' });
    }

    const parsedBody = parseIssueBodyObject(req.body);
    if ('error' in parsedBody) {
      return next({ status: 400, message: parsedBody.error });
    }
    const parsedMessage = parseBoundedString(parsedBody.value.message, {
      fieldName: 'Comment message',
      maxLength: MAX_ISSUE_MESSAGE_LENGTH,
    });

    if ('error' in parsedMessage) {
      return next({ status: 400, message: parsedMessage.error });
    }

    // Satisfy typescript here. User is set, we assure you!
    if (!req.user) {
      return next({ status: 500, message: 'User missing from request.' });
    }
    const actorId = req.user.id;

    try {
      const issue = await runAuthorizedUserSecurityMutation(
        actorId,
        actorId,
        [Permission.MANAGE_ISSUES, Permission.CREATE_ISSUES],
        (actor) =>
          issueMutationCoordinator.run(issueId, async (manager) => {
            const transactionRepository = manager.getRepository(Issue);
            const activeIssue = await transactionRepository.findOneOrFail({
              where: { id: issueId },
              relations: { createdBy: true },
              loadEagerRelations: false,
            });

            if (
              activeIssue.createdBy.id !== actor.id &&
              !actor.hasPermission(Permission.MANAGE_ISSUES)
            ) {
              throw Object.assign(new Error('Issue comment forbidden'), {
                status: 403,
              });
            }

            const commentRepository = manager.getRepository(IssueComment);
            const commentCount = await commentRepository.countBy({
              issue: { id: issueId },
            });
            if (commentCount >= MAX_ISSUE_COMMENTS) {
              throw Object.assign(new Error('Issue comment limit reached.'), {
                status: 409,
              });
            }

            const comment = new IssueComment({
              issue: activeIssue,
              message: parsedMessage.value,
              user: actor,
            });
            await commentRepository.save(comment);
            await transactionRepository.update(
              { id: issueId },
              { updatedAt: new Date() }
            );

            return transactionRepository.findOneOrFail({
              where: { id: issueId },
              relations: {
                comments: { user: true },
                createdBy: true,
                modifiedBy: true,
                media: true,
              },
              relationLoadStrategy: 'query',
            });
          })
      );

      return res.status(200).json(filterEntityResponse(issue, req.user));
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError || e.status === 403) {
        return next({
          status: 403,
          message: 'You do not have permission to comment on this issue.',
        });
      }
      if (e.status === 409) {
        return next({ status: 409, message: e.message });
      }
      logger.debug('Something went wrong creating an issue comment.', {
        label: 'API',
        errorMessage: e.message,
      });
      next({ status: 500, message: 'Issue not found.' });
    }
  }
);

issueRoutes.post<{ issueId: string; status: string }, Issue>(
  '/:issueId/:status',
  isAuthenticated([Permission.MANAGE_ISSUES, Permission.CREATE_ISSUES], {
    type: 'or',
  }),
  async (req, res, next) => {
    const issueId = parsePositiveRouteId(req.params.issueId);
    if (!issueId) {
      return next({ status: 404, message: 'Issue not found.' });
    }
    const newStatus = parseIssueStatusAction(req.params.status);
    if (!newStatus) {
      return next({
        status: 400,
        message: 'You must provide a valid status',
      });
    }

    // Satisfy typescript here. User is set, we assure you!
    if (!req.user) {
      return next({ status: 500, message: 'User missing from request.' });
    }

    try {
      const actorId = req.user.id;
      const issue = await runAuthorizedUserSecurityMutation(
        actorId,
        actorId,
        [Permission.MANAGE_ISSUES, Permission.CREATE_ISSUES],
        (actor) =>
          issueMutationCoordinator.run(issueId, async (manager) => {
            const transactionRepository = manager.getRepository(Issue);
            const activeIssue = await transactionRepository.findOneOrFail({
              where: { id: issueId },
              relations: { createdBy: true },
              loadEagerRelations: false,
            });

            if (
              !actor.hasPermission(Permission.MANAGE_ISSUES) &&
              activeIssue.createdBy.id !== actor.id
            ) {
              throw Object.assign(new Error('Issue mutation forbidden'), {
                status: 403,
              });
            }

            activeIssue.status = newStatus;
            activeIssue.modifiedBy = actor;
            await transactionRepository.save(activeIssue);
            return transactionRepository.findOneOrFail({
              where: { id: issueId },
              relations: {
                comments: { user: true },
                createdBy: true,
                modifiedBy: true,
                media: true,
              },
              relationLoadStrategy: 'query',
            });
          })
      );

      return res.status(200).json(filterEntityResponse(issue, req.user));
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError || e.status === 403) {
        return next({
          status: 403,
          message: 'You do not have permission to modify this issue.',
        });
      }
      logger.debug('Something went wrong creating an issue comment.', {
        label: 'API',
        errorMessage: e.message,
      });
      next({ status: 500, message: 'Issue not found.' });
    }
  }
);

issueRoutes.delete(
  '/:issueId',
  isAuthenticated([Permission.MANAGE_ISSUES, Permission.CREATE_ISSUES], {
    type: 'or',
  }),
  async (req, res, next) => {
    const issueId = parsePositiveRouteId(req.params.issueId);
    if (!issueId) {
      return next({ status: 404, message: 'Issue not found.' });
    }

    try {
      const actorId = req.user!.id;
      await runAuthorizedUserSecurityMutation(
        actorId,
        actorId,
        [Permission.MANAGE_ISSUES, Permission.CREATE_ISSUES],
        (actor) =>
          issueMutationCoordinator.run(issueId, async (manager) => {
            const transactionRepository = manager.getRepository(Issue);
            const issue = await transactionRepository.findOneOrFail({
              where: { id: issueId },
              relations: { createdBy: true },
              loadEagerRelations: false,
            });

            if (!actor.hasPermission(Permission.MANAGE_ISSUES)) {
              const commentCount = await manager
                .getRepository(IssueComment)
                .countBy({ issue: { id: issueId } });
              if (issue.createdBy.id !== actor.id || commentCount > 1) {
                throw Object.assign(new Error('Issue deletion forbidden'), {
                  status: 403,
                });
              }
            }

            await transactionRepository.remove(issue);
          })
      );

      return res.status(204).send();
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError || e.status === 403) {
        return next({
          status: 403,
          message: 'You do not have permission to delete this issue.',
        });
      }
      logger.error('Something went wrong deleting an issue.', {
        label: 'API',
        errorMessage: e.message,
      });
      next({ status: 404, message: 'Issue not found.' });
    }
  }
);

export default issueRoutes;
