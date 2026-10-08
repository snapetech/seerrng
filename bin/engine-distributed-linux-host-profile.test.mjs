import assert from 'node:assert/strict';
import test from 'node:test';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These focused tests run in native Node without application aliases.
import { detectLinuxHostProfile } from '../tools/validation-engine/runtime/distributed-linux-host-profile.mjs';

const processors = (
  count,
  { model = 'AMD Ryzen 9 7940HS', speed = 4000 } = {}
) => Array.from({ length: count }, () => ({ model, speed, times: {} }));

test('Linux host profile prefers valid availableParallelism capacity', () => {
  const profile = detectLinuxHostProfile({
    platform: 'linux',
    availableParallelism: () => 6,
    cpus: () => processors(16),
  });
  assert.deepEqual(profile, {
    cpuName: 'AMD Ryzen 9 7940HS',
    availableThreads: 6,
  });
  assert.equal(Object.isFrozen(profile), true);
});

test('Linux host profile falls back to os.cpus length when preferred capacity is unavailable', () => {
  for (const availableParallelism of [
    undefined,
    () => undefined,
    () => 0,
    () => -1,
    () => 2.5,
    () => Number.NaN,
    () => {
      throw new Error('not supported');
    },
  ]) {
    const profile = detectLinuxHostProfile({
      platform: 'linux',
      availableParallelism,
      cpus: () => processors(8),
    });
    assert.equal(profile.availableThreads, 8);
  }
});

test('CPU clock data is informational input and cannot affect scheduling capacity', () => {
  const slowClock = detectLinuxHostProfile({
    platform: 'linux',
    availableParallelism: () => 4,
    cpus: () => processors(12, { speed: 200 }),
  });
  const fastClock = detectLinuxHostProfile({
    platform: 'linux',
    availableParallelism: () => 4,
    cpus: () => processors(12, { speed: 9000 }),
  });
  assert.deepEqual(slowClock, fastClock);
  assert.deepEqual(Reflect.ownKeys(slowClock), ['cpuName', 'availableThreads']);
});

test('CPU model is trimmed for config use and must not be blank', () => {
  assert.equal(
    detectLinuxHostProfile({
      platform: 'linux',
      availableParallelism: () => 2,
      cpus: () => processors(4, { model: '  Intel Xeon E-2288G  ' }),
    }).cpuName,
    'Intel Xeon E-2288G'
  );
  for (const model of ['', '   ', '\t'])
    assert.throws(
      () =>
        detectLinuxHostProfile({
          platform: 'linux',
          availableParallelism: () => 2,
          cpus: () => processors(4, { model }),
        }),
      /CPU name is unavailable/
    );
});

test('non-Linux hosts fail before CPU APIs are inspected', () => {
  let calls = 0;
  assert.throws(
    () =>
      detectLinuxHostProfile({
        platform: 'win32',
        availableParallelism: () => {
          calls += 1;
          return 8;
        },
        cpus: () => {
          calls += 1;
          return processors(8);
        },
      }),
    /requires Linux/
  );
  assert.equal(calls, 0);
});

test('invalid CPU inventory and zero fallback capacity fail closed', () => {
  assert.throws(
    () =>
      detectLinuxHostProfile({
        platform: 'linux',
        availableParallelism: () => 0,
        cpus: () => [],
      }),
    /available threads must be a positive integer/
  );
  assert.throws(
    () =>
      detectLinuxHostProfile({
        platform: 'linux',
        availableParallelism: () => 4,
        cpus: () => null,
      }),
    /invalid data/
  );
  assert.throws(
    () =>
      detectLinuxHostProfile({
        platform: 'linux',
        availableParallelism: () => 4,
        cpus: () => {
          throw new Error('blocked');
        },
      }),
    /inspection failed/
  );
});
