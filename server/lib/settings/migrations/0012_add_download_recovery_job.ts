import type { AllSettings } from '@server/lib/settings';

type MutableSettings = {
  jobs?: Record<string, { schedule: string; enabled?: boolean }>;
  migrations?: string[];
};

const addDownloadRecoveryJob = (settings: AllSettings): AllSettings => {
  const mutableSettings = settings as unknown as MutableSettings;

  if (
    Array.isArray(mutableSettings.migrations) &&
    mutableSettings.migrations.includes('0012_add_download_recovery_job')
  ) {
    return settings;
  }

  if (!mutableSettings.jobs) {
    mutableSettings.jobs = {};
  }

  if (!mutableSettings.jobs['readarr-request-retry']) {
    mutableSettings.jobs['readarr-request-retry'] = {
      schedule: '0 */5 * * * *',
    };
  }

  if (!mutableSettings.jobs['download-recovery']) {
    mutableSettings.jobs['download-recovery'] = {
      schedule: '0 */5 * * * *',
      enabled: true,
    };
  }

  mutableSettings.jobs['download-recovery'].enabled ??= true;

  if (!Array.isArray(mutableSettings.migrations)) {
    mutableSettings.migrations = [];
  }
  mutableSettings.migrations.push('0012_add_download_recovery_job');

  return settings;
};

export default addDownloadRecoveryJob;
