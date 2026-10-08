// Copyright (c) snapetech and SeerrNG contributors.
// Durable machine-generated evidence storage for adaptive timing profiles.
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize } from 'node:path';

import {
  assertAdaptiveTimingProfile,
  createAdaptiveTimingProfile,
} from './distributed-adaptive-scheduler.mjs';

export const MAX_DISTRIBUTED_ADAPTIVE_PROFILE_BYTES = 32 * 1024 * 1024;

function sameFileObject(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function noFollowFlag() {
  return process.platform === 'win32' ? 0 : (constants.O_NOFOLLOW ?? 0);
}

function metadataOrNull(filePath, label) {
  let metadata;
  try {
    metadata = lstatSync(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error(`${label} must be an ordinary file`);
  if (metadata.size > MAX_DISTRIBUTED_ADAPTIVE_PROFILE_BYTES)
    throw new Error(`${label} exceeds its safe size limit`);
  return metadata;
}

function removeOwnedFile(filePath, expectedMetadata, label) {
  let current;
  try {
    current = lstatSync(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  if (!sameFileObject(current, expectedMetadata))
    throw new Error(`${label} ownership changed before cleanup`);
  unlinkSync(filePath);
}

function parseTimingProfile(text, label) {
  let profile;
  try {
    profile = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
  assertAdaptiveTimingProfile(profile);
  return profile;
}

function readExistingProfileText(profilePath, expectedMetadata, label) {
  const descriptor = openSync(profilePath, constants.O_RDONLY | noFollowFlag());
  try {
    const opened = fstatSync(descriptor);
    if (!sameFileObject(expectedMetadata, opened))
      throw new Error(`${label} changed while it was being opened`);
    if (
      !opened.isFile() ||
      opened.size > MAX_DISTRIBUTED_ADAPTIVE_PROFILE_BYTES
    )
      throw new Error(`${label} is not a safe ordinary file`);

    const text = readFileSync(descriptor, 'utf8');
    const after = fstatSync(descriptor);
    if (
      !sameFileObject(opened, after) ||
      opened.size !== after.size ||
      opened.mtimeMs !== after.mtimeMs
    )
      throw new Error(`${label} changed while it was being read`);

    const current = lstatSync(profilePath);
    if (!sameFileObject(opened, current))
      throw new Error(`${label} was replaced while it was being read`);
    return text;
  } finally {
    closeSync(descriptor);
  }
}

function assertTargetUnchanged(profilePath, expectedMetadata, label) {
  const current = metadataOrNull(profilePath, label);
  if (expectedMetadata === null) {
    if (current !== null)
      throw new Error(`${label} appeared while it was being written`);
    return;
  }
  if (current === null || !sameFileObject(current, expectedMetadata))
    throw new Error(`${label} changed while it was being written`);
}

export function normalizeAdaptiveTimingProfilePath(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4096 ||
    value.includes('\0')
  )
    throw new Error('Adaptive timing profile path must be nonempty text');
  if (!isAbsolute(value))
    throw new Error('Adaptive timing profile path must be absolute');

  const normalized = normalize(value);
  const filename = basename(normalized);
  if (!filename || filename === '.' || filename === '..')
    throw new Error('Adaptive timing profile path must name a file');
  return normalized;
}

export function readAdaptiveTimingProfileFile(profilePathValue) {
  const profilePath = normalizeAdaptiveTimingProfilePath(profilePathValue);
  const label = 'Adaptive timing profile';
  const metadata = metadataOrNull(profilePath, label);
  if (metadata === null) return createAdaptiveTimingProfile();
  return parseTimingProfile(
    readExistingProfileText(profilePath, metadata, label),
    label
  );
}

export function persistAdaptiveTimingProfileFile(profilePathValue, value) {
  const profilePath = normalizeAdaptiveTimingProfilePath(profilePathValue);
  assertAdaptiveTimingProfile(value);
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(text, 'utf8') > MAX_DISTRIBUTED_ADAPTIVE_PROFILE_BYTES)
    throw new Error('Adaptive timing profile exceeds its safe size limit');

  const label = 'Adaptive timing profile';
  const lockPath = `${profilePath}.lock`;
  const temporaryPath = join(
    dirname(profilePath),
    `.${basename(profilePath)}.${process.pid}.${randomBytes(12).toString('hex')}.tmp`
  );
  let lockDescriptor = null;
  let lockMetadata = null;
  let temporaryDescriptor = null;
  let temporaryMetadata = null;
  let renamed = false;
  let result;
  let failure = null;

  try {
    try {
      lockDescriptor = openSync(
        lockPath,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          noFollowFlag(),
        0o600
      );
    } catch (error) {
      if (error?.code === 'EEXIST')
        throw new Error('Adaptive timing profile is already being updated', {
          cause: error,
        });
      throw error;
    }
    lockMetadata = fstatSync(lockDescriptor);
    if (process.platform !== 'win32') fchmodSync(lockDescriptor, 0o600);
    writeFileSync(lockDescriptor, `${process.pid}\n`, 'utf8');
    fsyncSync(lockDescriptor);

    const priorMetadata = metadataOrNull(profilePath, label);
    temporaryDescriptor = openSync(
      temporaryPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        noFollowFlag(),
      0o600
    );
    temporaryMetadata = fstatSync(temporaryDescriptor);
    if (process.platform !== 'win32') fchmodSync(temporaryDescriptor, 0o600);
    writeFileSync(temporaryDescriptor, text, 'utf8');
    fsyncSync(temporaryDescriptor);
    closeSync(temporaryDescriptor);
    temporaryDescriptor = null;

    const verifiedTemporaryMetadata = metadataOrNull(
      temporaryPath,
      'Adaptive timing profile temporary file'
    );
    if (
      verifiedTemporaryMetadata === null ||
      !sameFileObject(temporaryMetadata, verifiedTemporaryMetadata)
    )
      throw new Error(
        'Adaptive timing profile temporary file changed before validation'
      );
    const temporaryText = readExistingProfileText(
      temporaryPath,
      verifiedTemporaryMetadata,
      'Adaptive timing profile temporary file'
    );
    parseTimingProfile(temporaryText, 'Adaptive timing profile temporary file');
    if (temporaryText !== text)
      throw new Error('Adaptive timing profile temporary file failed readback');

    assertTargetUnchanged(profilePath, priorMetadata, label);
    renameSync(temporaryPath, profilePath);
    renamed = true;
    result = value;
  } catch (error) {
    failure = error;
  }

  try {
    if (temporaryDescriptor !== null) closeSync(temporaryDescriptor);
    if (!renamed && temporaryMetadata)
      removeOwnedFile(
        temporaryPath,
        temporaryMetadata,
        'Adaptive timing profile temporary file'
      );
    if (lockDescriptor !== null) closeSync(lockDescriptor);
    if (lockMetadata)
      removeOwnedFile(lockPath, lockMetadata, 'Adaptive timing profile lock');
  } catch (error) {
    failure ??= error;
  }

  if (failure) throw failure;
  return result;
}
