import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectDeck, urlForEntry } from '../src/detect.mjs';

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), 'publish-slides-test-'));
}

test('detects a slides-grab deck root with nested slides folder', async () => {
  const dir = await tempDir();
  try {
    await mkdir(path.join(dir, 'slides'));
    await writeFile(path.join(dir, 'slides', 'slide-01.html'), '<h1>one</h1>');
    await writeFile(path.join(dir, 'slides', 'viewer.html'), '<html></html>');
    const deck = await detectDeck(dir);
    assert.equal(deck.format, 'slides-grab');
    assert.equal(deck.layout, 'deck-root');
    assert.equal(deck.entryRel, 'slides/viewer.html');
    assert.equal(deck.slideCount, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('detects a slides folder passed directly', async () => {
  const dir = await tempDir();
  try {
    await writeFile(path.join(dir, 'slide-01.html'), '<h1>one</h1>');
    const deck = await detectDeck(dir);
    assert.equal(deck.format, 'slides-grab');
    assert.equal(deck.layout, 'slides-dir');
    assert.equal(deck.entryRel, 'slide-01.html');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('generic index.html URL points at explicit index file', () => {
  assert.equal(
    urlForEntry({ domain: 'slides.example.com', slug: 'abc123', entryRel: 'index.html' }),
    'https://slides.example.com/abc123/index.html'
  );
});
