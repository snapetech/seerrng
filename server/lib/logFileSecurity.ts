import fs from 'fs';
import path from 'path';
import { assertNoSymlinkDirectoryComponents } from './pathSecurity';

export const PRIVATE_LOG_DIRECTORY_MODE = 0o700;
export const PRIVATE_LOG_FILE_MODE = 0o600;
const MANAGED_LOG_SYMLINKS = new Set([
  'seerr.log',
  'overseerr.log',
  '.machinelogs.json',
]);

const assertManagedLogSymlink = (directory: string, file: string): void => {
  if (!MANAGED_LOG_SYMLINKS.has(file)) {
    throw new Error(`Unexpected symlink in log directory: ${file}`);
  }

  const filePath = path.join(directory, file);
  const target = fs.readlinkSync(filePath);
  if (
    path.isAbsolute(target) ||
    path.basename(target) !== target ||
    target === '.' ||
    target === '..'
  ) {
    throw new Error(`Log symlink escapes log directory: ${file}`);
  }

  const targetPath = path.join(directory, target);
  try {
    const targetStat = fs.lstatSync(targetPath);
    if (
      !targetStat.isFile() ||
      targetStat.isSymbolicLink() ||
      targetStat.nlink !== 1
    ) {
      throw new Error(
        `Log symlink target must be a private regular file: ${file}`
      );
    }
  } catch (error) {
    // The rotation library creates the symlink before or after its dated file
    // depending on platform. A missing in-directory basename is safe; other
    // validation and I/O failures are not.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
};

export const secureLogDirectory = (directory: string): void => {
  assertNoSymlinkDirectoryComponents(directory, {
    allowMissing: true,
    label: 'Log directory',
  });
  fs.mkdirSync(directory, {
    recursive: true,
    mode: PRIVATE_LOG_DIRECTORY_MODE,
  });
  assertNoSymlinkDirectoryComponents(directory, { label: 'Log directory' });
  const directoryStat = fs.lstatSync(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error('Log directory must not be a symlink');
  }
  // mkdir's mode does not affect an existing directory.
  fs.chmodSync(directory, PRIVATE_LOG_DIRECTORY_MODE);

  for (const file of fs.readdirSync(directory)) {
    const filePath = path.join(directory, file);

    try {
      const fileStat = fs.lstatSync(filePath);
      if (fileStat.isSymbolicLink()) {
        assertManagedLogSymlink(directory, file);
      } else if (fileStat.isFile()) {
        if (fileStat.nlink !== 1) {
          throw new Error(`Log file must not be hard-linked: ${file}`);
        }
        fs.chmodSync(filePath, PRIVATE_LOG_FILE_MODE);
      }
    } catch (error) {
      // Rotation can remove a file between readdir and lstat/chmod. Ignore
      // only that benign race; permission and I/O failures must remain fatal.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
};
