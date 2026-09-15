import { withProperties } from '@app/utils/typeHelpers';
import { memo } from 'react';

interface ListItemProps {
  title: string;
  className?: string;
  children: React.ReactNode;
}

const ListItem = memo(({ title, className, children }: ListItemProps) => {
  return (
    <div className="app-list-row">
      <div className="max-w-6xl sm:grid sm:grid-cols-3 sm:gap-4">
        <dt className="app-list-label">{title}</dt>
        <dd className="app-list-value sm:col-span-2 sm:mt-0">
          <span className={`flex-grow ${className}`}>{children}</span>
        </dd>
      </div>
    </div>
  );
});

ListItem.displayName = 'ListItem';

interface ListProps {
  title: string;
  subTitle?: string;
  children: React.ReactNode;
}

const List = memo(({ title, subTitle, children }: ListProps) => {
  return (
    <>
      <div>
        <h3 className="heading">{title}</h3>
        {subTitle && <p className="description">{subTitle}</p>}
      </div>
      <div className="app-list-items section">
        <dl className="app-list">{children}</dl>
      </div>
    </>
  );
});

List.displayName = 'List';

export default withProperties(List, { Item: ListItem });
