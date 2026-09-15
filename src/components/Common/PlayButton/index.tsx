import Button from '@app/components/Common/Button';
import ButtonWithDropdown from '@app/components/Common/ButtonWithDropdown';
import { getSafeHref } from '@app/utils/safeUrl';

interface PlayButtonProps {
  links: PlayButtonLink[];
  buttonSize?: 'standard' | 'default' | 'sm';
  unavailableLink?: Omit<PlayButtonLink, 'url'>;
  disabledReason?: string;
}

export interface PlayButtonLink {
  text: string;
  url: string;
  svg: React.ReactNode;
}

const PlayButton = ({
  links,
  buttonSize = 'standard',
  unavailableLink,
  disabledReason,
}: PlayButtonProps) => {
  const safeLinks = links
    .map((link) => ({ ...link, url: getSafeHref(link.url) }))
    .filter((link): link is PlayButtonLink => Boolean(link.url));

  if (!safeLinks.length) {
    return unavailableLink ? (
      <Button
        buttonType="playback"
        buttonSize={buttonSize}
        disabled
        disabledReason={disabledReason}
      >
        <span className="playback-button-label">
          {unavailableLink.svg}
          <span>{unavailableLink.text}</span>
        </span>
      </Button>
    ) : null;
  }

  return (
    <ButtonWithDropdown
      as="a"
      buttonType="playback"
      buttonSize={buttonSize}
      text={
        <span className="playback-button-label">
          {safeLinks[0].svg}
          <span>{safeLinks[0].text}</span>
        </span>
      }
      href={safeLinks[0].url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {safeLinks.length > 1 &&
        safeLinks.slice(1).map((link, i) => {
          return (
            <ButtonWithDropdown.Item
              key={`play-button-dropdown-item-${i}`}
              buttonType="playback"
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="playback-button-label">
                {link.svg}
                <span>{link.text}</span>
              </span>
            </ButtonWithDropdown.Item>
          );
        })}
    </ButtonWithDropdown>
  );
};

export default PlayButton;
