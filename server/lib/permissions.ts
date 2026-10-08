export enum Permission {
  NONE = 0,
  ADMIN = 2,
  MANAGE_SETTINGS = 4,
  MANAGE_USERS = 8,
  MANAGE_REQUESTS = 16,
  REQUEST = 32,
  VOTE = 64,
  AUTO_APPROVE = 128,
  AUTO_APPROVE_MOVIE = 256,
  AUTO_APPROVE_TV = 512,
  REQUEST_4K = 1024,
  REQUEST_4K_MOVIE = 2048,
  REQUEST_4K_TV = 4096,
  REQUEST_ADVANCED = 8192,
  REQUEST_VIEW = 16384,
  AUTO_APPROVE_4K = 32768,
  AUTO_APPROVE_4K_MOVIE = 65536,
  AUTO_APPROVE_4K_TV = 131072,
  REQUEST_MOVIE = 262144,
  REQUEST_TV = 524288,
  MANAGE_ISSUES = 1048576,
  VIEW_ISSUES = 2097152,
  CREATE_ISSUES = 4194304,
  AUTO_REQUEST = 8388608,
  AUTO_REQUEST_MOVIE = 16777216,
  AUTO_REQUEST_TV = 33554432,
  RECENT_VIEW = 67108864,
  WATCHLIST_VIEW = 134217728,
  MANAGE_BLOCKLIST = 268435456,
  VIEW_BLOCKLIST = 1073741824,
  AUTO_APPROVE_MUSIC = 2147483648,
  REQUEST_MUSIC = 4294967296,
  AUTO_REQUEST_MUSIC = 8589934592,
  AUTO_APPROVE_BOOK = 17179869184,
  REQUEST_BOOK = 34359738368,
  AUTO_REQUEST_BOOK = 68719476736,
  AUTO_APPROVE_COMIC = 137438953472,
  REQUEST_COMIC = 274877906944,
  AUTO_REQUEST_COMIC = 549755813888,
  AUTO_APPROVE_MAGAZINE = 1099511627776,
  REQUEST_MAGAZINE = 2199023255552,
  AUTO_REQUEST_MAGAZINE = 4398046511104,
  MANAGE_DOWNLOADS = 8796093022208,
  AUTO_APPROVE_SPORTS = 17592186044416,
  REQUEST_SPORTS = 35184372088832,
}

export const MAX_PERMISSION_VALUE = Object.values(Permission)
  .filter((value): value is number => typeof value === 'number')
  .reduce((sum, value) => sum + value, 0);

export const isValidPermissionValue = (value: number): boolean => {
  if (!Number.isSafeInteger(value) || value < 0) {
    return false;
  }

  return (BigInt(value) & ~BigInt(MAX_PERMISSION_VALUE)) === 0n;
};

export interface PermissionCheckOptions {
  type: 'and' | 'or';
}

/**
 * Takes a Permission and the users permission value and determines
 * if the user has access to the permission provided. If the user has
 * the admin permission, true will always be returned from this check!
 *
 * @param permissions Single permission or array of permissions
 * @param value users current permission value
 * @param options Extra options to control permission check behavior (mainly for arrays)
 */
export const hasPermission = (
  permissions: Permission | Permission[],
  value: number,
  options: PermissionCheckOptions = { type: 'and' }
): boolean => {
  // If we are not checking any permissions, bail out and return true
  if (permissions === 0) {
    return true;
  }

  // Permission values can come from persisted data as well as validated API
  // writes. Fail closed on corrupt or unsupported masks instead of allowing a
  // negative value to behave like an all-bits mask or letting BigInt throw on
  // fractional/infinite values.
  if (!isValidPermissionValue(value)) {
    return false;
  }

  const bigValue = BigInt(value);

  if (Array.isArray(permissions)) {
    if (bigValue & BigInt(Permission.ADMIN)) {
      return true;
    }
    switch (options.type) {
      case 'and':
        return permissions.every(
          (permission) => !!(bigValue & BigInt(permission))
        );
      case 'or':
        return permissions.some(
          (permission) => !!(bigValue & BigInt(permission))
        );
    }
  }

  const bigTotal = BigInt(permissions);

  return !!(bigValue & BigInt(Permission.ADMIN)) || !!(bigValue & bigTotal);
};

export type RequestApprovalMediaType =
  'movie' | 'tv' | 'music' | 'book' | 'comic' | 'magazine' | 'sports';

export const hasAutoApprovePermission = (
  permissions: number,
  mediaType: RequestApprovalMediaType,
  is4k = false
): boolean => {
  const mediaPermission =
    mediaType === 'movie'
      ? is4k
        ? Permission.AUTO_APPROVE_4K_MOVIE
        : Permission.AUTO_APPROVE_MOVIE
      : mediaType === 'tv'
        ? is4k
          ? Permission.AUTO_APPROVE_4K_TV
          : Permission.AUTO_APPROVE_TV
        : mediaType === 'music'
          ? Permission.AUTO_APPROVE_MUSIC
          : mediaType === 'comic'
            ? Permission.AUTO_APPROVE_COMIC
            : mediaType === 'magazine'
              ? Permission.AUTO_APPROVE_MAGAZINE
              : mediaType === 'sports'
                ? Permission.AUTO_APPROVE_SPORTS
                : Permission.AUTO_APPROVE_BOOK;
  const generalPermission = is4k
    ? Permission.AUTO_APPROVE_4K
    : Permission.AUTO_APPROVE;

  return hasPermission(
    [Permission.MANAGE_REQUESTS, generalPermission, mediaPermission],
    permissions,
    { type: 'or' }
  );
};
