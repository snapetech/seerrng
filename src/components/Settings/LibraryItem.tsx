import MediaTypeBadge, {
  getMediaTypeBadgeType,
} from '@app/components/Common/MediaTypeBadge';
import SelectionCircle from '@app/components/Common/SelectionCircle';
import globalMessages from '@app/i18n/globalMessages';
import { ArrowsRightLeftIcon } from '@heroicons/react/24/outline';
import { useIntl } from 'react-intl';

interface LibraryItemProps {
  isEnabled?: boolean;
  name: string;
  /** Library content type, e.g. 'movie' | 'show' | 'music' | 'book'. */
  type?: string;
  typeLabel?: string;
  onToggle: () => void;
  /**
   * Shown as a small reclassify control when set. Used for Plex 'artist'
   * libraries, where music vs. audiobook can't be told apart automatically.
   */
  reclassify?: { label: string; onReclassify: () => void };
}

const LibraryItem = ({
  isEnabled,
  name,
  type,
  typeLabel,
  onToggle,
  reclassify,
}: LibraryItemProps) => {
  const intl = useIntl();
  // Library.type uses 'show' where MediaTypeBadgeType uses 'tv'. A Music
  // library isn't a single Album -- it keeps the Album badge's icon/tone
  // but overrides the label via MediaTypeBadge's `label` prop.
  const badgeType = getMediaTypeBadgeType(
    type === 'show' ? 'tv' : (type ?? '')
  );

  return (
    <li className="settings-library-card col-span-1 flex shadow-sm">
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
        <div className="settings-library-card-content">
          {badgeType && (
            <MediaTypeBadge
              mediaType={badgeType}
              variant="compact"
              label={
                typeLabel ??
                (type === 'music'
                  ? intl.formatMessage(globalMessages.music)
                  : undefined)
              }
            />
          )}
          <span className="truncate">{name}</span>
          {reclassify && (
            <button
              type="button"
              title={reclassify.label}
              aria-label={reclassify.label}
              onClick={(e) => {
                e.stopPropagation();
                reclassify.onReclassify();
              }}
              className="app-button app-button-default compact-control ml-1 w-5 shrink-0 p-0"
            >
              <ArrowsRightLeftIcon className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex-shrink-0">
          <SelectionCircle
            selected={Boolean(isEnabled)}
            label={name}
            onClick={onToggle}
          />
        </div>
      </div>
    </li>
  );
};

export default LibraryItem;
