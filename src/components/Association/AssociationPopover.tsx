import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import type { AssociationMediaType } from '@app/hooks/useAssociations';
import useAssociations from '@app/hooks/useAssociations';
import defineMessages from '@app/utils/defineMessages';
import { useIntl } from 'react-intl';
import AssociationDetailCard from './AssociationDetailCard';

const messages = defineMessages('components.Association', {
  similar: 'More like this',
  similarartists: 'Similar artists',
  alsoconnected: 'Also connected',
  empty: 'No associations found yet',
  loaderror: 'Could not load associations.',
});

interface AssociationPopoverProps {
  mediaType: AssociationMediaType;
  id: string | number;
  onSelect?: () => void;
}

const AssociationPopover = ({
  mediaType,
  id,
  onSelect,
}: AssociationPopoverProps) => {
  const intl = useIntl();
  const { edges, isLoading, isError } = useAssociations(mediaType, id, {
    includeWeak: true,
  });
  const similarLabel =
    mediaType === 'album' || mediaType === 'artist'
      ? intl.formatMessage(messages.similarartists)
      : intl.formatMessage(messages.similar);

  const sameMedium = edges
    .filter((e) => e.type === 'similar' || e.type === 'recommended')
    .slice(0, 5);
  const connected = edges
    .filter((e) => e.type === 'shared-person' || e.type === 'shared-genre')
    .slice(0, 4);

  return (
    <div className="scrollable-card max-h-[min(60vh,32rem)] overflow-y-auto">
      {isLoading && (
        <div className="space-y-2 px-2 py-3">
          <div className="mb-3 flex justify-center">
            <LoadingSpinner />
          </div>
          {[0, 1, 2].map((item) => (
            <div key={item} className="flex items-center gap-3">
              <div className="h-12 w-9 flex-shrink-0 animate-pulse rounded bg-gray-700" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3 w-3/4 animate-pulse rounded bg-gray-700" />
                <div className="h-2.5 w-1/2 animate-pulse rounded bg-gray-700" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && isError && (
        <div className="px-3 py-6 text-center text-sm text-red-300">
          {intl.formatMessage(messages.loaderror)}
        </div>
      )}

      {!isLoading && !isError && edges.length === 0 && (
        <div className="px-3 py-6 text-center text-sm text-gray-400">
          {intl.formatMessage(messages.empty)}
        </div>
      )}

      {sameMedium.length > 0 && (
        <section className="mb-4">
          <h2 className="mb-2 text-xs font-semibold tracking-wider text-gray-200 uppercase">
            {similarLabel}
          </h2>
          <div className="grid grid-cols-1 gap-2">
            {sameMedium.map((edge) => (
              <AssociationDetailCard
                key={`${edge.node.mediaType}:${edge.node.id}`}
                edge={edge}
                onSelect={onSelect}
              />
            ))}
          </div>
        </section>
      )}

      {connected.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold tracking-wider text-gray-200 uppercase">
            {intl.formatMessage(messages.alsoconnected)}
          </h2>
          <div className="grid grid-cols-1 gap-2">
            {connected.map((edge) => (
              <AssociationDetailCard
                key={`${edge.node.mediaType}:${edge.node.id}`}
                edge={edge}
                onSelect={onSelect}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default AssociationPopover;
