import { randomBytes } from 'node:crypto';

const SLUG_RE = /^[A-Za-z0-9_-]+$/;
const RESERVED_SLUGS = new Set([
  'index.html',
  'catalog.json',
  'favicon.ico',
  'robots.txt',
  'assets',
  'static'
]);

export function randomSlug(length = 12) {
  if (!Number.isInteger(length) || length < 6 || length > 64) {
    throw new Error('slugLength must be an integer between 6 and 64');
  }

  const bytes = Math.ceil((length * 3) / 4) + 2;
  return randomBytes(bytes).toString('base64url').slice(0, length);
}

export function validateSlug(slug) {
  if (!slug || typeof slug !== 'string') return 'Slug is required.';
  if (slug.length < 3 || slug.length > 64) return 'Slug must be between 3 and 64 characters.';
  if (!SLUG_RE.test(slug)) return 'Slug may only contain letters, numbers, underscores, and hyphens.';
  if (RESERVED_SLUGS.has(slug.toLowerCase())) return `Slug is reserved: ${slug}`;
  return '';
}
