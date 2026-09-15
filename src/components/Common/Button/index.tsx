import type { ForwardedRef, JSX } from 'react';
import React from 'react';
import { twMerge } from 'tailwind-merge';

export type ButtonType =
  | 'default'
  | 'primary'
  | 'danger'
  | 'warning'
  | 'success'
  | 'blocklist'
  | 'manage'
  | 'reportIssue'
  | 'association'
  | 'bulkRequest'
  | 'detailRequest'
  | 'trailer'
  | 'playback'
  | 'ghost';

// Helper type to override types (overrides onClick)
type MergeElementProps<
  T extends React.ElementType,
  P extends Record<string, unknown>,
> = Omit<React.ComponentProps<T>, keyof P> & P;

type ElementTypes = 'button' | 'a';

type Element<P extends ElementTypes = 'button'> = P extends 'a'
  ? HTMLAnchorElement
  : HTMLButtonElement;

type BaseProps<P> = {
  buttonType?: ButtonType;
  buttonSize?: 'standard' | 'default' | 'lg' | 'md' | 'sm';
  /** Explains a state-based disabled action. Displayed as a native tooltip. */
  disabledReason?: string;
  // Had to do declare this manually as typescript would assume e was of type any otherwise
  onClick?: (
    e: React.MouseEvent<P extends 'a' ? HTMLAnchorElement : HTMLButtonElement>
  ) => void;
};

export type ButtonProps<P extends React.ElementType> = {
  as?: P;
} & MergeElementProps<P, BaseProps<P>>;

const buttonTypeStyles: Record<ButtonType, string> = {
  default: 'app-button-default',
  primary: 'app-button-primary',
  danger: 'app-button-danger',
  warning: 'app-button-warning',
  success: 'app-button-success',
  blocklist: 'app-button-blocklist',
  manage: 'app-button-manage',
  reportIssue: 'app-button-report-issue',
  association: 'app-button-association',
  bulkRequest: 'app-button-bulk-request',
  detailRequest: 'app-button-detail-request',
  trailer: 'app-button-trailer',
  playback: 'app-button-playback',
  ghost: 'app-button-ghost',
};

const buttonSizeStyles: Record<
  NonNullable<BaseProps<unknown>['buttonSize']>,
  string
> = {
  standard: 'button-standard',
  default: 'button-standard',
  md: 'button-md',
  sm: 'button-sm',
  lg: 'button-lg',
};

function Button<P extends ElementTypes = 'button'>(
  {
    buttonType = 'default',
    buttonSize = 'standard',
    as,
    children,
    className,
    disabledReason,
    ...props
  }: ButtonProps<P>,
  ref?: React.Ref<Element<P>>
): JSX.Element {
  const buttonStyle = twMerge(
    'app-button',
    buttonTypeStyles[buttonType],
    buttonSizeStyles[buttonSize],
    className
  );

  if (as === 'a') {
    return (
      <a
        className={buttonStyle}
        {...(props as React.ComponentProps<'a'>)}
        ref={ref as ForwardedRef<HTMLAnchorElement>}
      >
        <span className="flex items-center">{children}</span>
      </a>
    );
  } else {
    const buttonProps = props as React.ComponentProps<'button'>;
    const disabledTitle = buttonProps.disabled
      ? (disabledReason ?? 'This action is unavailable in the current state.')
      : buttonProps.title;

    return (
      <button
        className={buttonStyle}
        {...buttonProps}
        title={disabledTitle}
        ref={ref as ForwardedRef<HTMLButtonElement>}
      >
        <span className="flex max-w-full items-center">{children}</span>
      </button>
    );
  }
}

export default React.forwardRef(Button) as typeof Button;
