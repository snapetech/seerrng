import MeshNetworkIcon from '@app/assets/mesh-network.svg';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import Tooltip from '@app/components/Common/Tooltip';
import type {
  AssociationEdge,
  AssociationGraph,
} from '@app/hooks/useAssociations';
import { mapWithConcurrency } from '@app/utils/concurrency';
import defineMessages from '@app/utils/defineMessages';
import { Transition } from '@headlessui/react';
import type { MovieResult } from '@server/models/Search';
import axios from 'axios';
import Link from 'next/link';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.CollectionDetails.Associations', {
  associations: 'Associations',
  empty: 'No collection associations are available.',
});

const getAssociationHref = (edge: AssociationEdge) => {
  const routeType =
    edge.node.mediaType === 'album' ? 'music' : edge.node.mediaType;
  return `/${routeType}/${edge.node.id}`;
};

const CollectionAssociationsButton = ({ parts }: { parts: MovieResult[] }) => {
  const intl = useIntl();
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [edges, setEdges] = useState<AssociationEdge[]>([]);

  const open = async () => {
    setShow(true);
    if (edges.length > 0 || loading) return;
    setLoading(true);
    const collectionIds = new Set(parts.map((part) => String(part.id)));
    const results = await mapWithConcurrency(parts, 5, async (part) => {
      try {
        return (
          await axios.get<AssociationGraph>(
            `/api/v1/association/movie/${part.id}?includeWeak=true`
          )
        ).data.edges;
      } catch {
        return [];
      }
    });
    const unique = new Map<string, AssociationEdge>();
    results.flat().forEach((edge) => {
      const nodeId = String(edge.node.id);
      if (edge.node.mediaType === 'movie' && collectionIds.has(nodeId)) return;
      const key = `${edge.node.mediaType}-${nodeId}`;
      if (!unique.has(key) || (unique.get(key)?.weight ?? 0) < edge.weight) {
        unique.set(key, edge);
      }
    });
    setEdges([...unique.values()].sort((a, b) => b.weight - a.weight));
    setLoading(false);
  };

  return (
    <>
      <Tooltip content={intl.formatMessage(messages.associations)}>
        <Button
          buttonType="association"
          buttonSize="sm"
          onClick={() => void open()}
        >
          <MeshNetworkIcon className="h-4 w-4" />
          <span>{intl.formatMessage(messages.associations)}</span>
        </Button>
      </Tooltip>
      <Transition show={show} as="div">
        <Modal
          title={intl.formatMessage(messages.associations)}
          onCancel={() => setShow(false)}
        >
          {loading ? (
            <LoadingSpinner />
          ) : edges.length === 0 ? (
            <p className="refreshed-detail-text text-center text-sm">
              {intl.formatMessage(messages.empty)}
            </p>
          ) : (
            <div className="scrollable-card grid max-h-80 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
              {edges.map((edge) => (
                <Link
                  key={`${edge.node.mediaType}-${edge.node.id}`}
                  href={getAssociationHref(edge)}
                  onClick={() => setShow(false)}
                  className="refreshed-inset-surface rounded-lg border border-gray-700 px-3 py-2 transition hover:border-cyan-400 hover:text-white"
                >
                  <span className="block truncate font-semibold">
                    {'title' in edge.node ? edge.node.title : edge.node.name}
                  </span>
                  <span className="refreshed-detail-text-muted block truncate text-xs">
                    {edge.reason}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Modal>
      </Transition>
    </>
  );
};

export default CollectionAssociationsButton;
