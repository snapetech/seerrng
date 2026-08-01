import { MediaServerType } from '@server/constants/server';
import blocklistedTagsProcessor from '@server/job/blocklistedTagsProcessor';
import availabilitySync from '@server/lib/availabilitySync';
import downloadRecovery from '@server/lib/downloadRecovery';
import downloadTracker from '@server/lib/downloadtracker';
import ImageProxy from '@server/lib/imageproxy';
import refreshToken from '@server/lib/refreshToken';
import {
  jellyfinFullScanner,
  jellyfinRecentScanner,
} from '@server/lib/scanners/jellyfin';
import { lidarrScanner } from '@server/lib/scanners/lidarr';
import { plexFullScanner, plexRecentScanner } from '@server/lib/scanners/plex';
import { radarrScanner } from '@server/lib/scanners/radarr';
import { readarrScanner } from '@server/lib/scanners/readarr';
import { sonarrScanner } from '@server/lib/scanners/sonarr';
import type { JobId } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import watchlistSync from '@server/lib/watchlistsync';
import logger from '@server/logger';
import { MediaRequestSubscriber } from '@server/subscriber/MediaRequestSubscriber';
import schedule from 'node-schedule';
import scheduledJobLeaseManager from './jobLease';

export interface ScheduledJob {
  id: JobId;
  job: schedule.Job;
  name: string;
  type: 'process' | 'command';
  interval: 'seconds' | 'minutes' | 'hours' | 'days' | 'fixed';
  cronSchedule: string;
  scope?: 'cluster' | 'instance';
  running?: () => boolean;
  cancelFn?: () => void;
}

export const scheduledJobs: ScheduledJob[] = [];
const activeJobRuns = new Set<Promise<void>>();
const activeJobRunsByName = new Map<string, Promise<void>>();

export const getScheduledJobLeaseName = (name: string): string =>
  `scheduled-job:${name}`;

export const runTrackedJob = (
  name: string,
  task: () => void | Promise<void>,
  options: {
    scope?: 'cluster' | 'instance';
    logCompletion?: boolean;
  } = {}
): Promise<void> => {
  const activeRun = activeJobRunsByName.get(name);
  if (activeRun) {
    logger.warn(`Scheduled job is already running: ${name}`, {
      label: 'Jobs',
    });
    return activeRun;
  }

  const startedAt = Date.now();
  let taskCompleted = false;
  const executeTask = async (): Promise<void> => {
    await task();
    taskCompleted = true;
  };
  const run = Promise.resolve()
    .then(async () => {
      if (options.scope === 'instance') {
        await executeTask();
      } else {
        const result = await scheduledJobLeaseManager.run(
          getScheduledJobLeaseName(name),
          executeTask
        );
        if (!result.acquired) {
          logger.debug(
            `Scheduled job is running on another instance: ${name}`,
            {
              label: 'Jobs',
            }
          );
        }
      }

      if (options.logCompletion && taskCompleted) {
        logger.info(`Scheduled job completed: ${name}`, {
          label: 'Jobs',
          durationMs: Date.now() - startedAt,
        });
      }
    })
    .catch((error) => {
      logger.error(`Scheduled job failed: ${name}`, {
        label: 'Jobs',
        errorMessage:
          error instanceof Error
            ? error.message
            : 'Unknown scheduled job error',
        durationMs: Date.now() - startedAt,
      });
    })
    .finally(() => {
      activeJobRuns.delete(run);
      if (activeJobRunsByName.get(name) === run) {
        activeJobRunsByName.delete(name);
      }
    });
  activeJobRuns.add(run);
  activeJobRunsByName.set(name, run);
  return run;
};

export const waitForActiveJobs = async (): Promise<void> => {
  while (activeJobRuns.size > 0) {
    await Promise.all([...activeJobRuns]);
  }
};

export const isTrackedJobRunning = (name: string): boolean =>
  activeJobRunsByName.has(name);

let stopJobsPromise: Promise<void> | undefined;

export const stopJobs = (): Promise<void> => {
  if (stopJobsPromise) {
    return stopJobsPromise;
  }

  stopJobsPromise = (async () => {
    for (const scheduledJob of scheduledJobs) {
      scheduledJob.cancelFn?.();
      scheduledJob.job.cancel();
    }
    scheduledJobs.length = 0;
    await waitForActiveJobs();
  })().finally(() => {
    stopJobsPromise = undefined;
  });

  return stopJobsPromise;
};

export const startJobs = (): void => {
  if (process.env.E2E_TESTS === 'true') {
    logger.info('Skipping scheduled jobs in E2E test mode', {
      label: 'Jobs',
    });
    return;
  }

  if (stopJobsPromise) {
    logger.warn('Scheduled jobs are stopping; skipping job start.', {
      label: 'Jobs',
    });
    return;
  }

  if (scheduledJobs.length > 0) {
    logger.warn(
      'Scheduled jobs are already loaded; skipping duplicate start.',
      {
        label: 'Jobs',
      }
    );
    return;
  }

  const jobs = getSettings().jobs;
  const mediaServerType = getSettings().main.mediaServerType;

  if (mediaServerType === MediaServerType.PLEX) {
    // Run recently added plex scan every 5 minutes
    scheduledJobs.push({
      id: 'plex-recently-added-scan',
      name: 'Plex Recently Added Scan',
      type: 'process',
      interval: 'minutes',
      cronSchedule: jobs['plex-recently-added-scan'].schedule,
      job: schedule.scheduleJob(
        jobs['plex-recently-added-scan'].schedule,
        () => {
          logger.info('Starting scheduled job: Plex Recently Added Scan', {
            label: 'Jobs',
          });
          return runTrackedJob('Plex Recently Added Scan', () =>
            plexRecentScanner.run()
          );
        }
      ),
      running: () => plexRecentScanner.status().running,
      cancelFn: () => plexRecentScanner.cancel(),
    });

    // Run full plex scan every 24 hours
    scheduledJobs.push({
      id: 'plex-full-scan',
      name: 'Plex Full Library Scan',
      type: 'process',
      interval: 'hours',
      cronSchedule: jobs['plex-full-scan'].schedule,
      job: schedule.scheduleJob(jobs['plex-full-scan'].schedule, () => {
        logger.info('Starting scheduled job: Plex Full Library Scan', {
          label: 'Jobs',
        });
        return runTrackedJob('Plex Full Library Scan', () =>
          plexFullScanner.run()
        );
      }),
      running: () => plexFullScanner.status().running,
      cancelFn: () => plexFullScanner.cancel(),
    });

    scheduledJobs.push({
      id: 'plex-refresh-token',
      name: 'Plex Refresh Token',
      type: 'process',
      interval: 'fixed',
      cronSchedule: jobs['plex-refresh-token'].schedule,
      job: schedule.scheduleJob(jobs['plex-refresh-token'].schedule, () => {
        logger.info('Starting scheduled job: Plex Refresh Token', {
          label: 'Jobs',
        });
        return runTrackedJob('Plex Refresh Token', () => refreshToken.run());
      }),
    });

    // Watchlist Sync
    scheduledJobs.push({
      id: 'plex-watchlist-sync',
      name: 'Plex Watchlist Sync',
      type: 'process',
      interval: 'seconds',
      cronSchedule: jobs['plex-watchlist-sync'].schedule,
      job: schedule.scheduleJob(jobs['plex-watchlist-sync'].schedule, () => {
        logger.info('Starting scheduled job: Plex Watchlist Sync', {
          label: 'Jobs',
        });
        return runTrackedJob(
          'Plex Watchlist Sync',
          () => watchlistSync.syncWatchlist(),
          { logCompletion: true }
        );
      }),
    });
  } else if (
    mediaServerType === MediaServerType.JELLYFIN ||
    mediaServerType === MediaServerType.EMBY
  ) {
    // Run recently added jellyfin sync every 5 minutes
    scheduledJobs.push({
      id: 'jellyfin-recently-added-scan',
      name: 'Jellyfin Recently Added Scan',
      type: 'process',
      interval: 'minutes',
      cronSchedule: jobs['jellyfin-recently-added-scan'].schedule,
      job: schedule.scheduleJob(
        jobs['jellyfin-recently-added-scan'].schedule,
        () => {
          logger.info('Starting scheduled job: Jellyfin Recently Added Scan', {
            label: 'Jobs',
          });
          return runTrackedJob('Jellyfin Recently Added Scan', () =>
            jellyfinRecentScanner.run()
          );
        }
      ),
      running: () => jellyfinRecentScanner.status().running,
      cancelFn: () => jellyfinRecentScanner.cancel(),
    });

    // Run full jellyfin sync every 24 hours
    scheduledJobs.push({
      id: 'jellyfin-full-scan',
      name: 'Jellyfin Full Library Scan',
      type: 'process',
      interval: 'hours',
      cronSchedule: jobs['jellyfin-full-scan'].schedule,
      job: schedule.scheduleJob(jobs['jellyfin-full-scan'].schedule, () => {
        logger.info('Starting scheduled job: Jellyfin Full Scan', {
          label: 'Jobs',
        });
        return runTrackedJob('Jellyfin Full Library Scan', () =>
          jellyfinFullScanner.run()
        );
      }),
      running: () => jellyfinFullScanner.status().running,
      cancelFn: () => jellyfinFullScanner.cancel(),
    });
  }

  // Run full radarr scan every 24 hours
  scheduledJobs.push({
    id: 'radarr-scan',
    name: 'Radarr Scan',
    type: 'process',
    interval: 'hours',
    cronSchedule: jobs['radarr-scan'].schedule,
    job: schedule.scheduleJob(jobs['radarr-scan'].schedule, () => {
      logger.info('Starting scheduled job: Radarr Scan', { label: 'Jobs' });
      return runTrackedJob('Radarr Scan', () => radarrScanner.run());
    }),
    running: () => radarrScanner.status().running,
    cancelFn: () => radarrScanner.cancel(),
  });

  // Run full sonarr scan every 24 hours
  scheduledJobs.push({
    id: 'sonarr-scan',
    name: 'Sonarr Scan',
    type: 'process',
    interval: 'hours',
    cronSchedule: jobs['sonarr-scan'].schedule,
    job: schedule.scheduleJob(jobs['sonarr-scan'].schedule, () => {
      logger.info('Starting scheduled job: Sonarr Scan', { label: 'Jobs' });
      return runTrackedJob('Sonarr Scan', () => sonarrScanner.run());
    }),
    running: () => sonarrScanner.status().running,
    cancelFn: () => sonarrScanner.cancel(),
  });

  scheduledJobs.push({
    id: 'lidarr-scan',
    name: 'Lidarr Scan',
    type: 'process',
    interval: 'hours',
    cronSchedule: jobs['lidarr-scan'].schedule,
    job: schedule.scheduleJob(jobs['lidarr-scan'].schedule, () => {
      logger.info('Starting scheduled job: Lidarr Scan', { label: 'Jobs' });
      return runTrackedJob('Lidarr Scan', () => lidarrScanner.run());
    }),
    running: () => lidarrScanner.status().running,
    cancelFn: () => lidarrScanner.cancel(),
  });

  scheduledJobs.push({
    id: 'readarr-scan',
    name: 'Bookshelf Scan',
    type: 'process',
    interval: 'hours',
    cronSchedule: jobs['readarr-scan'].schedule,
    job: schedule.scheduleJob(jobs['readarr-scan'].schedule, () => {
      logger.info('Starting scheduled job: Bookshelf Scan', { label: 'Jobs' });
      return runTrackedJob('Bookshelf Scan', () => readarrScanner.run());
    }),
    running: () => readarrScanner.status().running,
    cancelFn: () => readarrScanner.cancel(),
  });

  scheduledJobs.push({
    id: 'readarr-request-retry',
    name: 'Bookshelf Request Retry',
    type: 'process',
    interval: 'minutes',
    cronSchedule: jobs['readarr-request-retry'].schedule,
    job: schedule.scheduleJob(jobs['readarr-request-retry'].schedule, () => {
      logger.info('Starting scheduled job: Bookshelf Request Retry', {
        label: 'Jobs',
      });
      return runTrackedJob(
        'Bookshelf Request Retry',
        () => new MediaRequestSubscriber().retryApprovedReadarrRequests(),
        { logCompletion: true }
      );
    }),
  });

  // Checks if media is still available in plex/sonarr/radarr libs
  scheduledJobs.push({
    id: 'availability-sync',
    name: 'Media Availability Sync',
    type: 'process',
    interval: 'hours',
    cronSchedule: jobs['availability-sync'].schedule,
    job: schedule.scheduleJob(jobs['availability-sync'].schedule, () => {
      logger.info('Starting scheduled job: Media Availability Sync', {
        label: 'Jobs',
      });
      return runTrackedJob('Media Availability Sync', () =>
        availabilitySync.run()
      );
    }),
    running: () => availabilitySync.running,
    cancelFn: () => availabilitySync.cancel(),
  });

  // Run download sync every minute
  scheduledJobs.push({
    id: 'download-sync',
    name: 'Download Sync',
    type: 'command',
    interval: 'seconds',
    cronSchedule: jobs['download-sync'].schedule,
    scope: 'instance',
    job: schedule.scheduleJob(jobs['download-sync'].schedule, () => {
      logger.debug('Starting scheduled job: Download Sync', {
        label: 'Jobs',
      });
      return runTrackedJob(
        'Download Sync',
        () => downloadTracker.updateDownloads(),
        { scope: 'instance' }
      );
    }),
  });

  scheduledJobs.push({
    id: 'download-recovery',
    name: 'Download Recovery',
    type: 'process',
    interval: 'minutes',
    cronSchedule: jobs['download-recovery'].schedule,
    job: schedule.scheduleJob(jobs['download-recovery'].schedule, () => {
      logger.info('Starting scheduled job: Download Recovery', {
        label: 'Jobs',
      });
      void downloadRecovery.run();
    }),
    running: () => downloadRecovery.status().running,
  });

  // Reset download sync everyday at 01:00 am
  scheduledJobs.push({
    id: 'download-sync-reset',
    name: 'Download Sync Reset',
    type: 'command',
    interval: 'hours',
    cronSchedule: jobs['download-sync-reset'].schedule,
    scope: 'instance',
    job: schedule.scheduleJob(jobs['download-sync-reset'].schedule, () => {
      logger.info('Starting scheduled job: Download Sync Reset', {
        label: 'Jobs',
      });
      return runTrackedJob(
        'Download Sync Reset',
        () => downloadTracker.resetDownloadTracker(),
        { scope: 'instance' }
      );
    }),
  });

  // Run image cache cleanup every 24 hours
  scheduledJobs.push({
    id: 'image-cache-cleanup',
    name: 'Image Cache Cleanup',
    type: 'process',
    interval: 'hours',
    cronSchedule: jobs['image-cache-cleanup'].schedule,
    scope: 'instance',
    job: schedule.scheduleJob(jobs['image-cache-cleanup'].schedule, () => {
      logger.info('Starting scheduled job: Image Cache Cleanup', {
        label: 'Jobs',
      });
      // Clean TMDB image cache
      return runTrackedJob(
        'Image Cache Cleanup',
        async () => {
          // RAM is process-local and must be cleared on every replica. The
          // disk tree is normally shared, so only one replica may prune it.
          ImageProxy.clearMemoryCache();
          const result = await scheduledJobLeaseManager.run(
            'scheduled-job:Image Cache Disk Cleanup',
            async () => {
              await ImageProxy.clearCache('tmdb');

              // Clean users avatar image cache
              await ImageProxy.clearCache('avatar');
            }
          );
          if (!result.acquired) {
            logger.debug(
              'Image cache disk cleanup is running on another instance.',
              { label: 'Jobs' }
            );
          }
        },
        { scope: 'instance' }
      );
    }),
  });

  scheduledJobs.push({
    id: 'process-blocklisted-tags',
    name: 'Process Blocklisted Tags',
    type: 'process',
    interval: 'days',
    cronSchedule: jobs['process-blocklisted-tags'].schedule,
    job: schedule.scheduleJob(jobs['process-blocklisted-tags'].schedule, () => {
      logger.info('Starting scheduled job: Process Blocklisted Tags', {
        label: 'Jobs',
      });
      return runTrackedJob('Process Blocklisted Tags', () =>
        blocklistedTagsProcessor.run()
      );
    }),
    running: () => blocklistedTagsProcessor.status().running,
    cancelFn: () => blocklistedTagsProcessor.cancel(),
  });

  scheduledJobs.forEach((scheduledJob) => {
    if (jobs[scheduledJob.id]?.enabled === false) {
      scheduledJob.job.cancel();
    }
  });

  logger.info('Scheduled jobs loaded', { label: 'Jobs' });
};
