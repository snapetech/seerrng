// Copyright (c) snapetech and SeerrNG contributors.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Standalone Node tooling cannot resolve application aliases.
import { createNativeProcessReceiptLedger } from '../tools/validation-engine/runtime/native-stage-context.mjs';
import { runCommand } from './local-validation.mjs';
const quiet = { write() {} };
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const candidate = { sourceSha256: 'a'.repeat(64) };
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'seerrng-native-ledger-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'logs'));
  mkdirSync(path.join(root, 'source'));
  return { root, ledger: createNativeProcessReceiptLedger(root, candidate) };
}
test('actual passed and failed native commands have append-only hashed lifecycle records without environments or raw streams', async (t) => {
  const { root, ledger } = fixture(t);
  for (const exitCode of [0, 7]) {
    const id = `native-${exitCode}`;
    const command = {
      name: id,
      command: process.execPath,
      args: [
        '-e',
        `console.log('owned native output');process.exit(${exitCode})`,
      ],
      env: { PRIVATE_SENTINEL: 'DO-NOT-SERIALIZE' },
    };
    ledger.begin(id, command);
    let receipt;
    try {
      receipt = await runCommand(command, {
        root: path.join(root, 'source'),
        stdout: quiet,
        stderr: quiet,
        receipt: true,
        timeoutMs: 10_000,
        logDirectory: path.join(root, 'logs'),
        stdoutLog: path.join(root, 'logs', `${id}.stdout.log`),
        stderrLog: path.join(root, 'logs', `${id}.stderr.log`),
      });
    } catch (error) {
      receipt = error.receipt;
    }
    assert(receipt);
    ledger.complete(id, receipt);
  }
  const descriptor = ledger.describe();
  const bytes = readFileSync(descriptor.file);
  const rows = bytes.toString('utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows[0], { schema: 1, candidate });
  assert.deepEqual(
    rows.slice(1).map((row) => row.status),
    ['passed', 'failed']
  );
  assert.deepEqual(
    rows.slice(1).map((row) => row.exitCode),
    [0, 7]
  );
  assert.equal(descriptor.records, 2);
  assert.equal(descriptor.sha256, hash(bytes));
  assert.equal(descriptor.cleanupVerified, true);
  assert.deepEqual(descriptor.pending, []);
  for (const row of rows.slice(1)) {
    assert.equal(row.stdoutSha256, hash(readFileSync(row.stdoutLog)));
    assert.equal(row.stderrSha256, hash(readFileSync(row.stderrLog)));
  }
  assert.doesNotMatch(
    bytes.toString('utf8'),
    /DO-NOT-SERIALIZE|owned native output/
  );
});
test('pending or uncertain groups cannot claim verified cleanup; identities are single-use', (t) => {
  const { ledger } = fixture(t);
  ledger.begin('server', { id: 'production-server' }, 'server');
  assert.equal(ledger.describe().cleanupVerified, false);
  assert.equal(ledger.describe().pending.length, 1);
  assert.throws(() => ledger.begin('server', {}), /not fresh/);
  ledger.complete('server', {
    status: 'incomplete',
    lifecycle: { completed: true, cleanupVerified: false },
  });
  assert.equal(ledger.describe().cleanupVerified, false);
  assert.throws(() => ledger.complete('server', {}), /no active owner/);
  assert.throws(() => ledger.begin('server', {}), /not fresh/);
});
