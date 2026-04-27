import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { UserFacingError } from './detect.mjs';

const DEFAULT_HUB = {
  enabled: true,
  title: 'publish-slides',
  description: 'HTML slide decks shared with publish-slides.',
  catalogPath: 'catalog.json',
  indexPath: 'index.html'
};

const THUMBNAIL_CANDIDATES = [
  'thumbnail.png',
  'thumbnail.jpg',
  'thumbnail.jpeg',
  'thumbnail.webp',
  'cover.png',
  'cover.jpg',
  'cover.jpeg',
  'cover.webp',
  'slides/thumbnail.png',
  'slides/thumbnail.jpg',
  'slides/cover.png',
  'slides/cover.jpg'
];

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeRelPath(relPath) {
  return relPath.split(path.sep).join('/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function encodeRelUrl(relPath) {
  return normalizeRelPath(relPath)
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(value) {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function normalizeHubConfig(config = {}) {
  const hub = { ...DEFAULT_HUB, ...(config.hub || {}) };
  hub.enabled = hub.enabled !== false;
  hub.title = String(hub.title || DEFAULT_HUB.title).trim();
  hub.description = String(hub.description || DEFAULT_HUB.description).trim();
  hub.catalogPath = normalizeRelPath(String(hub.catalogPath || DEFAULT_HUB.catalogPath));
  hub.indexPath = normalizeRelPath(String(hub.indexPath || DEFAULT_HUB.indexPath));
  return { ...config, hub };
}

export function hubUrl(config) {
  const normalized = normalizeHubConfig(config);
  const domain = normalized.domain.replace(/\/+$/, '');
  return `https://${domain}/${encodeRelUrl(normalized.hub.indexPath)}`;
}

export function catalogUrl(config) {
  const normalized = normalizeHubConfig(config);
  const domain = normalized.domain.replace(/\/+$/, '');
  return `https://${domain}/${encodeRelUrl(normalized.hub.catalogPath)}`;
}

export function normalizeTags(tags = []) {
  const values = Array.isArray(tags) ? tags : [tags];
  const seen = new Set();
  const normalized = [];
  for (const value of values) {
    for (const tag of String(value || '').split(',')) {
      const clean = tag.trim();
      if (!clean) continue;
      const key = clean.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push(clean);
    }
  }
  return normalized;
}

export function humanizeName(name) {
  const withoutExtension = name.replace(/\.[^.]+$/, '');
  const words = withoutExtension
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!words) return 'Untitled deck';
  return words.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function extractTitleFromHtml(source) {
  const title = source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (title) {
    const clean = stripTags(title[1]);
    if (clean) return clean;
  }

  const h1 = source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) {
    const clean = stripTags(h1[1]);
    if (clean) return clean;
  }

  return '';
}

export async function titleForDeck(deck, explicitTitle) {
  if (explicitTitle && explicitTitle.trim()) return explicitTitle.trim();

  const titleRel = deck.titleRel || deck.firstSlideRel || deck.entryRel;
  if (titleRel) {
    try {
      const html = await readFile(path.join(deck.sourceDir, titleRel), 'utf8');
      const title = extractTitleFromHtml(html);
      if (title) return title;
    } catch {
      // Fall back to folder-derived title below.
    }
  }

  return humanizeName(path.basename(deck.sourceDir));
}

export async function thumbnailRelForDeck(deck, requestedThumbnail) {
  if (requestedThumbnail) {
    const raw = String(requestedThumbnail).trim();
    const absolute = path.isAbsolute(raw) ? raw : path.join(deck.sourceDir, raw);
    const relative = normalizeRelPath(path.relative(deck.sourceDir, absolute));
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new UserFacingError(`Thumbnail must be inside the deck folder: ${raw}`);
    }
    if (!(await exists(absolute))) {
      throw new UserFacingError(`Thumbnail does not exist: ${raw}`);
    }
    return relative;
  }

  for (const candidate of THUMBNAIL_CANDIDATES) {
    if (await exists(path.join(deck.sourceDir, candidate))) return candidate;
  }
  return '';
}

export async function buildCatalogEntry({ config, deck, slug, url, options = {}, existingEntry = null, now = new Date() }) {
  const normalizedConfig = normalizeHubConfig(config);
  const nowIso = now.toISOString();
  const baseUrl = `https://${normalizedConfig.domain.replace(/\/+$/, '')}/${encodeURIComponent(slug)}/`;
  const thumbnailRel = await thumbnailRelForDeck(deck, options.thumbnail);
  const defaultTags = Array.isArray(normalizedConfig.defaultTags)
    ? normalizedConfig.defaultTags
    : [normalizedConfig.defaultTags].filter(Boolean);
  const optionTags = Array.isArray(options.tags) ? options.tags : [options.tags].filter(Boolean);
  const tags = normalizeTags([
    ...defaultTags,
    deck.format,
    ...optionTags
  ]);

  return {
    slug,
    title: await titleForDeck(deck, options.title),
    description: String(options.description || '').trim(),
    author: String(options.author || normalizedConfig.defaultAuthor || '').trim(),
    tags,
    url,
    baseUrl,
    thumbnailRel,
    thumbnailUrl: thumbnailRel ? `${baseUrl}${encodeRelUrl(thumbnailRel)}` : '',
    format: deck.format,
    layout: deck.layout,
    slideCount: deck.slideCount,
    sourceName: path.basename(deck.sourceDir),
    createdAt: existingEntry?.createdAt || nowIso,
    updatedAt: nowIso
  };
}

export function emptyCatalog(config = {}, now = new Date()) {
  const normalizedConfig = normalizeHubConfig(config);
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    hub: {
      title: normalizedConfig.hub.title,
      description: normalizedConfig.hub.description
    },
    decks: []
  };
}

export function parseCatalogText(text, config = {}) {
  if (!text || !text.trim()) return emptyCatalog(config);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new UserFacingError(`Remote catalog is not valid JSON: ${error.message}`);
  }

  if (!Array.isArray(parsed.decks)) {
    throw new UserFacingError('Remote catalog is missing a decks array.');
  }

  const normalized = emptyCatalog(config);
  return {
    ...normalized,
    ...parsed,
    hub: {
      ...normalized.hub,
      ...(parsed.hub || {})
    },
    decks: parsed.decks
  };
}

export function upsertCatalogEntry(catalog, entry, now = new Date()) {
  const decks = catalog.decks.filter((deck) => deck.slug !== entry.slug);
  decks.push(entry);
  decks.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return {
    ...catalog,
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    decks
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().slice(0, 10);
}

function deckSearchText(deck) {
  return [deck.title, deck.description, deck.author, deck.format, ...(deck.tags || [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function renderDeckCard(deck) {
  const title = escapeHtml(deck.title || deck.slug);
  const description = deck.description ? `<p class="description">${escapeHtml(deck.description)}</p>` : '';
  const author = deck.author ? `<span>${escapeHtml(deck.author)}</span>` : '';
  const slideCount = Number.isInteger(deck.slideCount) ? `<span>${deck.slideCount} slides</span>` : '';
  const updatedAt = deck.updatedAt ? `<span>${escapeHtml(formatDate(deck.updatedAt))}</span>` : '';
  const tags = (deck.tags || [])
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join('');
  const thumb = deck.thumbnailUrl
    ? `<img src="${escapeHtml(deck.thumbnailUrl)}" alt="${title} thumbnail" loading="lazy">`
    : `<div class="placeholder" aria-hidden="true"><span>${escapeHtml((deck.title || deck.slug).slice(0, 2).toUpperCase())}</span></div>`;

  return `<article class="deck-card" data-search="${escapeHtml(deckSearchText(deck))}">
    <a class="thumb" href="${escapeHtml(deck.url)}">${thumb}</a>
    <div class="deck-body">
      <h2><a href="${escapeHtml(deck.url)}">${title}</a></h2>
      <div class="meta">${[author, slideCount, updatedAt].filter(Boolean).join('')}</div>
      ${description}
      <div class="tags">${tags}</div>
      <a class="open" href="${escapeHtml(deck.url)}">Open slides</a>
    </div>
  </article>`;
}

export function renderHubPage(catalog, config = {}) {
  const normalizedConfig = normalizeHubConfig(config);
  const title = catalog.hub?.title || normalizedConfig.hub.title;
  const description = catalog.hub?.description || normalizedConfig.hub.description;
  const decks = [...catalog.decks].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const cards = decks.length
    ? decks.map(renderDeckCard).join('\n')
    : '<p class="empty">No decks published yet. Run <code>publish-slides ./deck</code> to add the first one.</p>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; --bg: #080b12; --panel: #111827; --panel2: #172033; --text: #edf2ff; --muted: #9aa7bd; --line: rgba(255,255,255,.1); --accent: #87f5ff; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: radial-gradient(circle at top left, rgba(135,245,255,.18), transparent 30rem), var(--bg); color: var(--text); }
    a { color: inherit; }
    header { max-width: 1120px; margin: 0 auto; padding: 64px 24px 28px; }
    .eyebrow { color: var(--accent); font-size: 13px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; }
    h1 { margin: 12px 0 12px; font-size: clamp(40px, 7vw, 84px); line-height: .92; letter-spacing: -.06em; }
    header p { max-width: 720px; color: var(--muted); font-size: 18px; line-height: 1.6; }
    .toolbar { max-width: 1120px; margin: 0 auto; padding: 0 24px 24px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
    input[type="search"] { flex: 1 1 280px; min-width: 0; border: 1px solid var(--line); border-radius: 16px; background: rgba(17,24,39,.72); color: var(--text); padding: 14px 16px; font-size: 16px; outline: none; }
    input[type="search"]:focus { border-color: rgba(135,245,255,.8); box-shadow: 0 0 0 4px rgba(135,245,255,.12); }
    .count { color: var(--muted); font-size: 14px; }
    main { max-width: 1120px; margin: 0 auto; padding: 0 24px 64px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 18px; }
    .deck-card { overflow: hidden; border: 1px solid var(--line); border-radius: 24px; background: linear-gradient(180deg, rgba(23,32,51,.9), rgba(17,24,39,.9)); box-shadow: 0 24px 60px rgba(0,0,0,.22); }
    .thumb { display: block; aspect-ratio: 16 / 9; background: #0b1020; text-decoration: none; overflow: hidden; }
    .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .placeholder { width: 100%; height: 100%; display: grid; place-items: center; background: linear-gradient(135deg, rgba(135,245,255,.24), rgba(130,90,255,.28)); }
    .placeholder span { font-size: 56px; font-weight: 900; opacity: .78; letter-spacing: -.08em; }
    .deck-body { padding: 18px; }
    h2 { margin: 0 0 10px; font-size: 20px; line-height: 1.2; letter-spacing: -.02em; }
    h2 a { text-decoration: none; }
    h2 a:hover { color: var(--accent); }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; color: var(--muted); font-size: 13px; }
    .meta span:not(:last-child)::after { content: '·'; margin-left: 8px; color: #64748b; }
    .description { color: #c6d0e1; line-height: 1.5; min-height: 3em; }
    .tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 14px 0; }
    .tag { border: 1px solid var(--line); border-radius: 999px; color: #c6d0e1; padding: 4px 8px; font-size: 12px; }
    .open { display: inline-flex; align-items: center; justify-content: center; width: 100%; margin-top: 4px; border-radius: 14px; padding: 11px 14px; background: var(--text); color: #0b1020; font-weight: 800; text-decoration: none; }
    .empty { color: var(--muted); border: 1px dashed var(--line); border-radius: 20px; padding: 24px; }
    footer { max-width: 1120px; margin: 0 auto; padding: 0 24px 48px; color: var(--muted); font-size: 13px; }
  </style>
</head>
<body>
  <header>
    <div class="eyebrow">publish-slides hub</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(description)}</p>
  </header>
  <section class="toolbar" aria-label="Deck search">
    <input id="search" type="search" placeholder="Search decks, authors, tags…" autocomplete="off">
    <div class="count"><span id="visible-count">${decks.length}</span> / ${decks.length} decks</div>
  </section>
  <main>
    <div class="grid" id="deck-grid">${cards}</div>
  </main>
  <footer>
    Generated ${escapeHtml(formatDate(catalog.generatedAt))}. Machine-readable catalog: <a href="/${escapeHtml(normalizedConfig.hub.catalogPath)}">/${escapeHtml(normalizedConfig.hub.catalogPath)}</a>
  </footer>
  <script>
    const search = document.getElementById('search');
    const cards = Array.from(document.querySelectorAll('.deck-card'));
    const count = document.getElementById('visible-count');
    search?.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      let visible = 0;
      for (const card of cards) {
        const show = !q || card.dataset.search.includes(q);
        card.hidden = !show;
        if (show) visible += 1;
      }
      count.textContent = String(visible);
    });
  </script>
</body>
</html>
`;
}
