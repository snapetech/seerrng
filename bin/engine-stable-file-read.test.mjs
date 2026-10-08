// Copyright (c) snapetech and SeerrNG contributors.
import assert from 'node:assert/strict';
import fs, {
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tests exercise the security boundary directly.
import { readStableOrdinaryFileSync } from '../tools/validation-engine/runtime/stable-file-read.mjs';

test('descriptor reads reject a symlink swap that defeats check-then-read', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'seerrng-stable-file-read-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const evidence = join(root, 'evidence.json');
  const parked = join(root, 'evidence.parked');
  const secret = join(root, 'secret.json');
  writeFileSync(evidence, '{"trusted":true}\n');
  writeFileSync(secret, '{"attacker":true}\n');

  const originalReadFileSync = fs.readFileSync;
  const vulnerableRead = (filePath) => {
    const before = fs.lstatSync(filePath);
    assert.ok(before.isFile() && !before.isSymbolicLink());
    const bytes = fs.readFileSync(filePath);
    const after = fs.lstatSync(filePath);
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);
    return bytes;
  };
  fs.readFileSync = (filePath, ...args) => {
    if (filePath !== evidence) return originalReadFileSync(filePath, ...args);
    renameSync(evidence, parked);
    symlinkSync(secret, evidence);
    try {
      return originalReadFileSync(filePath, ...args);
    } finally {
      unlinkSync(evidence);
      renameSync(parked, evidence);
    }
  };
  syncBuiltinESMExports();
  try {
    assert.equal(
      vulnerableRead(evidence).toString('utf8'),
      '{"attacker":true}\n'
    );
  } finally {
    fs.readFileSync = originalReadFileSync;
    syncBuiltinESMExports();
  }

  const originalOpenSync = fs.openSync;
  let swapped = false;
  fs.openSync = (filePath, ...args) => {
    const descriptor = originalOpenSync(filePath, ...args);
    if (filePath === evidence && !swapped) {
      renameSync(evidence, parked);
      symlinkSync(secret, evidence);
      swapped = true;
    }
    return descriptor;
  };
  syncBuiltinESMExports();
  try {
    assert.throws(
      () => readStableOrdinaryFileSync(evidence, 'Evidence file'),
      /changed while it was being read/
    );
    assert.equal(swapped, true);
  } finally {
    fs.openSync = originalOpenSync;
    syncBuiltinESMExports();
    unlinkSync(evidence);
    renameSync(parked, evidence);
  }
});
