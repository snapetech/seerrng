import Button, { type ButtonType } from '@app/components/Common/Button';
import FormatRequestControl from '@app/components/Common/FormatRequestControl';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { InformationCircleIcon } from '@heroicons/react/24/solid';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import type Media from '@server/entity/Media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { ServiceCommonServer } from '@server/interfaces/api/serviceInterfaces';
import { hasAutoApprovePermission } from '@server/lib/permissions';
import axios from 'axios';
import dynamic from 'next/dynamic';
import { useMemo, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const RequestModal = dynamic(() => import('@app/components/RequestModal'), {
  ssr: false,
});

const messages = defineMessages('components.RequestButton', {
  viewrequest: 'View Request',
  viewrequest4k: 'View 4K Request',
  requestmore: 'Request More',
  requestmore4k: 'Request More in 4K',
  requestupdatesfailed:
    '{failed, plural, one {One request could not be updated.} other {{failed} requests could not be updated.}}',
  hd: 'HD',
  pendingFormat: 'An open pending request already exists for this format.',
  availableFormat: 'This format is already available.',
  unavailableFormat: 'This format cannot be requested in the current state.',
  noService: 'No service is configured for this format.',
  blocklisted: 'This title is blocklisted.',
});

interface ButtonOption {
  id: string;
  text: string;
  action: () => void;
  svg?: React.ReactNode;
  buttonType?: ButtonType;
}

interface RequestButtonProps {
  mediaType: 'movie' | 'tv';
  onUpdate: () => void;
  tmdbId: number;
  media?: Media;
  isShowComplete?: boolean;
  is4kShowComplete?: boolean;
  buttonSize?: 'standard' | 'default' | 'sm';
  buttonType?: 'primary' | 'ghost' | 'success' | 'detailRequest';
  className?: string;
}

const RequestButton = ({
  tmdbId,
  onUpdate,
  media,
  mediaType,
  isShowComplete = false,
  is4kShowComplete = false,
  buttonSize = 'standard',
  buttonType = 'primary',
  className = 'ml-2',
}: RequestButtonProps) => {
  const intl = useIntl();
  const settings = useSettings();
  const { addToast } = useToasts();
  const { user, hasPermission } = useUser();
  const serviceType = mediaType === 'movie' ? 'radarr' : 'sonarr';
  const { data: requestServices } = useSWR<ServiceCommonServer[]>(
    `/api/v1/service/${serviceType}`
  );
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [showRequest4kModal, setShowRequest4kModal] = useState(false);
  const [editRequest, setEditRequest] = useState(false);
  const [isModifying, setIsModifying] = useState(false);
  const modificationActiveRef = useRef(false);

  // All pending requests
  const activeRequests = media?.requests.filter(
    (request) => request.status === MediaRequestStatus.PENDING && !request.is4k
  );
  const active4kRequests = media?.requests.filter(
    (request) => request.status === MediaRequestStatus.PENDING && request.is4k
  );

  // Current user's pending request, or the first pending request
  const activeRequest = useMemo(() => {
    return activeRequests && activeRequests.length > 0
      ? (activeRequests.find(
          (request) => request.requestedBy?.id === user?.id
        ) ?? activeRequests[0])
      : undefined;
  }, [activeRequests, user]);
  const active4kRequest = useMemo(() => {
    return active4kRequests && active4kRequests.length > 0
      ? (active4kRequests.find(
          (request) => request.requestedBy?.id === user?.id
        ) ?? active4kRequests[0])
      : undefined;
  }, [active4kRequests, user]);

  const modifyRequest = async (
    request: MediaRequest,
    type: 'approve' | 'decline'
  ) => {
    if (modificationActiveRef.current) {
      return;
    }
    modificationActiveRef.current = true;
    setIsModifying(true);

    try {
      await axios.post(`/api/v1/request/${request.id}/${type}`);

      onUpdate();
      void mutate('/api/v1/request/count').catch(() => undefined);
    } catch {
      addToast(
        intl.formatMessage(messages.requestupdatesfailed, { failed: 1 }),
        {
          appearance: 'error',
          autoDismiss: true,
        }
      );
    } finally {
      modificationActiveRef.current = false;
      setIsModifying(false);
    }
  };

  const buttons: ButtonOption[] = [];

  // If there are pending requests, show request management options first
  if (activeRequest || active4kRequest) {
    if (
      activeRequest &&
      (activeRequest.requestedBy?.id === user?.id ||
        (activeRequests?.length === 1 &&
          hasPermission(Permission.MANAGE_REQUESTS)))
    ) {
      buttons.push({
        id: 'active-request',
        text: intl.formatMessage(messages.viewrequest),
        action: () => {
          setEditRequest(true);
          setShowRequestModal(true);
        },
        svg: <InformationCircleIcon />,
      });
    }

    if (
      active4kRequest &&
      (active4kRequest.requestedBy?.id === user?.id ||
        (active4kRequests?.length === 1 &&
          hasPermission(Permission.MANAGE_REQUESTS)))
    ) {
      buttons.push({
        id: 'active-4k-request',
        text: intl.formatMessage(messages.viewrequest4k),
        action: () => {
          setEditRequest(true);
          setShowRequest4kModal(true);
        },
        svg: <InformationCircleIcon />,
      });
    }
  }

  // Standard request button
  if (
    (!media ||
      media.status === MediaStatus.UNKNOWN ||
      (media.status === MediaStatus.DELETED && !activeRequest)) &&
    hasPermission(
      [
        Permission.REQUEST,
        mediaType === 'movie'
          ? Permission.REQUEST_MOVIE
          : Permission.REQUEST_TV,
      ],
      { type: 'or' }
    )
  ) {
    buttons.push({
      id: 'request',
      text: intl.formatMessage(globalMessages.request),
      action: () => {
        setEditRequest(false);
        setShowRequestModal(true);
      },
      svg: <ArrowDownTrayIcon />,
    });
  } else if (
    mediaType === 'tv' &&
    (!activeRequest || activeRequest.requestedBy?.id !== user?.id) &&
    hasPermission([Permission.REQUEST, Permission.REQUEST_TV], {
      type: 'or',
    }) &&
    media &&
    media.status !== MediaStatus.BLOCKLISTED &&
    !isShowComplete
  ) {
    buttons.push({
      id: 'request-more',
      text: intl.formatMessage(messages.requestmore),
      action: () => {
        setEditRequest(false);
        setShowRequestModal(true);
      },
      svg: <ArrowDownTrayIcon />,
    });
  }

  // 4K request button
  if (
    (!media ||
      media.status4k === MediaStatus.UNKNOWN ||
      (media.status4k === MediaStatus.DELETED && !active4kRequest)) &&
    hasPermission(
      [
        Permission.REQUEST_4K,
        mediaType === 'movie'
          ? Permission.REQUEST_4K_MOVIE
          : Permission.REQUEST_4K_TV,
      ],
      { type: 'or' }
    ) &&
    ((settings.currentSettings.movie4kEnabled && mediaType === 'movie') ||
      (settings.currentSettings.series4kEnabled && mediaType === 'tv'))
  ) {
    buttons.push({
      id: 'request4k',
      text: intl.formatMessage(globalMessages.request4k),
      action: () => {
        setEditRequest(false);
        setShowRequest4kModal(true);
      },
      svg: <ArrowDownTrayIcon />,
    });
  } else if (
    mediaType === 'tv' &&
    (!active4kRequest || active4kRequest.requestedBy?.id !== user?.id) &&
    hasPermission([Permission.REQUEST_4K, Permission.REQUEST_4K_TV], {
      type: 'or',
    }) &&
    media &&
    media.status4k !== MediaStatus.BLOCKLISTED &&
    !is4kShowComplete &&
    settings.currentSettings.series4kEnabled
  ) {
    buttons.push({
      id: 'request-more-4k',
      text: intl.formatMessage(messages.requestmore4k),
      action: () => {
        setEditRequest(false);
        setShowRequest4kModal(true);
      },
      svg: <ArrowDownTrayIcon />,
    });
  }

  const requestActionIds = new Set([
    'request',
    'request-more',
    'request4k',
    'request-more-4k',
  ]);
  const nonRequestButtons = buttons.filter(
    (button) => !requestActionIds.has(button.id)
  );
  const standardRequestButton = buttons.find(
    (button) => button.id === 'request' || button.id === 'request-more'
  );
  const request4kButton = buttons.find(
    (button) => button.id === 'request4k' || button.id === 'request-more-4k'
  );
  const canRequestStandard = hasPermission(
    [
      Permission.REQUEST,
      mediaType === 'movie' ? Permission.REQUEST_MOVIE : Permission.REQUEST_TV,
    ],
    { type: 'or' }
  );
  const canRequest4k =
    ((settings.currentSettings.movie4kEnabled && mediaType === 'movie') ||
      (settings.currentSettings.series4kEnabled && mediaType === 'tv')) &&
    hasPermission(
      [
        Permission.REQUEST_4K,
        mediaType === 'movie'
          ? Permission.REQUEST_4K_MOVIE
          : Permission.REQUEST_4K_TV,
      ],
      { type: 'or' }
    );
  const canChooseAlternateTarget = hasPermission(
    [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
    { type: 'or' }
  );
  const hasStandardService =
    requestServices === undefined ||
    requestServices.some((service) => !service.is4k);
  const has4kService =
    requestServices === undefined ||
    requestServices.some((service) => service.is4k);
  const isBlocklisted = media?.status === MediaStatus.BLOCKLISTED;
  const canApproveStandard =
    !!user &&
    !!activeRequest &&
    hasAutoApprovePermission(user.permissions, mediaType);
  const canApprove4k =
    !!user &&
    !!active4kRequest &&
    hasAutoApprovePermission(user.permissions, mediaType, true);
  const standardIsAvailable =
    media?.status === MediaStatus.AVAILABLE ||
    (mediaType === 'movie' &&
      media?.status === MediaStatus.PARTIALLY_AVAILABLE);
  const fourKIsAvailable =
    media?.status4k === MediaStatus.AVAILABLE ||
    (mediaType === 'movie' &&
      media?.status4k === MediaStatus.PARTIALLY_AVAILABLE);
  const canOpenStandardAlternate =
    canChooseAlternateTarget && hasStandardService && !isBlocklisted;
  const canOpen4kAlternate =
    canChooseAlternateTarget && has4kService && !isBlocklisted;
  const requestOptions = [
    ...(canRequestStandard
      ? [
          {
            id: 'standard',
            label: intl.formatMessage(messages.hd),
            onClick: standardRequestButton
              ? standardRequestButton.action
              : canApproveStandard && activeRequest
                ? () => void modifyRequest(activeRequest, 'approve')
                : () => {
                    setEditRequest(false);
                    setShowRequestModal(true);
                  },
            disabled:
              !hasStandardService ||
              isBlocklisted ||
              (!standardRequestButton &&
                !(canApproveStandard && activeRequest) &&
                !canOpenStandardAlternate),
            disabledReason: !hasStandardService
              ? intl.formatMessage(messages.noService)
              : isBlocklisted
                ? intl.formatMessage(messages.blocklisted)
                : activeRequest
                  ? intl.formatMessage(messages.pendingFormat)
                  : standardIsAvailable
                    ? intl.formatMessage(messages.availableFormat)
                    : intl.formatMessage(messages.unavailableFormat),
          },
        ]
      : []),
    ...(canRequest4k
      ? [
          {
            id: '4k',
            label: '4K',
            onClick: request4kButton
              ? request4kButton.action
              : canApprove4k && active4kRequest
                ? () => void modifyRequest(active4kRequest, 'approve')
                : () => {
                    setEditRequest(false);
                    setShowRequest4kModal(true);
                  },
            disabled:
              !has4kService ||
              isBlocklisted ||
              (!request4kButton &&
                !(canApprove4k && active4kRequest) &&
                !canOpen4kAlternate),
            disabledReason: !has4kService
              ? intl.formatMessage(messages.noService)
              : isBlocklisted
                ? intl.formatMessage(messages.blocklisted)
                : active4kRequest
                  ? intl.formatMessage(messages.pendingFormat)
                  : fourKIsAvailable
                    ? intl.formatMessage(messages.availableFormat)
                    : intl.formatMessage(messages.unavailableFormat),
          },
        ]
      : []),
  ];

  if (nonRequestButtons.length === 0 && requestOptions.length === 0) {
    return null;
  }

  return (
    <>
      {showRequestModal && (
        <RequestModal
          tmdbId={tmdbId}
          show={showRequestModal}
          type={mediaType}
          show4kSelector
          editRequest={editRequest ? activeRequest : undefined}
          onComplete={() => {
            onUpdate();
            setShowRequestModal(false);
          }}
          onCancel={() => setShowRequestModal(false)}
        />
      )}
      {showRequest4kModal && (
        <RequestModal
          tmdbId={tmdbId}
          show={showRequest4kModal}
          type={mediaType}
          show4kSelector
          editRequest={editRequest ? active4kRequest : undefined}
          is4k
          onComplete={() => {
            onUpdate();
            setShowRequest4kModal(false);
          }}
          onCancel={() => setShowRequest4kModal(false)}
        />
      )}
      {nonRequestButtons.map((button) => (
        <Button
          key={`request-option-${button.id}`}
          buttonSize={buttonSize}
          buttonType={button.buttonType ?? buttonType}
          onClick={button.action}
          disabled={isModifying}
          className={className}
        >
          {button.svg}
          <span>{button.text}</span>
        </Button>
      ))}
      <FormatRequestControl options={requestOptions} className={className} />
    </>
  );
};

export default RequestButton;
