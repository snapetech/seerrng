import {
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/solid';
import { memo } from 'react';

interface AlertProps {
  title?: React.ReactNode;
  type?: 'warning' | 'info' | 'error';
  children?: React.ReactNode;
  className?: string;
}

const alertDesign = {
  warning: {
    bgColor: 'border border-orange-400 backdrop-blur bg-orange-500/40',
    titleColor: 'text-orange-50',
    textColor: 'text-orange-100',
    svg: <ExclamationTriangleIcon className="h-5 w-5" />,
  },
  info: {
    bgColor: 'border border-indigo-500 backdrop-blur bg-indigo-400/20',
    titleColor: 'text-gray-100',
    textColor: 'text-gray-300',
    svg: <InformationCircleIcon className="h-5 w-5" />,
  },
  error: {
    bgColor: 'bg-red-600',
    titleColor: 'text-red-100',
    textColor: 'text-red-300',
    svg: <XCircleIcon className="h-5 w-5" />,
  },
};

const Alert = memo(
  ({ title, children, type = 'warning', className }: AlertProps) => {
    const design = alertDesign[type];

    return (
      <div
        className={`mb-4 rounded-md p-4 ${design.bgColor} ${className ?? ''}`}
      >
        <div className="flex items-center">
          <div className={`flex-shrink-0 ${design.titleColor}`}>
            {design.svg}
          </div>
          <div className="ml-3">
            {title && (
              <div className={`text-sm font-medium ${design.titleColor}`}>
                {title}
              </div>
            )}
            {children && (
              <div className={`mt-2 text-sm first:mt-0 ${design.textColor}`}>
                {children}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
);

Alert.displayName = 'Alert';

export default Alert;
