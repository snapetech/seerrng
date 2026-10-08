import { hasPermission, Permission } from '@server/lib/permissions';

export type RetryRequestMediaType =
  'movie' | 'tv' | 'music' | 'book' | 'comic' | 'magazine' | 'sports';

interface RetryRequestPermissionInput {
  requestType: RetryRequestMediaType;
  is4k: boolean;
  requestedById: number;
  userId?: number;
  permissions: number;
}

export const canRetryRequest = ({
  requestType,
  is4k,
  requestedById,
  userId,
  permissions,
}: RetryRequestPermissionInput): boolean => {
  if (hasPermission(Permission.MANAGE_REQUESTS, permissions)) {
    return true;
  }

  if (userId === undefined || userId !== requestedById) {
    return false;
  }

  const requestPermissions =
    requestType === 'movie'
      ? is4k
        ? [Permission.REQUEST_4K, Permission.REQUEST_4K_MOVIE]
        : [Permission.REQUEST, Permission.REQUEST_MOVIE]
      : requestType === 'tv'
        ? is4k
          ? [Permission.REQUEST_4K, Permission.REQUEST_4K_TV]
          : [Permission.REQUEST, Permission.REQUEST_TV]
        : requestType === 'music'
          ? [Permission.REQUEST, Permission.REQUEST_MUSIC]
          : requestType === 'book'
            ? [Permission.REQUEST, Permission.REQUEST_BOOK]
            : requestType === 'comic'
              ? [Permission.REQUEST, Permission.REQUEST_COMIC]
              : requestType === 'magazine'
                ? [Permission.REQUEST, Permission.REQUEST_MAGAZINE]
                : [Permission.REQUEST, Permission.REQUEST_SPORTS];

  return hasPermission(requestPermissions, permissions, { type: 'or' });
};
