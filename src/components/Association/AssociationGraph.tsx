import CachedImage from '@app/components/Common/CachedImage';
import type {
  AssociationEdgeType,
  AssociationGraph as GraphData,
} from '@app/hooks/useAssociations';
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useRouter } from 'next/router';
import { useMemo, useState } from 'react';
import { nodeHref, nodeImage, nodeImageType, nodeTitle } from './helpers';

const EDGE_LABEL: Record<AssociationEdgeType, string> = {
  similar: 'Similar',
  recommended: 'Recommended',
  'shared-person': 'Shared person',
  'shared-genre': 'Weak connection',
};

const EDGE_CLASS: Record<
  AssociationEdgeType,
  { edge: string; swatch: string }
> = {
  similar: {
    edge: 'association-edge-similar',
    swatch: 'association-edge-swatch-similar',
  },
  recommended: {
    edge: 'association-edge-recommended',
    swatch: 'association-edge-swatch-recommended',
  },
  'shared-person': {
    edge: 'association-edge-shared-person',
    swatch: 'association-edge-swatch-shared-person',
  },
  'shared-genre': {
    edge: 'association-edge-shared-genre',
    swatch: 'association-edge-swatch-shared-genre',
  },
};

const MEDIA_TONE: Record<string, string> = {
  movie: 'border-blue-500/70 bg-blue-950/70 text-blue-100',
  tv: 'border-purple-500/70 bg-purple-950/70 text-purple-100',
  album: 'border-emerald-500/70 bg-emerald-950/70 text-emerald-100',
  artist: 'border-emerald-500/70 bg-emerald-950/70 text-emerald-100',
  book: 'border-amber-500/70 bg-amber-950/70 text-amber-100',
  person: 'border-slate-500/70 bg-slate-900/80 text-slate-100',
};

const EDGE_ORDER: AssociationEdgeType[] = [
  'shared-person',
  'similar',
  'recommended',
  'shared-genre',
];

const EDGE_ARC: Record<AssociationEdgeType, { start: number; end: number }> = {
  'shared-person': { start: -165, end: -75 },
  similar: { start: -45, end: 45 },
  recommended: { start: 75, end: 165 },
  'shared-genre': { start: 195, end: 285 },
};

const degreeToRadian = (degree: number): number => (degree * Math.PI) / 180;

interface GraphNodeData {
  label: string;
  image?: string;
  href?: string;
  isRoot?: boolean;
  mediaType?: string;
  reason?: string;
  weight?: number;
  imageType?: 'tmdb' | 'music' | 'book';
  [key: string]: unknown;
}

const GraphNode = ({ data }: { data: GraphNodeData }) => (
  <div
    data-testid="association-graph-node"
    className={`flex w-40 flex-col items-center gap-1 rounded-lg border p-2 text-center shadow-lg transition ${
      data.isRoot
        ? 'border-indigo-300 bg-indigo-900/80 text-white'
        : (MEDIA_TONE[data.mediaType ?? ''] ??
          'border-gray-600 bg-gray-800 text-white')
    }`}
  >
    <Handle type="target" position={Position.Top} className="!bg-gray-500" />
    {data.image && (
      <div className="relative h-20 w-14 overflow-hidden rounded bg-gray-800">
        <CachedImage
          type={data.imageType ?? 'tmdb'}
          src={data.image}
          alt=""
          fill
          style={{ objectFit: 'cover' }}
        />
      </div>
    )}
    <span className="line-clamp-2 text-xs font-semibold text-white">
      {data.label}
    </span>
    {!data.isRoot && data.mediaType && (
      <span className="rounded-full bg-black/20 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-current uppercase">
        {data.mediaType === 'album' ? 'music' : data.mediaType}
      </span>
    )}
    <Handle type="source" position={Position.Bottom} className="!bg-gray-500" />
  </div>
);

const nodeTypes = { assoc: GraphNode };

const AssociationGraph = ({ graph }: { graph: GraphData }) => {
  const router = useRouter();
  const [flow, setFlow] = useState<ReactFlowInstance | null>(null);
  const [selected, setSelected] = useState<GraphNodeData | null>(null);

  const { nodes, edges } = useMemo(() => {
    const rfNodes: Node[] = [];
    const rfEdges: Edge[] = [];

    rfNodes.push({
      id: 'root',
      type: 'assoc',
      position: { x: 0, y: 0 },
      data: { label: graph.root.title, isRoot: true },
      draggable: false,
    });

    const grouped = EDGE_ORDER.flatMap((type) =>
      graph.edges.filter((edge) => edge.type === type)
    );
    const ring = grouped.slice(0, 24);
    const typeCounts = ring.reduce<Record<AssociationEdgeType, number>>(
      (counts, edge) => ({
        ...counts,
        [edge.type]: counts[edge.type] + 1,
      }),
      {
        similar: 0,
        recommended: 0,
        'shared-person': 0,
        'shared-genre': 0,
      }
    );
    const typeIndexes: Record<AssociationEdgeType, number> = {
      similar: 0,
      recommended: 0,
      'shared-person': 0,
      'shared-genre': 0,
    };

    ring.forEach((edge) => {
      const typeIndex = typeIndexes[edge.type];
      const count = typeCounts[edge.type];
      const arc = EDGE_ARC[edge.type];
      const spread = count <= 1 ? 0.5 : typeIndex / (count - 1);
      const angle = degreeToRadian(arc.start + (arc.end - arc.start) * spread);
      const radius = 310 + (typeIndex % 3) * 58 + (ring.length > 14 ? 70 : 0);
      typeIndexes[edge.type] += 1;
      const id = `${edge.node.mediaType}:${edge.node.id}`;
      rfNodes.push({
        id,
        type: 'assoc',
        position: {
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius + radius,
        },
        data: {
          label: nodeTitle(edge.node),
          image: nodeImage(edge.node),
          imageType: nodeImageType(edge.node),
          href: nodeHref(edge.node),
          mediaType: edge.node.mediaType,
          reason: edge.reason,
          weight: edge.weight,
        },
      });
      rfEdges.push({
        id: `e-${id}`,
        source: 'root',
        target: id,
        animated: edge.type === 'shared-person',
        className: EDGE_CLASS[edge.type].edge,
      });
    });

    return { nodes: rfNodes, edges: rfEdges };
  }, [graph]);

  return (
    <div className="relative h-[70vh] min-h-[28rem] w-full overflow-hidden rounded-lg border border-gray-700 bg-gray-900">
      <div
        className="absolute top-3 left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-2 rounded-lg border border-gray-700 bg-gray-950/90 px-3 py-2 text-xs text-gray-300 shadow-xl"
        data-testid="association-graph-legend"
      >
        {Object.entries(EDGE_LABEL).map(([type, label]) => (
          <span key={type} className="flex items-center gap-1.5">
            <span
              className={`${EDGE_CLASS[type as AssociationEdgeType].swatch} h-2.5 w-2.5 rounded-full`}
            />
            {label}
          </span>
        ))}
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        data-testid="association-graph"
        minZoom={0.25}
        maxZoom={1.4}
        onInit={setFlow}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => {
          setSelected(node.data as GraphNodeData);
          flow?.setCenter(node.position.x + 80, node.position.y + 80, {
            zoom: 1,
            duration: 500,
          });
        }}
        onNodeDoubleClick={(_, node) => {
          const href = (node.data as GraphNodeData).href;
          if (href) {
            router.push(href);
          }
        }}
      >
        <Background color="#374151" gap={24} />
        <Controls showInteractive={false} />
      </ReactFlow>
      {selected && !selected.isRoot && (
        <div className="absolute right-3 bottom-3 left-3 z-10 rounded-lg border border-gray-700 bg-gray-950/95 p-3 text-sm shadow-xl sm:left-auto sm:w-80">
          <div className="flex items-start gap-3">
            {selected.image && (
              <div className="relative h-16 w-11 flex-shrink-0 overflow-hidden rounded bg-gray-800">
                <CachedImage
                  type={selected.imageType ?? 'tmdb'}
                  src={selected.image}
                  alt=""
                  fill
                  style={{ objectFit: 'cover' }}
                />
              </div>
            )}
            <div className="min-w-0">
              <div className="line-clamp-2 font-semibold text-white">
                {selected.label}
              </div>
              {selected.reason && (
                <div className="mt-1 text-gray-300">{selected.reason}</div>
              )}
              {selected.href && (
                <button
                  type="button"
                  className="mt-2 text-sm font-semibold text-indigo-400 transition hover:text-indigo-300"
                  onClick={() => {
                    if (selected.href) {
                      router.push(selected.href);
                    }
                  }}
                >
                  Open details
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AssociationGraph;
