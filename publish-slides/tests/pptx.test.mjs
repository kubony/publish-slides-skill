import test from 'node:test';
import assert from 'node:assert/strict';
import { isPptxPath, renderPptxViewerHtml } from '../src/pptx.mjs';

test('isPptxPath accepts real pptx files and ignores Office lock files', () => {
  assert.equal(isPptxPath('/tmp/마음AI WoRV 소개.pptx'), true);
  assert.equal(isPptxPath('/tmp/deck.PPTX'), true);
  assert.equal(isPptxPath('/tmp/~$deck.pptx'), false);
  assert.equal(isPptxPath('/tmp/deck.pdf'), false);
});

test('renderPptxViewerHtml preserves original and exposes PDF/Office viewers', () => {
  const html = renderPptxViewerHtml({ title: '마음AI <WoRV>', slideCount: 11 });
  assert.match(html, /마음AI &lt;WoRV&gt;/);
  assert.match(html, /source\.pptx/);
  assert.match(html, /slides\.pdf/);
  assert.match(html, /view\.officeapps\.live\.com/);
  assert.match(html, /11 slides/);
  assert.match(html, /전체화면/);
});
