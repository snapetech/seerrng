import NotificationType from '@app/components/NotificationTypeSelector/NotificationType';
import useSettings from '@app/hooks/useSettings';
import type { User } from '@app/hooks/useUser';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { useMemo, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.NotificationTypeSelector', {
  notificationTypes: 'Notification Types',
  mediarequested: 'Request Pending Approval',
  mediarequestedDescription:
    'Send notifications when users submit new media requests which require approval.',
  usermediarequestedDescription:
    'Get notified when other users submit new media requests which require approval.',
  mediaapproved: 'Request Approved',
  mediaapprovedDescription:
    'Send notifications when media requests are manually approved.',
  usermediaapprovedDescription:
    'Get notified when your media requests are approved.',
  mediaAutoApproved: 'Request Automatically Approved',
  mediaAutoApprovedDescription:
    'Send notifications when users submit new media requests which are automatically approved.',
  usermediaAutoApprovedDescription:
    'Get notified when other users submit new media requests which are automatically approved.',
  mediaavailable: 'Request Available',
  mediaavailableDescription:
    'Send notifications when media requests become available.',
  usermediaavailableDescription:
    'Get notified when your media requests become available.',
  mediafailed: 'Request Processing Failed',
  mediafailedDescription:
    'Send notifications when media requests fail to be added to Radarr, Sonarr, Lidarr, or Bookshelf.',
  usermediafailedDescription:
    'Get notified when media requests fail to be added to Radarr, Sonarr, Lidarr, or Bookshelf.',
  mediadeclined: 'Request Declined',
  mediadeclinedDescription:
    'Send notifications when media requests are declined.',
  usermediadeclinedDescription:
    'Get notified when your media requests are declined.',
  issuecreated: 'Issue Reported',
  issuecreatedDescription: 'Send notifications when issues are reported.',
  userissuecreatedDescription: 'Get notified when other users report issues.',
  issuecomment: 'Issue Comment',
  issuecommentDescription:
    'Send notifications when issues receive new comments.',
  userissuecommentDescription:
    'Get notified when issues you reported receive new comments.',
  adminissuecommentDescription:
    'Get notified when other users comment on issues.',
  issueresolved: 'Issue Resolved',
  issueresolvedDescription: 'Send notifications when issues are resolved.',
  userissueresolvedDescription:
    'Get notified when issues you reported are resolved.',
  adminissueresolvedDescription:
    'Get notified when issues are resolved by other users.',
  issuereopened: 'Issue Reopened',
  issuereopenedDescription: 'Send notifications when issues are reopened.',
  userissuereopenedDescription:
    'Get notified when issues you reported are reopened.',
  adminissuereopenedDescription:
    'Get notified when issues are reopened by other users.',
  mediaautorequested: 'Request Automatically Submitted',
  mediaautorequestedDescription:
    'Get notified when new media requests are automatically submitted for items on Your Watchlist.',
});

export const hasNotificationType = (
  types: Notification | Notification[],
  value: number
): boolean => {
  let total: number;

  // If we are not checking any notifications, bail out and return true
  if (types === 0) {
    return true;
  }

  if (Array.isArray(types)) {
    // Combine all notification values into one
    total = types.reduce((a, v) => a + v, 0);
  } else {
    total = types;
  }

  // Test notifications don't need to be enabled
  if (!(value & Notification.TEST_NOTIFICATION)) {
    value += Notification.TEST_NOTIFICATION;
  }

  return !!(value & total);
};

export enum Notification {
  NONE = 0,
  MEDIA_PENDING = 2,
  MEDIA_APPROVED = 4,
  MEDIA_AVAILABLE = 8,
  MEDIA_FAILED = 16,
  TEST_NOTIFICATION = 32,
  MEDIA_DECLINED = 64,
  MEDIA_AUTO_APPROVED = 128,
  ISSUE_CREATED = 256,
  ISSUE_COMMENT = 512,
  ISSUE_RESOLVED = 1024,
  ISSUE_REOPENED = 2048,
  MEDIA_AUTO_REQUESTED = 4096,
}

export const ALL_NOTIFICATIONS = Object.values(Notification)
  .filter((v) => !isNaN(Number(v)))
  .reduce((a, v) => a + Number(v), 0);

export interface NotificationItem {
  id: string;
  name: string;
  description: string;
  value: Notification;
  hasNotifyUser: boolean;
  children?: NotificationItem[];
  hidden?: boolean;
}

interface NotificationTypeSelectorProps {
  user?: User;
  enabledTypes?: number;
  currentTypes: number;
  onUpdate: (newTypes: number) => void;
  error?: string;
}

const NotificationTypeSelector = ({
  user,
  enabledTypes = ALL_NOTIFICATIONS,
  currentTypes,
  onUpdate,
  error,
}: NotificationTypeSelectorProps) => {
  const intl = useIntl();
  const settings = useSettings();
  const { hasPermission } = useUser({ id: user?.id });
  const [allowedTypes, setAllowedTypes] = useState(enabledTypes);

  const availableTypes = useMemo(() => {
    const isRequestTypeAutomaticallyApproved = (
      requestPermissions: Permission[],
      autoApprovePermissions: Permission[]
    ) =>
      !hasPermission(requestPermissions, { type: 'or' }) ||
      hasPermission(autoApprovePermissions, { type: 'or' });

    const allRequestsAutoApproved =
      user &&
      // Has Manage Requests perm, which grants all Auto-Approve perms
      (hasPermission(Permission.MANAGE_REQUESTS) ||
        // Cannot submit requests of any type
        !hasPermission(
          [
            Permission.REQUEST,
            Permission.REQUEST_MOVIE,
            Permission.REQUEST_TV,
            Permission.REQUEST_4K,
            Permission.REQUEST_4K_MOVIE,
            Permission.REQUEST_4K_TV,
            Permission.REQUEST_MUSIC,
            Permission.REQUEST_BOOK,
            Permission.REQUEST_COMIC,
            Permission.REQUEST_MAGAZINE,
          ],
          { type: 'or' }
        ) ||
        (isRequestTypeAutomaticallyApproved(
          [Permission.REQUEST, Permission.REQUEST_MOVIE],
          [Permission.AUTO_APPROVE, Permission.AUTO_APPROVE_MOVIE]
        ) &&
          isRequestTypeAutomaticallyApproved(
            [Permission.REQUEST, Permission.REQUEST_TV],
            [Permission.AUTO_APPROVE, Permission.AUTO_APPROVE_TV]
          ) &&
          (!settings.currentSettings.movie4kEnabled ||
            isRequestTypeAutomaticallyApproved(
              [Permission.REQUEST_4K, Permission.REQUEST_4K_MOVIE],
              [Permission.AUTO_APPROVE_4K, Permission.AUTO_APPROVE_4K_MOVIE]
            )) &&
          (!settings.currentSettings.series4kEnabled ||
            isRequestTypeAutomaticallyApproved(
              [Permission.REQUEST_4K, Permission.REQUEST_4K_TV],
              [Permission.AUTO_APPROVE_4K, Permission.AUTO_APPROVE_4K_TV]
            )) &&
          isRequestTypeAutomaticallyApproved(
            [Permission.REQUEST, Permission.REQUEST_MUSIC],
            [Permission.AUTO_APPROVE, Permission.AUTO_APPROVE_MUSIC]
          ) &&
          isRequestTypeAutomaticallyApproved(
            [Permission.REQUEST, Permission.REQUEST_BOOK],
            [Permission.AUTO_APPROVE, Permission.AUTO_APPROVE_BOOK]
          ) &&
          isRequestTypeAutomaticallyApproved(
            [Permission.REQUEST, Permission.REQUEST_COMIC],
            [Permission.AUTO_APPROVE, Permission.AUTO_APPROVE_COMIC]
          ) &&
          isRequestTypeAutomaticallyApproved(
            [Permission.REQUEST, Permission.REQUEST_MAGAZINE],
            [Permission.AUTO_APPROVE, Permission.AUTO_APPROVE_MAGAZINE]
          )));

    const types: NotificationItem[] = [
      {
        id: 'media-auto-requested',
        name: intl.formatMessage(messages.mediaautorequested),
        description: intl.formatMessage(messages.mediaautorequestedDescription),
        value: Notification.MEDIA_AUTO_REQUESTED,
        hidden:
          !user ||
          (!user.settings?.watchlistSyncMovies &&
            !user.settings?.watchlistSyncTv &&
            !user.settings?.watchlistSyncMusic &&
            !user.settings?.watchlistSyncBooks &&
            !user.settings?.watchlistSyncComics) ||
          !hasPermission(
            [
              Permission.AUTO_REQUEST,
              Permission.AUTO_REQUEST_MOVIE,
              Permission.AUTO_REQUEST_TV,
              Permission.AUTO_REQUEST_MUSIC,
              Permission.AUTO_REQUEST_BOOK,
              Permission.AUTO_REQUEST_COMIC,
            ],
            { type: 'or' }
          ),
        hasNotifyUser: true,
      },
      {
        id: 'media-requested',
        name: intl.formatMessage(messages.mediarequested),
        description: intl.formatMessage(
          user
            ? messages.usermediarequestedDescription
            : messages.mediarequestedDescription
        ),
        value: Notification.MEDIA_PENDING,
        hasNotifyUser: false,
        hidden: user && !hasPermission(Permission.MANAGE_REQUESTS),
      },
      {
        id: 'media-auto-approved',
        name: intl.formatMessage(messages.mediaAutoApproved),
        description: intl.formatMessage(
          user
            ? messages.usermediaAutoApprovedDescription
            : messages.mediaAutoApprovedDescription
        ),
        value: Notification.MEDIA_AUTO_APPROVED,
        hasNotifyUser: false,
        hidden: user && !hasPermission(Permission.MANAGE_REQUESTS),
      },
      {
        id: 'media-approved',
        name: intl.formatMessage(messages.mediaapproved),
        description: intl.formatMessage(
          user
            ? messages.usermediaapprovedDescription
            : messages.mediaapprovedDescription
        ),
        value: Notification.MEDIA_APPROVED,
        hasNotifyUser: true,
        hidden: allRequestsAutoApproved,
      },
      {
        id: 'media-declined',
        name: intl.formatMessage(messages.mediadeclined),
        description: intl.formatMessage(
          user
            ? messages.usermediadeclinedDescription
            : messages.mediadeclinedDescription
        ),
        value: Notification.MEDIA_DECLINED,
        hasNotifyUser: true,
        hidden: allRequestsAutoApproved,
      },
      {
        id: 'media-available',
        name: intl.formatMessage(messages.mediaavailable),
        description: intl.formatMessage(
          user
            ? messages.usermediaavailableDescription
            : messages.mediaavailableDescription
        ),
        value: Notification.MEDIA_AVAILABLE,
        hasNotifyUser: true,
      },
      {
        id: 'media-failed',
        name: intl.formatMessage(messages.mediafailed),
        description: intl.formatMessage(
          user
            ? messages.usermediafailedDescription
            : messages.mediafailedDescription
        ),
        value: Notification.MEDIA_FAILED,
        hidden: user && !hasPermission(Permission.MANAGE_REQUESTS),
        hasNotifyUser: false,
      },
      {
        id: 'issue-created',
        name: intl.formatMessage(messages.issuecreated),
        description: intl.formatMessage(
          user
            ? messages.userissuecreatedDescription
            : messages.issuecreatedDescription
        ),
        value: Notification.ISSUE_CREATED,
        hidden: user && !hasPermission(Permission.MANAGE_ISSUES),
        hasNotifyUser: false,
      },
      {
        id: 'issue-comment',
        name: intl.formatMessage(messages.issuecomment),
        description: intl.formatMessage(
          user
            ? hasPermission(Permission.MANAGE_ISSUES)
              ? messages.adminissuecommentDescription
              : messages.userissuecommentDescription
            : messages.issuecommentDescription
        ),
        value: Notification.ISSUE_COMMENT,
        hidden:
          user &&
          !hasPermission([Permission.MANAGE_ISSUES, Permission.CREATE_ISSUES], {
            type: 'or',
          }),
        hasNotifyUser:
          !user || hasPermission(Permission.MANAGE_ISSUES) ? false : true,
      },
      {
        id: 'issue-resolved',
        name: intl.formatMessage(messages.issueresolved),
        description: intl.formatMessage(
          user
            ? hasPermission(Permission.MANAGE_ISSUES)
              ? messages.adminissueresolvedDescription
              : messages.userissueresolvedDescription
            : messages.issueresolvedDescription
        ),
        value: Notification.ISSUE_RESOLVED,
        hidden:
          user &&
          !hasPermission([Permission.MANAGE_ISSUES, Permission.CREATE_ISSUES], {
            type: 'or',
          }),
        hasNotifyUser:
          !user || hasPermission(Permission.MANAGE_ISSUES) ? false : true,
      },
      {
        id: 'issue-reopened',
        name: intl.formatMessage(messages.issuereopened),
        description: intl.formatMessage(
          user
            ? hasPermission(Permission.MANAGE_ISSUES)
              ? messages.adminissuereopenedDescription
              : messages.userissuereopenedDescription
            : messages.issuereopenedDescription
        ),
        value: Notification.ISSUE_REOPENED,
        hidden:
          user &&
          !hasPermission([Permission.MANAGE_ISSUES, Permission.CREATE_ISSUES], {
            type: 'or',
          }),
        hasNotifyUser:
          !user || hasPermission(Permission.MANAGE_ISSUES) ? false : true,
      },
    ];

    const filteredTypes = types.filter(
      (type) => !type.hidden && hasNotificationType(type.value, enabledTypes)
    );

    const newAllowedTypes = filteredTypes.reduce((a, v) => a + v.value, 0);
    if (newAllowedTypes !== allowedTypes) {
      setAllowedTypes(newAllowedTypes);
    }

    return user
      ? [...filteredTypes].sort(
          (a, b) => Number(b.hasNotifyUser) - Number(a.hasNotifyUser)
        )
      : filteredTypes;
  }, [user, hasPermission, settings, intl, allowedTypes, enabledTypes]);

  if (!availableTypes.length) {
    return null;
  }

  return (
    <div role="group" aria-labelledby="group-label" className="form-group">
      <div className="form-row">
        <span id="group-label" className="group-label">
          {intl.formatMessage(messages.notificationTypes)}
          {!user && <span className="label-required">*</span>}
        </span>
        <div className="form-input-area">
          <div className="max-w-lg">
            {availableTypes.map((type) => (
              <NotificationType
                key={`notification-type-${type.id}`}
                option={type}
                currentTypes={currentTypes}
                onUpdate={onUpdate}
              />
            ))}
          </div>
          {error && <div className="error">{error}</div>}
        </div>
      </div>
    </div>
  );
};

export default NotificationTypeSelector;
