import { getRepository } from '@server/datasource';
import OverrideRule from '@server/entity/OverrideRule';
import type { OverrideRuleResultsResponse } from '@server/interfaces/api/overrideRuleInterfaces';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import { runOverrideRuleMutation } from '@server/lib/overrideRuleMutation';
import { Permission } from '@server/lib/permissions';
import { runWithServarrServiceAdmission } from '@server/lib/serviceAdmission';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import {
  authorizedMutation,
  authorizedRouteAccess,
} from '@server/middleware/authorizedMutation';
import { parsePositiveRouteId } from '@server/utils/routeId';
import {
  parseBoundedString,
  parseOptionalNonNegativeInteger,
} from '@server/utils/validation';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';

const overrideRuleRoutes = Router();
const MAX_OVERRIDE_RULE_STRING_LENGTH = 500;
const MAX_OVERRIDE_RULE_ID = 1_000_000_000;
const MAX_OVERRIDE_RULE_LIST_ITEMS = 100;
const overrideRuleBodyFields = new Set<keyof OverrideRuleBody>([
  'users',
  'genre',
  'language',
  'keywords',
  'profileId',
  'rootFolder',
  'tags',
  'radarrServiceId',
  'sonarrServiceId',
  'lidarrServiceId',
]);

type OverrideRuleBody = {
  users?: string | null;
  genre?: string | null;
  language?: string | null;
  keywords?: string | null;
  profileId?: number | null;
  rootFolder?: string | null;
  tags?: string | null;
  radarrServiceId?: number | null;
  sonarrServiceId?: number | null;
  lidarrServiceId?: number | null;
};

type OverrideRulePatch = {
  users?: string | null;
  genre?: string | null;
  language?: string | null;
  keywords?: string | null;
  profileId?: number | null;
  rootFolder?: string | null;
  tags?: string | null;
  radarrServiceId?: number | null;
  sonarrServiceId?: number | null;
  lidarrServiceId?: number | null;
};

type OverrideRuleServiceSelection = Pick<
  OverrideRulePatch,
  'radarrServiceId' | 'sonarrServiceId' | 'lidarrServiceId'
>;

const getOverrideRuleServiceReferences = (
  rules: OverrideRuleServiceSelection[]
) =>
  rules.flatMap((rule) => [
    ...(rule.radarrServiceId != null
      ? [{ serviceType: 'radarr' as const, serviceId: rule.radarrServiceId }]
      : []),
    ...(rule.sonarrServiceId != null
      ? [{ serviceType: 'sonarr' as const, serviceId: rule.sonarrServiceId }]
      : []),
    ...(rule.lidarrServiceId != null
      ? [{ serviceType: 'lidarr' as const, serviceId: rule.lidarrServiceId }]
      : []),
  ]);

const runWithOverrideRuleServiceAdmission = <Result>(
  rules: OverrideRuleServiceSelection[],
  callback: () => Promise<Result>
): Promise<Result> =>
  runWithServarrServiceAdmission(
    getOverrideRuleServiceReferences(rules),
    callback
  );

type OverrideRuleErrorResponse = { status: number; message: string };
type OverrideRuleResponse = OverrideRule | OverrideRuleErrorResponse;
type OverrideRuleRequest<P = Record<string, string>> = Request<
  P,
  OverrideRuleResponse,
  OverrideRuleBody
>;

const parseOverrideRuleRouteId = (id: unknown): number | undefined =>
  parsePositiveRouteId(id, MAX_OVERRIDE_RULE_ID);

const reportOverrideRuleError = (
  action: string,
  error: unknown,
  next: NextFunction
) => {
  logger.error(`Failed to ${action} override rule`, {
    label: 'Override Rule',
    errorMessage: error instanceof Error ? error.message : String(error),
  });
  next({ status: 500, message: 'Unable to process override rules.' });
};

const parseOptionalRuleString = (
  value: unknown,
  fieldName: string
): string | null | undefined | { error: string } => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === '') {
    return null;
  }

  const parsed = parseBoundedString(value, {
    fieldName,
    maxLength: MAX_OVERRIDE_RULE_STRING_LENGTH,
    required: false,
  });

  if ('error' in parsed) {
    return parsed;
  }

  return parsed.value || null;
};

const parseOptionalRuleInteger = (
  value: unknown,
  fieldName: string
): number | null | undefined | { error: string } => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === '') {
    return null;
  }

  const parsed = parseOptionalNonNegativeInteger(value, MAX_OVERRIDE_RULE_ID);
  return parsed === undefined
    ? { error: `${fieldName} must be a valid ID.` }
    : parsed;
};

const parseOptionalRuleIdList = (
  value: unknown,
  fieldName: string,
  options: { allowZero?: boolean } = {}
): string | null | undefined | { error: string } => {
  const parsed = parseOptionalRuleString(value, fieldName);
  if (parsed === undefined || parsed === null || typeof parsed === 'object') {
    return parsed;
  }

  const values = parsed.split(',').map((item) => item.trim());
  const minimum = options.allowZero ? 0 : 1;
  if (
    values.length === 0 ||
    values.length > MAX_OVERRIDE_RULE_LIST_ITEMS ||
    values.some((item) => !/^\d+$/.test(item))
  ) {
    return {
      error: `${fieldName} must contain at most ${MAX_OVERRIDE_RULE_LIST_ITEMS} numeric IDs.`,
    };
  }

  const ids = values.map(Number);
  if (
    ids.some(
      (id) =>
        !Number.isSafeInteger(id) || id < minimum || id > MAX_OVERRIDE_RULE_ID
    )
  ) {
    return { error: `${fieldName} contains an invalid ID.` };
  }

  return [...new Set(ids)].join(',');
};

const parseOptionalRuleLanguageList = (
  value: unknown
): string | null | undefined | { error: string } => {
  const parsed = parseOptionalRuleString(value, 'Language');
  if (parsed === undefined || parsed === null || typeof parsed === 'object') {
    return parsed;
  }

  const languages = parsed.split('|').map((language) => language.trim());
  if (
    languages.length === 0 ||
    languages.length > MAX_OVERRIDE_RULE_LIST_ITEMS ||
    languages.some((language) => !/^[a-z]{2}$/.test(language))
  ) {
    return {
      error: `Language must contain at most ${MAX_OVERRIDE_RULE_LIST_ITEMS} ISO 639-1 codes.`,
    };
  }

  return [...new Set(languages)].join('|');
};

const hasRuleValue = (value: unknown): boolean =>
  typeof value === 'string' ? value.trim().length > 0 : value != null;

const validateOverrideRuleShape = (
  rule: OverrideRulePatch
): { error: string } | undefined => {
  const configuredServices = [
    rule.radarrServiceId,
    rule.sonarrServiceId,
    rule.lidarrServiceId,
  ].filter((serviceId) => serviceId != null);

  if (configuredServices.length !== 1) {
    return { error: 'Override rules must target exactly one service.' };
  }

  const settings = getExternalRuntimeConfig();
  if (
    (rule.radarrServiceId != null &&
      !settings.radarr.some(({ id }) => id === rule.radarrServiceId)) ||
    (rule.sonarrServiceId != null &&
      !settings.sonarr.some(({ id }) => id === rule.sonarrServiceId)) ||
    (rule.lidarrServiceId != null &&
      !settings.lidarr.some(({ id }) => id === rule.lidarrServiceId))
  ) {
    return { error: 'The selected override rule service does not exist.' };
  }

  if (
    ![rule.users, rule.genre, rule.language, rule.keywords].some(hasRuleValue)
  ) {
    return { error: 'Override rules must define at least one condition.' };
  }

  if (![rule.profileId, rule.rootFolder, rule.tags].some(hasRuleValue)) {
    return { error: 'Override rules must define at least one setting.' };
  }

  if (
    rule.lidarrServiceId != null &&
    [rule.genre, rule.language, rule.keywords].some(hasRuleValue)
  ) {
    return {
      error: 'Lidarr override rules support only user conditions.',
    };
  }

  return undefined;
};

const parseOverrideRuleBody = (
  body: unknown
): OverrideRulePatch | { error: string } => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Override rule body must be an object.' };
  }

  const unknownField = Object.keys(body).find(
    (field) => !overrideRuleBodyFields.has(field as keyof OverrideRuleBody)
  );
  if (unknownField) {
    return { error: `Unknown override rule field: ${unknownField}.` };
  }

  const bodyObject = body as Record<keyof OverrideRuleBody, unknown>;

  const users = parseOptionalRuleIdList(bodyObject.users, 'Users');
  if (typeof users === 'object' && users && 'error' in users) return users;
  const genre = parseOptionalRuleIdList(bodyObject.genre, 'Genre');
  if (typeof genre === 'object' && genre && 'error' in genre) return genre;
  const language = parseOptionalRuleLanguageList(bodyObject.language);
  if (typeof language === 'object' && language && 'error' in language) {
    return language;
  }
  const keywords = parseOptionalRuleIdList(bodyObject.keywords, 'Keywords');
  if (typeof keywords === 'object' && keywords && 'error' in keywords) {
    return keywords;
  }
  const rootFolder = parseOptionalRuleString(
    bodyObject.rootFolder,
    'Root folder'
  );
  if (typeof rootFolder === 'object' && rootFolder && 'error' in rootFolder) {
    return rootFolder;
  }
  const tags = parseOptionalRuleIdList(bodyObject.tags, 'Tags', {
    allowZero: true,
  });
  if (typeof tags === 'object' && tags && 'error' in tags) return tags;

  const profileId = parseOptionalRuleInteger(
    bodyObject.profileId,
    'Profile ID'
  );
  if (typeof profileId === 'object' && profileId && 'error' in profileId) {
    return profileId;
  }
  const radarrServiceId = parseOptionalRuleInteger(
    bodyObject.radarrServiceId,
    'Radarr service ID'
  );
  if (
    typeof radarrServiceId === 'object' &&
    radarrServiceId &&
    'error' in radarrServiceId
  ) {
    return radarrServiceId;
  }
  const sonarrServiceId = parseOptionalRuleInteger(
    bodyObject.sonarrServiceId,
    'Sonarr service ID'
  );
  if (
    typeof sonarrServiceId === 'object' &&
    sonarrServiceId &&
    'error' in sonarrServiceId
  ) {
    return sonarrServiceId;
  }
  const lidarrServiceId = parseOptionalRuleInteger(
    bodyObject.lidarrServiceId,
    'Lidarr service ID'
  );
  if (
    typeof lidarrServiceId === 'object' &&
    lidarrServiceId &&
    'error' in lidarrServiceId
  ) {
    return lidarrServiceId;
  }

  const parsedRule: OverrideRulePatch = {
    users,
    genre,
    language,
    keywords,
    profileId,
    rootFolder,
    tags,
    radarrServiceId,
    sonarrServiceId,
    lidarrServiceId,
  };

  return Object.fromEntries(
    Object.entries(parsedRule).filter(([, value]) => value !== undefined)
  ) as OverrideRulePatch;
};

overrideRuleRoutes.get(
  '/',
  isAuthenticated(Permission.ADMIN),
  authorizedRouteAccess(Permission.ADMIN),
  async (req, res, next) => {
    const overrideRuleRepository = getRepository(OverrideRule);

    try {
      const rules = await overrideRuleRepository.find({});

      return res.status(200).json(rules as OverrideRuleResultsResponse);
    } catch (e) {
      reportOverrideRuleError('retrieve', e, next);
    }
  }
);

overrideRuleRoutes.post(
  '/',
  isAuthenticated(Permission.ADMIN),
  authorizedMutation(
    Permission.ADMIN,
    async (
      req: OverrideRuleRequest,
      res: Response<OverrideRuleResponse>,
      next: NextFunction
    ) => {
      const overrideRuleRepository = getRepository(OverrideRule);
      const parsedBody = parseOverrideRuleBody(req.body);
      if ('error' in parsedBody) {
        return res.status(400).json({ status: 400, message: parsedBody.error });
      }

      try {
        return await runWithOverrideRuleServiceAdmission(
          [parsedBody],
          async () => {
            const shapeError = validateOverrideRuleShape(parsedBody);
            if (shapeError) {
              return res
                .status(400)
                .json({ status: 400, message: shapeError.error });
            }

            const rule = new OverrideRule();
            Object.assign(rule, parsedBody);

            const newRule = await overrideRuleRepository.save(rule);

            return res.status(200).json(newRule);
          }
        );
      } catch (e) {
        reportOverrideRuleError('create', e, next);
      }
    }
  )
);

overrideRuleRoutes.put(
  '/:ruleId',
  isAuthenticated(Permission.ADMIN),
  authorizedMutation(
    Permission.ADMIN,
    async (
      req: OverrideRuleRequest<{ ruleId: string }>,
      res: Response<OverrideRuleResponse>,
      next: NextFunction
    ) => {
      const overrideRuleRepository = getRepository(OverrideRule);
      const ruleId = parseOverrideRuleRouteId(req.params.ruleId);
      if (!ruleId) {
        return next({ status: 404, message: 'Override Rule not found.' });
      }

      const parsedBody = parseOverrideRuleBody(req.body);
      if ('error' in parsedBody) {
        return res.status(400).json({ status: 400, message: parsedBody.error });
      }

      try {
        return await runOverrideRuleMutation(ruleId, async () => {
          const rule = await overrideRuleRepository.findOne({
            where: {
              id: ruleId,
            },
          });

          if (!rule) {
            return next({ status: 404, message: 'Override Rule not found.' });
          }

          const updatedRule = { ...rule, ...parsedBody };
          return runWithOverrideRuleServiceAdmission(
            [rule, updatedRule],
            async () => {
              const shapeError = validateOverrideRuleShape(updatedRule);
              if (shapeError) {
                return res
                  .status(400)
                  .json({ status: 400, message: shapeError.error });
              }

              Object.assign(rule, updatedRule);

              const newRule = await overrideRuleRepository.save(rule);

              return res.status(200).json(newRule);
            }
          );
        });
      } catch (e) {
        reportOverrideRuleError('update', e, next);
      }
    }
  )
);

overrideRuleRoutes.delete<
  { ruleId: string },
  OverrideRule | { status: number; message: string }
>(
  '/:ruleId',
  isAuthenticated(Permission.ADMIN),
  authorizedMutation<
    { ruleId: string },
    OverrideRule | { status: number; message: string }
  >(Permission.ADMIN, async (req, res, next) => {
    const overrideRuleRepository = getRepository(OverrideRule);
    const ruleId = parseOverrideRuleRouteId(req.params.ruleId);
    if (!ruleId) {
      return next({ status: 404, message: 'Override Rule not found.' });
    }

    try {
      return await runOverrideRuleMutation(ruleId, async () => {
        const rule = await overrideRuleRepository.findOne({
          where: {
            id: ruleId,
          },
        });

        if (!rule) {
          return next({ status: 404, message: 'Override Rule not found.' });
        }

        return runWithOverrideRuleServiceAdmission([rule], async () => {
          await overrideRuleRepository.remove(rule);

          return res.status(200).json(rule);
        });
      });
    } catch (e) {
      reportOverrideRuleError('delete', e, next);
    }
  })
);

export default overrideRuleRoutes;
