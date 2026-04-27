import test from 'node:test';
import assert from 'node:assert/strict';
import { apiEndpointForConfig, uploadModeForConfig } from '../src/api-upload.mjs';

test('upload mode defaults to api when api endpoint is configured', () => {
  const config = { upload: { apiEndpoint: 'https://example.run.app' } };
  assert.equal(apiEndpointForConfig(config), 'https://example.run.app');
  assert.equal(uploadModeForConfig(config), 'api');
});

test('explicit upload mode overrides configured api endpoint', () => {
  const config = { upload: { mode: 'api', apiEndpoint: 'https://example.run.app' } };
  assert.equal(uploadModeForConfig(config, 'gcloud'), 'gcloud');
});
