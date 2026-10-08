import Button from '@app/components/Common/Button';
import { useSetupConnections } from '@app/context/SetupConnectionsContext';
import defineMessages from '@app/utils/defineMessages';
import { useRef, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Settings.SetupConnectionsImport', {
  import: 'Import connection report',
  help: 'Choose a seerrng-connections.json file from Docker discovery or manual setup. Hostnames and ports will prefill matching service forms; API keys are never imported.',
  imported:
    'Loaded suggestions for {count, plural, one {# app} other {# apps}}. Matching add forms will use these hostnames and ports.',
  clear: 'Clear imported suggestions',
  invalidFile: 'Unable to read this setup file.',
});

const SetupConnectionsImport = () => {
  const intl = useIntl();
  const input = useRef<HTMLInputElement>(null);
  const { connections, importFile, clearConnections } = useSetupConnections();
  const [error, setError] = useState('');

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const target = event.currentTarget;
    const file = target.files?.[0];
    if (!file) return;
    setError('');
    try {
      await importFile(file);
    } catch {
      setError(intl.formatMessage(messages.invalidFile));
    } finally {
      target.value = '';
    }
  };

  return (
    <>
      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label={intl.formatMessage(messages.import)}
          onChange={handleFileChange}
        />
        <Button
          buttonType="default"
          buttonSize="standard"
          onClick={() => input.current?.click()}
        >
          {intl.formatMessage(messages.import)}
        </Button>
        {connections.length > 0 && (
          <>
            <p className="description" role="status">
              {intl.formatMessage(messages.imported, {
                count: connections.length,
              })}
            </p>
            <Button
              buttonType="default"
              buttonSize="standard"
              onClick={clearConnections}
            >
              {intl.formatMessage(messages.clear)}
            </Button>
          </>
        )}
      </div>
      <p className="description">{intl.formatMessage(messages.help)}</p>
      {error && (
        <p className="description" role="alert">
          {error}
        </p>
      )}
    </>
  );
};

export default SetupConnectionsImport;
