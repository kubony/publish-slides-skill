import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE_HREF_RE = /<base\s+[^>]*href=["']\/slides\/["'][^>]*>\s*/gi;
const VALIDATION_SCRIPT_RE = /<script\b[^>]*data-slides-grab-validation[^>]*>[\s\S]*?<\/script>\s*/gi;

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}

export function cleanHtmlSource(source) {
  return source.replace(BASE_HREF_RE, '').replace(VALIDATION_SCRIPT_RE, '');
}

export async function cleanStagedHtml(stageDir) {
  let changed = 0;
  for await (const filePath of walk(stageDir)) {
    if (!filePath.toLowerCase().endsWith('.html')) continue;
    const before = await readFile(filePath, 'utf8');
    const after = cleanHtmlSource(before);
    if (after !== before) {
      await writeFile(filePath, after, 'utf8');
      changed += 1;
    }
  }
  return changed;
}
