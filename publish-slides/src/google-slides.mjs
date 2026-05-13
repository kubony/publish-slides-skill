import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { UserFacingError } from './detect.mjs';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractUrlText(input) {
  const raw = String(input || '').trim();
  const iframeSrc = raw.match(/<iframe\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/i);
  const candidate = iframeSrc ? iframeSrc[2] : raw;
  return decodeHtmlEntities(candidate).trim();
}

export function googleSlidesUrlFromInput(input) {
  let candidate = extractUrlText(input);
  if (/^docs\.google\.com\/presentation\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new UserFacingError('Google Slides input must be a docs.google.com presentation URL or iframe embed code.');
  }
  if (url.protocol !== 'https:') {
    throw new UserFacingError('Google Slides links must use https.');
  }
  if (url.hostname.toLowerCase() !== 'docs.google.com') {
    throw new UserFacingError(`Not a Google Slides URL: ${url.hostname}`);
  }
  if (!/^\/presentation\/d(?:\/e)?\//i.test(url.pathname)) {
    throw new UserFacingError('Google Slides URL must be under /presentation/d/ or /presentation/d/e/.');
  }
  return url.href;
}

export function isGoogleSlidesInput(input) {
  try {
    googleSlidesUrlFromInput(input);
    return true;
  } catch {
    return false;
  }
}

function slideIdFromUrl(url) {
  const searchSlide = url.searchParams.get('slide');
  if (searchSlide) return searchSlide;
  const hash = decodeURIComponent(url.hash || '');
  return hash.match(/slide=([^&]+)/)?.[1] || '';
}

export function canonicalGoogleSlidesUrls(input) {
  const originalUrl = googleSlidesUrlFromInput(input);
  const url = new URL(originalUrl);
  const published = url.pathname.match(/^\/presentation\/d\/e\/([^/]+)/i);
  const normal = url.pathname.match(/^\/presentation\/d\/([^/]+)/i);
  const id = published?.[1] || normal?.[1] || '';
  if (!id) throw new UserFacingError('Could not extract Google Slides presentation id.');

  const embedPath = published
    ? `/presentation/d/e/${id}/embed`
    : `/presentation/d/${id}/embed`;
  const embedUrl = new URL(`https://docs.google.com${embedPath}`);
  embedUrl.searchParams.set('start', 'false');
  embedUrl.searchParams.set('loop', 'false');
  embedUrl.searchParams.set('delayms', '3000');
  const slideId = slideIdFromUrl(url);
  if (slideId) embedUrl.searchParams.set('slide', slideId);

  return {
    id,
    originalUrl,
    embedUrl: embedUrl.href
  };
}

function titleFromGoogleSlidesId(id) {
  return `Google Slides ${String(id || '').slice(0, 10) || 'deck'}`;
}

function renderGoogleSlidesThumbnailSvg(title) {
  const safeTitle = escapeHtml(title);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" role="img" aria-label="${safeTitle}">
  <rect width="1280" height="720" rx="42" fill="#f8fafd"/>
  <rect x="88" y="88" width="1104" height="544" rx="30" fill="#fff" stroke="#dde5f2" stroke-width="8"/>
  <rect x="168" y="168" width="380" height="64" rx="18" fill="#fbbc04"/>
  <rect x="168" y="280" width="944" height="32" rx="16" fill="#e8eef8"/>
  <rect x="168" y="340" width="720" height="32" rx="16" fill="#e8eef8"/>
  <circle cx="1010" cy="210" r="76" fill="#4285f4"/>
  <circle cx="1082" cy="292" r="52" fill="#34a853"/>
  <text x="168" y="510" fill="#1f2937" font-family="Inter, Arial, sans-serif" font-size="54" font-weight="900" letter-spacing="-2">Google Slides</text>
  <text x="168" y="574" fill="#64748b" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="700">${safeTitle}</text>
</svg>
`;
}

export function renderGoogleSlidesViewerHtml({ title, embedUrl, originalUrl } = {}) {
  const safeTitle = escapeHtml(title || 'Google Slides');
  const safeEmbedUrl = escapeHtml(embedUrl);
  const safeOriginalUrl = escapeHtml(originalUrl || embedUrl);
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="publish-slides-format" content="google-slides">
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: dark; --bg: #070a12; --line: rgba(255,255,255,.14); --text: #edf2ff; --muted: #9aa7bd; }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body { margin: 0; overflow: hidden; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: radial-gradient(circle at top left, rgba(135,245,255,.10), transparent 28rem), var(--bg); color: var(--text); }
    .topbar { position: fixed; z-index: 10; top: 12px; left: 12px; right: 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; pointer-events: none; }
    .title, .actions { pointer-events: auto; border: 1px solid var(--line); background: rgba(7,10,18,.72); backdrop-filter: blur(14px); border-radius: 999px; box-shadow: 0 12px 40px rgba(0,0,0,.22); }
    .title { min-width: 0; max-width: min(54vw, 680px); padding: 9px 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 14px; font-weight: 800; }
    .title small { margin-left: 8px; color: var(--muted); font-weight: 650; }
    .actions { display: flex; gap: 4px; padding: 4px; }
    button, a.button { border: 0; border-radius: 999px; background: transparent; color: var(--text); padding: 8px 10px; font: inherit; font-size: 13px; font-weight: 760; text-decoration: none; cursor: pointer; }
    button:hover, a.button:hover { background: rgba(255,255,255,.10); }
    .stage { width: 100vw; height: 100vh; display: grid; place-items: center; padding: 58px 24px 24px; }
    .slide { width: min(100%, calc((100vh - 92px) * 16 / 9)); max-width: 1600px; aspect-ratio: 16 / 9; border-radius: 8px; overflow: hidden; background: #fff; box-shadow: 0 28px 90px rgba(0,0,0,.45); }
    iframe { width: 100%; height: 100%; border: 0; display: block; background: white; }
    body:fullscreen .stage, .stage:fullscreen { padding: 0; background: #000; }
    body:fullscreen .slide, .stage:fullscreen .slide { width: 100vw; height: 100vh; max-width: none; border-radius: 0; box-shadow: none; }
    @media (max-width: 720px) {
      .topbar { align-items: stretch; flex-direction: column; }
      .title { max-width: none; }
      .actions { align-self: flex-end; }
      .stage { padding: 104px 8px 16px; }
      .slide { width: 100%; }
    }
  </style>
</head>
<body>
  <div class="topbar">
    <div class="title" title="${safeTitle}">${safeTitle}<small>Google Slides</small></div>
    <nav class="actions" aria-label="presentation actions">
      <a class="button" href="${safeOriginalUrl}" target="_blank" rel="noopener">Slides</a>
      <button id="fullscreen" type="button">전체</button>
    </nav>
  </div>
  <main class="stage" id="stage">
    <section class="slide" aria-label="${safeTitle}">
      <iframe src="${safeEmbedUrl}" title="${safeTitle}" allowfullscreen="true" mozallowfullscreen="true" webkitallowfullscreen="true"></iframe>
    </section>
  </main>
  <script>
    const stage = document.getElementById('stage');
    document.getElementById('fullscreen')?.addEventListener('click', async () => {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await stage.requestFullscreen();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key.toLowerCase() === 'f') document.getElementById('fullscreen')?.click();
    });
  </script>
</body>
</html>
`;
}

export async function prepareGoogleSlidesDeck(input, outputDir, { title = '' } = {}) {
  const urls = canonicalGoogleSlidesUrls(input);
  const deckTitle = title?.trim() || titleFromGoogleSlidesId(urls.id);
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, 'index.html'),
    renderGoogleSlidesViewerHtml({ title: deckTitle, embedUrl: urls.embedUrl, originalUrl: urls.originalUrl }),
    'utf8'
  );
  await writeFile(path.join(outputDir, 'thumbnail.svg'), renderGoogleSlidesThumbnailSvg(deckTitle), 'utf8');
  return {
    format: 'google-slides',
    layout: 'google-slides-embed',
    sourceDir: outputDir,
    slideCount: null,
    entryRel: 'index.html',
    firstSlideRel: 'index.html',
    titleRel: 'index.html',
    cleanupHtml: false,
    sourceFile: urls.embedUrl,
    sourceName: urls.id,
    title: deckTitle
  };
}
