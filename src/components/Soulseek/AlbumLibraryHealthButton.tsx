import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import Tooltip from '@app/components/Common/Tooltip';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { WrenchScrewdriverIcon } from '@heroicons/react/24/outline';
import axios from 'axios';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

interface AlbumIssue {
  issueId: string;
  type: string;
  severity: string;
  status: string;
  title?: string;
  reason?: string;
  canAutoFix: boolean;
  remediationJobId?: string;
}

const messages = defineMessages(
  'components.Soulseek.AlbumLibraryHealthButton',
  {
    button: 'Library Health',
    tooltip: 'Check this album for transcodes and missing tracks in slskdN',
    title: 'Library Health',
    loading: 'Checking slskdN…',
    loadError: 'slskdN library health could not be loaded.',
    none: 'slskdN has not found any open issues for this album.',
    track: 'Track',
    severity: 'Severity',
    status: 'Status',
    fixable: 'Fixable',
    fixAll: 'Fix {count, plural, one {# Issue} other {# Issues}} with Soulseek',
    fixing: 'Starting…',
    fixStarted:
      'slskdN started fixing {count, plural, one {# issue} other {# issues}}.',
    fixFailed: 'slskdN could not start the fix.',
    close: 'Close',
    SuspectedTranscode: 'Suspected Transcode',
    NonCanonicalVariant: 'Non-Canonical Variant',
    TrackNotInTaggedRelease: 'Track Not in Release',
    MissingTrackInRelease: 'Missing Track',
    CorruptedFile: 'Corrupted File',
    MissingMetadata: 'Missing Metadata',
    MultipleVariants: 'Multiple Variants',
    WrongDuration: 'Wrong Duration',
  }
);

const issueLabel = (type: string) =>
  type in messages ? messages[type as keyof typeof messages] : undefined;

interface AlbumLibraryHealthButtonProps {
  releaseGroupId: string;
}

/**
 * Manager-only view of slskdN library-health issues for an album, with a
 * one-step fix for issues slskdN can remediate automatically.
 */
const AlbumLibraryHealthButton = ({
  releaseGroupId,
}: AlbumLibraryHealthButtonProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { hasPermission } = useUser();
  const canManage = hasPermission(Permission.MANAGE_REQUESTS);
  const { data: status } = useSWR<{ configured: boolean }>(
    canManage ? '/api/v1/soulseek/status' : null,
    { revalidateOnFocus: false }
  );
  const [open, setOpen] = useState(false);
  const [fixing, setFixing] = useState(false);
  const { data, error, mutate } = useSWR<{ issues: AlbumIssue[] }>(
    open
      ? `/api/v1/soulseek/albums/${encodeURIComponent(releaseGroupId)}/issues`
      : null
  );

  if (!canManage || !status?.configured) {
    return null;
  }

  const fixable = (data?.issues ?? []).filter(
    (issue) => issue.canAutoFix && !issue.remediationJobId
  );

  const fix = async () => {
    setFixing(true);
    try {
      const response = await axios.post<{ issueCount: number }>(
        `/api/v1/soulseek/albums/${encodeURIComponent(releaseGroupId)}/remediate`,
        { issueIds: fixable.map((issue) => issue.issueId) }
      );
      addToast(
        intl.formatMessage(messages.fixStarted, {
          count: response.data.issueCount,
        }),
        { appearance: 'success', autoDismiss: true }
      );
      await mutate();
    } catch (failure) {
      addToast(
        axios.isAxiosError(failure) &&
          typeof failure.response?.data?.message === 'string'
          ? failure.response.data.message
          : intl.formatMessage(messages.fixFailed),
        { appearance: 'error', autoDismiss: true }
      );
    } finally {
      setFixing(false);
    }
  };

  return (
    <>
      <Tooltip content={intl.formatMessage(messages.tooltip)}>
        <Button
          buttonType="default"
          buttonSize="sm"
          onClick={() => setOpen(true)}
          aria-label={intl.formatMessage(messages.button)}
        >
          <WrenchScrewdriverIcon />
          <span>{intl.formatMessage(messages.button)}</span>
        </Button>
      </Tooltip>
      {open && (
        <Modal
          title={intl.formatMessage(messages.title)}
          onCancel={() => setOpen(false)}
          cancelText={intl.formatMessage(messages.close)}
          onOk={fixable.length > 0 ? () => void fix() : undefined}
          okText={
            fixable.length > 0
              ? intl.formatMessage(fixing ? messages.fixing : messages.fixAll, {
                  count: fixable.length,
                })
              : undefined
          }
          okDisabled={fixing}
        >
          {!data && !error && <LoadingSpinner />}
          {error && (
            <p className="card-body-text">
              {intl.formatMessage(messages.loadError)}
            </p>
          )}
          {data && data.issues.length === 0 && (
            <p className="card-body-text">
              {intl.formatMessage(messages.none)}
            </p>
          )}
          {data && data.issues.length > 0 && (
            <ul className="card-list">
              {data.issues.map((issue) => {
                const label = issueLabel(issue.type);
                return (
                  <li key={issue.issueId}>
                    <article className="app-card-sub card-layout">
                      <div className="page-title-row">
                        <h3 className="card-title">
                          {label ? intl.formatMessage(label) : issue.type}
                        </h3>
                        {issue.canAutoFix && (
                          <Badge badgeType="success">
                            {intl.formatMessage(messages.fixable)}
                          </Badge>
                        )}
                      </div>
                      <dl className="card-table">
                        {issue.title && (
                          <>
                            <dt>{intl.formatMessage(messages.track)}</dt>
                            <dd>{issue.title}</dd>
                          </>
                        )}
                        <dt>{intl.formatMessage(messages.severity)}</dt>
                        <dd>{issue.severity}</dd>
                        <dt>{intl.formatMessage(messages.status)}</dt>
                        <dd>{issue.status}</dd>
                      </dl>
                      {issue.reason && (
                        <p className="card-body-text">{issue.reason}</p>
                      )}
                    </article>
                  </li>
                );
              })}
            </ul>
          )}
        </Modal>
      )}
    </>
  );
};

export default AlbumLibraryHealthButton;
