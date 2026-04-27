import test from 'node:test';
import assert from 'node:assert/strict';
import { authorFromEnvironment, defaultAuthor, firstNonEmpty } from '../src/defaults.mjs';

test('firstNonEmpty returns trimmed first non-empty value', () => {
  assert.equal(firstNonEmpty('', '  ', ' Alice ', 'Bob'), 'Alice');
  assert.equal(firstNonEmpty('', null, undefined), '');
});

test('authorFromEnvironment uses publish-slides and git env before OS username', () => {
  assert.equal(
    authorFromEnvironment({ PUBLISH_SLIDES_AUTHOR: 'Deck Team', USER: 'inkeun' }, { username: 'fallback' }),
    'Deck Team'
  );
  assert.equal(
    authorFromEnvironment({ GIT_AUTHOR_NAME: 'Git User', USER: 'inkeun' }, { username: 'fallback' }),
    'Git User'
  );
  assert.equal(authorFromEnvironment({}, { username: 'fallback' }), 'fallback');
});

test('defaultAuthor prefers explicit and config values before environment fallback', async () => {
  assert.equal(
    await defaultAuthor({ explicitAuthor: 'Explicit', config: { defaultAuthor: 'Config' }, env: { USER: 'env-user' } }),
    'Explicit'
  );
  assert.equal(
    await defaultAuthor({ config: { defaultAuthor: 'Config' }, env: { USER: 'env-user' } }),
    'Config'
  );
});
