import Dropdown from '@app/components/Common/Dropdown';
import { withProperties } from '@app/utils/typeHelpers';
import { Menu } from '@headlessui/react';
import { ChevronDownIcon } from '@heroicons/react/24/solid';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';

type ButtonWithDropdownProps = {
  text: React.ReactNode;
  dropdownIcon?: React.ReactNode;
  buttonType?: 'primary' | 'ghost' | 'success' | 'detailRequest' | 'playback';
  buttonSize?: 'standard' | 'default' | 'sm';
  disabledReason?: string;
} & (
  | ({ as?: 'button' } & ButtonHTMLAttributes<HTMLButtonElement>)
  | ({ as: 'a' } & AnchorHTMLAttributes<HTMLAnchorElement>)
);

const ButtonWithDropdown = ({
  text,
  children,
  dropdownIcon,
  className,
  buttonType = 'primary',
  buttonSize = 'standard',
  disabledReason,
  ...props
}: ButtonWithDropdownProps) => {
  const isSmall = buttonSize === 'sm';
  const buttonTypeClassNames = {
    primary: 'app-button-primary',
    ghost: 'app-button-ghost',
    success: 'app-button-success',
    detailRequest: 'app-button-detail-request',
    playback: 'app-button-playback',
  };
  const sharedClasses = `app-button ${buttonTypeClassNames[buttonType]} ${
    isSmall ? 'button-sm' : 'button-standard'
  }`;

  const TriggerElement = props.as ?? 'button';
  const disabled = props.as !== 'a' && props.disabled === true;
  const disabledTitle = disabled
    ? (disabledReason ?? 'This action is unavailable in the current state.')
    : props.title;

  return (
    <Menu as="div" className="relative z-10 inline-flex">
      <TriggerElement
        type="button"
        className={`relative z-10 hover:z-20 focus:z-20 ${sharedClasses} ${
          children ? 'rounded-r-none' : ''
        } ${className ?? ''}`}
        {...(props as Record<string, string>)}
        title={disabledTitle}
      >
        {text}
      </TriggerElement>
      {children && (
        <span className="relative -ml-px block">
          <Menu.Button
            type="button"
            disabled={disabled}
            className={`relative z-10 -ml-px rounded-l-none px-1.5 hover:z-20 focus:z-20 ${sharedClasses}`}
            aria-label="Expand"
            title={disabledTitle}
          >
            {dropdownIcon ? dropdownIcon : <ChevronDownIcon />}
          </Menu.Button>
          <Dropdown.Items dropdownType={buttonType}>{children}</Dropdown.Items>
        </span>
      )}
    </Menu>
  );
};
export default withProperties(ButtonWithDropdown, { Item: Dropdown.Item });
