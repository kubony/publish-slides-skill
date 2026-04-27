import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanHtmlSource } from '../src/clean.mjs';
import { randomSlug, validateSlug } from '../src/slug.mjs';

test('cleanHtmlSource strips slides-grab base href and validation script', () => {
  const before = `<!doctype html><html><head><base href="/slides/"><script data-slides-grab-validation>window.__x = true;</script></head><body>ok</body></html>`;
  const after = cleanHtmlSource(before);
  assert.equal(after.includes('<base'), false);
  assert.equal(after.includes('data-slides-grab-validation'), false);
  assert.equal(after.includes('<body>ok</body>'), true);
});

test('randomSlug returns url-safe slug with requested length', () => {
  const slug = randomSlug(12);
  assert.equal(slug.length, 12);
  assert.match(slug, /^[A-Za-z0-9_-]+$/);
});

test('validateSlug rejects paths and reserved hub objects', () => {
  assert.equal(validateSlug('deck_123'), '');
  assert.match(validateSlug('bad/path'), /letters/);
  assert.match(validateSlug('assets'), /reserved/);
});
