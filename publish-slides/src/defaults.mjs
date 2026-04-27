import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function clean(value) {
  return String(value || '').trim();
}

export function firstNonEmpty(...values) {
  for (const value of values) {
    const cleaned = clean(value);
    if (cleaned) return cleaned;
  }
  return '';
}

export function authorFromEnvironment(env = process.env, userInfo = os.userInfo()) {
  return firstNonEmpty(
    env.PUBLISH_SLIDES_AUTHOR,
    env.GIT_AUTHOR_NAME,
    env.GIT_COMMITTER_NAME,
    env.USER,
    env.LOGNAME,
    userInfo?.username
  );
}

export async function authorFromGit(cwd = process.cwd()) {
  try {
    const { stdout } = await execFileAsync('git', ['config', '--get', 'user.name'], {
      cwd,
      timeout: 2_000
    });
    return clean(stdout);
  } catch {
    return '';
  }
}

export async function defaultAuthor({ explicitAuthor = '', config = {}, cwd = process.cwd(), env = process.env } = {}) {
  return firstNonEmpty(
    explicitAuthor,
    config.defaultAuthor,
    env.PUBLISH_SLIDES_AUTHOR,
    await authorFromGit(cwd),
    authorFromEnvironment(env)
  );
}
