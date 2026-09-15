import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import type { AssociationMediaType } from '@app/hooks/useAssociations';
import useAssociations from '@app/hooks/useAssociations';
import defineMessages from '@app/utils/defineMessages';
import {
  readLocalStorageValue,
  writeLocalStorageValue,
} from '@app/utils/localStorage';
import { ListBulletIcon, ShareIcon } from '@heroicons/react/24/solid';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import AssociationWall from './AssociationWall';

const AssociationGraph = dynamic(() => import('./AssociationGraph'), {
  ssr: false,
  loading: () => <LoadingSpinner />,
});

const messages = defineMessages('components.Association', {
  title: 'Associations for {title}',
  wallview: 'List',
  graphview: 'Map',
  loaderror: 'Could not load associations.',
});

type ViewMode = 'wall' | 'graph';
const STORAGE_KEY = 'association-view-mode';
const GRAPH_MEDIA_QUERY = '(min-width: 640px)';

const AssociationExplorer = () => {
  const intl = useIntl();
  const router = useRouter();
  const mediaType = router.query.mediaType as AssociationMediaType;
  const id = router.query.id as string;

  const [view, setView] = useState<ViewMode>('wall');
  const [isGraphAvailable, setIsGraphAvailable] = useState(false);

  useEffect(() => {
    const stored = readLocalStorageValue(STORAGE_KEY);
    if (stored === 'graph' || stored === 'wall') {
      setView(stored);
    }
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia(GRAPH_MEDIA_QUERY);

    const updateGraphAvailability = () => {
      const canShowGraph = mediaQuery.matches;
      setIsGraphAvailable(canShowGraph);

      if (!canShowGraph) {
        setView('wall');
      }
    };

    updateGraphAvailability();
    mediaQuery.addEventListener('change', updateGraphAvailability);

    return () => {
      mediaQuery.removeEventListener('change', updateGraphAvailability);
    };
  }, []);

  const setMode = (mode: ViewMode) => {
    if (mode === 'graph' && !isGraphAvailable) {
      return;
    }

    setView(mode);
    writeLocalStorageValue(STORAGE_KEY, mode);
  };

  const { graph, isLoading, isError } = useAssociations(mediaType, id, {
    includeWeak: true,
  });

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (isError || !graph) {
    return (
      <div className="py-16 text-center text-gray-400">
        {intl.formatMessage(messages.loaderror)}
      </div>
    );
  }

  const effectiveView = isGraphAvailable ? view : 'wall';

  return (
    <div className="discover-home">
      <PageTitle
        title={intl.formatMessage(messages.title, {
          title: graph.root.title,
        })}
      />
      <div className="mt-2 mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="min-w-0 text-2xl font-bold break-words text-white">
          {intl.formatMessage(messages.title, { title: graph.root.title })}
        </h1>
        <div className="flex flex-shrink-0 flex-wrap gap-2">
          <Button
            buttonType={effectiveView === 'wall' ? 'primary' : 'default'}
            buttonSize="sm"
            onClick={() => setMode('wall')}
          >
            <ListBulletIcon />
            <span>{intl.formatMessage(messages.wallview)}</span>
          </Button>
          {isGraphAvailable && (
            <Button
              buttonType={effectiveView === 'graph' ? 'primary' : 'default'}
              buttonSize="sm"
              onClick={() => setMode('graph')}
            >
              <ShareIcon />
              <span>{intl.formatMessage(messages.graphview)}</span>
            </Button>
          )}
        </div>
      </div>

      {effectiveView === 'wall' ? (
        <AssociationWall graph={graph} />
      ) : (
        <AssociationGraph graph={graph} />
      )}
    </div>
  );
};

export default AssociationExplorer;
