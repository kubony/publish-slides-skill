import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { UserFacingError } from './detect.mjs';

function cleanEndpoint(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

export function apiEndpointForConfig(config = {}) {
  return cleanEndpoint(
    process.env.PUBLISH_SLIDES_API_URL ||
      config.upload?.apiEndpoint ||
      config.apiEndpoint ||
      ''
  );
}

export function uploadModeForConfig(config = {}, explicitMode = '') {
  const mode = String(process.env.PUBLISH_SLIDES_UPLOAD_MODE || explicitMode || config.upload?.mode || '').trim().toLowerCase();
  if (mode) return mode;
  return apiEndpointForConfig(config) ? 'api' : 'gcloud';
}

async function readJsonResponse(response, action) {
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Keep body null and surface raw response text below.
  }
  if (!response.ok) {
    const message = body?.error || text || `${response.status} ${response.statusText}`;
    throw new UserFacingError(`${action} failed: ${message}`);
  }
  return body || {};
}

async function postJson(endpoint, pathName, payload, action) {
  const response = await fetch(`${endpoint}${pathName}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return readJsonResponse(response, action);
}

export function tokenStorePath() {
  return process.env.PUBLISH_SLIDES_TOKEN_STORE || path.join(os.homedir(), '.config', 'publish-slides', 'tokens.json');
}

async function readTokenStore() {
  try {
    return JSON.parse(await readFile(tokenStorePath(), 'utf8'));
  } catch {
    return { schemaVersion: 1, tokens: {} };
  }
}

export async function savedEditToken(slug) {
  if (!slug) return '';
  const store = await readTokenStore();
  return String(store.tokens?.[slug] || '');
}

export async function saveEditToken(slug, token) {
  if (!slug || !token) return;
  const filePath = tokenStorePath();
  const store = await readTokenStore();
  store.schemaVersion = 1;
  store.tokens = { ...(store.tokens || {}), [slug]: token };
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}

export async function initApiUpload(config, { requestedSlug = '', editToken = '', files = [] } = {}) {
  const endpoint = apiEndpointForConfig(config);
  if (!endpoint) throw new UserFacingError('API upload mode requires config.upload.apiEndpoint or PUBLISH_SLIDES_API_URL.');
  return postJson(endpoint, '/api/publish/init', {
    slug: requestedSlug,
    editToken,
    files
  }, 'API upload init');
}

export async function uploadFilesToSignedUrls(stageDir, uploadFiles = []) {
  for (let index = 0; index < uploadFiles.length; index += 1) {
    const file = uploadFiles[index];
    const filePath = path.join(stageDir, file.path);
    const headers = {
      ...(file.headers || {}),
      'content-length': String(file.size)
    };
    console.error(`publish-slides: uploading ${index + 1}/${uploadFiles.length} ${file.path}`);
    const response = await fetch(file.uploadUrl, {
      method: 'PUT',
      headers,
      body: createReadStream(filePath),
      duplex: 'half'
    });
    if (!response.ok) {
      const text = await response.text();
      throw new UserFacingError(`Signed URL upload failed for ${file.path}: ${response.status} ${text.slice(0, 500)}`);
    }
  }
}

export async function finalizeApiUpload(config, { slug, editToken = '', catalogEntry, entryRel }) {
  const endpoint = apiEndpointForConfig(config);
  if (!endpoint) throw new UserFacingError('API upload mode requires config.upload.apiEndpoint or PUBLISH_SLIDES_API_URL.');
  const result = await postJson(endpoint, '/api/publish/finalize', {
    slug,
    editToken,
    entryRel,
    catalogEntry
  }, 'API upload finalize');
  if (result.editToken) await saveEditToken(slug, result.editToken);
  return result;
}
