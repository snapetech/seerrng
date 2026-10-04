import type { AllSettings } from '@server/lib/settings';

type SettingsWithJobMigrations = {
  jobs?: Partial<AllSettings['jobs']>;
  migrations?: string[];
};

const addExternalRequestListSyncJob = (
  settings: SettingsWithJobMigrations
): AllSettings => {
  if (
    settings.migrations?.includes('0021_add_external_request_list_sync_job')
  ) {
    return settings as AllSettings;
  }

  settings.jobs ??= {};
  settings.jobs['external-request-list-sync'] ??= {
    schedule: '0 0 3 * * *',
  };
  settings.migrations ??= [];
  settings.migrations.push('0021_add_external_request_list_sync_job');
  return settings as AllSettings;
};

export default addExternalRequestListSyncJob;
