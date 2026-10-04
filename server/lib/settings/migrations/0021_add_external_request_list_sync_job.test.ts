import { describe, expect, it } from 'vitest';
import addExternalRequestListSyncJob from './0021_add_external_request_list_sync_job';

describe('external request list sync job settings migration', () => {
  it('adds its daily schedule and preserves an operator schedule', () => {
    const defaults = addExternalRequestListSyncJob({
      jobs: {},
      migrations: [],
    });
    expect(defaults.jobs['external-request-list-sync']).toEqual({
      schedule: '0 0 3 * * *',
    });

    const customized = addExternalRequestListSyncJob({
      jobs: {
        'external-request-list-sync': {
          schedule: '0 30 4 * * *',
          enabled: false,
        },
      },
      migrations: [],
    });
    expect(customized.jobs['external-request-list-sync']).toEqual({
      schedule: '0 30 4 * * *',
      enabled: false,
    });
  });
});
