import logger from '@server/logger';
import { setupTestDb } from '@server/test/db';
import schedule from 'node-schedule';
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { runTrackedJob, scheduledJobs, startJobs, stopJobs } from './schedule';

setupTestDb();

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
};

afterEach(async () => {
  await stopJobs();
  mock.restoreAll();
});

describe('scheduled job lifecycle', () => {
  it('does not start scheduled jobs in E2E test mode', () => {
    const previousE2eFlag = process.env.E2E_TESTS;
    process.env.E2E_TESTS = 'true';

    try {
      startJobs();
      assert.strictEqual(scheduledJobs.length, 0);
    } finally {
      if (previousE2eFlag === undefined) {
        delete process.env.E2E_TESTS;
      } else {
        process.env.E2E_TESTS = previousE2eFlag;
      }
    }
  });

  it('does not register duplicate jobs when startup runs twice', () => {
    const job = schedule.scheduleJob(
      new Date(Date.now() + 60_000),
      () => undefined
    );
    assert.ok(job);
    scheduledJobs.push({
      id: 'download-sync',
      job,
      name: 'Existing Job',
      type: 'command',
      interval: 'minutes',
      cronSchedule: '* * * * *',
    });

    startJobs();

    assert.strictEqual(scheduledJobs.length, 1);
    assert.strictEqual(scheduledJobs[0].job, job);
  });

  it('cancels future invocations and waits for active work', async () => {
    let cancelCalled = false;
    let release: (() => void) | undefined;
    const job = schedule.scheduleJob(
      new Date(Date.now() + 60_000),
      () => undefined
    );
    assert.ok(job);
    scheduledJobs.push({
      id: 'download-sync',
      job,
      name: 'Pending Job',
      type: 'command',
      interval: 'minutes',
      cronSchedule: '* * * * *',
      cancelFn: () => {
        cancelCalled = true;
      },
    });
    void runTrackedJob(
      'Held Job',
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );

    const stopping = stopJobs();
    let stopped = false;
    void stopping.then(() => {
      stopped = true;
    });
    await waitFor(() => Boolean(release));

    assert.strictEqual(cancelCalled, true);
    assert.strictEqual(job.nextInvocation(), null);
    assert.strictEqual(stopped, false);
    assert.ok(release);

    release();
    await stopping;
    assert.strictEqual(stopped, true);
    assert.strictEqual(scheduledJobs.length, 0);
  });

  it('captures scheduled task failures without rejecting the drain', async () => {
    const errorMock = mock.method(logger, 'error', () => logger).mock;

    await runTrackedJob('Broken Job', async () => {
      throw new Error('job secret failure');
    });

    assert.strictEqual(errorMock.callCount(), 1);
    const logged = JSON.stringify(errorMock.calls[0].arguments);
    assert.match(logged, /Broken Job/);
    assert.match(logged, /job secret failure/);
    const [, metadata] = errorMock.calls[0].arguments as unknown as [
      string,
      { durationMs: number },
    ];
    assert.equal(typeof metadata.durationMs, 'number');
    assert.ok(metadata.durationMs >= 0);
  });

  it('logs completion and duration only when requested', async () => {
    const infoMock = mock.method(logger, 'info', () => logger).mock;

    await runTrackedJob('Quiet Job', async () => undefined);
    await runTrackedJob('Observed Job', async () => undefined, {
      logCompletion: true,
    });

    assert.strictEqual(infoMock.callCount(), 1);
    const [message, metadata] = infoMock.calls[0].arguments as unknown as [
      string,
      { durationMs: number; label: string },
    ];
    assert.match(message, /Observed Job/);
    assert.equal(metadata.label, 'Jobs');
    assert.equal(typeof metadata.durationMs, 'number');
    assert.ok(metadata.durationMs >= 0);
  });

  it('coalesces overlapping invocations of the same job', async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const first = runTrackedJob('Single Flight Job', () => {
      calls += 1;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const overlapping = runTrackedJob('Single Flight Job', () => {
      calls += 1;
    });
    await waitFor(() => Boolean(release));

    assert.strictEqual(overlapping, first);
    assert.strictEqual(calls, 1);
    assert.ok(release);

    release();
    await first;
  });
});
