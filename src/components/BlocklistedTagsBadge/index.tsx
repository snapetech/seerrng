import Badge from '@app/components/Common/Badge';
import Tooltip from '@app/components/Common/Tooltip';
import { mapWithConcurrency } from '@app/utils/concurrency';
import defineMessages from '@app/utils/defineMessages';
import { TagIcon } from '@heroicons/react/20/solid';
import type { BlocklistItem } from '@server/interfaces/api/blocklistInterfaces';
import type { Keyword } from '@server/models/common';
import axios from 'axios';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.BlocklistedTagsBadge', {
  blocklistTag: 'Blocklist Tag',
});
const KEYWORD_LOOKUP_CONCURRENCY = 8;

export const compactBlocklistSourceBadgeClass =
  'compact-detail-status-badge compact-detail-status-badge-danger max-w-full gap-0.5';

interface BlocklistedTagsBadgeProps {
  data: BlocklistItem;
  compact?: boolean;
}

const BlocklistedTagsBadge = ({
  data,
  compact = false,
}: BlocklistedTagsBadgeProps) => {
  const [tagNamesBlocklistedFor, setTagNamesBlocklistedFor] =
    useState<string>('Loading...');
  const intl = useIntl();

  useEffect(() => {
    if (!data.blocklistedTags) {
      return;
    }

    const controller = new AbortController();
    let active = true;
    const keywordIds = data.blocklistedTags.slice(1, -1).split(',');
    const loadTagNames = async () => {
      try {
        const keywords = await mapWithConcurrency(
          keywordIds,
          KEYWORD_LOOKUP_CONCURRENCY,
          async (keywordId) => {
            const { data } = await axios.get<Keyword | null>(
              `/api/v1/keyword/${keywordId}`,
              { signal: controller.signal }
            );
            return data?.name || `[Invalid: ${keywordId}]`;
          }
        );
        if (active) {
          setTagNamesBlocklistedFor(keywords.join(', '));
        }
      } catch {
        if (active) {
          setTagNamesBlocklistedFor(
            keywordIds.map((keywordId) => `[Invalid: ${keywordId}]`).join(', ')
          );
        }
      }
    };

    void loadTagNames();
    return () => {
      active = false;
      controller.abort();
    };
  }, [data.blocklistedTags]);

  return (
    <Tooltip
      content={tagNamesBlocklistedFor}
      tooltipConfig={{ followCursor: false }}
    >
      <Badge
        badgeType="dark"
        className={
          compact
            ? compactBlocklistSourceBadgeClass
            : 'items-center border border-red-500 !text-red-400'
        }
      >
        <TagIcon
          className={compact ? 'h-2.5 w-2.5 shrink-0' : 'mr-1 h-4'}
          aria-hidden="true"
        />
        <span className="truncate">
          {intl.formatMessage(messages.blocklistTag)}
        </span>
      </Badge>
    </Tooltip>
  );
};

export default BlocklistedTagsBadge;
