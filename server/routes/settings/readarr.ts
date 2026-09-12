import type { ReadarrBookLookupResult } from '@server/api/servarr/readarr';
import ReadarrAPI from '@server/api/servarr/readarr';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import { Permission } from '@server/lib/permissions';
import { runWithServarrServiceCollectionMutationAdmission } from '@server/lib/serviceAdmission';
import {
  allocateServarrServiceId,
  assertServarrServiceCanBeRemoved,
  assertServarrServiceCanChangeKind,
  getHistoricalServarrServiceIdMaximum,
} from '@server/lib/serviceId';
import type { ReadarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { authorizedMutation } from '@server/middleware/authorizedMutation';
import {
  classifyBookshelfProvider,
  getBookshelfProviderWarning,
} from '@server/utils/bookshelfProvider';
import { mapWithConcurrency } from '@server/utils/concurrency';
import { parseNonNegativeRouteId } from '@server/utils/routeId';
import { REDACTED_SECRET, redactSecrets } from '@server/utils/security';
import {
  assertServarrInstanceCapacity,
  parseReadarrSettings,
  parseServarrConnectionSettings,
  preserveServarrApiKey,
  preserveServarrConnectionSecret,
  type ServarrConnectionSettings,
} from '@server/utils/servarrSettings';
import {
  parseOptionalBodyBoolean,
  parseOptionalBoundedString,
  parseOptionalNonNegativeInteger,
} from '@server/utils/validation';
import { Router } from 'express';

const readarrRoutes = Router();
const MAX_DIAGNOSTIC_TERM_LENGTH = 512;
const MAX_DIAGNOSTIC_PATH_LENGTH = 4096;
const MAX_DIAGNOSTIC_PROFILE_ID = 1_000_000;
export const MAX_DIAGNOSTIC_LOOKUP_RESULTS = 50;
export const DIAGNOSTIC_LOOKUP_HYDRATION_CONCURRENCY = 5;
type DiagnosticAuthor = NonNullable<ReadarrBookLookupResult['author']>;

const parseOptionalDiagnosticId = (
  value: unknown,
  fieldName: string
): { value: number | undefined } | { error: string } => {
  if (value === undefined || value === null || value === '') {
    return { value: undefined };
  }

  const numericValue =
    typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value)
      : value;
  const parsed = parseOptionalNonNegativeInteger(
    numericValue,
    MAX_DIAGNOSTIC_PROFILE_ID
  );

  return parsed === undefined
    ? { error: `${fieldName} is invalid.` }
    : { value: parsed };
};

const isAddableBookLookupResult = (result: ReadarrBookLookupResult): boolean =>
  !!(
    result.foreignBookId &&
    result.title &&
    result.author?.foreignAuthorId &&
    Array.isArray(result.editions) &&
    result.editions.length > 0
  );

const parseAuthorName = (
  result: ReadarrBookLookupResult
): string | undefined => {
  const authorTitle = result.authorTitle?.trim();

  if (!authorTitle) {
    return undefined;
  }

  const titleIndex = authorTitle
    .toLocaleLowerCase()
    .lastIndexOf(result.title.toLocaleLowerCase());
  const rawAuthorName =
    titleIndex > 0 ? authorTitle.slice(0, titleIndex).trim() : authorTitle;
  const [lastName, ...firstNameParts] = rawAuthorName
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (!lastName) {
    return undefined;
  }

  return firstNameParts.length
    ? `${firstNameParts.join(' ')} ${lastName}`
    : lastName;
};

const hydrateSoftcoverResult = async (
  readarr: ReadarrAPI,
  result: ReadarrBookLookupResult,
  loadAuthor: (
    authorName: string
  ) => Promise<DiagnosticAuthor | undefined> = async (authorName) => {
    const [author] = await readarr.lookupAuthor(authorName);
    return author?.foreignAuthorId && author.authorName
      ? {
          foreignAuthorId: author.foreignAuthorId,
          authorName: author.authorName,
          id: author.id,
        }
      : undefined;
  }
): Promise<ReadarrBookLookupResult> => {
  if (isAddableBookLookupResult(result)) {
    return result;
  }

  if (result.author || !result.foreignEditionId) {
    return result;
  }

  const authorName = parseAuthorName(result);

  if (!authorName) {
    return result;
  }

  const author = await loadAuthor(authorName);
  if (!author) {
    return result;
  }

  return {
    ...result,
    author: {
      foreignAuthorId: author.foreignAuthorId,
      authorName: author.authorName,
    },
    editions: [
      {
        foreignEditionId: result.foreignEditionId,
        title: result.title,
        monitored: true,
      },
    ],
  };
};

readarrRoutes.get('/', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(redactSecrets(settings.readarr));
});

readarrRoutes.post(
  '/',
  authorizedMutation(Permission.ADMIN, async (req, res) => {
    const settings = getSettings();

    const parsedReadarr = parseReadarrSettings(req.body);

    if ('error' in parsedReadarr) {
      return res.status(400).json({ message: parsedReadarr.error });
    }

    return runWithServarrServiceCollectionMutationAdmission(
      'readarr',
      async () => {
        const historicalServiceIdMaximum =
          await getHistoricalServarrServiceIdMaximum('readarr');
        const readarr = await settings.persistSection('readarr', (current) => {
          assertServarrInstanceCapacity(current);
          const newReadarr = {
            ...parsedReadarr.value,
            id: allocateServarrServiceId(
              current.map(({ id }) => id),
              historicalServiceIdMaximum
            ),
          };
          const serviceType = newReadarr.serviceType ?? 'ebook';
          const existing = newReadarr.isDefault
            ? current.map((instance) => ({
                ...instance,
                isDefault:
                  (instance.serviceType ?? 'ebook') === serviceType
                    ? false
                    : instance.isDefault,
              }))
            : current;
          return [...existing, newReadarr];
        });
        const newReadarr = readarr[readarr.length - 1];

        return res.status(201).json(redactSecrets(newReadarr));
      }
    );
  })
);

readarrRoutes.post<
  undefined,
  Record<string, unknown>,
  ServarrConnectionSettings
>(
  '/test',
  authorizedMutation<
    undefined,
    Record<string, unknown>,
    ServarrConnectionSettings
  >(Permission.ADMIN, async (req, res, next) => {
    try {
      const parsedReadarr = parseServarrConnectionSettings(
        preserveServarrConnectionSecret(
          req.body,
          getExternalRuntimeConfig().readarr
        )
      );

      if ('error' in parsedReadarr) {
        return res.status(400).json({ message: parsedReadarr.error });
      }

      const readarr = new ReadarrAPI({
        apiKey: parsedReadarr.value.apiKey,
        url: ReadarrAPI.buildUrl(parsedReadarr.value, '/api/v1'),
        mediaType: parsedReadarr.value.serviceType ?? 'ebook',
      });

      const [urlBase, development] = await Promise.all([
        readarr
          .getSystemStatus()
          .then((value) => value.urlBase)
          .catch(() => parsedReadarr.value.baseUrl),
        readarr.getDevelopmentConfig().catch(() => undefined),
      ]);
      const profiles = await readarr.getProfiles();
      const metadataProfiles = await readarr.getMetadataProfiles();
      const folders = await readarr.getRootFolders();
      const provider = classifyBookshelfProvider(development?.metadataSource);

      return res.status(200).json({
        profiles,
        metadataProfiles,
        rootFolders: folders.map((folder) => ({
          id: folder.id,
          path: folder.path,
        })),
        tags: [],
        urlBase,
        provider,
        legacyWarning: getBookshelfProviderWarning(provider),
        metadataSource: development?.metadataSource,
      });
    } catch (e) {
      logger.error('Failed to test Readarr', {
        label: 'Readarr',
        message: e.message,
      });
      next({ status: 500, message: 'Failed to connect to Bookshelf' });
    }
  })
);

readarrRoutes.post<
  undefined,
  Record<string, unknown>,
  Partial<ReadarrSettings> & {
    term?: unknown;
    testAdd?: unknown;
  }
>(
  '/diagnose',
  authorizedMutation<
    undefined,
    Record<string, unknown>,
    Partial<ReadarrSettings> & { term?: unknown; testAdd?: unknown }
  >(Permission.ADMIN, async (req, res) => {
    const parsedReadarr = parseServarrConnectionSettings(
      preserveServarrConnectionSecret(
        req.body,
        getExternalRuntimeConfig().readarr
      )
    );

    if ('error' in parsedReadarr) {
      return res.status(400).json({
        ok: false,
        category: 'backend_unreachable',
        message: parsedReadarr.error,
      });
    }

    const term = parseOptionalBoundedString(req.body.term, {
      fieldName: 'term',
      maxLength: MAX_DIAGNOSTIC_TERM_LENGTH,
    });
    const testAdd = parseOptionalBodyBoolean(req.body.testAdd, 'testAdd');
    const activeDirectory = parseOptionalBoundedString(
      req.body.activeDirectory,
      {
        fieldName: 'activeDirectory',
        maxLength: MAX_DIAGNOSTIC_PATH_LENGTH,
      }
    );
    const activeProfileId = parseOptionalDiagnosticId(
      req.body.activeProfileId,
      'activeProfileId'
    );
    const activeMetadataProfileId = parseOptionalDiagnosticId(
      req.body.activeMetadataProfileId,
      'activeMetadataProfileId'
    );
    if (
      'error' in term ||
      'error' in testAdd ||
      'error' in activeDirectory ||
      'error' in activeProfileId ||
      'error' in activeMetadataProfileId
    ) {
      const message =
        ('error' in term && term.error) ||
        ('error' in testAdd && testAdd.error) ||
        ('error' in activeDirectory && activeDirectory.error) ||
        ('error' in activeProfileId && activeProfileId.error) ||
        ('error' in activeMetadataProfileId && activeMetadataProfileId.error) ||
        'Invalid diagnostic request.';
      return res.status(400).json({
        ok: false,
        category: 'invalid_request',
        message,
      });
    }

    const lookupTerm = term.value || 'isbn:9780547928227';
    const readarr = new ReadarrAPI({
      apiKey: parsedReadarr.value.apiKey,
      url: ReadarrAPI.buildUrl(parsedReadarr.value, '/api/v1'),
      mediaType: parsedReadarr.value.serviceType ?? 'ebook',
    });

    try {
      const [status, development, profiles, metadataProfiles, folders] =
        await Promise.all([
          readarr.getSystemStatus(),
          readarr.getDevelopmentConfig().catch(() => undefined),
          readarr.getProfiles(),
          readarr.getMetadataProfiles(),
          readarr.getRootFolders(),
        ]);
      const provider = classifyBookshelfProvider(development?.metadataSource);
      const legacyWarning = getBookshelfProviderWarning(provider);
      const lookup = await readarr.lookupBook(lookupTerm);

      if (!lookup.length) {
        return res.status(200).json({
          ok: false,
          category: 'lookup_empty',
          message: 'Bookshelf lookup returned no results.',
          term: lookupTerm,
          system: {
            appName: status.appName,
            version: status.version,
            urlBase: status.urlBase,
          },
          provider,
          legacyWarning,
          metadataSource: development?.metadataSource,
          profiles: profiles.map((profile) => ({
            id: profile.id,
            name: profile.name,
          })),
          metadataProfiles: metadataProfiles.map((profile) => ({
            id: profile.id,
            name: profile.name,
          })),
          rootFolders: folders.map((folder) => ({
            id: folder.id,
            path: folder.path,
            accessible: folder.accessible,
          })),
          lookupCount: 0,
        });
      }

      const authorCache = new Map<
        string,
        Promise<DiagnosticAuthor | undefined>
      >();
      const loadAuthor = (authorName: string) => {
        let pending = authorCache.get(authorName);
        if (!pending) {
          pending = readarr.lookupAuthor(authorName).then(([author]) =>
            author?.foreignAuthorId && author.authorName
              ? {
                  foreignAuthorId: author.foreignAuthorId,
                  authorName: author.authorName,
                  id: author.id,
                }
              : undefined
          );
          authorCache.set(authorName, pending);
        }
        return pending;
      };
      const hydratedLookup = await mapWithConcurrency(
        lookup.slice(0, MAX_DIAGNOSTIC_LOOKUP_RESULTS),
        DIAGNOSTIC_LOOKUP_HYDRATION_CONCURRENCY,
        (result) => hydrateSoftcoverResult(readarr, result, loadAuthor)
      );
      const addableResult = hydratedLookup.find(isAddableBookLookupResult);

      if (!addableResult) {
        return res.status(200).json({
          ok: false,
          category: 'lookup_incomplete',
          message:
            'Bookshelf lookup returned results, but none had usable author and edition metadata.',
          term: lookupTerm,
          provider,
          legacyWarning,
          metadataSource: development?.metadataSource,
          lookupCount: lookup.length,
          sample: lookup.slice(0, 3).map((result) => ({
            title: result.title,
            foreignBookId: result.foreignBookId,
            foreignEditionId: result.foreignEditionId,
            authorPresent: !!result.author,
            editionCount: result.editions?.length ?? 0,
          })),
        });
      }

      if (testAdd.value === true) {
        try {
          const requestedRootFolder = activeDirectory.value;
          const rootFolder = requestedRootFolder || folders[0]?.path;
          const qualityProfileId = activeProfileId.value ?? profiles[0]?.id;
          const metadataProfileId =
            activeMetadataProfileId.value ?? metadataProfiles[0]?.id;

          if (
            !rootFolder ||
            !folders.some(
              (folder) =>
                folder.path === rootFolder && folder.accessible !== false
            ) ||
            qualityProfileId === undefined ||
            !profiles.some((profile) => profile.id === qualityProfileId) ||
            metadataProfileId === undefined ||
            !metadataProfiles.some(
              (profile) => profile.id === metadataProfileId
            )
          ) {
            return res.status(400).json({
              ok: false,
              category: 'invalid_request',
              message:
                'Test add selections must match accessible Bookshelf profiles and root folders.',
            });
          }

          const added = await readarr.addBook({
            ...addableResult,
            monitored: true,
            qualityProfileId,
            metadataProfileId,
            rootFolderPath: rootFolder,
            tags: [],
            author: {
              ...addableResult.author,
              rootFolderPath: rootFolder,
              qualityProfileId,
              metadataProfileId,
              monitored: true,
              addOptions: {
                monitor: 'none',
                searchForMissingBooks: false,
              },
              manualAdd: true,
            },
            editions: addableResult.editions ?? [],
            addOptions: {
              searchForNewBook: false,
            },
          });

          if (added.id !== undefined && added.id !== null) {
            try {
              await readarr.removeBook(added.id, {
                deleteFiles: false,
                addImportListExclusion: false,
              });
            } catch (cleanupError) {
              return res.status(200).json({
                ok: false,
                category: 'backend_cleanup_failed',
                message:
                  cleanupError instanceof Error
                    ? cleanupError.message
                    : String(cleanupError),
                term: lookupTerm,
                provider,
                legacyWarning,
                lookupCount: lookup.length,
                addedBookId: added.id,
              });
            }
          }
        } catch (e) {
          return res.status(200).json({
            ok: false,
            category: 'backend_add_rejected',
            message: e instanceof Error ? e.message : String(e),
            term: lookupTerm,
            provider,
            legacyWarning,
            lookupCount: lookup.length,
          });
        }
      }

      return res.status(200).json({
        ok: true,
        category: 'ok',
        message: 'Bookshelf lookup returned usable metadata.',
        term: lookupTerm,
        provider,
        legacyWarning,
        metadataSource: development?.metadataSource,
        lookupCount: lookup.length,
        sample: {
          title: addableResult.title,
          foreignBookId: addableResult.foreignBookId,
          authorName: addableResult.author?.authorName,
          editionCount: addableResult.editions?.length ?? 0,
        },
      });
    } catch (e) {
      logger.error('Failed to diagnose Bookshelf', {
        label: 'Readarr',
        message: e instanceof Error ? e.message : String(e),
      });

      return res.status(200).json({
        ok: false,
        category: 'backend_unreachable',
        message: e instanceof Error ? e.message : String(e),
        term: lookupTerm,
      });
    }
  })
);

readarrRoutes.put<{ id: string }, ReadarrSettings, ReadarrSettings>(
  '/:id',
  authorizedMutation<{ id: string }, ReadarrSettings, ReadarrSettings>(
    Permission.ADMIN,
    async (req, res, next) => {
      const settings = getSettings();
      const readarrId = parseNonNegativeRouteId(req.params.id);
      if (readarrId === undefined) {
        return next({ status: 404, message: 'Settings instance not found' });
      }

      const readarrIndex = settings.readarr.findIndex(
        (r) => r.id === readarrId
      );

      if (readarrIndex === -1) {
        return next({ status: 404, message: 'Settings instance not found' });
      }

      return runWithServarrServiceCollectionMutationAdmission(
        'readarr',
        async () => {
          const currentReadarr = settings.readarr.find(
            (instance) => instance.id === readarrId
          );
          if (!currentReadarr) {
            return next({
              status: 404,
              message: 'Settings instance not found',
            });
          }
          const admittedReadarr = parseReadarrSettings(
            preserveServarrApiKey(req.body, currentReadarr),
            currentReadarr
          );
          if ('error' in admittedReadarr) {
            return next({ status: 400, message: admittedReadarr.error });
          }
          if (
            (currentReadarr.serviceType ?? 'ebook') !==
            (admittedReadarr.value.serviceType ?? 'ebook')
          ) {
            await assertServarrServiceCanChangeKind('readarr', readarrId);
          }
          const readarr = await settings.persistSection(
            'readarr',
            (current) => {
              const serviceType = admittedReadarr.value.serviceType ?? 'ebook';
              const oldServiceType = currentReadarr.serviceType ?? 'ebook';
              const updated = current.map((instance) => {
                if (instance.id === readarrId) {
                  return {
                    ...admittedReadarr.value,
                    apiKey:
                      (req.body as { apiKey?: unknown }).apiKey ===
                      REDACTED_SECRET
                        ? instance.apiKey
                        : admittedReadarr.value.apiKey,
                    id: readarrId,
                  } as ReadarrSettings;
                }
                return admittedReadarr.value.isDefault &&
                  (instance.serviceType ?? 'ebook') === serviceType
                  ? { ...instance, isDefault: false }
                  : instance;
              });

              // Changing an instance's book format away from the type it
              // was the default for must not leave that type without one,
              // matching the auto-promotion the DELETE route already does.
              if (oldServiceType !== serviceType && currentReadarr.isDefault) {
                const hasDefaultForOldType = updated.some(
                  (instance) =>
                    instance.id !== readarrId &&
                    (instance.serviceType ?? 'ebook') === oldServiceType &&
                    instance.isDefault
                );
                if (!hasDefaultForOldType) {
                  let promoted = false;
                  return updated.map((instance) => {
                    if (
                      !promoted &&
                      instance.id !== readarrId &&
                      (instance.serviceType ?? 'ebook') === oldServiceType
                    ) {
                      promoted = true;
                      return { ...instance, isDefault: true };
                    }
                    return instance;
                  });
                }
              }

              return updated;
            }
          );

          return res
            .status(200)
            .json(redactSecrets(readarr.find(({ id }) => id === readarrId)));
        }
      );
    }
  )
);

readarrRoutes.delete<{ id: string }>(
  '/:id',
  authorizedMutation<{ id: string }>(
    Permission.ADMIN,
    async (req, res, next) => {
      const settings = getSettings();
      const readarrId = parseNonNegativeRouteId(req.params.id);
      if (readarrId === undefined) {
        return next({ status: 404, message: 'Settings instance not found' });
      }

      const readarrIndex = settings.readarr.findIndex(
        (r) => r.id === readarrId
      );

      if (readarrIndex === -1) {
        return next({ status: 404, message: 'Settings instance not found' });
      }

      return runWithServarrServiceCollectionMutationAdmission(
        'readarr',
        async () => {
          const removed = settings.readarr.find(
            (instance) => instance.id === readarrId
          );
          if (!removed) {
            return next({
              status: 404,
              message: 'Settings instance not found',
            });
          }
          await assertServarrServiceCanBeRemoved('readarr', readarrId);
          await settings.persistSection('readarr', (current) => {
            const remaining = current.filter(({ id }) => id !== readarrId);
            if (!removed.isDefault) {
              return remaining;
            }

            const removedServiceType = removed.serviceType ?? 'ebook';
            let promoted = false;
            return remaining.map((instance) => {
              if (
                !promoted &&
                (instance.serviceType ?? 'ebook') === removedServiceType
              ) {
                promoted = true;
                return { ...instance, isDefault: true };
              }
              return instance;
            });
          });

          return res.status(200).json(redactSecrets(removed));
        }
      );
    }
  )
);

export default readarrRoutes;
