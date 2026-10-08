// Copyright (c) snapetech and SeerrNG contributors.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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

  // Keep the intentionally vulnerable check-then-read sequence in an eval
  // fixture, so CodeQL doesn't mistake the regression test itself for product
  // code with a filesystem race.
  const vulnerableSequence = String.raw`
    const fs = require('node:fs');
    const [evidence, parked, secret] = process.argv.slice(1);
    const originalReadFileSync = fs.readFileSync;
    const vulnerableRead = (filePath) => {
      const before = fs.lstatSync(filePath);
      if (!before.isFile() || before.isSymbolicLink()) throw new Error('not a regular file');
      const bytes = fs.readFileSync(filePath);
      const after = fs.lstatSync(filePath);
      if (after.dev !== before.dev || after.ino !== before.ino) throw new Error('file identity changed');
      return bytes;
    };
    fs.readFileSync = (filePath, ...args) => {
      if (filePath !== evidence) return originalReadFileSync(filePath, ...args);
      fs.renameSync(evidence, parked);
      fs.symlinkSync(secret, evidence);
      try {
        return originalReadFileSync(filePath, ...args);
      } finally {
        fs.unlinkSync(evidence);
        fs.renameSync(parked, evidence);
      }
    };
    process.stdout.write(vulnerableRead(evidence));
  `;
  assert.equal(
    execFileSync(
      process.execPath,
      ['--eval', vulnerableSequence, evidence, parked, secret],
      { encoding: 'utf8' }
    ),
    '{"attacker":true}\n'
  );

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
