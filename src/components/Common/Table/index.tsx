import { withProperties } from '@app/utils/typeHelpers';
import { memo, useMemo } from 'react';

type TBodyProps = {
  children: React.ReactNode;
};

const TBody = memo(({ children }: TBodyProps) => {
  return <tbody className="app-data-table-body">{children}</tbody>;
});

TBody.displayName = 'TBody';

const TH = memo(
  ({ children, className, ...props }: React.ComponentPropsWithoutRef<'th'>) => {
    const style = useMemo(
      () => ['app-data-table-heading', className].filter(Boolean).join(' '),
      [className]
    );

    return (
      <th className={style} {...props}>
        {children}
      </th>
    );
  }
);

TH.displayName = 'TH';

type TDProps = {
  alignText?: 'left' | 'center' | 'right';
  noPadding?: boolean;
};

const TD = memo(
  ({
    children,
    alignText = 'left',
    noPadding,
    className,
    ...props
  }: TDProps & React.ComponentPropsWithoutRef<'td'>) => {
    const style = useMemo(
      () =>
        [
          'app-data-table-cell',
          alignText === 'center'
            ? 'text-center'
            : alignText === 'right'
              ? 'text-right'
              : 'text-left',
          noPadding ? 'p-0' : undefined,
          className,
        ]
          .filter(Boolean)
          .join(' '),
      [alignText, className, noPadding]
    );

    return (
      <td className={style} {...props}>
        {children}
      </td>
    );
  }
);

TD.displayName = 'TD';

type TableProps = {
  children: React.ReactNode;
  className?: string;
};

const Table = memo(({ children, className }: TableProps) => {
  return (
    <div className="app-data-table-container">
      <div className="app-data-table-scroll scrollable-card">
        <div className="app-data-table-frame">
          <div className="overflow-hidden rounded-lg">
            <table className={`app-data-table ${className ?? ''}`}>
              {children}
            </table>
          </div>
        </div>
      </div>
    </div>
  );
});

Table.displayName = 'Table';

export default withProperties(Table, { TH, TBody, TD });
