import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import imageSize from 'image-size';
import { imageSizeFromFile } from 'image-size/fromFile';

const box = (input, offset, size, type) => {
  input.writeUInt32BE(size, offset);
  input.write(type, offset + 4, 'ascii');
};

test('rejects ICNS entries with a zero length', () => {
  const input = Buffer.alloc(16);
  input.write('icns', 0, 'ascii');
  input.writeUInt32BE(16, 4);
  input.write('ic09', 8, 'ascii');

  assert.throws(() => imageSize(input), /Invalid ICNS/u);
});

test('rejects HEIF ispe boxes with a zero length', () => {
  const input = Buffer.alloc(60);
  box(input, 0, 16, 'ftyp');
  input.write('mif1', 8, 'ascii');
  box(input, 16, 44, 'meta');
  box(input, 28, 24, 'iprp');
  box(input, 36, 16, 'ipco');
  box(input, 44, 0, 'ispe');

  assert.throws(() => imageSize(input), /Invalid HEIF/u);
});

test('rejects JXL boxes that cannot advance the parser', () => {
  const input = Buffer.alloc(40);
  box(input, 0, 16, 'JXL ');
  box(input, 16, 16, 'ftyp');
  input.write('jxl ', 24, 'ascii');
  box(input, 32, 0, 'jxlp');

  assert.throws(() => imageSize(input), /Invalid JXL/u);
});

test('rejects malformed files through the asynchronous file API', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'seerrng-image-size-')
  );
  const filePath = path.join(directory, 'malformed.icns');
  const input = Buffer.alloc(16);
  input.write('icns', 0, 'ascii');
  input.writeUInt32BE(16, 4);
  input.write('ic09', 8, 'ascii');

  try {
    await writeFile(filePath, input);
    await assert.rejects(imageSizeFromFile(filePath), /Invalid ICNS/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
