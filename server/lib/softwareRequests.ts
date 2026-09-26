import type { SoftwareAssetStream } from '@server/api/software/questarrng';
import QuestarrNGAPI from '@server/api/software/questarrng';
import ROMarrNGAPI from '@server/api/software/romarrng';
import type {
  PcArchitecture,
  PcOperatingSystem,
  SoftwareAsset,
  SoftwareAssetsResponse,
  SoftwareProviderRequest,
  SoftwareProviderStatus,
} from '@server/api/software/types';
import { getRepository } from '@server/datasource';
import SoftwareRequest, {
  type SoftwareRequestProvider,
  type SoftwareRequestStatus,
} from '@server/entity/SoftwareRequest';
import SoftwareRequestStatusEvent from '@server/entity/SoftwareRequestStatusEvent';
import { User } from '@server/entity/User';
import { getIntl } from '@server/i18n';
import globalMessages from '@server/i18n/globalMessages';
import notificationManager, { Notification } from '@server/lib/notifications';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import type { AvailableLocale } from '@server/types/languages';
import { mapWithConcurrency } from '@server/utils/concurrency';

export type PcGameVariant = {
  operatingSystem: PcOperatingSystem;
  architecture: PcArchitecture;
};

export interface SoftwareRequestView {
  request: SoftwareRequest;
  assets: SoftwareAsset[];
  status: SoftwareRequestStatus;
  message: string | null;
}

export class SoftwareProviderNotConfiguredError extends Error {}
export class SoftwareRequestConfirmationRequiredError extends Error {}
export class SoftwareRequestStateError extends Error {}

const getProviderSettings = (provider: SoftwareRequestProvider) => {
  const settings = getSettings().softwareAcquisition[provider];
  if (!settings.hostname || !settings.apiKey) {
    throw new SoftwareProviderNotConfiguredError(
      `${provider === 'romarr' ? 'ROMarrNG' : 'QuestarrNG'} is not configured.`
    );
  }
  return settings;
};

const getQuestarr = () => new QuestarrNGAPI(getProviderSettings('questarr'));
const getRomarr = () => new ROMarrNGAPI(getProviderSettings('romarr'));

const safeErrorMessage = (status: SoftwareProviderStatus): string | null =>
  status === 'failed'
    ? 'The acquisition provider could not complete this request.'
    : null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const isRomarrRetryConfirmationRequired = (error: unknown): boolean => {
  if (!isRecord(error) || !isRecord(error.response)) return false;
  const data = error.response.data;
  return (
    isRecord(data) && data.confirmationRequired === 'confirmNoExistingDownload'
  );
};

const sanitizeSoftwareAssets = (value: unknown): SoftwareAsset[] => {
  if (!isRecord(value) || !Array.isArray(value.assets)) return [];
  return value.assets
    .slice(0, 100)
    .filter(
      (asset): asset is Record<string, unknown> =>
        isRecord(asset) &&
        typeof asset.id === 'string' &&
        asset.id.length > 0 &&
        asset.id.length <= 256 &&
        typeof asset.name === 'string' &&
        asset.name.length > 0 &&
        asset.name.length <= 512 &&
        Number.isSafeInteger(asset.size) &&
        (asset.size as number) >= 0
    )
    .map((asset) => ({
      id: asset.id as string,
      name: (asset.name as string).replace(/[\r\n\0]/g, '_'),
      size: asset.size as number,
      // The upstream URL is deliberately discarded. Users receive only a
      // same-origin SeerrNG request-scoped download route.
      url: '',
    }));
};

const mapProviderStatus = (
  providerRequest: SoftwareProviderRequest,
  assets: SoftwareAsset[]
): SoftwareRequestStatus => {
  if (providerRequest.status === 'available') {
    return assets.length > 0 ? 'available' : 'importing';
  }
  if (providerRequest.status === 'accepted') return 'approved';
  return providerRequest.status;
};

const recordStatusEvent = async (
  request: SoftwareRequest,
  message: string | null
): Promise<void> => {
  const repository = getRepository(SoftwareRequestStatusEvent);
  const fingerprint = `${request.status}:${request.attempt}:${request.percent ?? 'na'}`;
  const existing = await repository.findOneBy({
    requestId: request.id,
    fingerprint,
  });
  if (existing) return;
  await repository.save(
    repository.create({
      requestId: request.id,
      requestedById: request.requestedById,
      status: request.status,
      message: message?.slice(0, 512) ?? null,
      percent: request.percent ?? null,
      fingerprint,
    })
  );
};

const notifySoftwareAvailable = async (
  request: SoftwareRequest
): Promise<void> => {
  try {
    const requester =
      request.requestedBy ??
      (await getRepository(User).findOneBy({ id: request.requestedById }));
    if (!requester) return;

    const intl = getIntl(
      requester.settings?.locale as AvailableLocale | undefined
    );
    await notificationManager.sendNotification(
      Notification.SOFTWARE_AVAILABLE,
      {
        event: intl.formatMessage(globalMessages.softwareRequestAvailable),
        subject: request.title,
        notifySystem: false,
        notifyAdmin: false,
        notifyUser: requester,
        mediaUrl: `/requests/status?softwareRequestId=${request.id}`,
        message: intl.formatMessage(globalMessages.softwareAvailableMessage),
        image: request.coverUrl ?? undefined,
      }
    );
  } catch (error) {
    logger.error('Could not queue software availability notification', {
      requestId: request.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const notifySoftwareRequestStatus = async (
  request: SoftwareRequest,
  status: 'pending' | 'approved' | 'declined' | 'failed'
): Promise<void> => {
  try {
    const requester =
      request.requestedBy ??
      (await getRepository(User).findOneBy({ id: request.requestedById }));
    if (!requester) return;

    const intl = getIntl(
      requester.settings?.locale as AvailableLocale | undefined
    );
    const event = intl.formatMessage(
      status === 'pending'
        ? globalMessages.softwareRequestPending
        : status === 'approved'
          ? globalMessages.softwareRequestApproved
          : status === 'declined'
            ? globalMessages.softwareRequestDeclined
            : globalMessages.softwareRequestFailed
    );
    const message = intl.formatMessage(
      status === 'pending'
        ? globalMessages.softwarePendingMessage
        : status === 'approved'
          ? globalMessages.softwareApprovedMessage
          : status === 'declined'
            ? globalMessages.softwareDeclinedMessage
            : globalMessages.softwareFailedMessage
    );

    await notificationManager.sendNotification(Notification.SOFTWARE_STATUS, {
      event,
      subject: request.title,
      notifySystem: false,
      notifyAdmin: status === 'pending' || status === 'failed',
      notifyUser: requester,
      mediaUrl: `/requests/status?softwareRequestId=${request.id}`,
      message,
      image: request.coverUrl ?? undefined,
      extra: [
        {
          name: intl.formatMessage(globalMessages.requestedBy),
          value: requester.displayName,
        },
      ],
    });
  } catch (error) {
    logger.error('Could not queue software request status notification', {
      requestId: request.id,
      status,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const getProviderRequest = async (
  request: SoftwareRequest,
  dispatchIfMissing: boolean
): Promise<SoftwareProviderRequest> => {
  const variant = {
    operatingSystem: request.operatingSystem as PcOperatingSystem,
    architecture: request.architecture as PcArchitecture,
  };
  try {
    return request.provider === 'questarr'
      ? await getQuestarr().getRequest(request.externalRequestId)
      : await getRomarr().getRequest(request.externalRequestId);
  } catch (error) {
    if (!dispatchIfMissing) throw error;
    // Both NG providers make externalRequestId idempotent. Replaying the saved
    // request recovers a crash between SeerrNG approval and provider dispatch.
    logger.info(
      'Replaying idempotent software request after status read failed',
      {
        requestId: request.id,
        provider: request.provider,
      }
    );
    return request.provider === 'questarr'
      ? getQuestarr().createRequest(
          request.externalRequestId,
          request.title,
          variant
        )
      : getRomarr().createRequest(
          request.externalRequestId,
          request.title,
          request.platformSlug ?? ''
        );
  }
};

const getAssets = async (
  request: SoftwareRequest
): Promise<SoftwareAssetsResponse> =>
  request.provider === 'questarr'
    ? getQuestarr().getAssets(request.externalRequestId)
    : getRomarr().getAssets(request.externalRequestId);

export const listSoftwareRequestAssets = async (
  request: SoftwareRequest
): Promise<SoftwareAsset[]> => {
  if (request.status !== 'available') return [];
  try {
    return sanitizeSoftwareAssets(await getAssets(request));
  } catch (error) {
    logger.warn('Could not list software request assets', {
      requestId: request.id,
      provider: request.provider,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
};

export const refreshSoftwareRequest = async (
  request: SoftwareRequest
): Promise<SoftwareRequestView> => {
  if (
    request.status === 'pending' ||
    request.status === 'declined' ||
    request.status === 'failed' ||
    request.status === 'cancelled'
  ) {
    return {
      request,
      assets: [],
      status: request.status,
      message: request.errorMessage ?? null,
    };
  }

  try {
    const providerRequest = await getProviderRequest(request, true);
    let assets: SoftwareAsset[] = [];
    if (providerRequest.status === 'available') {
      const response = await getAssets(request);
      assets = (Array.isArray(response?.assets) ? response.assets : [])
        .slice(0, 100)
        .filter(
          (asset) =>
            typeof asset.id === 'string' &&
            asset.id.length > 0 &&
            asset.id.length <= 256 &&
            typeof asset.name === 'string' &&
            asset.name.length > 0 &&
            asset.name.length <= 512 &&
            Number.isSafeInteger(asset.size) &&
            asset.size >= 0
        )
        .map(({ id, name, size }) => ({
          id,
          name: name.replace(/[\r\n\0]/g, '_'),
          size,
          url: '',
        }));
    }

    const nextStatus = mapProviderStatus(providerRequest, assets);
    const previousStatus = request.status;
    request.status = nextStatus;
    request.errorMessage = safeErrorMessage(providerRequest.status);
    request.lastCheckedAt = new Date();
    if (nextStatus !== previousStatus) {
      await getRepository(SoftwareRequest).save(request);
      await recordStatusEvent(request, request.errorMessage);
      if (nextStatus === 'available') {
        await notifySoftwareAvailable(request);
      } else if (nextStatus === 'failed') {
        await notifySoftwareRequestStatus(request, 'failed');
      }
    } else {
      await getRepository(SoftwareRequest).update(request.id, {
        lastCheckedAt: request.lastCheckedAt,
      });
    }

    return {
      request,
      assets,
      status: nextStatus,
      message: request.errorMessage ?? null,
    };
  } catch (error) {
    logger.warn('Software request status could not be refreshed', {
      requestId: request.id,
      provider: request.provider,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      request,
      assets: [],
      status: request.status,
      message: request.errorMessage ?? null,
    };
  }
};

export const approveSoftwareRequest = async (
  request: SoftwareRequest,
  approvedById: number
): Promise<SoftwareRequestView> => {
  if (request.status !== 'pending') {
    throw new SoftwareRequestStateError(
      'Only pending requests can be approved.'
    );
  }
  getProviderSettings(request.provider);
  const attempt = request.attempt + 1;
  const repository = getRepository(SoftwareRequest);
  const result = await repository.update(
    { id: request.id, status: 'pending' },
    {
      status: 'approved',
      approvedById,
      attempt,
      errorMessage: null,
    }
  );
  if (!result.affected) {
    throw new SoftwareRequestStateError(
      'Only pending requests can be approved.'
    );
  }
  request.status = 'approved';
  request.approvedById = approvedById;
  request.attempt = attempt;
  request.errorMessage = null;
  await recordStatusEvent(request, 'Request approved.');
  await notifySoftwareRequestStatus(request, 'approved');
  return refreshSoftwareRequest(request);
};

export const declineSoftwareRequest = async (
  request: SoftwareRequest,
  approvedById: number
): Promise<SoftwareRequest> => {
  if (request.status !== 'pending') {
    throw new SoftwareRequestStateError(
      'Only pending requests can be declined.'
    );
  }
  const repository = getRepository(SoftwareRequest);
  const result = await repository.update(
    { id: request.id, status: 'pending' },
    { status: 'declined', approvedById }
  );
  if (!result.affected) {
    throw new SoftwareRequestStateError(
      'Only pending requests can be declined.'
    );
  }
  request.status = 'declined';
  request.approvedById = approvedById;
  await recordStatusEvent(request, 'Request declined.');
  await notifySoftwareRequestStatus(request, 'declined');
  return request;
};

export const withdrawPendingSoftwareRequest = async (
  request: SoftwareRequest
): Promise<SoftwareRequest> => {
  const repository = getRepository(SoftwareRequest);
  const result = await repository.update(
    { id: request.id, status: 'pending' },
    { status: 'cancelled' }
  );
  if (!result.affected) {
    throw new SoftwareRequestStateError(
      'Only pending requests can be withdrawn.'
    );
  }
  request.status = 'cancelled';
  await recordStatusEvent(request, 'Request withdrawn by requester.');
  return request;
};

export const retrySoftwareRequest = async (
  request: SoftwareRequest,
  confirmNoExistingDownload = false
): Promise<SoftwareRequestView> => {
  if (request.status !== 'failed') {
    throw new SoftwareRequestStateError('Only failed requests can be retried.');
  }

  const saveProviderStatus = async (
    providerRequest: SoftwareProviderRequest
  ): Promise<SoftwareRequestView> => {
    const assets =
      providerRequest.status === 'available'
        ? sanitizeSoftwareAssets(await getAssets(request))
        : [];
    const nextStatus = mapProviderStatus(providerRequest, assets);
    request.attempt += 1;
    request.status = nextStatus;
    request.errorMessage = safeErrorMessage(providerRequest.status);
    request.lastCheckedAt = new Date();
    await getRepository(SoftwareRequest).save(request);
    await recordStatusEvent(request, request.errorMessage ?? 'Retry started.');
    if (nextStatus === 'available') {
      await notifySoftwareAvailable(request);
    }
    return {
      request,
      assets,
      status: nextStatus,
      message: request.errorMessage,
    };
  };

  // A previous POST may have reached the provider even if SeerrNG did not get
  // its response. Read the durable provider state before attempting another
  // dispatch so a retry cannot enqueue a duplicate download.
  const current = await getProviderRequest(request, false);
  if (current.status !== 'failed') {
    return saveProviderStatus(current);
  }

  try {
    const providerRequest =
      request.provider === 'questarr'
        ? await getQuestarr().retryRequest(request.externalRequestId)
        : await getRomarr().retryRequest(
            request.externalRequestId,
            confirmNoExistingDownload
          );
    return saveProviderStatus(providerRequest);
  } catch (error) {
    if (
      request.provider === 'romarr' &&
      !confirmNoExistingDownload &&
      isRomarrRetryConfirmationRequired(error)
    ) {
      throw new SoftwareRequestConfirmationRequiredError();
    }

    // The provider may have accepted the retry and lost only its response.
    // Reconcile that state before returning an error that invites another try.
    try {
      const latest = await getProviderRequest(request, false);
      if (latest.status !== 'failed') {
        return saveProviderStatus(latest);
      }
    } catch {
      // Keep the durable local request failed; a later user retry can reconcile.
    }
    throw error;
  }
};

export const streamSoftwareRequestAsset = async (
  request: SoftwareRequest,
  asset: SoftwareAsset,
  range?: string
): Promise<SoftwareAssetStream> => {
  if (request.provider === 'questarr') {
    return getQuestarr().streamAsset(
      request.externalRequestId,
      asset.id,
      range
    );
  }
  return getRomarr().streamAsset(request.externalRequestId, asset.id, range);
};

export const refreshSoftwareRequests = async (
  requests: SoftwareRequest[]
): Promise<SoftwareRequestView[]> =>
  mapWithConcurrency(requests, 4, refreshSoftwareRequest);

export const refreshTrackedSoftwareRequests = async (): Promise<void> => {
  const requests = await getRepository(SoftwareRequest)
    .createQueryBuilder('request')
    .leftJoinAndSelect('request.requestedBy', 'requestedBy')
    .where('request.status IN (:...statuses)', {
      statuses: ['approved', 'searching', 'downloading', 'importing'],
    })
    .orderBy('COALESCE(request.lastCheckedAt, request.createdAt)', 'ASC')
    .take(100)
    .getMany();

  if (requests.length > 0) {
    await refreshSoftwareRequests(requests);
  }
};

export const isValidPcVariant = (value: unknown): value is PcGameVariant => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const variant = value as Record<string, unknown>;
  return (
    (variant.operatingSystem === 'windows' ||
      variant.operatingSystem === 'linux' ||
      variant.operatingSystem === 'macos') &&
    (variant.architecture === 'x64' ||
      variant.architecture === 'arm64' ||
      variant.architecture === 'x86' ||
      variant.architecture === 'universal')
  );
};

export const hasSoftwareRequestAccess = (
  request: SoftwareRequest,
  user: User
): boolean =>
  request.requestedById === user.id ||
  user.hasPermission([Permission.REQUEST_VIEW, Permission.MANAGE_REQUESTS], {
    type: 'or',
  });
