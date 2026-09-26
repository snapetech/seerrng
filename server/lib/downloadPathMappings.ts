import type {
  DownloadPathMapping,
  DownloadPathService,
} from '@server/lib/settings';
import path from 'node:path';

const allowedServices: DownloadPathService[] = [
  'radarr',
  'sonarr',
  'readarr',
  'lazylibrarian',
  'kapowarr',
];
const maxMappings = 100;
const maxPathLength = 4_096;

const isWindowsPath = (value: string): boolean =>
  /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeRemoteRoot = (value: string): string | undefined => {
  if (isWindowsPath(value)) {
    const normalized = path.win32.normalize(value);
    return normalized === path.win32.parse(normalized).root
      ? undefined
      : normalized.replace(/[\\/]+$/, '');
  }
  if (!path.posix.isAbsolute(value)) return undefined;
  const normalized = path.posix.normalize(value);
  return normalized === path.posix.parse(normalized).root
    ? undefined
    : normalized.replace(/\/+$/, '');
};

export const parseDownloadPathMappings = (
  value: unknown
): DownloadPathMapping[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxMappings) {
    throw new Error(
      `downloadPathMappings must be an array of at most ${maxMappings} entries.`
    );
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`downloadPathMappings[${index}] must be an object.`);
    }
    const serviceType = entry.serviceType;
    if (
      typeof serviceType !== 'string' ||
      !allowedServices.includes(serviceType as DownloadPathService)
    ) {
      throw new Error(
        `downloadPathMappings[${index}].serviceType is not supported.`
      );
    }
    if (
      entry.serviceId !== undefined &&
      (!Number.isSafeInteger(entry.serviceId) ||
        (entry.serviceId as number) < 1)
    ) {
      throw new Error(
        `downloadPathMappings[${index}].serviceId must be a positive integer.`
      );
    }
    if (
      typeof entry.remoteRoot !== 'string' ||
      !entry.remoteRoot.trim() ||
      entry.remoteRoot.length > maxPathLength ||
      entry.remoteRoot.includes('\0')
    ) {
      throw new Error(
        `downloadPathMappings[${index}].remoteRoot must be a valid absolute path.`
      );
    }
    if (
      typeof entry.localRoot !== 'string' ||
      !entry.localRoot.trim() ||
      entry.localRoot.length > maxPathLength ||
      entry.localRoot.includes('\0') ||
      !path.isAbsolute(entry.localRoot)
    ) {
      throw new Error(
        `downloadPathMappings[${index}].localRoot must be an absolute path visible to SeerrNG.`
      );
    }

    const remoteRoot = normalizeRemoteRoot(entry.remoteRoot.trim());
    const localRoot = path.resolve(entry.localRoot.trim());
    if (!remoteRoot) {
      throw new Error(
        `downloadPathMappings[${index}].remoteRoot must not be a filesystem root.`
      );
    }
    if (localRoot === path.parse(localRoot).root) {
      throw new Error(
        `downloadPathMappings[${index}].localRoot must not be a filesystem root.`
      );
    }

    return {
      serviceType: serviceType as DownloadPathService,
      ...(entry.serviceId !== undefined
        ? { serviceId: entry.serviceId as number }
        : {}),
      remoteRoot,
      localRoot,
    };
  });
};
