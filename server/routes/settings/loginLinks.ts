import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import UserLoginLink from '@server/entity/UserLoginLink';
import { Permission } from '@server/lib/permissions';
import { authorizedMutation } from '@server/middleware/authorizedMutation';
import { parsePositiveRouteId } from '@server/utils/routeId';
import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';

export const USER_LOGIN_LINK_TTL_MS = 30 * 60 * 1000;
const maxLoginLinkId = 1_000_000_000;
const routes = Router();

const view = (link: UserLoginLink) => ({
  id: link.id,
  userId: link.userId,
  createdById: link.createdById,
  createdAt: link.createdAt,
  expiresAt: link.expiresAt,
  usedAt: link.usedAt ?? null,
  revokedAt: link.revokedAt ?? null,
  status: link.usedAt
    ? 'used'
    : link.revokedAt
      ? 'revoked'
      : link.expiresAt.getTime() <= Date.now()
        ? 'expired'
        : 'active',
});

routes.get('/', async (req, res) => {
  const userId = parsePositiveRouteId(req.query.userId);
  if (!userId) return res.status(400).json({ message: 'Choose a valid user.' });
  const links = await getRepository(UserLoginLink).find({
    where: { userId },
    order: { createdAt: 'DESC' },
    take: 100,
  });
  return res.status(200).json(links.map(view));
});

routes.post(
  '/',
  authorizedMutation(Permission.ADMIN, async (req, res) => {
    const body = req.body;
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1
    ) {
      return res.status(400).json({ message: 'Choose a valid user.' });
    }
    const userId = (body as Record<string, unknown>).userId;
    if (!parsePositiveRouteId(userId)) {
      return res.status(400).json({ message: 'Choose a valid user.' });
    }
    const targetUserId = parsePositiveRouteId(userId)!;
    const user = await getRepository(User).findOne({
      where: { id: targetUserId },
    });
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + USER_LOGIN_LINK_TTL_MS);
    const link = await getRepository(UserLoginLink).save(
      new UserLoginLink({
        userId: targetUserId,
        user,
        createdById: req.user!.id,
        createdBy: req.user!,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt,
      })
    );
    res.setHeader('Cache-Control', 'no-store');
    return res.status(201).json({ ...view(link), token });
  })
);

routes.post<{ id: string }>(
  '/:id/revoke',
  authorizedMutation(Permission.ADMIN, async (req, res) => {
    const id = parsePositiveRouteId(req.params.id, maxLoginLinkId);
    if (!id) return res.status(404).json({ message: 'Login link not found.' });
    const repository = getRepository(UserLoginLink);
    const link = await repository.findOne({ where: { id } });
    if (!link)
      return res.status(404).json({ message: 'Login link not found.' });
    if (
      link.usedAt ||
      link.revokedAt ||
      link.expiresAt.getTime() <= Date.now()
    ) {
      return res
        .status(409)
        .json({ message: 'This login link is no longer active.' });
    }
    const revokedAt = new Date();
    const result = await repository
      .createQueryBuilder()
      .update(UserLoginLink)
      .set({ revokedAt })
      .where('"id" = :id', { id })
      .andWhere('"usedAt" IS NULL')
      .andWhere('"revokedAt" IS NULL')
      .andWhere('"expiresAt" > :now', { now: revokedAt })
      .execute();
    if (result.affected !== 1) {
      return res
        .status(409)
        .json({ message: 'This login link is no longer active.' });
    }
    return res.status(200).json(view({ ...link, revokedAt }));
  })
);

export default routes;
