import {
  IssueStatus,
  IssueType,
  MAX_ISSUE_COMMENTS,
  MAX_ISSUE_MESSAGE_LENGTH,
} from '@server/constants/issue';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Issue from '@server/entity/Issue';
import IssueComment from '@server/entity/IssueComment';
import Media from '@server/entity/Media';
import { User } from '@server/entity/User';
import type {
  IssueRequestBody,
  IssueResultsResponse,
} from '@server/interfaces/api/issueInterfaces';
import type { SeasonEpisodeSelection } from '@server/interfaces/api/seasonInterfaces';
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
import { getSearchTerms } from '@server/utils/searchTerms';
import { escapeSqlLikePattern } from '@server/utils/sqlLike';
import {
  parseBoundedString,
  parseOptionalAllowedString,
  parseOptionalNonNegativeInteger,
} from '@server/utils/validation';
import { Router } from 'express';

class IssueUserNotFoundError extends Error {}

const issueRoutes = Router();
const MAX_ISSUE_ROUTE_ID = 1_000_000_000;
const MAX_AFFECTED_EPISODES = 500;
const MAX_AFFECTED_SEASONS = 100;
const issueSortFields = ['added', 'modified', 'status'] as const;
const issueStatusFilters = ['all', 'open', 'resolved'] as const;
const issueTimeFrames = ['7d', '14d', '30d', '6m', 'all'] as const;
const issueMediaTypeFilters = [
  'all',
  MediaType.MOVIE,
  MediaType.TV,
  MediaType.MUSIC,
  MediaType.BOOK,
] as const;
const issueTypeFilters = [
  'all',
  'audio',
  'video',
  'subtitle',
  'other',
] as const;
const issueTypeByFilter = {
  audio: IssueType.AUDIO,
  video: IssueType.VIDEO,
  subtitle: IssueType.SUBTITLES,
  other: IssueType.OTHER,
} as const;

const parseIssueMetadataFilter = (value: unknown, fieldName: string) =>
  parseBoundedString(value ?? '', {
    fieldName,
    maxLength: 128,
    required: false,
  });

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

const parseIssueBodyBoolean = (value: unknown, fieldName: string) => {
  if (value === undefined || value === null) {
    return { value: false };
  }

  return typeof value === 'boolean'
    ? { value }
    : { error: `${fieldName} must be a boolean.` };
};

const parseIssueBodyEpisodeList = (value: unknown) => {
  if (value === undefined || value === null) {
    return { value: [] as number[] };
  }
  if (!Array.isArray(value)) {
    return { error: 'Problem episodes must be an array.' };
  }
  if (value.length > MAX_AFFECTED_EPISODES) {
    return {
      error: `Problem episodes must contain no more than ${MAX_AFFECTED_EPISODES} entries.`,
    };
  }

  const episodes: number[] = [];
  for (const episode of value) {
    const parsed = parseOptionalNonNegativeInteger(episode, MAX_ISSUE_ROUTE_ID);
    if (parsed === undefined || parsed < 1) {
      return { error: 'Problem episodes must contain positive integers.' };
    }
    if (!episodes.includes(parsed)) {
      episodes.push(parsed);
    }
  }

  return { value: episodes.sort((a, b) => a - b) };
};

const parseIssueBodyEpisodeSelections = (
  value: unknown
): { value: SeasonEpisodeSelection[] } | { error: string } => {
  if (value === undefined || value === null) {
    return { value: [] as SeasonEpisodeSelection[] };
  }
  if (!Array.isArray(value)) {
    return { error: 'Problem episode selections must be an array.' };
  }
  if (value.length > MAX_AFFECTED_SEASONS) {
    return {
      error: `Problem episode selections must contain no more than ${MAX_AFFECTED_SEASONS} seasons.`,
    };
  }

  const selections: SeasonEpisodeSelection[] = [];
  let episodeCount = 0;
  for (const selection of value) {
    if (
      !selection ||
      typeof selection !== 'object' ||
      Array.isArray(selection)
    ) {
      return { error: 'Each problem episode selection must be an object.' };
    }
    const rawSelection = selection as Record<string, unknown>;
    const seasonNumber = parseOptionalNonNegativeInteger(
      rawSelection.seasonNumber,
      MAX_ISSUE_ROUTE_ID
    );
    if (seasonNumber === undefined) {
      return { error: 'Affected seasons must be non-negative integers.' };
    }
    if (selections.some((item) => item.seasonNumber === seasonNumber)) {
      return { error: 'Affected seasons must not contain duplicates.' };
    }

    const parsedEpisodes = parseIssueBodyEpisodeList(
      rawSelection.episodeNumbers
    );
    if ('error' in parsedEpisodes) {
      return {
        error:
          parsedEpisodes.error ?? 'Problem episodes must contain valid values.',
      };
    }
    if (
      rawSelection.episodeNumbers !== undefined &&
      parsedEpisodes.value.length === 0
    ) {
      return {
        error: 'An affected partial season must include at least one episode.',
      };
    }
    episodeCount += parsedEpisodes.value.length;
    if (episodeCount > MAX_AFFECTED_EPISODES) {
      return {
        error: `Problem episode selections must contain no more than ${MAX_AFFECTED_EPISODES} episodes.`,
      };
    }

    selections.push({
      seasonNumber,
      ...(rawSelection.episodeNumbers !== undefined
        ? { episodeNumbers: parsedEpisodes.value }
        : {}),
    });
  }

  return {
    value: selections.sort((a, b) => a.seasonNumber - b.seasonNumber),
  };
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

    const parsedDirection = parseOptionalAllowedString(
      req.query.sortDirection,
      {
        fieldName: 'Sort direction',
        allowedValues: ['asc', 'desc'] as const,
        maxLength: 4,
      }
    );
    if ('error' in parsedDirection) {
      return next({ status: 400, message: parsedDirection.error });
    }
    const parsedTimeFrame = parseOptionalAllowedString(req.query.timeFrame, {
      fieldName: 'Time frame',
      allowedValues: issueTimeFrames,
      maxLength: 8,
    });
    if ('error' in parsedTimeFrame) {
      return next({ status: 400, message: parsedTimeFrame.error });
    }
    const parsedMediaType = parseOptionalAllowedString(req.query.mediaType, {
      fieldName: 'Media type',
      allowedValues: issueMediaTypeFilters,
      maxLength: 16,
    });
    if ('error' in parsedMediaType) {
      return next({ status: 400, message: parsedMediaType.error });
    }
    const parsedIssueType = parseOptionalAllowedString(req.query.issueType, {
      fieldName: 'Issue type',
      allowedValues: issueTypeFilters,
      maxLength: 16,
    });
    if ('error' in parsedIssueType) {
      return next({ status: 400, message: parsedIssueType.error });
    }
    const parsedReleaseYear = parseIssueMetadataFilter(
      req.query.releaseYear,
      'Release year'
    );
    if ('error' in parsedReleaseYear) {
      return next({ status: 400, message: parsedReleaseYear.error });
    }
    if (
      parsedReleaseYear.value &&
      parsedReleaseYear.value !== 'before-1970' &&
      !/^\d{4}$/.test(parsedReleaseYear.value)
    ) {
      return next({
        status: 400,
        message: 'Release year must be a four-digit year or before-1970.',
      });
    }
    const parsedGenre = parseIssueMetadataFilter(req.query.genre, 'Genre');
    if ('error' in parsedGenre) {
      return next({ status: 400, message: parsedGenre.error });
    }
    const parsedStudio = parseIssueMetadataFilter(req.query.studio, 'Studio');
    if ('error' in parsedStudio) {
      return next({ status: 400, message: parsedStudio.error });
    }
    const parsedNetwork = parseIssueMetadataFilter(
      req.query.network,
      'Network'
    );
    if ('error' in parsedNetwork) {
      return next({ status: 400, message: parsedNetwork.error });
    }
    const parsedAlbumType = parseIssueMetadataFilter(
      req.query.albumType,
      'Album type'
    );
    if ('error' in parsedAlbumType) {
      return next({ status: 400, message: parsedAlbumType.error });
    }
    const parsedSearch = parseBoundedString(req.query.search ?? '', {
      fieldName: 'Search',
      maxLength: 512,
      required: false,
    });
    if ('error' in parsedSearch) {
      return next({ status: 400, message: parsedSearch.error });
    }

    let sortFilter: string;

    switch (parsedSort.value) {
      case 'modified':
        sortFilter = 'issue.updatedAt';
        break;
      case 'status':
        sortFilter = 'issue.status';
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
      .leftJoin('media.searchMetadata', 'searchMetadata')
      .leftJoin('issue.comments', 'searchComments')
      .where('1 = 1')
      .distinct(true);

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

    if (parsedMediaType.value && parsedMediaType.value !== 'all') {
      query = query.andWhere('media.mediaType = :issueMediaType', {
        issueMediaType: parsedMediaType.value,
      });
    }
    if (parsedIssueType.value && parsedIssueType.value !== 'all') {
      query = query.andWhere('issue.issueType = :selectedIssueType', {
        selectedIssueType: issueTypeByFilter[parsedIssueType.value],
      });
    }

    if (parsedMediaType.value && parsedMediaType.value !== 'all') {
      if (parsedReleaseYear.value === 'before-1970') {
        query = query.andWhere(
          "COALESCE(searchMetadata.releaseDate, '') <> '' AND searchMetadata.releaseDate < :issueReleaseCutoff",
          { issueReleaseCutoff: '1970' }
        );
      } else if (parsedReleaseYear.value) {
        query = query.andWhere(
          "COALESCE(searchMetadata.releaseDate, '') LIKE :issueReleaseYear ESCAPE '\\'",
          { issueReleaseYear: `${parsedReleaseYear.value}%` }
        );
      }
      if (parsedGenre.value) {
        query = query.andWhere(
          "LOWER(COALESCE(searchMetadata.genres, '')) LIKE :issueGenre ESCAPE '\\'",
          {
            issueGenre: `%${escapeSqlLikePattern(parsedGenre.value.toLocaleLowerCase())}%`,
          }
        );
      }
      if (parsedMediaType.value === MediaType.MOVIE && parsedStudio.value) {
        query = query.andWhere(
          "LOWER(COALESCE(searchMetadata.studio, '')) LIKE :issueStudio ESCAPE '\\'",
          {
            issueStudio: `%${escapeSqlLikePattern(parsedStudio.value.toLocaleLowerCase())}%`,
          }
        );
      }
      if (parsedMediaType.value === MediaType.TV && parsedNetwork.value) {
        query = query.andWhere(
          "LOWER(COALESCE(searchMetadata.network, '')) LIKE :issueNetwork ESCAPE '\\'",
          {
            issueNetwork: `%${escapeSqlLikePattern(parsedNetwork.value.toLocaleLowerCase())}%`,
          }
        );
      }
      if (parsedMediaType.value === MediaType.MUSIC && parsedAlbumType.value) {
        query = query.andWhere(
          "LOWER(COALESCE(searchMetadata.albumType, '')) LIKE :issueAlbumType ESCAPE '\\'",
          {
            issueAlbumType: `%${escapeSqlLikePattern(parsedAlbumType.value.toLocaleLowerCase())}%`,
          }
        );
      }
    }

    const now = Date.now();
    const timeFrameMs =
      parsedTimeFrame.value === '7d'
        ? 7 * 24 * 60 * 60 * 1000
        : parsedTimeFrame.value === '14d'
          ? 14 * 24 * 60 * 60 * 1000
          : parsedTimeFrame.value === '30d'
            ? 30 * 24 * 60 * 60 * 1000
            : parsedTimeFrame.value === '6m'
              ? 183 * 24 * 60 * 60 * 1000
              : undefined;
    if (timeFrameMs) {
      query = query.andWhere('issue.createdAt >= :issueSince', {
        issueSince: new Date(now - timeFrameMs),
      });
    }

    for (const [termIndex, term] of getSearchTerms(
      parsedSearch.value
    ).entries()) {
      const searchParameter = `issueSearch${termIndex}`;
      const searchOpenParameter = `searchOpen${termIndex}`;
      const searchResolvedParameter = `searchResolved${termIndex}`;
      query = query.andWhere(
        `(LOWER(COALESCE(searchMetadata.searchText, '')) LIKE :${searchParameter} ESCAPE '\\'
          OR LOWER(COALESCE(createdBy.username, '')) LIKE :${searchParameter} ESCAPE '\\'
          OR LOWER(COALESCE(createdBy.plexUsername, '')) LIKE :${searchParameter} ESCAPE '\\'
          OR LOWER(COALESCE(createdBy.jellyfinUsername, '')) LIKE :${searchParameter} ESCAPE '\\'
          OR LOWER(COALESCE(createdBy.email, '')) LIKE :${searchParameter} ESCAPE '\\'
          OR LOWER(COALESCE(searchComments.message, '')) LIKE :${searchParameter} ESCAPE '\\'
          OR (:${searchOpenParameter} = 1 AND issue.status = :openStatus)
          OR (:${searchResolvedParameter} = 1 AND issue.status = :resolvedStatus))`,
        {
          [searchParameter]: `%${escapeSqlLikePattern(term)}%`,
          [searchOpenParameter]: term === 'open' ? 1 : 0,
          [searchResolvedParameter]: term === 'resolved' ? 1 : 0,
          openStatus: IssueStatus.OPEN,
          resolvedStatus: IssueStatus.RESOLVED,
        }
      );
    }

    const rawCounts = await query
      .clone()
      .select('issue.status', 'status')
      .addSelect('COUNT(DISTINCT issue.id)', 'count')
      .groupBy('issue.status')
      .getRawMany<{ status: string; count: string }>();
    const countFor = (status: IssueStatus) =>
      Number(
        rawCounts.find((row) => Number(row.status) === status)?.count ?? 0
      );

    query = query.andWhere('issue.status IN (:...issueStatus)', {
      issueStatus: statusFilter,
    });

    const [issueRows, issueCount] = await query
      .orderBy(sortFilter, parsedDirection.value === 'asc' ? 'ASC' : 'DESC')
      .addOrderBy('issue.id', parsedDirection.value === 'asc' ? 'ASC' : 'DESC')
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
      counts: {
        all: countFor(IssueStatus.OPEN) + countFor(IssueStatus.RESOLVED),
        open: countFor(IssueStatus.OPEN),
        resolved: countFor(IssueStatus.RESOLVED),
      },
    });
  }
);

issueRoutes.post<Record<string, string>, Issue, IssueRequestBody>(
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
    const userRepository = getRepository(User);
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
    const problemEpisodes = parseIssueBodyEpisodeList(body.problemEpisodes);
    if ('error' in problemEpisodes) {
      return next({ status: 400, message: problemEpisodes.error });
    }
    const problemEpisodeSelections = parseIssueBodyEpisodeSelections(
      body.problemEpisodeSelections
    );
    if ('error' in problemEpisodeSelections) {
      return next({ status: 400, message: problemEpisodeSelections.error });
    }
    const is4k = parseIssueBodyBoolean(body.is4k, 'Issue quality');
    if ('error' in is4k) {
      return next({ status: 400, message: is4k.error });
    }
    const onBehalfOfUserId = parseOptionalPositiveInt(body.userId) ?? null;

    const media = await mediaRepository.findOne({
      where: { id: mediaId.value },
    });

    if (!media) {
      return next({ status: 404, message: 'Media does not exist.' });
    }

    if (
      (problemEpisodes.value.length > 0 ||
        problemEpisodeSelections.value.length > 0) &&
      media.mediaType !== MediaType.TV
    ) {
      return next({
        status: 400,
        message:
          'Problem episodes require a series issue and an affected season.',
      });
    }

    try {
      const newIssue = await runAuthorizedUserSecurityMutation(
        req.user.id,
        onBehalfOfUserId && onBehalfOfUserId !== req.user.id
          ? [req.user.id, onBehalfOfUserId]
          : req.user.id,
        [Permission.MANAGE_ISSUES, Permission.CREATE_ISSUES],
        async (actor) => {
          let createdBy = actor;

          if (onBehalfOfUserId && onBehalfOfUserId !== actor.id) {
            if (!actor.hasPermission(Permission.MANAGE_ISSUES)) {
              throw new UserMutationActorUnauthorizedError(
                'You do not have permission to create an issue on behalf of another user.'
              );
            }

            const targetUser = await userRepository.findOne({
              where: { id: onBehalfOfUserId },
            });

            if (!targetUser) {
              throw new IssueUserNotFoundError('Issue user not found');
            }

            createdBy = targetUser;
          }

          return issueRepository.save(
            new Issue({
              createdBy,
              issueType: issueType.value,
              problemSeason:
                problemEpisodeSelections.value[0]?.seasonNumber ??
                problemSeason.value,
              problemEpisode:
                problemEpisodeSelections.value[0]?.episodeNumbers?.[0] ??
                problemEpisodes.value[0] ??
                problemEpisode.value,
              problemEpisodes:
                problemEpisodes.value.length > 0
                  ? problemEpisodes.value
                  : problemEpisodeSelections.value[0]?.episodeNumbers,
              problemEpisodeSelections:
                problemEpisodeSelections.value.length > 0
                  ? problemEpisodeSelections.value
                  : undefined,
              is4k:
                media.mediaType === MediaType.MOVIE ||
                media.mediaType === MediaType.TV
                  ? is4k.value
                  : false,
              media,
              comments: [
                new IssueComment({
                  user: createdBy,
                  message: parsedMessage.value,
                }),
              ],
            })
          );
        }
      );

      return res.status(200).json(filterEntityResponse(newIssue, req.user));
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError) {
        return next({
          status: 403,
          message:
            e.message || 'You no longer have permission to create issues.',
        });
      }
      if (e instanceof IssueUserNotFoundError) {
        return next({ status: 404, message: e.message });
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
