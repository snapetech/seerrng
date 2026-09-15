import type {
  AssociationEdge,
  AssociationGraph,
} from '@app/hooks/useAssociations';
import defineMessages from '@app/utils/defineMessages';
import { useIntl } from 'react-intl';
import AssociationDetailCard from './AssociationDetailCard';

const messages = defineMessages('components.Association', {
  similar: 'More like this',
  recommended: 'Recommended',
  similarartists: 'Similar artists',
  music: 'Connected music',
  screen: 'On screen',
  sharedgenre: 'Shared genre',
  listeneroverlap: 'Listener overlap',
  relatedbooks: 'Related books',
  books: 'Same author',
  empty: 'No associations found yet',
});

interface Section {
  key: string;
  title: string;
  match: (edge: AssociationEdge) => boolean;
}

const AssociationWall = ({ graph }: { graph: AssociationGraph }) => {
  const intl = useIntl();
  const similarTitle =
    graph.root.mediaType === 'album' || graph.root.mediaType === 'artist'
      ? intl.formatMessage(messages.similarartists)
      : intl.formatMessage(messages.similar);
  const weakTitle =
    graph.root.mediaType === 'album' || graph.root.mediaType === 'artist'
      ? intl.formatMessage(messages.listeneroverlap)
      : graph.root.mediaType === 'book'
        ? intl.formatMessage(messages.relatedbooks)
        : intl.formatMessage(messages.sharedgenre);

  const sections: Section[] = [
    {
      key: 'similar',
      title: similarTitle,
      match: (e) => e.type === 'similar',
    },
    {
      key: 'recommended',
      title: intl.formatMessage(messages.recommended),
      match: (e) => e.type === 'recommended',
    },
    {
      key: 'music',
      title: intl.formatMessage(messages.music),
      match: (e) =>
        e.type === 'shared-person' &&
        (e.node.mediaType === 'artist' || e.node.mediaType === 'album'),
    },
    {
      key: 'screen',
      title: intl.formatMessage(messages.screen),
      match: (e) =>
        e.type === 'shared-person' &&
        (e.node.mediaType === 'movie' || e.node.mediaType === 'tv'),
    },
    {
      key: 'books',
      title: intl.formatMessage(messages.books),
      match: (e) => e.type === 'shared-person' && e.node.mediaType === 'book',
    },
    {
      key: 'adjacent',
      title: weakTitle,
      match: (e) => e.type === 'shared-genre',
    },
  ];

  const rendered = sections
    .map((section) => ({
      section,
      edges: graph.edges.filter(section.match),
    }))
    .filter(({ edges }) => edges.length > 0);

  if (rendered.length === 0) {
    return (
      <div className="py-16 text-center text-gray-400">
        {intl.formatMessage(messages.empty)}
      </div>
    );
  }

  return (
    <div className="space-y-8" data-testid="association-wall">
      {rendered.map(({ section, edges }) => (
        <div key={section.key}>
          <div className="slider-header">
            <div className="slider-title">
              <span>{section.title}</span>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3">
            {edges.map((edge) => (
              <AssociationDetailCard
                key={`${edge.node.mediaType}:${edge.node.id}`}
                edge={edge}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default AssociationWall;
