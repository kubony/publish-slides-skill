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

function canvaHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return (
    host === 'canva.com' ||
    host.endsWith('.canva.com') ||
    host === 'canva.site' ||
    host.endsWith('.canva.site') ||
    host === 'canva.link'
  );
}

function extractUrlText(input) {
  const raw = String(input || '').trim();
  const iframeSrc = raw.match(/<iframe\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/i);
  const candidate = iframeSrc ? iframeSrc[2] : raw;
  return decodeHtmlEntities(candidate).trim();
}

export function canvaUrlFromInput(input) {
  let candidate = extractUrlText(input);
  if (/^(?:www\.)?canva\.(?:com|site)\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }
  if (/^[a-z0-9-]+\.canva\.(?:com|site)\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new UserFacingError('Canva input must be a Canva https URL or an iframe embed code with a Canva src.');
  }
  if (url.protocol !== 'https:') {
    throw new UserFacingError('Canva links must use https.');
  }
  if (!canvaHost(url.hostname)) {
    throw new UserFacingError(`Not a Canva URL: ${url.hostname}`);
  }
  return url.href;
}

export function isCanvaInput(input) {
  try {
    canvaUrlFromInput(input);
    return true;
  } catch {
    return false;
  }
}

export function canonicalCanvaViewerUrl(canvaUrl) {
  const url = new URL(canvaUrl);
  const designMatch = url.pathname.match(/^\/design\/([^/]+)\/([^/]+)\/(?:edit|view)\/?$/i);
  if (!designMatch) return url.href;

  const canonical = new URL(`https://www.canva.com/design/${designMatch[1]}/${designMatch[2]}/view`);
  canonical.search = 'embed';
  return canonical.href;
}

async function resolveCanvaUrl(input) {
  const canvaUrl = canvaUrlFromInput(input);
  const url = new URL(canvaUrl);
  if (url.hostname.toLowerCase() !== 'canva.link') return canonicalCanvaViewerUrl(canvaUrl);

  let response;
  try {
    response = await fetch(canvaUrl, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000)
    });
  } catch (headError) {
    try {
      response = await fetch(canvaUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000)
      });
    } catch {
      throw new UserFacingError(`Could not resolve Canva short link: ${headError.message}`);
    }
  }

  const location = response.headers.get('location');
  if (!location) {
    throw new UserFacingError('Canva short link did not provide a redirect target.');
  }
  const resolved = new URL(location, canvaUrl).href;
  return canonicalCanvaViewerUrl(canvaUrlFromInput(resolved));
}

function canvaIdFromUrl(canvaUrl) {
  const url = new URL(canvaUrl);
  const match = url.pathname.match(/\/design\/([^/]+)/i);
  return match?.[1] || '';
}

function titleFromCanvaUrl(canvaUrl) {
  const id = canvaIdFromUrl(canvaUrl);
  return id ? `Canva ${id}` : 'Canva design';
}

function renderCanvaThumbnailSvg(title) {
  const safeTitle = escapeHtml(title);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" role="img" aria-label="${safeTitle}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#00c4cc"/>
      <stop offset=".48" stop-color="#7d2ae8"/>
      <stop offset="1" stop-color="#ff66c4"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="720" rx="42" fill="url(#bg)"/>
  <circle cx="1016" cy="120" r="180" fill="rgba(255,255,255,.14)"/>
  <circle cx="190" cy="612" r="240" fill="rgba(255,255,255,.10)"/>
  <text x="96" y="326" fill="white" font-family="Inter, Arial, sans-serif" font-size="80" font-weight="900" letter-spacing="-4">Canva</text>
  <text x="96" y="410" fill="rgba(255,255,255,.82)" font-family="Inter, Arial, sans-serif" font-size="40" font-weight="700">${safeTitle}</text>
</svg>
`;
}

export function renderCanvaViewerHtml({ title, canvaUrl } = {}) {
  const safeTitle = escapeHtml(title || 'Canva design');
  const safeUrl = escapeHtml(canvaUrl);
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="publish-slides-format" content="canva">
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
    .fallback { padding: 28px; color: #253047; font-weight: 700; }
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
    <div class="title" title="${safeTitle}">${safeTitle}<small>Canva</small></div>
    <nav class="actions" aria-label="presentation actions">
      <a class="button" href="${safeUrl}" target="_blank" rel="noopener">Canva</a>
      <button id="fullscreen" type="button">전체</button>
    </nav>
  </div>
  <main class="stage" id="stage">
    <section class="slide" aria-label="${safeTitle}">
      <iframe src="${safeUrl}" title="${safeTitle}" allowfullscreen="allowfullscreen" allow="fullscreen" loading="eager"></iframe>
      <div class="fallback">Canva가 iframe 표시를 막거나 링크가 비공개라면 <a href="${safeUrl}" target="_blank" rel="noopener">Canva에서 직접 열어주세요.</a></div>
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

export async function prepareCanvaDeck(input, outputDir, { title = '' } = {}) {
  const canvaUrl = await resolveCanvaUrl(input);
  const deckTitle = title?.trim() || titleFromCanvaUrl(canvaUrl);
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'index.html'), renderCanvaViewerHtml({ title: deckTitle, canvaUrl }), 'utf8');
  await writeFile(path.join(outputDir, 'thumbnail.svg'), renderCanvaThumbnailSvg(deckTitle), 'utf8');
  return {
    format: 'canva',
    layout: 'canva-embed',
    sourceDir: outputDir,
    slideCount: null,
    entryRel: 'index.html',
    firstSlideRel: 'index.html',
    titleRel: 'index.html',
    cleanupHtml: false,
    sourceFile: canvaUrl,
    sourceName: canvaIdFromUrl(canvaUrl) || canvaUrl,
    title: deckTitle
  };
}
