import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { contentTypeForPath, listFiles } from '../src/files.mjs';

test('contentTypeForPath maps common deck asset extensions', () => {
  assert.equal(contentTypeForPath('index.html'), 'text/html');
  assert.equal(contentTypeForPath('slides/assets/demo.mp4'), 'video/mp4');
  assert.equal(contentTypeForPath('slides/assets/unknown.bin'), 'application/octet-stream');
});

test('listFiles returns stable relative paths with content types', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'publish-slides-files-test-'));
  try {
    await mkdir(path.join(dir, 'slides', 'assets'), { recursive: true });
    await writeFile(path.join(dir, 'index.html'), '<!doctype html>');
    await writeFile(path.join(dir, 'slides', 'assets', 'demo.mp4'), 'video');
    const files = await listFiles(dir);
    assert.deepEqual(files.map((file) => file.path), ['index.html', 'slides/assets/demo.mp4']);
    assert.equal(files[0].contentType, 'text/html');
    assert.equal(files[1].contentType, 'video/mp4');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
