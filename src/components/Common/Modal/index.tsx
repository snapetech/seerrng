import type { ButtonType } from '@app/components/Common/Button';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import useClickOutside from '@app/hooks/useClickOutside';
import { useLockBodyScroll } from '@app/hooks/useLockBodyScroll';
import globalMessages from '@app/i18n/globalMessages';
import { Transition } from '@headlessui/react';
import type { MouseEvent } from 'react';
import React, { Fragment, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useIntl } from 'react-intl';

interface ModalProps {
  title?: string;
  subTitle?: string;
  ariaLabel?: string;
  onCancel?: (e?: MouseEvent<HTMLElement>) => void;
  onOk?: (e?: MouseEvent<HTMLButtonElement>) => void;
  onSecondary?: (e?: MouseEvent<HTMLButtonElement>) => void;
  onTertiary?: (e?: MouseEvent<HTMLButtonElement>) => void;
  cancelText?: string;
  okText?: string;
  secondaryText?: string;
  tertiaryText?: string;
  okDisabled?: boolean;
  cancelButtonType?: ButtonType;
  okButtonType?: ButtonType;
  secondaryButtonType?: ButtonType;
  secondaryDisabled?: boolean;
  tertiaryDisabled?: boolean;
  tertiaryButtonType?: ButtonType;
  okButtonProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  cancelButtonProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  secondaryButtonProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  tertiaryButtonProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  disableScrollLock?: boolean;
  backgroundClickable?: boolean;
  loading?: boolean;
  backdrop?: string;
  backdropFull?: boolean;
  children?: React.ReactNode;
  dialogClass?: string;
  hideActions?: boolean;
  alignTop?: boolean;
  actionsClass?: string;
  actionButtonSize?: 'standard' | 'default' | 'md' | 'sm';
}

const Modal = React.forwardRef<HTMLDivElement, ModalProps>(
  (
    {
      title,
      subTitle,
      ariaLabel,
      onCancel,
      onOk,
      cancelText,
      okText,
      okDisabled = false,
      cancelButtonType = 'default',
      okButtonType = 'primary',
      children,
      disableScrollLock,
      backgroundClickable = true,
      secondaryButtonType = 'default',
      secondaryDisabled = false,
      onSecondary,
      secondaryText,
      tertiaryButtonType = 'default',
      tertiaryDisabled = false,
      tertiaryText,
      loading = false,
      onTertiary,
      backdrop,
      backdropFull = false,
      dialogClass,
      hideActions = false,
      alignTop = false,
      okButtonProps,
      cancelButtonProps,
      secondaryButtonProps,
      tertiaryButtonProps,
      actionsClass = '',
      actionButtonSize = 'sm',
    },
    parentRef
  ) => {
    const intl = useIntl();
    const modalRef = useRef<HTMLDivElement>(null);
    const backgroundClickableRef = useRef(backgroundClickable); // This ref is used to detect state change inside the useClickOutside hook
    useEffect(() => {
      backgroundClickableRef.current = backgroundClickable;
    }, [backgroundClickable]);
    useClickOutside(modalRef, () => {
      if (onCancel && backgroundClickableRef.current) {
        onCancel();
      }
    });
    useLockBodyScroll(true, disableScrollLock);

    return ReactDOM.createPortal(
      <Transition.Child
        as="div"
        data-testid="modal-root"
        className={`app-modal-screen-backdrop fixed top-0 right-0 bottom-0 left-0 z-[60] flex h-full w-full justify-center overflow-y-auto ${
          alignTop ? 'items-start pt-[49px] pb-4 sm:pt-[65px]' : 'items-center'
        } transition-opacity duration-300 data-closed:opacity-0`}
        ref={parentRef}
      >
        <Transition
          as={Fragment}
          enter="transition duration-300"
          enterFrom="opacity-0 scale-75"
          enterTo="opacity-100 scale-100"
          leave="transition-opacity duration-300"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
          show={loading}
        >
          <div style={{ position: 'absolute' }}>
            <LoadingSpinner />
          </div>
        </Transition>
        <Transition
          className={`relative inline-block w-full overflow-auto bg-gray-800 px-4 pt-4 pb-4 text-left align-bottom shadow-xl ring-1 ring-gray-700 transition-all sm:max-w-3xl sm:rounded-lg sm:align-middle ${
            alignTop
              ? 'my-0 max-h-[calc(100dvh-65px)] sm:max-h-[calc(100dvh-81px)]'
              : 'hide-scrollbar sm:my-8'
          } ${dialogClass} transition duration-300 data-closed:scale-75 data-closed:opacity-0`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title || subTitle ? 'modal-headline' : undefined}
          aria-label={!title && !subTitle ? ariaLabel : undefined}
          style={
            alignTop
              ? undefined
              : {
                  maxHeight: 'calc(100% - env(safe-area-inset-top) * 2)',
                }
          }
          as="div"
          show={!loading}
          ref={modalRef}
        >
          {backdrop && (
            <div
              className={
                backdropFull
                  ? 'pointer-events-none absolute inset-0 z-0 overflow-hidden'
                  : 'absolute top-0 right-0 left-0 z-0 h-64 max-h-full w-full'
              }
            >
              <CachedImage
                type="tmdb"
                alt=""
                src={backdrop}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                fill
                priority
              />
              {backdropFull ? (
                <>
                  <div className="refreshed-artwork-scrim" />
                  <div className="refreshed-artwork-gradient" />
                </>
              ) : (
                <div className="absolute inset-0 bg-gray-800/75" />
              )}
            </div>
          )}
          <div className="relative -mx-4 overflow-x-hidden px-4 pt-0.5 sm:flex sm:items-center">
            <div
              className={`mt-3 truncate text-center text-white sm:mt-0 sm:text-left`}
            >
              {(title || subTitle) && (
                <div className="flex flex-col space-y-1">
                  {title && (
                    <span
                      className="text-overseerr truncate pb-0.5 text-2xl leading-6 font-bold"
                      id="modal-headline"
                      data-testid="modal-title"
                    >
                      {title}
                    </span>
                  )}
                  {subTitle && (
                    <span
                      className="truncate text-lg leading-6 font-semibold text-gray-200"
                      id="modal-headline"
                      data-testid="modal-title"
                    >
                      {subTitle}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          {children && (
            <div
              className={`relative mt-4 text-sm leading-5 text-gray-300 ${
                !(onCancel || onOk || onSecondary || onTertiary) ? 'mb-3' : ''
              }`}
            >
              {children}
            </div>
          )}
          {!hideActions && (onCancel || onOk || onSecondary || onTertiary) && (
            <div
              className={`relative mt-5 flex flex-row-reverse justify-center sm:mt-4 sm:justify-start ${actionsClass}`}
            >
              {typeof onOk === 'function' && (
                <Button
                  buttonType={okButtonType}
                  buttonSize={actionButtonSize}
                  onClick={onOk}
                  className="ml-3"
                  disabled={okDisabled}
                  data-testid="modal-ok-button"
                  {...okButtonProps}
                >
                  {okText ? okText : 'Ok'}
                </Button>
              )}
              {typeof onSecondary === 'function' && secondaryText && (
                <Button
                  buttonType={secondaryButtonType}
                  buttonSize={actionButtonSize}
                  onClick={onSecondary}
                  className="ml-3"
                  disabled={secondaryDisabled}
                  data-testid="modal-secondary-button"
                  {...secondaryButtonProps}
                >
                  {secondaryText}
                </Button>
              )}
              {typeof onTertiary === 'function' && tertiaryText && (
                <Button
                  buttonType={tertiaryButtonType}
                  buttonSize={actionButtonSize}
                  onClick={onTertiary}
                  className="ml-3"
                  disabled={tertiaryDisabled}
                  {...tertiaryButtonProps}
                >
                  {tertiaryText}
                </Button>
              )}
              {typeof onCancel === 'function' && (
                <Button
                  buttonType={cancelButtonType}
                  buttonSize={actionButtonSize}
                  onClick={onCancel}
                  className="ml-3 sm:ml-0"
                  data-testid="modal-cancel-button"
                  {...cancelButtonProps}
                >
                  {cancelText
                    ? cancelText
                    : intl.formatMessage(globalMessages.cancel)}
                </Button>
              )}
            </div>
          )}
        </Transition>
      </Transition.Child>,
      document.body
    );
  }
);

Modal.displayName = 'Modal';

export default Modal;
