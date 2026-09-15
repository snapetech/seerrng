import Tooltip from '@app/components/Common/Tooltip';
import defineMessages from '@app/utils/defineMessages';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import type { SVGProps } from 'react';
import { useIntl } from 'react-intl';

const PushPinIcon = ({
  filled = false,
  ...props
}: SVGProps<SVGSVGElement> & { filled?: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke={filled ? 'none' : 'currentColor'}
    strokeWidth={filled ? undefined : 1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M16 9V4l1-1V2H7v1l1 1v5c0 1.66-1.34 3-3 3v2h6v7l1 1 1-1v-7h6v-2c-1.66 0-3-1.34-3-3Z" />
  </svg>
);

const messages = defineMessages('components.MediaDetails.DetailDisclosure', {
  pin: 'Pin {label} open across detail pages',
  unpin: 'Unpin {label}',
});

interface DetailDisclosureButtonProps {
  label: string;
  open: boolean;
  onClick: () => void;
  pinned?: boolean;
  onPinClick?: () => void;
}

const DetailDisclosureButton = ({
  label,
  open,
  onClick,
  pinned = false,
  onPinClick,
}: DetailDisclosureButtonProps) => {
  const intl = useIntl();
  const pinLabel = intl.formatMessage(pinned ? messages.unpin : messages.pin, {
    label,
  });

  return (
    <span className="detail-disclosure-control">
      {onPinClick && (
        <Tooltip content={pinLabel}>
          <button
            type="button"
            className={`detail-disclosure-pin ${pinned ? 'detail-disclosure-pin-active' : ''}`}
            aria-label={pinLabel}
            aria-pressed={pinned}
            onClick={onPinClick}
          >
            <PushPinIcon
              filled={pinned}
              className="h-3.5 w-3.5 rotate-45"
              aria-hidden="true"
            />
          </button>
        </Tooltip>
      )}
      <button
        type="button"
        className="detail-disclosure-button"
        aria-expanded={open}
        onClick={onClick}
      >
        {label}
        <ChevronDownIcon
          className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
    </span>
  );
};

export default DetailDisclosureButton;
