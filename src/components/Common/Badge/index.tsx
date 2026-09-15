import { getSafeHref, isExternalHref } from '@app/utils/safeUrl';
import Link from 'next/link';
import React from 'react';

interface BadgeProps {
  badgeType?:
    'default' | 'primary' | 'danger' | 'warning' | 'success' | 'dark' | 'light';
  className?: string;
  href?: string;
  children: React.ReactNode;
}

const Badge = (
  { badgeType = 'default', className, href, children }: BadgeProps,
  ref?: React.Ref<HTMLElement>
) => {
  const badgeStyle = [
    'compact-control inline-flex items-center px-2 text-xs leading-none font-semibold rounded-full whitespace-nowrap',
  ];

  if (href) {
    badgeStyle.push('transition cursor-pointer !no-underline');
  } else {
    badgeStyle.push('cursor-default');
  }

  switch (badgeType) {
    case 'danger':
      badgeStyle.push('bg-red-600/35 border-red-500 border !text-red-100');
      if (href) {
        badgeStyle.push('hover:bg-red-500/55');
      }
      break;
    case 'warning':
      badgeStyle.push(
        'bg-yellow-500/35 border-yellow-500 border !text-yellow-100'
      );
      if (href) {
        badgeStyle.push('hover:bg-yellow-500/55');
      }
      break;
    case 'success':
      badgeStyle.push(
        'bg-green-500/35 border border-green-500 !text-green-100'
      );
      if (href) {
        badgeStyle.push('hover:bg-green-500/55');
      }
      break;
    case 'dark':
      badgeStyle.push('bg-gray-900/35 !text-gray-400');
      if (href) {
        badgeStyle.push('hover:bg-gray-800/55');
      }
      break;
    case 'light':
      badgeStyle.push('bg-gray-700/35 !text-gray-300');
      if (href) {
        badgeStyle.push('hover:bg-gray-600/55');
      }
      break;
    default:
      badgeStyle.push(
        'bg-indigo-500/35 border border-indigo-500 !text-indigo-100'
      );
      if (href) {
        badgeStyle.push('hover:bg-indigo-500/55');
      }
  }

  if (className) {
    badgeStyle.push(className);
  }

  const safeHref = getSafeHref(href);

  if (safeHref && isExternalHref(safeHref)) {
    return (
      <a
        href={safeHref}
        target="_blank"
        rel="noopener noreferrer"
        className={badgeStyle.join(' ')}
        ref={ref as React.Ref<HTMLAnchorElement>}
      >
        {children}
      </a>
    );
  } else if (safeHref) {
    return (
      <Link
        href={safeHref}
        className={badgeStyle.join(' ')}
        ref={ref as React.Ref<HTMLAnchorElement>}
      >
        {children}
      </Link>
    );
  } else {
    return (
      <span
        className={badgeStyle.join(' ')}
        ref={ref as React.Ref<HTMLSpanElement>}
      >
        {children}
      </span>
    );
  }
};

export default React.forwardRef(Badge) as typeof Badge;
