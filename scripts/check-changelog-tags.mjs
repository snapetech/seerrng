#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import process from 'node:process';

const repository = process.cwd();
// The checked-out app's release identity is independent of build-channel labels
// and Git ancestry (a fork can adopt a released tree without its tag ancestry).
const parseVersion = (value) => {
  if (
    typeof value !== 'string' ||
    !/^3\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(value)
  ) {
    return null;
  }
  const parts = value.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
};
const candidateVersion = JSON.parse(
  fs.readFileSync('package.json', 'utf8')
).version;
const candidateParts = parseVersion(candidateVersion);
if (!candidateParts) {
  console.error(
    'package.json must declare a valid stable SeerrNG 3.x release version.'
  );
  process.exit(1);
}
const tags = execFileSync(
  'git',
  ['tag', '--sort=version:refname', '--list', 'v3.*'],
  { cwd: repository, encoding: 'utf8' }
)
  .trim()
  .split(/\s+/u)
  .filter(Boolean);
const applicableTags = [];
const newerTags = [];
for (const tag of tags) {
  const parts = parseVersion(tag.slice(1));
  if (!parts) {
    console.error(
      `Unsupported SeerrNG release tag: ${tag}; expected a stable v3.x.y version.`
    );
    process.exit(1);
  }
  const difference =
    parts
      .map((part, index) => part - candidateParts[index])
      .find((part) => part !== 0) ?? 0;
  (difference > 0 ? newerTags : applicableTags).push(tag);
}
if (newerTags.length > 0) {
  console.log(
    `Newer tags outside candidate ${candidateVersion} scope (${newerTags.length}): ${newerTags.join(', ')}`
  );
}
if (applicableTags.length === 0) {
  console.error(
    `No applicable SeerrNG release tags at or below candidate ${candidateVersion}.`
  );
  process.exit(1);
}
const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
const versions = [
  ...changelog.matchAll(/^## \[?(\d+\.\d+\.\d+)\]?(?=\s|\(|$)/gmu),
].map((match) => match[1]);
const counts = new Map();
for (const version of versions) {
  counts.set(version, (counts.get(version) ?? 0) + 1);
}

const missing = applicableTags
  .map((tag) => tag.slice(1))
  .filter((version) => !counts.has(version));
const requiredVersions = new Set([
  ...applicableTags.map((tag) => tag.slice(1)),
  candidateVersion,
]);
const duplicate = [...requiredVersions]
  .filter((version) => (counts.get(version) ?? 0) > 1)
  .map((version) => `${version} (${counts.get(version)} sections)`);

const missingCandidate = !counts.has(candidateVersion);
if (missing.length > 0 || duplicate.length > 0 || missingCandidate) {
  if (missing.length > 0) {
    console.error(
      `Changelog is missing tagged releases: ${missing.join(', ')}`
    );
  }
  if (missingCandidate) {
    console.error(
      `Changelog is missing the declared candidate release: ${candidateVersion}`
    );
  }
  if (duplicate.length > 0) {
    console.error(
      `Changelog contains duplicate release sections: ${duplicate.join(', ')}`
    );
  }
  process.exit(1);
}

console.log(
  `Changelog covers all ${applicableTags.length} applicable SeerrNG tag(s) through candidate ${candidateVersion}.`
);
