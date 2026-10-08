import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These focused tests run in native Node without application aliases.
import { createAdaptiveTimingProfile } from '../tools/validation-engine/runtime/distributed-adaptive-scheduler.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These focused tests run in native Node without application aliases.
import {
  normalizeAdaptiveTimingProfilePath,
  persistAdaptiveTimingProfileFile,
  readAdaptiveTimingProfileFile,
} from '../tools/validation-engine/runtime/distributed-adaptive-timing-profile-store.mjs';

function temporaryDirectory() {
  return mkdtempSync(join(tmpdir(), 'seerrng-adaptive-profile-store-'));
}

test('missing adaptive timing evidence starts with a fresh profile without creating a file', () => {
  const root = temporaryDirectory();
  try {
    const profilePath = join(root, 'timing-profile.json');
    assert.deepEqual(
      readAdaptiveTimingProfileFile(profilePath),
      createAdaptiveTimingProfile()
    );
    assert.equal(existsSync(profilePath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('adaptive timing evidence round trips through an atomic machine-generated JSON file', () => {
  const root = temporaryDirectory();
  try {
    const profilePath = join(root, 'nested', '..', 'timing-profile.json');
    const profile = createAdaptiveTimingProfile();
    assert.equal(
      normalizeAdaptiveTimingProfilePath(profilePath),
      join(root, 'timing-profile.json')
    );
    assert.equal(
      persistAdaptiveTimingProfileFile(profilePath, profile),
      profile
    );
    assert.equal(
      persistAdaptiveTimingProfileFile(profilePath, profile),
      profile
    );
    assert.deepEqual(readAdaptiveTimingProfileFile(profilePath), profile);
    assert.equal(
      readFileSync(profilePath, 'utf8'),
      `${JSON.stringify(profile, null, 2)}\n`
    );
    assert.deepEqual(readdirSync(root), ['timing-profile.json']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('invalid existing adaptive timing evidence fails closed instead of becoming a fresh profile', () => {
  const root = temporaryDirectory();
  try {
    const profilePath = join(root, 'timing-profile.json');
    writeFileSync(profilePath, '{"schema":"wrong","scopes":[]}\n', 'utf8');
    assert.throws(
      () => readAdaptiveTimingProfileFile(profilePath),
      /Unsupported distributed adaptive profile schema/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('invalid replacement profiles leave prior adaptive timing evidence byte-for-byte intact', () => {
  const root = temporaryDirectory();
  try {
    const profilePath = join(root, 'timing-profile.json');
    const prior = createAdaptiveTimingProfile();
    persistAdaptiveTimingProfileFile(profilePath, prior);
    const priorText = readFileSync(profilePath, 'utf8');
    const invalid = { ...prior, schema: 'wrong' };

    assert.throws(
      () => persistAdaptiveTimingProfileFile(profilePath, invalid),
      /Unsupported distributed adaptive profile schema/
    );
    assert.equal(readFileSync(profilePath, 'utf8'), priorText);
    assert.deepEqual(readdirSync(root), ['timing-profile.json']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('failed locked writes preserve prior evidence and do not create temporary files', () => {
  const root = temporaryDirectory();
  try {
    const profilePath = join(root, 'timing-profile.json');
    const prior = createAdaptiveTimingProfile();
    persistAdaptiveTimingProfileFile(profilePath, prior);
    const priorText = readFileSync(profilePath, 'utf8');
    writeFileSync(`${profilePath}.lock`, 'other writer\n', 'utf8');

    assert.throws(
      () => persistAdaptiveTimingProfileFile(profilePath, prior),
      /already being updated/
    );
    assert.equal(readFileSync(profilePath, 'utf8'), priorText);
    assert.deepEqual(readdirSync(root).toSorted(), [
      'timing-profile.json',
      'timing-profile.json.lock',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('adaptive timing evidence paths must be explicit absolute file paths', () => {
  const profile = createAdaptiveTimingProfile();
  assert.throws(
    () => readAdaptiveTimingProfileFile('timing-profile.json'),
    /must be absolute/
  );
  assert.throws(
    () => persistAdaptiveTimingProfileFile('timing-profile.json', profile),
    /must be absolute/
  );
});

test('symbolic-link evidence targets are rejected without changing their referent', (context) => {
  const root = temporaryDirectory();
  try {
    const referent = join(root, 'referent.json');
    const profilePath = join(root, 'timing-profile.json');
    const priorText = `${JSON.stringify(createAdaptiveTimingProfile())}\n`;
    writeFileSync(referent, priorText, 'utf8');
    try {
      symlinkSync(referent, profilePath, 'file');
    } catch (error) {
      if (process.platform === 'win32' && error?.code === 'EPERM') {
        context.skip('Windows symbolic-link creation is unavailable');
        return;
      }
      throw error;
    }

    assert.throws(
      () => readAdaptiveTimingProfileFile(profilePath),
      /must be an ordinary file/
    );
    assert.throws(
      () =>
        persistAdaptiveTimingProfileFile(
          profilePath,
          createAdaptiveTimingProfile()
        ),
      /must be an ordinary file/
    );
    assert.equal(readFileSync(referent, 'utf8'), priorText);
  } finally {
    if (process.platform !== 'win32') chmodSync(root, 0o700);
    rmSync(root, { recursive: true, force: true });
  }
});
