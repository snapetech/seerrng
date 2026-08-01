import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from 'node:fs';

const MAX_INDEX_BYTES = 128 * 1024 * 1024;
const MAX_INDEX_ISSUES = 10_000;
const MAX_EMBEDDING_DIMENSIONS = 4096;

const isBoundedString = (value, maxLength) =>
  typeof value === 'string' && value.length <= maxLength;

export function loadIndex(path) {
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (error?.code === 'ELOOP') {
      throw new Error('Issue index is not a bounded private regular file', {
        cause: error,
      });
    }
    throw error;
  }
  try {
    const metadata = fstatSync(descriptor);
    if (
      !metadata.isFile() ||
      metadata.nlink !== 1 ||
      metadata.size < 1 ||
      metadata.size > MAX_INDEX_BYTES
    ) {
      throw new Error('Issue index is not a bounded private regular file');
    }

    const data = JSON.parse(readFileSync(descriptor, 'utf8'));
    if (
      data === null ||
      typeof data !== 'object' ||
      !Array.isArray(data.issues) ||
      !Array.isArray(data.embeddings) ||
      data.issues.length !== data.embeddings.length ||
      data.issues.length > MAX_INDEX_ISSUES
    ) {
      throw new Error('Issue index has an invalid top-level shape');
    }

    const issueNumbers = new Set();
    let dimensions;
    for (let index = 0; index < data.issues.length; index += 1) {
      const issue = data.issues[index];
      if (
        issue === null ||
        typeof issue !== 'object' ||
        !Number.isSafeInteger(issue.number) ||
        issue.number < 1 ||
        issueNumbers.has(issue.number) ||
        !isBoundedString(issue.title, 256) ||
        !isBoundedString(issue.state, 32) ||
        !isBoundedString(issue.body_preview ?? '', 500) ||
        !isBoundedString(issue.url ?? '', 2048) ||
        !Array.isArray(issue.labels) ||
        issue.labels.length > 100 ||
        !issue.labels.every((label) => isBoundedString(label, 100))
      ) {
        throw new Error(
          `Issue index contains invalid metadata at row ${index}`
        );
      }
      issueNumbers.add(issue.number);

      const embedding = data.embeddings[index];
      if (
        !Array.isArray(embedding) ||
        embedding.length < 1 ||
        embedding.length > MAX_EMBEDDING_DIMENSIONS ||
        (dimensions !== undefined && embedding.length !== dimensions) ||
        !embedding.every(
          (component) => Number.isFinite(component) && Math.abs(component) <= 1
        )
      ) {
        throw new Error(
          `Issue index contains an invalid embedding at row ${index}`
        );
      }
      dimensions ??= embedding.length;
    }

    return data;
  } finally {
    closeSync(descriptor);
  }
}
