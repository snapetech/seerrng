import BlocklistConfirmationModal from '@app/components/BlocklistConfirmationModal';

interface ExternalBlocklistModalProps {
  show: boolean;
  title: string;
  type: 'book' | 'music' | 'comic' | 'magazine';
  backdrop?: string | null;
  onComplete?: () => void;
  onCancel?: () => void;
  isUpdating?: boolean;
}

const ExternalBlocklistModal = ({
  show,
  onComplete,
  onCancel,
  isUpdating,
}: ExternalBlocklistModalProps) => {
  return (
    <BlocklistConfirmationModal
      show={show}
      onCancel={onCancel}
      onComplete={onComplete}
      isUpdating={isUpdating}
    />
  );
};

export default ExternalBlocklistModal;
