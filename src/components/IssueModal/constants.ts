import defineMessages from '@app/utils/defineMessages';
import { IssueType } from '@server/constants/issue';
import type { MessageDescriptor } from 'react-intl';

const messages = defineMessages('components.IssueModal', {
  issueAudio: 'Audio',
  issueVideo: 'Video',
  issueSubtitles: 'Subtitle',
  issueOther: 'Other',
});

interface IssueOption {
  name: MessageDescriptor;
  issueType: IssueType;
  mediaType?: 'movie' | 'tv' | 'music' | 'book' | 'comic' | 'magazine';
}

export const issueOptions: IssueOption[] = [
  {
    name: messages.issueVideo,
    issueType: IssueType.VIDEO,
  },
  {
    name: messages.issueAudio,
    issueType: IssueType.AUDIO,
  },
  {
    name: messages.issueSubtitles,
    issueType: IssueType.SUBTITLES,
  },
  {
    name: messages.issueOther,
    issueType: IssueType.OTHER,
  },
];

export const getIssueOptionsForMediaType = (
  mediaType: IssueOption['mediaType']
): IssueOption[] => {
  if (mediaType === 'music') {
    return issueOptions.filter((option) =>
      [IssueType.AUDIO, IssueType.OTHER].includes(option.issueType)
    );
  }

  if (
    mediaType === 'book' ||
    mediaType === 'comic' ||
    mediaType === 'magazine'
  ) {
    return issueOptions.filter(
      (option) => option.issueType === IssueType.OTHER
    );
  }

  return issueOptions;
};
