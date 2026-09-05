import Button from '@app/components/Common/Button';
import Tooltip from '@app/components/Common/Tooltip';
import useCardTextVisibility from '@app/hooks/useCardTextVisibility';
import defineMessages from '@app/utils/defineMessages';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import type { UserSettingsCardTextResponse } from '@server/interfaces/api/userSettingsInterfaces';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Common.CardTextVisibilityToggle', {
  showText: 'Always show titles',
  hideText: 'Only show titles on hover',
});

interface CardTextVisibilityToggleProps {
  mediaType:
    | keyof UserSettingsCardTextResponse
    | (keyof UserSettingsCardTextResponse)[];
}

const CardTextVisibilityToggle = ({
  mediaType,
}: CardTextVisibilityToggleProps) => {
  const intl = useIntl();
  const { visibility, setVisibility } = useCardTextVisibility();
  const mediaTypes = Array.isArray(mediaType) ? mediaType : [mediaType];
  const isAlwaysVisible = mediaTypes.every(
    (currentMediaType) => visibility[currentMediaType] === 'always'
  );
  const label = intl.formatMessage(
    isAlwaysVisible ? messages.hideText : messages.showText
  );

  return (
    <Tooltip content={label}>
      <Button
        buttonType="ghost"
        buttonSize="sm"
        className="h-8 w-8 p-0"
        aria-label={label}
        onClick={(e) => {
          e.preventDefault();
          void (async () => {
            const nextVisibility = isAlwaysVisible ? 'hover' : 'always';

            for (const currentMediaType of mediaTypes) {
              await setVisibility(currentMediaType, nextVisibility);
            }
          })();
        }}
      >
        {isAlwaysVisible ? (
          <EyeIcon className="h-4 w-4" />
        ) : (
          <EyeSlashIcon className="h-4 w-4" />
        )}
      </Button>
    </Tooltip>
  );
};

export default CardTextVisibilityToggle;
