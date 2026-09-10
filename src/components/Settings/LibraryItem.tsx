import MediaTypeBadge, {
  getMediaTypeBadgeType,
} from '@app/components/Common/MediaTypeBadge';
import { ArrowsRightLeftIcon } from '@heroicons/react/24/outline';
import { CheckIcon, XMarkIcon } from '@heroicons/react/24/solid';

interface LibraryItemProps {
  isEnabled?: boolean;
  name: string;
  /** Library content type, e.g. 'movie' | 'show' | 'music' | 'book'. */
  type?: string;
  onToggle: () => void;
  /**
   * Shown as a small reclassify control when set. Used for Plex 'artist'
   * libraries, where music vs. audiobook can't be told apart automatically.
   */
  reclassifyLabel?: string;
  onReclassify?: () => void;
}

const LibraryItem = ({
  isEnabled,
  name,
  type,
  onToggle,
  reclassifyLabel,
  onReclassify,
}: LibraryItemProps) => {
  // Library.type uses 'show' where MediaTypeBadgeType uses 'tv'.
  const badgeType = getMediaTypeBadgeType(
    type === 'show' ? 'tv' : (type ?? '')
  );

  return (
    <li className="col-span-1 flex rounded-md shadow-sm">
      <div className="flex flex-1 items-center justify-between truncate rounded-md border-b border-r border-t border-gray-700 bg-gray-600">
        <div className="flex min-w-0 flex-1 cursor-default items-center gap-2 truncate px-4 py-6 text-sm leading-5">
          {badgeType && (
            <MediaTypeBadge mediaType={badgeType} variant="compact" />
          )}
          <span className="truncate">{name}</span>
          {onReclassify && (
            <button
              type="button"
              title={reclassifyLabel}
              aria-label={reclassifyLabel}
              onClick={(e) => {
                e.stopPropagation();
                onReclassify();
              }}
              className="ml-1 shrink-0 rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white"
            >
              <ArrowsRightLeftIcon className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex-shrink-0 pr-2">
          <span
            role="checkbox"
            tabIndex={0}
            aria-checked={isEnabled}
            onClick={() => onToggle()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onToggle();
              }
            }}
            className={`${
              isEnabled ? 'bg-indigo-600' : 'bg-gray-700'
            } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring`}
          >
            <span
              aria-hidden="true"
              className={`${
                isEnabled ? 'translate-x-5' : 'translate-x-0'
              } relative inline-block h-5 w-5 rounded-full bg-white shadow transition duration-200 ease-in-out`}
            >
              <span
                className={`${
                  isEnabled
                    ? 'opacity-0 duration-100 ease-out'
                    : 'opacity-100 duration-200 ease-in'
                } absolute inset-0 flex h-full w-full items-center justify-center transition-opacity`}
              >
                <XMarkIcon className="h-3 w-3 text-gray-400" />
              </span>
              <span
                className={`${
                  isEnabled
                    ? 'opacity-100 duration-200 ease-in'
                    : 'opacity-0 duration-100 ease-out'
                } absolute inset-0 flex h-full w-full items-center justify-center transition-opacity`}
              >
                <CheckIcon className="h-3 w-3 text-indigo-600" />
              </span>
            </span>
          </span>
        </div>
      </div>
    </li>
  );
};

export default LibraryItem;
