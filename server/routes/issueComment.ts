import { MAX_ISSUE_MESSAGE_LENGTH } from '@server/constants/issue';
import { getRepository } from '@server/datasource';
import IssueComment from '@server/entity/IssueComment';
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
import { parsePositiveRouteId } from '@server/utils/routeId';
import { parseBoundedString } from '@server/utils/validation';
import { Router } from 'express';

const issueCommentRoutes = Router();
const maxIssueCommentId = 1_000_000_000;

const parseIssueCommentId = (id: unknown): number | undefined =>
  parsePositiveRouteId(id, maxIssueCommentId);

const parseIssueCommentBodyObject = (
  body: unknown
): { value: Record<string, unknown> } | { error: string } => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Issue comment body must be an object.' };
  }

  return { value: body as Record<string, unknown> };
};

issueCommentRoutes.get<{ commentId: string }, IssueComment>(
  '/:commentId',
  isAuthenticated(
    [
      Permission.MANAGE_ISSUES,
      Permission.VIEW_ISSUES,
      Permission.CREATE_ISSUES,
    ],
    {
      type: 'or',
    }
  ),
  authorizedRouteAccess([
    Permission.MANAGE_ISSUES,
    Permission.VIEW_ISSUES,
    Permission.CREATE_ISSUES,
  ]),
  async (req, res, next) => {
    const issueCommentRepository = getRepository(IssueComment);

    try {
      const commentId = parseIssueCommentId(req.params.commentId);
      if (!commentId) {
        return next({ status: 404, message: 'Issue comment not found.' });
      }

      const comment = await issueCommentRepository.findOneOrFail({
        where: { id: commentId },
        relations: { issue: { createdBy: true } },
      });

      if (
        !req.user?.hasPermission(
          [Permission.MANAGE_ISSUES, Permission.VIEW_ISSUES],
          { type: 'or' }
        ) &&
        comment.issue.createdBy.id !== req.user?.id
      ) {
        return next({
          status: 403,
          message: 'You do not have permission to view this comment.',
        });
      }

      // The issue relation is loaded only to enforce ownership and is not part
      // of the direct comment response contract.
      delete (comment as Partial<IssueComment>).issue;

      return res.status(200).json(filterEntityResponse(comment, req.user));
    } catch (e) {
      logger.debug('Request for unknown issue comment failed', {
        label: 'API',
        errorMessage: e.message,
      });
      next({ status: 404, message: 'Issue comment not found.' });
    }
  }
);

issueCommentRoutes.put<
  { commentId: string },
  IssueComment,
  { message: string }
>(
  '/:commentId',
  isAuthenticated([Permission.MANAGE_ISSUES, Permission.CREATE_ISSUES], {
    type: 'or',
  }),
  async (req, res, next) => {
    const issueCommentRepository = getRepository(IssueComment);
    const parsedBody = parseIssueCommentBodyObject(req.body);
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

    try {
      const commentId = parseIssueCommentId(req.params.commentId);
      if (!commentId) {
        return next({ status: 404, message: 'Issue comment not found.' });
      }

      const locatedComment = await issueCommentRepository.findOneOrFail({
        where: { id: commentId },
        relations: { issue: true },
      });
      const actorId = req.user!.id;
      const comment = await runAuthorizedUserSecurityMutation(
        actorId,
        actorId,
        [Permission.MANAGE_ISSUES, Permission.CREATE_ISSUES],
        (actor) =>
          issueMutationCoordinator.run(
            locatedComment.issue.id,
            async (manager) => {
              const transactionRepository = manager.getRepository(IssueComment);
              const activeComment = await transactionRepository.findOneOrFail({
                where: { id: commentId },
                relations: { issue: true },
              });

              if (activeComment.user.id !== actor.id) {
                throw Object.assign(new Error('Issue comment edit forbidden'), {
                  status: 403,
                });
              }

              activeComment.message = parsedMessage.value;
              return transactionRepository.save(activeComment);
            }
          )
      );

      delete (comment as Partial<IssueComment>).issue;
      return res.status(200).json(filterEntityResponse(comment, req.user));
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError || e.status === 403) {
        return next({
          status: 403,
          message: 'You can only edit your own comments.',
        });
      }
      logger.debug('Put request for issue comment failed', {
        label: 'API',
        errorMessage: e.message,
      });
      next({ status: 404, message: 'Issue comment not found.' });
    }
  }
);

issueCommentRoutes.delete<{ commentId: string }, IssueComment>(
  '/:commentId',
  isAuthenticated([Permission.MANAGE_ISSUES, Permission.CREATE_ISSUES], {
    type: 'or',
  }),
  async (req, res, next) => {
    const issueCommentRepository = getRepository(IssueComment);

    try {
      const commentId = parseIssueCommentId(req.params.commentId);
      if (!commentId) {
        return next({ status: 404, message: 'Issue comment not found.' });
      }

      const locatedComment = await issueCommentRepository.findOneOrFail({
        where: { id: commentId },
        relations: { issue: true },
      });
      const actorId = req.user!.id;
      await runAuthorizedUserSecurityMutation(
        actorId,
        actorId,
        [Permission.MANAGE_ISSUES, Permission.CREATE_ISSUES],
        (actor) =>
          issueMutationCoordinator.run(
            locatedComment.issue.id,
            async (manager) => {
              const transactionRepository = manager.getRepository(IssueComment);
              const activeComment = await transactionRepository.findOneOrFail({
                where: { id: commentId },
                relations: { issue: true },
              });

              if (
                !actor.hasPermission(Permission.MANAGE_ISSUES) &&
                activeComment.user.id !== actor.id
              ) {
                throw Object.assign(
                  new Error('Issue comment deletion forbidden'),
                  { status: 403 }
                );
              }

              await transactionRepository.remove(activeComment);
            }
          )
      );

      return res.status(204).send();
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError || e.status === 403) {
        return next({
          status: 403,
          message: 'You do not have permission to delete this comment.',
        });
      }
      logger.debug('Delete request for issue comment failed', {
        label: 'API',
        errorMessage: e.message,
      });
      next({ status: 404, message: 'Issue comment not found.' });
    }
  }
);

export default issueCommentRoutes;
