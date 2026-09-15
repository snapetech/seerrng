import Modal from '@app/components/Common/Modal';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { Transition } from '@headlessui/react';
import { useIntl } from 'react-intl';

interface BlocklistConfirmationModalProps {
  show: boolean;
  onComplete?: () => void;
  onCancel?: () => void;
  isUpdating?: boolean;
}

const messages = defineMessages('component.BlocklistConfirmationModal', {
  confirmation: 'Are you sure you want to blocklist this item?',
  blocklisting: 'Blocklisting',
});

const BlocklistConfirmationModal = ({
  show,
  onComplete,
  onCancel,
  isUpdating,
}: BlocklistConfirmationModalProps) => {
  const intl = useIntl();

  return (
    <Transition
      as="div"
      enter="transition-opacity duration-300"
      enterFrom="opacity-0"
      enterTo="opacity-100"
      leave="transition-opacity duration-300"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
      show={show}
    >
      <Modal
        backgroundClickable
        dialogClass="app-blocklist-confirmation-card"
        onCancel={onCancel}
        onOk={onComplete}
        cancelButtonType="danger"
        okButtonType="success"
        okText={
          isUpdating
            ? intl.formatMessage(messages.blocklisting)
            : intl.formatMessage(globalMessages.blocklist)
        }
        okDisabled={isUpdating}
        actionsClass="!justify-center gap-3"
        actionButtonSize="standard"
      >
        <p className="text-center text-base font-bold text-white">
          {intl.formatMessage(messages.confirmation)}
        </p>
      </Modal>
    </Transition>
  );
};

export default BlocklistConfirmationModal;
