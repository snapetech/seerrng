import MeshNetworkIcon from '@app/assets/mesh-network.svg';
import Button from '@app/components/Common/Button';
import Modal from '@app/components/Common/Modal';
import Tooltip from '@app/components/Common/Tooltip';
import type { AssociationMediaType } from '@app/hooks/useAssociations';
import useAssociations, {
  toAssociationMediaType,
} from '@app/hooks/useAssociations';
import defineMessages from '@app/utils/defineMessages';
import { Transition } from '@headlessui/react';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import AssociationPopover from './AssociationPopover';

const messages = defineMessages('components.Association', {
  associations: 'Associations',
  browseMore: 'Browse More...',
});

interface AssociationBadgeProps {
  mediaType: string;
  id: string | number;
  /** 'card' floats over poster art; 'inline' sits next to a title. */
  variant?: 'card' | 'inline' | 'button';
  hideWhenEmpty?: boolean;
}

const AssociationBadge = ({
  mediaType,
  id,
  variant = 'card',
  hideWhenEmpty = false,
}: AssociationBadgeProps) => {
  const intl = useIntl();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const associationType: AssociationMediaType | null =
    toAssociationMediaType(mediaType);
  const { isLoading: isChecking, hasStrongEdges } = useAssociations(
    associationType,
    id,
    {
      enabled: hideWhenEmpty && !!associationType,
      includeWeak: false,
    }
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [isOpen]);

  if (!associationType || id == null || id === '') {
    return null;
  }

  if (hideWhenEmpty && (isChecking || !hasStrongEdges)) {
    return null;
  }

  const associationLabel = intl.formatMessage(messages.associations);
  const buttonClass =
    variant === 'card'
      ? 'app-button app-button-association h-6 w-6 rounded-full p-0 shadow-md shadow-cyan-950/40 backdrop-blur'
      : 'flex h-8 w-8 items-center justify-center rounded-full bg-gray-800 text-gray-300 ring-1 ring-gray-700 transition hover:text-white';

  const toggleAssociations = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (hideWhenEmpty && isChecking) {
      return;
    }
    setIsOpen((open) => !open);
  };

  return (
    <>
      <Tooltip content={associationLabel}>
        {variant === 'button' ? (
          <Button
            buttonType="association"
            buttonSize="sm"
            data-testid="association-badge"
            aria-label={associationLabel}
            disabled={hideWhenEmpty && isChecking}
            onClick={toggleAssociations}
          >
            <MeshNetworkIcon className="h-4 w-4" aria-hidden="true" />
            <span>{associationLabel}</span>
          </Button>
        ) : (
          <button
            type="button"
            data-testid="association-badge"
            aria-label={associationLabel}
            className={buttonClass}
            disabled={hideWhenEmpty && isChecking}
            onClick={toggleAssociations}
          >
            <MeshNetworkIcon
              className={variant === 'card' ? 'h-3.5 w-3.5' : 'h-4 w-4'}
              aria-hidden="true"
            />
          </button>
        )}
      </Tooltip>
      <Transition show={isOpen} as="div">
        <Modal
          title={associationLabel}
          onCancel={() => setIsOpen(false)}
          onOk={() => {
            setIsOpen(false);
            void router.push(
              `/associations/${associationType}/${encodeURIComponent(String(id))}`
            );
          }}
          okText={intl.formatMessage(messages.browseMore)}
          cancelButtonType="danger"
          okButtonType="success"
          actionButtonSize="standard"
          dialogClass="request-modal-site-surface refreshed-detail-text !w-[calc(100%-2rem)] rounded-xl border border-gray-700 shadow-lg shadow-gray-950/20 sm:!max-w-4xl"
        >
          <div data-testid="association-popover">
            <AssociationPopover
              mediaType={associationType}
              id={id}
              onSelect={() => setIsOpen(false)}
            />
          </div>
        </Modal>
      </Transition>
    </>
  );
};

export default AssociationBadge;
