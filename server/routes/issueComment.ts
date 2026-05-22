import { MAX_ISSUE_MESSAGE_LENGTH } from '@server/constants/issue';
import { getRepository } from '@server/datasource';
import IssueComment from '@server/entity/IssueComment';
import { Permission } from '@server/lib/permissions';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
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
  async (req, res, next) => {
    const issueCommentRepository = getRepository(IssueComment);

    try {
      const commentId = parseIssueCommentId(req.params.commentId);
      if (!commentId) {
        return next({ status: 404, message: 'Issue comment not found.' });
      }

      const comment = await issueCommentRepository.findOneOrFail({
        where: { id: commentId },
      });

      if (
        !req.user?.hasPermission(
          [Permission.MANAGE_ISSUES, Permission.VIEW_ISSUES],
          { type: 'or' }
        ) &&
        comment.user.id !== req.user?.id
      ) {
        return next({
          status: 403,
          message: 'You do not have permission to view this comment.',
        });
      }

      return res.status(200).json(filterEntityResponse(comment));
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

      const comment = await issueCommentRepository.findOneOrFail({
        where: { id: commentId },
      });

      if (comment.user.id !== req.user?.id) {
        return next({
          status: 403,
          message: 'You can only edit your own comments.',
        });
      }

      comment.message = parsedMessage.value;

      await issueCommentRepository.save(comment);

      return res.status(200).json(filterEntityResponse(comment));
    } catch (e) {
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

      const comment = await issueCommentRepository.findOneOrFail({
        where: { id: commentId },
      });

      if (
        !req.user?.hasPermission([Permission.MANAGE_ISSUES], { type: 'or' }) &&
        comment.user.id !== req.user?.id
      ) {
        return next({
          status: 403,
          message: 'You do not have permission to delete this comment.',
        });
      }

      await issueCommentRepository.remove(comment);

      return res.status(204).send();
    } catch (e) {
      logger.debug('Delete request for issue comment failed', {
        label: 'API',
        errorMessage: e.message,
      });
      next({ status: 404, message: 'Issue comment not found.' });
    }
  }
);

export default issueCommentRoutes;
