import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  canonicalGoogleSlidesUrls,
  googleSlidesUrlFromInput,
  isGoogleSlidesInput,
  prepareGoogleSlidesDeck,
  renderGoogleSlidesViewerHtml
} from '../src/google-slides.mjs';

const SAMPLE =
  'https://docs.google.com/presentation/d/1vZUsCg3GJdxnVRg6nwDmtcsyawReRwohid5_HCZRDQc/edit?slide=id.g3aae98ea9cd_0_1313#slide=id.g3aae98ea9cd_0_1313';

test('isGoogleSlidesInput accepts presentation URLs and iframe embed codes', () => {
  assert.equal(isGoogleSlidesInput(SAMPLE), true);
  assert.equal(isGoogleSlidesInput('docs.google.com/presentation/d/abc123/edit'), true);
  assert.equal(isGoogleSlidesInput('<iframe src="https://docs.google.com/presentation/d/abc123/embed"></iframe>'), true);
  assert.equal(isGoogleSlidesInput('https://docs.google.com/document/d/abc123/edit'), false);
});

test('googleSlidesUrlFromInput validates https docs presentation links', () => {
  assert.equal(
    googleSlidesUrlFromInput('docs.google.com/presentation/d/abc123/edit'),
    'https://docs.google.com/presentation/d/abc123/edit'
  );
  assert.throws(() => googleSlidesUrlFromInput('http://docs.google.com/presentation/d/abc123/edit'), /https/);
});

test('canonicalGoogleSlidesUrls builds an embeddable URL and keeps slide id', () => {
  const urls = canonicalGoogleSlidesUrls(SAMPLE);
  assert.equal(urls.id, '1vZUsCg3GJdxnVRg6nwDmtcsyawReRwohid5_HCZRDQc');
  assert.match(urls.embedUrl, /\/presentation\/d\/1vZUsCg3GJdxnVRg6nwDmtcsyawReRwohid5_HCZRDQc\/embed/);
  assert.match(urls.embedUrl, /start=false/);
  assert.match(urls.embedUrl, /slide=id\.g3aae98ea9cd_0_1313/);
});

test('renderGoogleSlidesViewerHtml creates a simple slide-like iframe viewer', () => {
  const html = renderGoogleSlidesViewerHtml({
    title: 'Google <Slides>',
    embedUrl: 'https://docs.google.com/presentation/d/abc123/embed?start=false',
    originalUrl: 'https://docs.google.com/presentation/d/abc123/edit'
  });
  assert.match(html, /Google &lt;Slides&gt;/);
  assert.match(html, /<iframe/);
  assert.match(html, /allowfullscreen/);
  assert.match(html, /class="stage"/);
  assert.match(html, /전체/);
});

test('prepareGoogleSlidesDeck stages a static viewer and SVG thumbnail', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'publish-slides-gslides-test-'));
  try {
    const deck = await prepareGoogleSlidesDeck(SAMPLE, dir, { title: 'Google sample' });
    assert.equal(deck.format, 'google-slides');
    assert.equal(deck.layout, 'google-slides-embed');
    assert.equal(deck.entryRel, 'index.html');
    assert.equal(deck.sourceName, '1vZUsCg3GJdxnVRg6nwDmtcsyawReRwohid5_HCZRDQc');
    assert.equal((await stat(path.join(dir, 'index.html'))).isFile(), true);
    assert.equal((await stat(path.join(dir, 'thumbnail.svg'))).isFile(), true);
    assert.match(await readFile(path.join(dir, 'index.html'), 'utf8'), /Google sample/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
