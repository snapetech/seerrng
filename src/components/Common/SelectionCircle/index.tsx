import { CheckIcon } from '@heroicons/react/24/solid';
import type { FocusEventHandler } from 'react';

interface SelectionCircleProps {
  selected: boolean;
  partial?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  'data-testid'?: string;
  label?: string;
  onBlur?: FocusEventHandler<HTMLButtonElement>;
  onClick: () => void;
}

const SelectionCircle = ({
  selected,
  partial = false,
  disabled = false,
  id,
  name,
  'data-testid': dataTestId,
  label,
  onBlur,
  onClick,
}: SelectionCircleProps) => (
  <button
    type="button"
    id={id}
    name={name}
    data-testid={dataTestId}
    disabled={disabled}
    onClick={onClick}
    onBlur={onBlur}
    aria-label={label}
    aria-pressed={partial ? 'mixed' : selected}
    data-partial={partial || undefined}
    className="selection-circle"
  >
    <CheckIcon className="selection-circle-icon" aria-hidden="true" />
  </button>
);

export default SelectionCircle;
