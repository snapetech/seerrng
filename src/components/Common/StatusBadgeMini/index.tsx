import Spinner from '@app/assets/spinner.svg';
import Tooltip from '@app/components/Common/Tooltip';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { CheckCircleIcon } from '@heroicons/react/20/solid';
import { CheckCircleIcon as AvailabilityIcon } from '@heroicons/react/24/outline';
import {
  BellIcon,
  ClockIcon,
  EyeSlashIcon,
  MinusSmallIcon,
  TrashIcon,
} from '@heroicons/react/24/solid';
import { MediaStatus } from '@server/constants/media';
import { memo } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Common.StatusBadgeMini', {
  pendingApproval: '{quality}: Pending approval',
  approvedProcessing: '{quality}: Approved and processing',
});

export type StatusBadgeQuality = 'HD' | '4K' | 'MP3' | 'FLAC';

interface StatusBadgeMiniProps {
  status: MediaStatus;
  quality?: StatusBadgeQuality;
  inProgress?: boolean;
  // Should the badge shrink on mobile to a smaller size? (TitleCard)
  shrink?: boolean;
}

const StatusBadgeMini = memo(
  ({
    status,
    quality,
    inProgress = false,
    shrink = false,
  }: StatusBadgeMiniProps) => {
    const intl = useIntl();
    const badgeStyle = [
      `rounded-full shadow-md ${shrink ? 'h-3.5 w-3.5' : 'w-5 p-0.5'}`,
    ];

    let indicatorIcon: React.ReactNode;

    switch (status) {
      case MediaStatus.PROCESSING:
        badgeStyle.push(
          'bg-indigo-500/35 border-indigo-400 ring-indigo-400 text-indigo-100'
        );
        indicatorIcon = <ClockIcon />;
        break;
      case MediaStatus.AVAILABLE:
        badgeStyle.push(
          'bg-green-500/35 border-green-400 ring-green-400 text-green-100'
        );
        indicatorIcon = <CheckCircleIcon />;
        break;
      case MediaStatus.PENDING:
        badgeStyle.push(
          'bg-yellow-500/35 border-yellow-400 ring-yellow-400 text-yellow-100'
        );
        indicatorIcon = <BellIcon />;
        break;
      case MediaStatus.BLOCKLISTED:
        badgeStyle.push('bg-red-500/35 border-white ring-white text-white');
        indicatorIcon = <EyeSlashIcon />;
        break;
      case MediaStatus.PARTIALLY_AVAILABLE:
        badgeStyle.push(
          'bg-green-500/35 border-green-400 ring-green-400 text-green-100'
        );
        indicatorIcon = <MinusSmallIcon />;
        break;
      case MediaStatus.DELETED:
        badgeStyle.push(
          'bg-red-500/35 border-red-400 ring-red-400 text-red-100'
        );
        indicatorIcon = <TrashIcon />;
        break;
    }

    if (inProgress) {
      indicatorIcon = <Spinner />;
    }

    const statusLabel = (() => {
      if (inProgress) {
        return intl.formatMessage(globalMessages.processing);
      }

      switch (status) {
        case MediaStatus.PROCESSING:
          return intl.formatMessage(globalMessages.processing);
        case MediaStatus.AVAILABLE:
          return intl.formatMessage(globalMessages.available);
        case MediaStatus.PENDING:
          return intl.formatMessage(globalMessages.pending);
        case MediaStatus.BLOCKLISTED:
          return intl.formatMessage(globalMessages.blocklisted);
        case MediaStatus.PARTIALLY_AVAILABLE:
          return intl.formatMessage(globalMessages.partiallyavailable);
        case MediaStatus.DELETED:
          return intl.formatMessage(globalMessages.deleted);
        default:
          return undefined;
      }
    })();
    const label = [quality, statusLabel].filter(Boolean).join(' ');
    const tooltipLabel =
      quality && !inProgress && status === MediaStatus.PENDING
        ? intl.formatMessage(messages.pendingApproval, { quality })
        : quality && !inProgress && status === MediaStatus.PROCESSING
          ? intl.formatMessage(messages.approvedProcessing, { quality })
          : label;

    if (shrink && quality) {
      const tone = inProgress
        ? 'border-indigo-400/80 bg-indigo-700/35 text-indigo-50'
        : status === MediaStatus.AVAILABLE ||
            status === MediaStatus.PARTIALLY_AVAILABLE
          ? 'border-green-500/80 bg-green-700/35 text-green-50'
          : status === MediaStatus.PENDING
            ? 'border-yellow-400/80 bg-yellow-700/35 text-yellow-50'
            : 'border-indigo-400/80 bg-indigo-700/35 text-indigo-50';
      const qualityBadge = (
        <div
          className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] leading-none font-semibold shadow-md backdrop-blur ${tone}`}
          data-testid="poster-quality-status-badge"
          role="img"
          aria-label={tooltipLabel}
        >
          {status === MediaStatus.AVAILABLE && !inProgress ? (
            <>
              <span>{quality}</span>
              <AvailabilityIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            </>
          ) : (
            <>
              <span className="h-3.5 w-3.5 shrink-0">{indicatorIcon}</span>
              <span>{quality}</span>
            </>
          )}
        </div>
      );

      return <Tooltip content={tooltipLabel}>{qualityBadge}</Tooltip>;
    }

    const badge = (
      <div
        className={`relative inline-flex rounded-full border-gray-700 text-xs leading-5 font-semibold whitespace-nowrap ring-gray-700 ${
          shrink ? '' : 'ring-1'
        }`}
        role="img"
        aria-label={label || undefined}
      >
        <div className={badgeStyle.join(' ')}>{indicatorIcon}</div>
        {quality && <span className="pr-2 pl-1 text-gray-200">{quality}</span>}
      </div>
    );

    return label ? <Tooltip content={label}>{badge}</Tooltip> : badge;
  }
);

StatusBadgeMini.displayName = 'StatusBadgeMini';

export default StatusBadgeMini;
