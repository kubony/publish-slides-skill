import { access, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export class UserFacingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserFacingError';
  }
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function htmlSlidesIn(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /^slide-\d+\.html$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch {
    return [];
  }
}

export async function detectDeck(inputPath) {
  const sourceDir = path.resolve(inputPath);
  let info;
  try {
    info = await stat(sourceDir);
  } catch {
    throw new UserFacingError(`Deck path does not exist: ${sourceDir}`);
  }

  if (!info.isDirectory()) {
    throw new UserFacingError(`Deck path must be a directory: ${sourceDir}`);
  }

  const nestedSlidesDir = path.join(sourceDir, 'slides');
  const nestedSlides = await htmlSlidesIn(nestedSlidesDir);
  if (nestedSlides.length > 0) {
    const viewer = path.join(nestedSlidesDir, 'viewer.html');
    const firstSlideRel = `slides/${nestedSlides[0]}`;
    return {
      format: 'slides-grab',
      layout: 'deck-root',
      sourceDir,
      slideCount: nestedSlides.length,
      entryRel: (await exists(viewer)) ? 'slides/viewer.html' : firstSlideRel,
      firstSlideRel,
      titleRel: firstSlideRel,
      cleanupHtml: true
    };
  }

  const rootSlides = await htmlSlidesIn(sourceDir);
  if (rootSlides.length > 0) {
    const viewer = path.join(sourceDir, 'viewer.html');
    const firstSlideRel = rootSlides[0];
    return {
      format: 'slides-grab',
      layout: 'slides-dir',
      sourceDir,
      slideCount: rootSlides.length,
      entryRel: (await exists(viewer)) ? 'viewer.html' : firstSlideRel,
      firstSlideRel,
      titleRel: firstSlideRel,
      cleanupHtml: true
    };
  }

  if (await exists(path.join(sourceDir, 'index.html'))) {
    return {
      format: 'generic-html',
      layout: 'index-dir',
      sourceDir,
      slideCount: null,
      entryRel: 'index.html',
      titleRel: 'index.html',
      cleanupHtml: false
    };
  }

  if (await exists(path.join(sourceDir, 'viewer.html'))) {
    return {
      format: 'generic-html',
      layout: 'viewer-dir',
      sourceDir,
      slideCount: null,
      entryRel: 'viewer.html',
      titleRel: 'viewer.html',
      cleanupHtml: false
    };
  }

  throw new UserFacingError(
    `Unsupported deck folder: ${sourceDir}\n` +
      'Expected either slides/slide-*.html, slide-*.html, index.html, or viewer.html.'
  );
}

export function urlForEntry({ domain, slug, entryRel }) {
  const base = `https://${domain.replace(/\/+$/, '')}/${slug}/`;
  const normalized = entryRel.split(path.sep).join('/');
  return `${base}${normalized}`;
}
