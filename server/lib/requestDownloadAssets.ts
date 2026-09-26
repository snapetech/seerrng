import KapowarrAPI from '@server/api/comics/kapowarr';
import MylarAPI from '@server/api/comics/mylar';
import LazyLibrarianAPI from '@server/api/lazylibrarian';
import RadarrAPI from '@server/api/servarr/radarr';
import ReadarrAPI from '@server/api/servarr/readarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import { MediaType } from '@server/constants/media';
import { MediaIdentifierProvider } from '@server/entity/MediaIdentifier';
import type { MediaRequest } from '@server/entity/MediaRequest';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import type { DownloadPathService } from '@server/lib/settings';
import logger from '@server/logger';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';

export interface RequestDownloadAsset {
  id: string;
  name: string;
  size?: number;
}

export interface OpenRequestDownloadAsset {
  file?: FileHandle;
  stream?: Readable;
  name: string;
  size?: number;
}

type ResolvedAsset = RequestDownloadAsset & {
  source:
    | { type: 'file'; filePath: string }
    | { type: 'mylar'; serviceId: number; issueId: string };
};

const maxAssetsPerRequest = 1_000;
const maxRemotePathLength = 10_000;

const isWindowsPath = (value: string): boolean =>
  /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value);

const isWithin = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
};

const resolveRemoteRelativePath = (
  root: string,
  candidate: string
): string | undefined => {
  const windowsPath = isWindowsPath(root);
  if (
    windowsPath !== isWindowsPath(candidate) ||
    (windowsPath && !path.win32.isAbsolute(candidate)) ||
    (!windowsPath && !path.posix.isAbsolute(candidate))
  ) {
    return undefined;
  }

  const pathApi = windowsPath ? path.win32 : path.posix;
  const normalizedRoot = pathApi.normalize(root);
  const normalizedCandidate = pathApi.normalize(candidate);
  const relative = pathApi.relative(normalizedRoot, normalizedCandidate);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${pathApi.sep}`) ||
    pathApi.isAbsolute(relative)
  ) {
    return undefined;
  }
  return relative;
};

const findMappedPath = (
  serviceType: DownloadPathService,
  serviceId: number,
  remoteFilePath: string
):
  | { localPath: string; localRoot: string; normalizedRemotePath: string }
  | undefined => {
  if (
    !remoteFilePath ||
    remoteFilePath.length > maxRemotePathLength ||
    remoteFilePath.includes('\0')
  ) {
    return undefined;
  }

  const config = getExternalRuntimeConfig();
  const matches = config.main.downloadPathMappings.flatMap((mapping) => {
    if (
      mapping.serviceType !== serviceType ||
      (mapping.serviceId !== undefined && mapping.serviceId !== serviceId)
    ) {
      return [];
    }
    const remoteRelativePath = resolveRemoteRelativePath(
      mapping.remoteRoot,
      remoteFilePath
    );
    if (!remoteRelativePath) return [];
    return [
      {
        mapping,
        remoteRelativePath,
        explicitServiceId: mapping.serviceId !== undefined,
        rootLength: mapping.remoteRoot.length,
      },
    ];
  });

  matches.sort(
    (left, right) =>
      Number(right.explicitServiceId) - Number(left.explicitServiceId) ||
      right.rootLength - left.rootLength
  );
  const best = matches[0];
  if (!best) return undefined;
  const tied = matches.filter(
    (match) =>
      match.explicitServiceId === best.explicitServiceId &&
      match.rootLength === best.rootLength
  );
  if (
    tied.some(
      (match) =>
        match.mapping.localRoot !== best.mapping.localRoot ||
        match.remoteRelativePath !== best.remoteRelativePath
    )
  ) {
    return undefined;
  }

  const localPath = path.resolve(
    best.mapping.localRoot,
    ...best.remoteRelativePath.split(/[\\/]+/).filter(Boolean)
  );
  const localRoot = path.resolve(best.mapping.localRoot);
  if (!isWithin(localRoot, localPath) || localPath === localRoot) {
    return undefined;
  }

  return {
    localPath,
    localRoot,
    normalizedRemotePath: isWindowsPath(remoteFilePath)
      ? path.win32.normalize(remoteFilePath)
      : path.posix.normalize(remoteFilePath),
  };
};

const createAssetId = (
  requestId: number,
  serviceType: DownloadPathService | 'mylar',
  serviceId: number,
  remotePath: string
): string => {
  const key = getExternalRuntimeConfig().main.apiKey;
  return createHmac('sha256', key)
    .update(`${requestId}\0${serviceType}\0${serviceId}\0${remotePath}`)
    .digest('base64url');
};

const buildResolvedAsset = async (
  requestId: number,
  serviceType: DownloadPathService,
  serviceId: number,
  remoteFilePath: string
): Promise<ResolvedAsset | undefined> => {
  const mapped = findMappedPath(serviceType, serviceId, remoteFilePath);
  if (!mapped) return undefined;

  try {
    const canonicalRoot = await realpath(mapped.localRoot);
    const canonicalFile = await realpath(mapped.localPath);
    if (
      !isWithin(canonicalRoot, canonicalFile) ||
      canonicalFile === canonicalRoot
    ) {
      return undefined;
    }
    const fileInfo = await stat(canonicalFile);
    if (!fileInfo.isFile()) return undefined;

    const name = path
      .basename(canonicalFile)
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .slice(0, 255);
    if (!name) return undefined;
    return {
      id: createAssetId(
        requestId,
        serviceType,
        serviceId,
        mapped.normalizedRemotePath
      ),
      name,
      size: fileInfo.size,
      source: { type: 'file', filePath: canonicalFile },
    };
  } catch {
    return undefined;
  }
};

const addAsset = async (
  assets: ResolvedAsset[],
  requestId: number,
  serviceType: DownloadPathService,
  serviceId: number,
  remoteFilePath: string | undefined
): Promise<void> => {
  if (!remoteFilePath || assets.length >= maxAssetsPerRequest) return;
  const asset = await buildResolvedAsset(
    requestId,
    serviceType,
    serviceId,
    remoteFilePath
  );
  if (asset && !assets.some((existing) => existing.id === asset.id)) {
    assets.push(asset);
  }
};

const getRadarrAssets = async (
  request: MediaRequest,
  assets: ResolvedAsset[]
): Promise<void> => {
  const media = request.media;
  const serviceId =
    request.serverId ?? (request.is4k ? media.serviceId4k : media.serviceId);
  const movieId = request.is4k
    ? media.externalServiceId4k
    : media.externalServiceId;
  if (!serviceId || !movieId) return;
  const server = getExternalRuntimeConfig().radarr.find(
    (instance) => instance.id === serviceId
  );
  if (!server) return;

  const api = new RadarrAPI({
    url: RadarrAPI.buildUrl(server, '/api/v3'),
    apiKey: server.apiKey,
  });
  const movie = await api.getMovie({ id: movieId });
  if (movie.hasFile && movie.movieFile?.path) {
    await addAsset(
      assets,
      request.id,
      'radarr',
      serviceId,
      movie.movieFile.path
    );
  }
};

const getSonarrAssets = async (
  request: MediaRequest,
  assets: ResolvedAsset[]
): Promise<void> => {
  const media = request.media;
  const serviceId =
    request.serverId ?? (request.is4k ? media.serviceId4k : media.serviceId);
  const seriesId = request.is4k
    ? media.externalServiceId4k
    : media.externalServiceId;
  if (!serviceId || !seriesId) return;
  const server = getExternalRuntimeConfig().sonarr.find(
    (instance) => instance.id === serviceId
  );
  if (!server) return;

  const api = new SonarrAPI({
    url: SonarrAPI.buildUrl(server, '/api/v3'),
    apiKey: server.apiKey,
  });
  const [episodes, files] = await Promise.all([
    api.getEpisodes(seriesId),
    api.getEpisodeFiles(seriesId),
  ]);
  const requestedSeasons = request.seasons ?? [];
  const selectedFileIds = new Set(
    episodes
      .filter((episode) => {
        if (requestedSeasons.length === 0) return true;
        const season = requestedSeasons.find(
          (selected) => selected.seasonNumber === episode.seasonNumber
        );
        return (
          !!season &&
          (season.episodeNumbers == null ||
            season.episodeNumbers.includes(episode.episodeNumber))
        );
      })
      .map((episode) => episode.episodeFileId)
      .filter((episodeFileId) => episodeFileId > 0)
  );

  for (const file of files) {
    if (
      file.seriesId === seriesId &&
      (requestedSeasons.length === 0 || selectedFileIds.has(file.id)) &&
      file.path
    ) {
      await addAsset(assets, request.id, 'sonarr', serviceId, file.path);
    }
  }
};

type BookDeliveryTarget = {
  format: 'ebook' | 'audiobook';
  serviceId: number;
  bookId: number;
};

const getBookDeliveryTargets = (
  request: MediaRequest
): BookDeliveryTarget[] => {
  const media = request.media;
  const allowedFormats =
    request.bookFormat === 'both'
      ? ['ebook', 'audiobook']
      : [request.bookFormat === 'audiobook' ? 'audiobook' : 'ebook'];
  const targets: BookDeliveryTarget[] = [];

  for (const target of request.serviceTargets ?? []) {
    if (
      target.serviceType !== 'readarr' ||
      !allowedFormats.includes(target.format as 'ebook' | 'audiobook')
    ) {
      continue;
    }
    const format = target.format as 'ebook' | 'audiobook';
    const bookId =
      target.externalServiceId ??
      (format === 'audiobook'
        ? media.audiobookExternalServiceId
        : media.externalServiceId);
    if (
      Number.isSafeInteger(target.serverId) &&
      Number.isSafeInteger(bookId) &&
      bookId! > 0
    ) {
      targets.push({ format, serviceId: target.serverId, bookId: bookId! });
    }
  }

  if (targets.length > 0) return targets;

  const legacyTarget: BookDeliveryTarget[] = [];
  if (
    allowedFormats.includes('ebook') &&
    media.serviceId &&
    media.externalServiceId
  ) {
    legacyTarget.push({
      format: 'ebook',
      serviceId: media.serviceId,
      bookId: media.externalServiceId,
    });
  }
  if (
    allowedFormats.includes('audiobook') &&
    media.audiobookServiceId &&
    media.audiobookExternalServiceId
  ) {
    legacyTarget.push({
      format: 'audiobook',
      serviceId: media.audiobookServiceId,
      bookId: media.audiobookExternalServiceId,
    });
  }
  return legacyTarget;
};

const getReadarrAssets = async (
  request: MediaRequest,
  assets: ResolvedAsset[]
): Promise<void> => {
  for (const target of getBookDeliveryTargets(request)) {
    const server = getExternalRuntimeConfig().readarr.find(
      (instance) => instance.id === target.serviceId
    );
    if (!server) continue;
    const api = new ReadarrAPI({
      url: ReadarrAPI.buildUrl(server, '/api/v1'),
      apiKey: server.apiKey,
      mediaType: target.format,
    });
    const files = await api.getBookFiles(target.bookId);
    for (const file of files) {
      if (file.bookId === target.bookId && file.path) {
        await addAsset(
          assets,
          request.id,
          'readarr',
          target.serviceId,
          file.path
        );
      }
    }
  }
};

const getLazyLibrarianAssets = async (
  request: MediaRequest,
  assets: ResolvedAsset[]
): Promise<void> => {
  const serviceId = request.serverId ?? request.media.serviceId;
  const title =
    request.media.externalServiceSlug ??
    request.media.identifiers?.find(
      (identifier) =>
        identifier.provider === MediaIdentifierProvider.LAZYLIBRARIAN
    )?.value;
  if (!serviceId || !title) return;
  const server = getExternalRuntimeConfig().lazylibrarian.find(
    (instance) => instance.id === serviceId
  );
  if (!server) return;

  const api = new LazyLibrarianAPI({
    url: LazyLibrarianAPI.buildUrl(server),
    apiKey: server.apiKey,
  });
  const detail = await api.getIssues(title);
  for (const issue of detail.issues) {
    await addAsset(
      assets,
      request.id,
      'lazylibrarian',
      serviceId,
      issue.issueFile
    );
  }
};

const sanitizeAssetName = (value: string): string => {
  const name = value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 255);
  return name || 'Download';
};

const getMylarAssets = async (
  request: MediaRequest,
  assets: ResolvedAsset[]
): Promise<void> => {
  const media = request.media;
  const serviceId = request.serverId ?? media.serviceId;
  const comicId =
    media.externalServiceSlug ??
    (media.externalServiceId ? String(media.externalServiceId) : undefined);
  if (!serviceId || !comicId || !/^\d{1,20}$/.test(comicId)) return;
  const server = getExternalRuntimeConfig().mylar.find(
    (instance) => instance.id === serviceId
  );
  if (!server) return;

  const api = new MylarAPI({
    url: MylarAPI.buildUrl(server),
    apiKey: server.apiKey,
  });
  const detail = await api.getComic(comicId);
  for (const issue of detail.issues) {
    if (issue.status !== 'Downloaded' || !/^\d{1,20}$/.test(issue.id)) {
      continue;
    }
    const name = sanitizeAssetName(
      [
        detail.comic?.name,
        issue.number ? `#${issue.number}` : undefined,
        issue.name,
      ]
        .filter(Boolean)
        .join(' ')
    );
    const id = createAssetId(
      request.id,
      'mylar',
      serviceId,
      `issue:${issue.id}`
    );
    if (assets.some((asset) => asset.id === id)) continue;
    assets.push({
      id,
      name,
      source: { type: 'mylar', serviceId, issueId: issue.id },
    });
  }
};

const getKapowarrAssets = async (
  request: MediaRequest,
  assets: ResolvedAsset[]
): Promise<void> => {
  const media = request.media;
  const serviceId = request.serverId ?? media.serviceId;
  const rawVolumeId = media.externalServiceId ?? media.externalServiceSlug;
  const volumeId = Number(rawVolumeId);
  if (!serviceId || !Number.isSafeInteger(volumeId) || volumeId < 1) {
    return;
  }
  const server = getExternalRuntimeConfig().kapowarr.find(
    (instance) => instance.id === serviceId
  );
  if (!server) return;

  const api = new KapowarrAPI({
    url: KapowarrAPI.buildUrl(server),
    apiKey: server.apiKey,
  });
  const volume = await api.getVolume(volumeId);
  if (!volume || volume.id !== volumeId) return;

  for (const issue of volume.issues ?? []) {
    if (issue.volume_id !== volumeId) continue;
    for (const file of issue.files) {
      await addAsset(assets, request.id, 'kapowarr', serviceId, file.filepath);
    }
  }
};

const resolveRequestAssets = async (
  request: MediaRequest
): Promise<ResolvedAsset[]> => {
  const assets: ResolvedAsset[] = [];
  const providers: Partial<Record<MediaType, () => Promise<void>>> = {
    [MediaType.MOVIE]: () => getRadarrAssets(request, assets),
    [MediaType.TV]: () => getSonarrAssets(request, assets),
    [MediaType.BOOK]: () => getReadarrAssets(request, assets),
    [MediaType.COMIC]: () =>
      request.media.comicServiceType === 'kapowarr'
        ? getKapowarrAssets(request, assets)
        : request.media.comicServiceType === 'mylar'
          ? getMylarAssets(request, assets)
          : Promise.resolve(),
    [MediaType.MAGAZINE]: () => getLazyLibrarianAssets(request, assets),
  };
  const resolve = providers[request.type];
  if (!resolve) return assets;

  try {
    await resolve();
  } catch (error) {
    logger.warn('Unable to list local request download copies', {
      label: 'Request Downloads',
      requestId: request.id,
      mediaType: request.type,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
  }
  return assets;
};

export const listRequestDownloadAssets = async (
  request: MediaRequest
): Promise<RequestDownloadAsset[]> => {
  const assets = await resolveRequestAssets(request);
  return assets.map(({ id, name, size }) => ({ id, name, size }));
};

export const openRequestDownloadAsset = async (
  request: MediaRequest,
  assetId: string
): Promise<OpenRequestDownloadAsset | undefined> => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(assetId)) return undefined;
  const asset = (await resolveRequestAssets(request)).find((candidate) => {
    const expected = Buffer.from(candidate.id);
    const provided = Buffer.from(assetId);
    return (
      expected.length === provided.length && timingSafeEqual(expected, provided)
    );
  });
  if (!asset) return undefined;

  const source = asset.source;
  if (source.type === 'mylar') {
    const server = getExternalRuntimeConfig().mylar.find(
      (instance) => instance.id === source.serviceId
    );
    if (!server) return undefined;
    const api = new MylarAPI({
      url: MylarAPI.buildUrl(server),
      apiKey: server.apiKey,
    });
    const issueDownload = await api.downloadIssue(source.issueId);
    return {
      stream: issueDownload.stream,
      name: issueDownload.filename ?? asset.name,
      size: issueDownload.size,
    };
  }

  let file: FileHandle | undefined;
  try {
    const expectedInfo = await stat(source.filePath);
    file = await open(
      source.filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW
    );
    const openedInfo = await file.stat();
    if (
      !openedInfo.isFile() ||
      openedInfo.dev !== expectedInfo.dev ||
      openedInfo.ino !== expectedInfo.ino
    ) {
      await file.close();
      return undefined;
    }
    return { file, name: asset.name, size: openedInfo.size };
  } catch {
    if (file) await file.close().catch(() => undefined);
    return undefined;
  }
};
