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
  isReleaseNoteShipped,
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

test('release-note areas require lowercase slugs without spaces', () => {
  const invalid = parseReleaseNote(
    'release-notes/library-removal.md',
    validContent.replace('area: metadata', 'area: library management')
  );
  const valid = parseReleaseNote(
    'release-notes/library-removal.md',
    validContent.replace('area: metadata', 'area: library-removal')
  );

  assert.match(invalid.errors.join('\n'), /area must be a 2-32 character/u);
  assert.deepEqual(valid.errors, []);
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
      'Bump the release-note-none-codeql-action group across dependencies.'
    ),
    true
  );
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
    runGit('tag', 'v3.0.0', base);

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
    assert.equal(
      isReleaseNoteShipped('release-notes/books.md', secondHead, repository),
      false
    );

    const updatedPreview = execFileSync(
      process.execPath,
      [previewScript, '--base', firstHead, '--head', secondHead],
      { cwd: repository, encoding: 'utf8' }
    );
    assert.match(updatedPreview, /cached metadata/u);

    execFileSync(
      process.execPath,
      [
        checkScript,
        '--base',
        firstHead,
        '--head',
        secondHead,
        '--pr-body',
        bodyFile,
      ],
      { cwd: repository, encoding: 'utf8' }
    );

    runGit('tag', 'v3.0.1', secondHead);
    fs.writeFileSync(
      fragment,
      validContent.replace('short upstream outage.', 'brief upstream outage.')
    );
    runGit('add', '.');
    runGit('commit', '--quiet', '-m', 'fix: alter a shipped release note');
    const thirdHead = runGit('rev-parse', 'HEAD');
    assert.equal(
      isReleaseNoteShipped('release-notes/books.md', thirdHead, repository),
      true
    );
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            checkScript,
            '--base',
            secondHead,
            '--head',
            thirdHead,
            '--pr-body',
            bodyFile,
          ],
          { cwd: repository, encoding: 'utf8' }
        ),
      (error) =>
        error.status === 1 &&
        error.stderr
          .toString()
          .includes('release-note fragments are append-only')
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

  const { version } = JSON.parse(
    fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  );
  assert.match(output, /Changelog covers all \d+ applicable SeerrNG tag\(s\)/u);
  assert.ok(output.includes(`through candidate ${version}.`));
});

const checkChangelogFixture = ({
  version,
  tags,
  headings,
  unrelatedHistory = false,
}) => {
  const repository = fs.mkdtempSync(
    path.join(os.tmpdir(), 'seerrng-changelog-tags-')
  );
  const runGit = (...args) =>
    execFileSync('git', args, { cwd: repository, encoding: 'utf8' });
  try {
    runGit('init', '--initial-branch=main', '--quiet');
    runGit('config', 'user.name', 'Changelog Tags Test');
    runGit('config', 'user.email', 'changelog-tags@example.invalid');
    fs.writeFileSync(
      path.join(repository, 'package.json'),
      JSON.stringify({ version })
    );
    fs.writeFileSync(
      path.join(repository, 'CHANGELOG.md'),
      headings.map((heading) => `## [${heading}]\n`).join('\n')
    );
    runGit('add', '.');
    runGit('commit', '--quiet', '-m', 'chore: initialize release fixture');
    for (const tag of tags) runGit('tag', tag);
    if (unrelatedHistory) {
      runGit('checkout', '--orphan', 'adopted-tree', '--quiet');
      runGit('add', '.');
      runGit('commit', '--quiet', '-m', 'chore: adopt release tree');
      for (const tag of tags) {
        assert.throws(
          () => runGit('merge-base', '--is-ancestor', tag, 'HEAD'),
          (error) => error.status === 1
        );
      }
    }
    const script = new URL('./check-changelog-tags.mjs', import.meta.url);
    try {
      return {
        status: 0,
        stdout: execFileSync(process.execPath, [fileURLToPath(script)], {
          cwd: repository,
          encoding: 'utf8',
          stdio: 'pipe',
        }),
        stderr: '',
      };
    } catch (error) {
      return {
        status: error.status,
        stdout: error.stdout.toString(),
        stderr: error.stderr.toString(),
      };
    }
  } finally {
    fs.rmSync(repository, { recursive: true, force: true });
  }
};

test('changelog tag scope validates numeric release order without relying on ancestry', () => {
  const result = checkChangelogFixture({
    version: '3.10.0',
    tags: ['v3.9.0', 'v3.10.0', 'v3.11.0'],
    headings: ['3.9.0', '3.10.0'],
    unrelatedHistory: true,
  });
  assert.equal(result.status, 0);
  assert.match(
    result.stdout,
    /covers all 2 applicable SeerrNG tag\(s\) through candidate 3\.10\.0/u
  );
  assert.match(
    result.stdout,
    /Newer tags outside candidate 3\.10\.0 scope \(1\): v3\.11\.0/u
  );
});

test('changelog tag scope rejects missing or duplicate applicable releases', () => {
  for (const headings of [
    ['3.10.0'],
    ['3.9.0'],
    ['3.9.0', '3.9.0', '3.10.0'],
    ['3.9.0', '3.10.0', '3.10.0'],
  ]) {
    const result = checkChangelogFixture({
      version: '3.10.0',
      tags: ['v3.9.0', 'v3.10.0', 'v3.11.0'],
      headings,
    });
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /missing tagged releases: 3\.(?:9|10)\.0|duplicate release sections: 3\.(?:9|10)\.0/u
    );
  }
});

test('changelog tag scope requires the declared candidate heading even before tagging', () => {
  for (const headings of [['3.9.0'], ['3.9.0', '3.10.0-beta.1']]) {
    const result = checkChangelogFixture({
      version: '3.10.0',
      tags: ['v3.9.0'],
      headings,
    });
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /missing the declared candidate release: 3\.10\.0/u
    );
  }
  const duplicate = checkChangelogFixture({
    version: '3.10.0',
    tags: ['v3.9.0'],
    headings: ['3.9.0', '3.10.0', '3.10.0'],
  });
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /duplicate release sections: 3\.10\.0/u);
});

test('changelog tag scope rejects invalid candidate or tag versions', () => {
  for (const version of [
    'v3.10.0',
    '3.10',
    '3.10.0-beta.1',
    '3.010.0',
    '4.0.0',
    '3.9007199254740992.0',
    null,
  ]) {
    const result = checkChangelogFixture({
      version,
      tags: ['v3.9.0'],
      headings: ['3.9.0'],
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /valid stable SeerrNG 3\.x release version/u);
  }
  for (const tag of [
    'v3.10.0-beta.1',
    'v3.010.0',
    'v3.invalid',
    'v3.9007199254740992.0',
  ]) {
    const result = checkChangelogFixture({
      version: '3.10.0',
      tags: ['v3.9.0', tag],
      headings: ['3.9.0', '3.10.0'],
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsupported SeerrNG release tag/u);
  }
});

test('changelog tag scope rejects zero applicable tags rather than vacuous coverage', () => {
  for (const tags of [[], ['v3.11.0']]) {
    const result = checkChangelogFixture({
      version: '3.10.0',
      tags,
      headings: ['3.10.0'],
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /No applicable SeerrNG release tags/u);
  }
});
