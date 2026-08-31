import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  changedReleaseNoteFiles,
  formatCaptureMetadata,
  formatCuratedNotes,
  hasExplicitNoReleaseNote,
  injectCuratedNotes,
  parseReleaseNote,
  readReleaseNotes,
} from './release-notes.mjs';

const validContent = `---
category: fixed
audience: users, operators
area: metadata
action: none
breaking: false
---
Hardcover-backed book searches now keep working from cached metadata during a short upstream outage.`;

test('release-note fragments require a valid category and meaningful body', () => {
  const note = parseReleaseNote('release-notes/books.md', validContent);

  assert.deepEqual(note.errors, []);
  assert.equal(note.category, 'fixed');
  assert.deepEqual(note.audience, ['users', 'operators']);
  assert.equal(note.area, 'metadata');
  assert.equal(note.action, 'none');
  assert.equal(note.breaking, false);
  assert.match(note.body, /cached metadata/u);
});

test('release-note fragments reject placeholders and short text', () => {
  const note = parseReleaseNote(
    'release-notes/incomplete.md',
    '---\ncategory: changed\n---\nTODO'
  );

  assert.match(note.errors.join('\n'), /audience must list/u);
  assert.match(note.errors.join('\n'), /30-400 characters/u);
  assert.match(note.errors.join('\n'), /placeholder/u);
});

test('release-note fragments reject alternate HTML comment endings', () => {
  const note = parseReleaseNote(
    'release-notes/comment-marker.md',
    `---
category: changed
audience: users
area: metadata
action: none
breaking: false
---
This body contains --!> and must be rejected as an HTML comment marker.`
  );

  assert.match(note.errors.join('\n'), /placeholder/u);
});

test('release-note fragments reject unsupported metadata', () => {
  const note = parseReleaseNote(
    'release-notes/metadata.md',
    '---\ncategory: changed\nauthor: someone\n---\nThis metadata key should not be accepted in a release fragment.'
  );

  assert.match(note.errors.join('\n'), /not supported/u);
});

test('breaking notes require an explicit upgrade action', () => {
  const note = parseReleaseNote(
    'release-notes/breaking.md',
    `---
category: changed
audience: users
area: deployment
action: none
breaking: true
---
This change requires a documented upgrade step for existing deployments.`
  );

  assert.match(
    note.errors.join('\n'),
    /breaking changes must describe an upgrade/u
  );
});

test('curated notes are grouped and inserted into the current release', () => {
  const note = parseReleaseNote('release-notes/books.md', validContent);
  const curated = formatCuratedNotes([note]);
  const changelog = injectCuratedNotes(
    '# Changelog\n\n## [3.12.0]\n\n### Bug Fixes\n',
    curated
  );

  assert.match(changelog, /## \[3\.12\.0\][\s\S]*### User-facing changes/u);
  assert.match(
    changelog,
    /#### Fixed[\s\S]*\*\*Metadata:\*\*[\s\S]*cached metadata/u
  );
});

test('capture metadata is visible in the pull-request preview', () => {
  const note = parseReleaseNote('release-notes/books.md', validContent);
  const metadata = formatCaptureMetadata([note]);

  assert.match(metadata, /Audience/u);
  assert.match(metadata, /users, operators/u);
  assert.match(metadata, /metadata/u);
  assert.match(metadata, /none/u);
});

test('internal-only work has an explicit opt-out marker', () => {
  assert.equal(hasExplicitNoReleaseNote('release-note: none'), true);
  assert.equal(
    hasExplicitNoReleaseNote(
      '- [x] This change is internal-only and does not need a user-facing release note.'
    ),
    true
  );
  assert.equal(hasExplicitNoReleaseNote('No release details yet.'), false);
});

test('release-note range discovery distinguishes additions from edits', () => {
  const repository = fs.mkdtempSync(
    path.join(os.tmpdir(), 'seerrng-release-notes-')
  );
  const runGit = (...args) =>
    execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();

  try {
    runGit('init', '--initial-branch=main', '--quiet');
    runGit('config', 'user.name', 'Release Notes Test');
    runGit('config', 'user.email', 'release-notes@example.invalid');
    fs.mkdirSync(path.join(repository, 'release-notes'));
    fs.writeFileSync(
      path.join(repository, 'release-notes', 'README.md'),
      '# Release notes\n'
    );
    runGit('add', '.');
    runGit('commit', '--quiet', '-m', 'chore: initialize test repository');
    const base = runGit('rev-parse', 'HEAD');

    const fragment = path.join(repository, 'release-notes', 'books.md');
    fs.writeFileSync(fragment, validContent);
    runGit('add', '.');
    runGit('commit', '--quiet', '-m', 'feat: add book compatibility');
    const firstHead = runGit('rev-parse', 'HEAD');

    const additions = changedReleaseNoteFiles(base, firstHead, repository);
    assert.deepEqual(additions, [
      { status: 'A', file: 'release-notes/books.md' },
    ]);
    assert.deepEqual(readReleaseNotes(additions, repository).errors, []);

    const previewScript = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      'preview-release-notes.mjs'
    );
    const preview = execFileSync(
      process.execPath,
      [previewScript, '--base', base, '--head', firstHead],
      { cwd: repository, encoding: 'utf8' }
    );
    assert.match(preview, /\*\*Metadata:\*\*/u);

    const checkScript = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      'check-release-notes.mjs'
    );
    const bodyFile = path.join(repository, 'pr-body.md');
    const summaryFile = path.join(repository, 'summary.md');
    fs.writeFileSync(bodyFile, 'This pull request includes a release note.');
    execFileSync(
      process.execPath,
      [
        checkScript,
        '--base',
        base,
        '--head',
        firstHead,
        '--pr-body',
        bodyFile,
        '--summary-file',
        summaryFile,
      ],
      { cwd: repository, encoding: 'utf8' }
    );
    assert.match(
      fs.readFileSync(summaryFile, 'utf8'),
      /## Release-note preview[\s\S]*### Capture metadata/u
    );

    fs.writeFileSync(fragment, `${validContent}\n`);
    runGit('add', '.');
    runGit('commit', '--quiet', '-m', 'fix: refine release note');
    const secondHead = runGit('rev-parse', 'HEAD');
    assert.deepEqual(
      changedReleaseNoteFiles(firstHead, secondHead, repository),
      [{ status: 'M', file: 'release-notes/books.md' }]
    );
  } finally {
    fs.rmSync(repository, { recursive: true, force: true });
  }
});

test('changelog assembly prepends a release without replacing prior history', () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'seerrng-changelog-')
  );
  const currentPath = path.join(directory, 'current.md');
  const existingPath = path.join(directory, 'CHANGELOG.md');
  const outputPath = path.join(directory, 'output.md');
  const scriptPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'prepend-changelog-section.mjs'
  );
  const existing = `# Changelog\n\nIntroductory text.\n\n## [3.11.2]\n\n- Previous release.\n\n## Historical upstream history\n\n- Legacy release.\n`;
  const current = `# Changelog\n\n## [3.12.0]\n\n### Fixed\n\n- Current release.\n`;

  try {
    fs.writeFileSync(currentPath, current);
    fs.writeFileSync(existingPath, existing);
    execFileSync(
      process.execPath,
      [
        scriptPath,
        '--current',
        currentPath,
        '--existing',
        existingPath,
        '--output',
        outputPath,
      ],
      { encoding: 'utf8' }
    );

    const assembled = fs.readFileSync(outputPath, 'utf8');
    assert.match(assembled, /^# Changelog[\s\S]*^## \[3\.12\.0\]/mu);
    assert.match(
      assembled,
      /3\.12\.0[\s\S]*3\.11\.2[\s\S]*Historical upstream history/u
    );

    fs.writeFileSync(existingPath, assembled);
    execFileSync(
      process.execPath,
      [
        scriptPath,
        '--current',
        currentPath,
        '--existing',
        existingPath,
        '--output',
        outputPath,
      ],
      { encoding: 'utf8' }
    );
    const rerun = fs.readFileSync(outputPath, 'utf8');
    assert.equal((rerun.match(/^## \[3\.12\.0\]/gmu) ?? []).length, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('checked-in changelog covers every SeerrNG tag', () => {
  const scriptPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'check-changelog-tags.mjs'
  );
  const output = execFileSync(process.execPath, [scriptPath], {
    cwd: path.dirname(path.dirname(fileURLToPath(import.meta.url))),
    encoding: 'utf8',
  });

  assert.match(output, /Changelog covers all \d+ SeerrNG tag\(s\)/u);
});
