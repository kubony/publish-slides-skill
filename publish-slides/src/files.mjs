import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const CONTENT_TYPES = new Map([
  ['.html', 'text/html'],
  ['.htm', 'text/html'],
  ['.css', 'text/css'],
  ['.js', 'text/javascript'],
  ['.mjs', 'text/javascript'],
  ['.json', 'application/json'],
  ['.txt', 'text/plain'],
  ['.md', 'text/markdown'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.ico', 'image/x-icon'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.mov', 'video/quicktime'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.ogg', 'audio/ogg'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.pdf', 'application/pdf']
]);

export function contentTypeForPath(filePath) {
  return CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
}

function toRel(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

export async function listFiles(rootDir) {
  const root = path.resolve(rootDir);
  const files = [];

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const info = await stat(fullPath);
        const rel = toRel(root, fullPath);
        files.push({
          path: rel,
          size: info.size,
          contentType: contentTypeForPath(rel)
        });
      }
    }
  }

  await walk(root);
  return files;
}
