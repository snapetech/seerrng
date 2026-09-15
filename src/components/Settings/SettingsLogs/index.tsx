import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import PageTitle from '@app/components/Common/PageTitle';
import PaginationFooter from '@app/components/Common/PaginationFooter';
import Table from '@app/components/Common/Table';
import Tooltip from '@app/components/Common/Tooltip';
import useDebouncedState from '@app/hooks/useDebouncedState';
import useToasts from '@app/hooks/useToasts';
import {
  getPositiveQueryParamNumber,
  useUpdateQueryParams,
} from '@app/hooks/useUpdateQueryParams';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import {
  isStoredOption,
  isStoredPageSize,
  readLocalStoredRecord,
  writeLocalStoredRecord,
} from '@app/utils/localStorage';
import { Transition } from '@headlessui/react';
import {
  ClipboardDocumentIcon,
  DocumentMagnifyingGlassIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  PauseIcon,
  PlayIcon,
} from '@heroicons/react/24/solid';
import type {
  LogMessage,
  LogsResultsResponse,
} from '@server/interfaces/api/settingsInterfaces';
import copy from 'copy-to-clipboard';
import { useRouter } from 'next/router';
import { Fragment, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Settings.SettingsLogs', {
  logs: 'Logs',
  logsDescription:
    'You can also view these logs directly via <code>stdout</code>, or in <code>{appDataPath}/logs/seerr.log</code>.',
  time: 'Timestamp',
  level: 'Severity',
  label: 'Label',
  message: 'Message',
  filterDebug: 'Debug',
  filterInfo: 'Info',
  filterWarn: 'Warning',
  filterError: 'Error',
  showall: 'Show All Logs',
  pauseLogs: 'Pause',
  resumeLogs: 'Resume',
  copyToClipboard: 'Copy to Clipboard',
  logDetails: 'Log Details',
  extraData: 'Additional Data',
  copiedLogMessage: 'Copied log message to clipboard.',
  viewdetails: 'View Details',
});

type Filter = 'debug' | 'info' | 'warn' | 'error';
const LOG_FILTER_OPTIONS: readonly Filter[] = [
  'debug',
  'info',
  'warn',
  'error',
];
const LOG_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

const SettingsLogs = () => {
  const router = useRouter();
  const intl = useIntl();
  const { addToast } = useToasts();
  const [currentFilter, setCurrentFilter] = useState<Filter>('debug');
  const [currentPageSize, setCurrentPageSize] = useState(25);
  const [searchFilter, debouncedSearchFilter, setSearchFilter] =
    useDebouncedState('');
  const [refreshInterval, setRefreshInterval] = useState(5000);
  const [activeLog, setActiveLog] = useState<{
    isOpen: boolean;
    log?: LogMessage;
  }>({ isOpen: false });

  const page = getPositiveQueryParamNumber(router.query.page, 1) ?? 1;
  const pageIndex = page - 1;
  const updateQueryParams = useUpdateQueryParams({ page: page.toString() });

  const toggleLogs = () => {
    setRefreshInterval(refreshInterval === 5000 ? 0 : 5000);
  };

  const { data, error } = useSWR<LogsResultsResponse>(
    `/api/v1/settings/logs?take=${currentPageSize}&skip=${
      pageIndex * currentPageSize
    }&filter=${currentFilter}${
      debouncedSearchFilter
        ? `&search=${encodeURIComponent(debouncedSearchFilter)}`
        : ''
    }`,
    {
      refreshInterval: refreshInterval,
      revalidateOnFocus: false,
    }
  );

  const { data: appData } = useSWR('/api/v1/status/appdata');

  useEffect(() => {
    const filterSettings = readLocalStoredRecord('logs-display-settings');
    if (filterSettings) {
      if (isStoredOption(filterSettings.currentFilter, LOG_FILTER_OPTIONS)) {
        setCurrentFilter(filterSettings.currentFilter);
      }
      if (
        isStoredPageSize(filterSettings.currentPageSize, LOG_PAGE_SIZE_OPTIONS)
      ) {
        setCurrentPageSize(filterSettings.currentPageSize);
      }
    }
  }, []);

  useEffect(() => {
    writeLocalStoredRecord('logs-display-settings', {
      currentFilter,
      currentPageSize,
    });
  }, [currentFilter, currentPageSize]);

  const copyLogString = (log: LogMessage): void => {
    copy(
      `${log.timestamp} [${log.level}]${log.label ? `[${log.label}]` : ''}: ${
        log.message
      }${log.data ? `${JSON.stringify(log.data)}` : ''}`
    );
    addToast(intl.formatMessage(messages.copiedLogMessage), {
      appearance: 'success',
      autoDismiss: true,
    });
  };

  // check if there's no data and no errors in the table
  // so as to show a spinner inside the table and not refresh the whole component
  if (!data && error) {
    return <ErrorPage statusCode={500} />;
  }

  const changePage = (nextPage: number) => {
    updateQueryParams('page', String(nextPage));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      <PageTitle
        title={[
          intl.formatMessage(messages.logs),
          intl.formatMessage(globalMessages.settings),
        ]}
      />
      <Transition
        as={Fragment}
        enter="transition-opacity duration-300"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="transition-opacity duration-300"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
        appear
        show={activeLog.isOpen}
      >
        <Modal
          title={intl.formatMessage(messages.logDetails)}
          onCancel={() => setActiveLog({ log: activeLog.log, isOpen: false })}
          cancelText={intl.formatMessage(globalMessages.close)}
          onOk={() =>
            activeLog.log ? copyLogString(activeLog.log) : undefined
          }
          okText={intl.formatMessage(messages.copyToClipboard)}
          okButtonType="primary"
        >
          {activeLog && (
            <>
              <div className="form-row">
                <div className="text-label">
                  {intl.formatMessage(messages.time)}
                </div>
                <div className="mb-1 text-sm leading-5 font-medium text-gray-400 sm:mt-2">
                  <div className="flex max-w-lg items-center">
                    {intl.formatDate(activeLog.log?.timestamp, {
                      year: 'numeric',
                      month: 'short',
                      day: '2-digit',
                      hour: 'numeric',
                      minute: 'numeric',
                      second: 'numeric',
                    })}
                  </div>
                </div>
              </div>
              <div className="form-row">
                <div className="text-label">
                  {intl.formatMessage(messages.level)}
                </div>
                <div className="mb-1 text-sm leading-5 font-medium text-gray-400 sm:mt-2">
                  <div className="flex max-w-lg items-center">
                    <Badge
                      badgeType={
                        activeLog.log?.level === 'error'
                          ? 'danger'
                          : activeLog.log?.level === 'warn'
                            ? 'warning'
                            : activeLog.log?.level === 'info'
                              ? 'success'
                              : 'default'
                      }
                    >
                      {activeLog.log?.level.toUpperCase()}
                    </Badge>
                  </div>
                </div>
              </div>
              <div className="form-row">
                <div className="text-label">
                  {intl.formatMessage(messages.label)}
                </div>
                <div className="mb-1 text-sm leading-5 font-medium text-gray-400 sm:mt-2">
                  <div className="flex max-w-lg items-center">
                    {activeLog.log?.label}
                  </div>
                </div>
              </div>
              <div className="form-row">
                <div className="text-label">
                  {intl.formatMessage(messages.message)}
                </div>
                <div className="col-span-2 mb-1 text-sm leading-5 font-medium text-gray-400 sm:mt-2">
                  <div className="flex max-w-lg items-center">
                    {activeLog.log?.message}
                  </div>
                </div>
              </div>
              {activeLog.log?.data && (
                <div className="form-row">
                  <div className="text-label">
                    {intl.formatMessage(messages.extraData)}
                  </div>
                  <div className="col-span-2 mb-1 text-sm leading-5 font-medium text-gray-400 sm:mt-2">
                    <code className="block max-h-64 w-full overflow-auto bg-gray-800 px-6 py-4 whitespace-pre ring-1 ring-gray-700">
                      {JSON.stringify(activeLog.log?.data, null, ' ')}
                    </code>
                  </div>
                </div>
              )}
            </>
          )}
        </Modal>
      </Transition>
      <div className="mb-2">
        <h3 className="heading">{intl.formatMessage(messages.logs)}</h3>
        <p className="description">
          {intl.formatMessage(messages.logsDescription, {
            code: (msg: React.ReactNode) => (
              <code className="bg-gray-800/50 break-words whitespace-normal">
                {msg}
              </code>
            ),
            appDataPath: appData ? appData.appDataPath : '/app/config',
          })}
        </p>
        <div className="settings-log-toolbar">
          <div className="settings-log-search-control">
            <span className="settings-log-control-icon">
              <MagnifyingGlassIcon />
            </span>
            <input
              type="text"
              className="settings-log-search-input"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value as string)}
            />
          </div>
          <Button
            buttonType={refreshInterval ? 'default' : 'primary'}
            buttonSize="standard"
            onClick={() => toggleLogs()}
          >
            {refreshInterval ? <PauseIcon /> : <PlayIcon />}
            <span>
              {intl.formatMessage(
                refreshInterval ? messages.pauseLogs : messages.resumeLogs
              )}
            </span>
          </Button>
          <div className="settings-log-filter-control">
            <span className="settings-log-control-icon">
              <FunnelIcon />
            </span>
            <select
              id="filter"
              name="filter"
              onChange={(e) => {
                setCurrentFilter(e.target.value as Filter);
                router.push(router.pathname);
              }}
              value={currentFilter}
              className="settings-log-filter-select"
            >
              <option value="debug">
                {intl.formatMessage(messages.filterDebug)}
              </option>
              <option value="info">
                {intl.formatMessage(messages.filterInfo)}
              </option>
              <option value="warn">
                {intl.formatMessage(messages.filterWarn)}
              </option>
              <option value="error">
                {intl.formatMessage(messages.filterError)}
              </option>
            </select>
          </div>
        </div>
        <Table className="settings-logs-table">
          <thead>
            <tr>
              <Table.TH className="w-52">
                {intl.formatMessage(messages.time)}
              </Table.TH>
              <Table.TH className="w-28">
                {intl.formatMessage(messages.level)}
              </Table.TH>
              <Table.TH className="w-40">
                {intl.formatMessage(messages.label)}
              </Table.TH>
              <Table.TH>{intl.formatMessage(messages.message)}</Table.TH>
              <Table.TH className="w-28" />
            </tr>
          </thead>
          <Table.TBody>
            {!data ? (
              <tr>
                <Table.TD colSpan={5} noPadding>
                  <LoadingSpinner />
                </Table.TD>
              </tr>
            ) : (
              data.results.map((row: LogMessage, index: number) => {
                return (
                  <tr key={`log-list-${index}`}>
                    <Table.TD className="settings-log-primary-cell text-gray-300">
                      {intl.formatDate(row.timestamp, {
                        year: 'numeric',
                        month: 'short',
                        day: '2-digit',
                        hour: 'numeric',
                        minute: 'numeric',
                        second: 'numeric',
                      })}
                    </Table.TD>
                    <Table.TD className="settings-log-primary-cell text-gray-300">
                      <Badge
                        badgeType={
                          row.level === 'error'
                            ? 'danger'
                            : row.level === 'warn'
                              ? 'warning'
                              : row.level === 'info'
                                ? 'success'
                                : 'default'
                        }
                      >
                        {row.level.toUpperCase()}
                      </Badge>
                    </Table.TD>
                    <Table.TD className="settings-log-primary-cell text-gray-300">
                      {row.label ?? ''}
                    </Table.TD>
                    <Table.TD className="text-gray-300">{row.message}</Table.TD>
                    <Table.TD className="-m-1 flex flex-wrap items-center justify-end">
                      {row.data && (
                        <Tooltip
                          content={intl.formatMessage(messages.viewdetails)}
                        >
                          <Button
                            buttonSize="sm"
                            buttonType="primary"
                            onClick={() =>
                              setActiveLog({ log: row, isOpen: true })
                            }
                            className="m-1"
                          >
                            <DocumentMagnifyingGlassIcon className="icon-md" />
                          </Button>
                        </Tooltip>
                      )}
                      <Tooltip
                        content={intl.formatMessage(messages.copyToClipboard)}
                      >
                        <Button
                          buttonType="primary"
                          buttonSize="sm"
                          onClick={() => copyLogString(row)}
                          className="m-1"
                        >
                          <ClipboardDocumentIcon className="icon-md" />
                        </Button>
                      </Tooltip>
                    </Table.TD>
                  </tr>
                );
              })
            )}

            {data?.results.length === 0 && (
              <tr className="relative h-24 p-2 text-white">
                <Table.TD colSpan={5} noPadding>
                  <div className="flex w-screen flex-col items-center justify-center p-6 md:w-full">
                    <span className="text-base">
                      {intl.formatMessage(globalMessages.noresults)}
                    </span>
                    {currentFilter !== 'debug' && (
                      <div className="mt-4">
                        <Button
                          buttonSize="sm"
                          buttonType="primary"
                          onClick={() => setCurrentFilter('debug')}
                        >
                          {intl.formatMessage(messages.showall)}
                        </Button>
                      </div>
                    )}
                  </div>
                </Table.TD>
              </tr>
            )}
          </Table.TBody>
        </Table>
        <PaginationFooter
          defaultPageSize={25}
          page={page}
          pageSize={currentPageSize}
          totalPages={data?.pageInfo.pages ?? 1}
          onPageChange={changePage}
          onPageSizeChange={(size) => {
            setCurrentPageSize(size);
            void router.push(router.pathname).then(() => window.scrollTo(0, 0));
          }}
        />
      </div>
    </>
  );
};

export default SettingsLogs;
