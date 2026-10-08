// Copyright (c) snapetech and SeerrNG contributors.
// Read one ordinary file through an opened descriptor so path replacement cannot
// redirect a read after the file has been checked.
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs';

const CHUNK_BYTES = 64 * 1024;

function sameFileObject(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameFileSnapshot(left, right) {
  return (
    sameFileObject(left, right) &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

/**
 * Open first, then verify the opened object and its path before and after one
 * bounded descriptor read. A later path swap cannot change which object is read.
 */
export function readStableOrdinaryFileSync(
  filePath,
  label,
  { maxBytes = Number.MAX_SAFE_INTEGER, requireCanonicalPath = false } = {}
) {
  const noFollow =
    process.platform === 'win32' ? 0 : (constants.O_NOFOLLOW ?? 0);
  let descriptor;
  try {
    descriptor = openSync(filePath, constants.O_RDONLY | noFollow);
  } catch (error) {
    if (error?.code === 'ELOOP')
      throw new Error(`${label} must be an ordinary nonsymlink file`, {
        cause: error,
      });
    throw error;
  }

  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile()) throw new Error(`${label} must be an ordinary file`);
    if (opened.size > maxBytes)
      throw new Error(`${label} exceeds its safe size limit`);

    const assertPathStillNamesOpenedFile = () => {
      let current;
      try {
        current = lstatSync(filePath);
      } catch (error) {
        throw new Error(`${label} changed while it was being read`, {
          cause: error,
        });
      }
      if (
        !current.isFile() ||
        current.isSymbolicLink() ||
        !sameFileObject(opened, current) ||
        (requireCanonicalPath && realpathSync(filePath) !== filePath)
      )
        throw new Error(`${label} changed while it was being read`);
    };

    assertPathStillNamesOpenedFile();
    const chunks = [];
    let position = 0;
    while (position < opened.size) {
      const chunk = Buffer.allocUnsafe(
        Math.min(CHUNK_BYTES, opened.size - position)
      );
      const bytesRead = readSync(descriptor, chunk, 0, chunk.length, position);
      if (bytesRead === 0)
        throw new Error(`${label} changed while it was being read`);
      chunks.push(
        bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead)
      );
      position += bytesRead;
    }
    const bytes = Buffer.concat(chunks, opened.size);
    const after = fstatSync(descriptor);
    if (!sameFileSnapshot(opened, after) || bytes.length !== after.size)
      throw new Error(`${label} changed while it was being read`);
    assertPathStillNamesOpenedFile();
    return { bytes, metadata: after };
  } finally {
    closeSync(descriptor);
  }
}
