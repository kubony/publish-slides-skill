import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { UserFacingError } from './detect.mjs';

const execFileAsync = promisify(execFile);

function gcloudArgs(config, args) {
  if (config.projectId && config.projectId !== 'CHANGE_ME') {
    return ['--project', config.projectId, ...args];
  }
  return args;
}

export async function ensureGcloudReady(config) {
  try {
    await execFileAsync('gcloud', ['--version']);
  } catch {
    throw new UserFacingError('gcloud is not installed or not available in PATH. Install Google Cloud SDK first.');
  }

  try {
    const { stdout } = await execFileAsync(
      'gcloud',
      gcloudArgs(config, ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'])
    );
    if (!stdout.trim()) {
      throw new Error('no active account');
    }
  } catch {
    throw new UserFacingError('gcloud has no active authenticated account. Run: gcloud auth login');
  }
}

export async function slugExists(config, slug) {
  try {
    await execFileAsync('gcloud', gcloudArgs(config, ['storage', 'ls', `gs://${config.bucket}/${slug}/`]), {
      timeout: 30_000
    });
    return true;
  } catch {
    return false;
  }
}

async function copyToBucket(config, source, destination, { recursive = false, cacheControl = '', contentType = '' } = {}) {
  const cpArgs = ['storage', 'cp'];
  if (recursive) cpArgs.push('--recursive');
  if (cacheControl) cpArgs.push(`--cache-control=${cacheControl}`);
  if (contentType) cpArgs.push(`--content-type=${contentType}`);
  cpArgs.push(source, destination);
  const args = gcloudArgs(config, cpArgs);
  try {
    await execFileAsync('gcloud', args, {
      env: {
        ...process.env,
        GCLOUD_CORE_PARALLEL_COMPOSITE_UPLOAD_THRESHOLD:
          process.env.GCLOUD_CORE_PARALLEL_COMPOSITE_UPLOAD_THRESHOLD || '50M'
      },
      maxBuffer: 1024 * 1024 * 10
    });
  } catch (error) {
    const stderr = error.stderr ? `\n${error.stderr}` : '';
    throw new UserFacingError(`Upload failed while copying ${source} to ${destination}.${stderr}`);
  }
}

export async function uploadStage(config, stageDir, slug) {
  const entries = await readdir(stageDir, { withFileTypes: true });
  if (entries.length === 0) {
    throw new UserFacingError('Staged deck is empty; refusing to upload.');
  }

  const destination = `gs://${config.bucket}/${slug}/`;
  for (const entry of entries) {
    const source = path.join(stageDir, entry.name);
    await copyToBucket(config, source, destination, { recursive: entry.isDirectory() });
  }
}

function isNotFound(error) {
  const text = `${error.stderr || ''}\n${error.stdout || ''}\n${error.message || ''}`.toLowerCase();
  return (
    text.includes('not found') ||
    text.includes('no urls matched') ||
    text.includes('matched no objects or files') ||
    text.includes('404')
  );
}

export async function readObjectText(config, objectPath) {
  try {
    const { stdout } = await execFileAsync(
      'gcloud',
      gcloudArgs(config, ['storage', 'cat', `gs://${config.bucket}/${objectPath}`]),
      { maxBuffer: 1024 * 1024 * 20 }
    );
    return stdout;
  } catch (error) {
    if (isNotFound(error)) return '';
    const stderr = error.stderr ? `\n${error.stderr}` : '';
    throw new UserFacingError(`Could not read gs://${config.bucket}/${objectPath}.${stderr}`);
  }
}

export async function uploadTextObject(config, objectPath, contents) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'publish-slides-hub-'));
  try {
    const filePath = path.join(tempDir, path.basename(objectPath));
    await writeFile(filePath, contents, 'utf8');
    await copyToBucket(config, filePath, `gs://${config.bucket}/${objectPath}`, {
      cacheControl: 'no-cache, max-age=0',
      contentType: objectPath.endsWith('.json') ? 'application/json' : 'text/html'
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
