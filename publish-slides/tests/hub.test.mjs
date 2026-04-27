import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectDeck } from '../src/detect.mjs';
import {
  buildCatalogEntry,
  emptyCatalog,
  extractTitleFromHtml,
  hubUrl,
  normalizeHubConfig,
  renderHubPage,
  upsertCatalogEntry
} from '../src/hub.mjs';

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), 'publish-slides-hub-test-'));
}

const config = normalizeHubConfig({
  domain: 'slides.example.com',
  defaultTags: ['community'],
  hub: {
    title: 'Example Slides',
    description: 'Shared decks',
    catalogPath: 'catalog.json',
    indexPath: 'index.html'
  }
});

test('extractTitleFromHtml prefers title then h1', () => {
  assert.equal(extractTitleFromHtml('<title>Bobcat &amp; AI</title><h1>Ignored</h1>'), 'Bobcat & AI');
  assert.equal(extractTitleFromHtml('<main><h1>Fallback Deck</h1></main>'), 'Fallback Deck');
});

test('buildCatalogEntry auto-detects metadata and thumbnail', async () => {
  const dir = await tempDir();
  try {
    await mkdir(path.join(dir, 'slides'));
    await writeFile(path.join(dir, 'slides', 'slide-01.html'), '<title>Launch Deck</title>');
    await writeFile(path.join(dir, 'slides', 'viewer.html'), '<title>Viewer</title>');
    await writeFile(path.join(dir, 'thumbnail.png'), 'not really a png');
    const deck = await detectDeck(dir);
    const entry = await buildCatalogEntry({
      config,
      deck,
      slug: 'abc123',
      url: 'https://slides.example.com/abc123/slides/viewer.html',
      options: { author: 'Inkeun', tags: ['launch, demo'] },
      now: new Date('2026-04-26T00:00:00.000Z')
    });

    assert.equal(entry.title, 'Launch Deck');
    assert.equal(entry.author, 'Inkeun');
    assert.deepEqual(entry.tags, ['community', 'slides-grab', 'launch', 'demo']);
    assert.equal(entry.thumbnailRel, 'thumbnail.png');
    assert.equal(entry.thumbnailUrl, 'https://slides.example.com/abc123/thumbnail.png');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('upsertCatalogEntry replaces existing slug and preserves newest first', () => {
  const catalog = emptyCatalog(config, new Date('2026-04-26T00:00:00.000Z'));
  const first = upsertCatalogEntry(catalog, { slug: 'old', title: 'Old', updatedAt: '2026-04-25T00:00:00.000Z' });
  const second = upsertCatalogEntry(first, { slug: 'new', title: 'New', updatedAt: '2026-04-26T00:00:00.000Z' });
  const replaced = upsertCatalogEntry(second, { slug: 'old', title: 'Old v2', updatedAt: '2026-04-27T00:00:00.000Z' });

  assert.equal(replaced.decks.length, 2);
  assert.equal(replaced.decks[0].slug, 'old');
  assert.equal(replaced.decks[0].title, 'Old v2');
});

test('renderHubPage creates searchable gallery HTML', () => {
  const catalog = upsertCatalogEntry(emptyCatalog(config), {
    slug: 'abc123',
    title: 'Escaped <Deck>',
    description: 'A useful deck',
    author: 'Team',
    tags: ['demo'],
    url: 'https://slides.example.com/abc123/',
    updatedAt: '2026-04-26T00:00:00.000Z'
  });
  const html = renderHubPage(catalog, config);

  assert.match(html, /publish-slides hub/);
  assert.match(html, /Escaped &lt;Deck&gt;/);
  assert.match(html, /id="search"/);
  assert.equal(hubUrl(config), 'https://slides.example.com/index.html');
});
