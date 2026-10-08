import type {
  SetupConnectionAppId,
  SetupConnectionSuggestion,
} from '@app/utils/setupConnections';
import { parseSetupConnections } from '@app/utils/setupConnections';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

type SetupConnectionsContextValue = {
  connections: SetupConnectionSuggestion[];
  importFile: (file: File) => Promise<number>;
  clearConnections: () => void;
  suggestionFor: (
    appId: SetupConnectionAppId
  ) => SetupConnectionSuggestion | undefined;
};

const SetupConnectionsContext =
  createContext<SetupConnectionsContextValue | null>(null);

export const SetupConnectionsProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [connections, setConnections] = useState<SetupConnectionSuggestion[]>(
    []
  );
  const importFile = useCallback(async (file: File) => {
    if (file.size > 256 * 1024) {
      throw new Error('The setup file is larger than 256 KB.');
    }
    const parsed = parseSetupConnections(await file.text());
    setConnections(parsed);
    return parsed.length;
  }, []);
  const clearConnections = useCallback(() => setConnections([]), []);
  const suggestionFor = useCallback(
    (appId: SetupConnectionAppId) =>
      connections.find(
        (connection) =>
          connection.id === appId && connection.state === 'running'
      ) ?? connections.find((connection) => connection.id === appId),
    [connections]
  );
  const value = useMemo(
    () => ({ connections, importFile, clearConnections, suggestionFor }),
    [connections, importFile, clearConnections, suggestionFor]
  );

  return (
    <SetupConnectionsContext.Provider value={value}>
      {children}
    </SetupConnectionsContext.Provider>
  );
};

export const useSetupConnections = () => {
  const context = useContext(SetupConnectionsContext);
  if (!context) {
    throw new Error(
      'Setup connection assistance must be used inside SetupConnectionsProvider.'
    );
  }
  return context;
};

export const useSetupConnectionSuggestion = (appId: SetupConnectionAppId) =>
  useSetupConnections().suggestionFor(appId);
