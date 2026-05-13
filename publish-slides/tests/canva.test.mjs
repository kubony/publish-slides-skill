import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  canvaUrlFromInput,
  canonicalCanvaViewerUrl,
  isCanvaInput,
  prepareCanvaDeck,
  renderCanvaViewerHtml
} from '../src/canva.mjs';

test('isCanvaInput accepts Canva URLs and iframe embed codes', () => {
  assert.equal(isCanvaInput('https://www.canva.com/design/DACHZTlgWkU/view'), true);
  assert.equal(isCanvaInput('www.canva.com/design/DACHZTlgWkU/view'), true);
  assert.equal(isCanvaInput('https://canva.link/w84why5jyz3li8s'), true);
  assert.equal(isCanvaInput('<iframe src="https://www.canva.com/design/DACHZTlgWkU/view?embed"></iframe>'), true);
  assert.equal(isCanvaInput('https://example.com/design/DACHZTlgWkU/view'), false);
});

test('canvaUrlFromInput normalizes and validates input', () => {
  assert.equal(
    canvaUrlFromInput('www.canva.com/design/DACHZTlgWkU/view'),
    'https://www.canva.com/design/DACHZTlgWkU/view'
  );
  assert.throws(() => canvaUrlFromInput('http://www.canva.com/design/DACHZTlgWkU/view'), /https/);
});

test('canonicalCanvaViewerUrl turns edit links into embeddable view links', () => {
  assert.equal(
    canonicalCanvaViewerUrl('https://www.canva.com/design/DAG_P29hPt8/qwXnBsGWwSJV-59STS5_qQ/edit?utm_source=sharebutton'),
    'https://www.canva.com/design/DAG_P29hPt8/qwXnBsGWwSJV-59STS5_qQ/view?embed'
  );
});

test('renderCanvaViewerHtml creates a simple slide-like iframe viewer', () => {
  const html = renderCanvaViewerHtml({
    title: 'Canva <Deck>',
    canvaUrl: 'https://www.canva.com/design/DACHZTlgWkU/view'
  });
  assert.match(html, /Canva &lt;Deck&gt;/);
  assert.match(html, /<iframe/);
  assert.match(html, /allowfullscreen/);
  assert.match(html, /class="stage"/);
  assert.match(html, /전체/);
});

test('prepareCanvaDeck stages a static viewer and SVG thumbnail', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'publish-slides-canva-test-'));
  try {
    const deck = await prepareCanvaDeck('https://www.canva.com/design/DACHZTlgWkU/view', dir, {
      title: 'Canva sample'
    });
    assert.equal(deck.format, 'canva');
    assert.equal(deck.layout, 'canva-embed');
    assert.equal(deck.entryRel, 'index.html');
    assert.equal(deck.sourceName, 'DACHZTlgWkU');
    assert.equal((await stat(path.join(dir, 'index.html'))).isFile(), true);
    assert.equal((await stat(path.join(dir, 'thumbnail.svg'))).isFile(), true);
    assert.match(await readFile(path.join(dir, 'index.html'), 'utf8'), /Canva sample/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
