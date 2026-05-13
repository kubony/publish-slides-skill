import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { UserFacingError } from './detect.mjs';
import { humanizeName } from './hub.mjs';

const execFileAsync = promisify(execFile);

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export function isPptxPath(inputPath) {
  const base = path.basename(String(inputPath || ''));
  return /\.pptx$/i.test(base) && !base.startsWith('~$');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function commandExists(command) {
  try {
    await execFileAsync(command, ['--version'], { timeout: 5_000, maxBuffer: 1024 * 1024 });
    return true;
  } catch {
    return false;
  }
}

async function resolveSoffice() {
  const configured = process.env.PUBLISH_SLIDES_SOFFICE || '';
  if (configured) {
    if (await commandExists(configured)) return configured;
    throw new UserFacingError(`PUBLISH_SLIDES_SOFFICE is not executable: ${configured}`);
  }
  for (const candidate of ['soffice', 'libreoffice']) {
    if (await commandExists(candidate)) return candidate;
  }
  throw new UserFacingError(
    'PPTX publishing requires LibreOffice/soffice to convert the presentation to PDF. ' +
      'Install LibreOffice or set PUBLISH_SLIDES_SOFFICE to the soffice executable.'
  );
}

async function convertPptxToPdf(inputPath, outputDir) {
  const soffice = await resolveSoffice();
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'publish-slides-pptx-'));
  const profileDir = path.join(workDir, 'libreoffice-profile');
  const convertDir = path.join(workDir, 'convert');
  await mkdir(profileDir, { recursive: true });
  await mkdir(convertDir, { recursive: true });

  try {
    await execFileAsync(
      soffice,
      [
        `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
        '--headless',
        '--nologo',
        '--nodefault',
        '--nofirststartwizard',
        '--norestore',
        '--convert-to',
        'pdf',
        '--outdir',
        convertDir,
        inputPath
      ],
      { timeout: 180_000, maxBuffer: 1024 * 1024 * 20 }
    );
  } catch (error) {
    const stderr = error.stderr ? `\n${error.stderr}` : '';
    const stdout = error.stdout ? `\n${error.stdout}` : '';
    await rm(workDir, { recursive: true, force: true });
    throw new UserFacingError(`Could not convert PPTX to PDF with LibreOffice.${stdout}${stderr}`);
  }

  try {
    const outputs = (await readdir(convertDir))
      .filter((name) => name.toLowerCase().endsWith('.pdf'))
      .sort();
    if (outputs.length === 0) {
      throw new UserFacingError('LibreOffice finished but did not produce a PDF.');
    }

    const pdfPath = path.join(outputDir, 'slides.pdf');
    await rename(path.join(convertDir, outputs[0]), pdfPath);
    return pdfPath;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function tryExec(command, args, options = {}) {
  try {
    await execFileAsync(command, args, { timeout: 60_000, maxBuffer: 1024 * 1024 * 10, ...options });
    return true;
  } catch {
    return false;
  }
}

async function generateThumbnail(pdfPath, outputDir) {
  const thumbnailPath = path.join(outputDir, 'thumbnail.png');
  const base = path.join(outputDir, 'thumbnail');

  if (await tryExec('pdftoppm', ['-png', '-singlefile', '-f', '1', '-l', '1', '-r', '144', pdfPath, base])) {
    try {
      await stat(thumbnailPath);
      return thumbnailPath;
    } catch {
      // Continue to the next renderer.
    }
  }

  const quicklookDir = await mkdtemp(path.join(os.tmpdir(), 'publish-slides-quicklook-'));
  await mkdir(quicklookDir, { recursive: true });
  try {
    if (await tryExec('qlmanage', ['-t', '-s', '1280', '-o', quicklookDir, pdfPath])) {
      const outputs = (await readdir(quicklookDir)).filter((name) => name.toLowerCase().endsWith('.png')).sort();
      if (outputs.length > 0) {
        await copyFile(path.join(quicklookDir, outputs[0]), thumbnailPath);
        return thumbnailPath;
      }
    }
  } finally {
    await rm(quicklookDir, { recursive: true, force: true });
  }

  if (
    await tryExec('magick', [
      '-density',
      '144',
      `${pdfPath}[0]`,
      '-thumbnail',
      '1280x720>',
      '-background',
      'white',
      '-alpha',
      'remove',
      '-alpha',
      'off',
      thumbnailPath
    ])
  ) {
    try {
      await stat(thumbnailPath);
      return thumbnailPath;
    } catch {
      // Thumbnail is optional.
    }
  }

  return '';
}

async function countSlides(inputPath, pdfPath) {
  if (await tryExec('pdfinfo', [pdfPath])) {
    try {
      const { stdout } = await execFileAsync('pdfinfo', [pdfPath], { timeout: 10_000, maxBuffer: 1024 * 1024 });
      const match = stdout.match(/^Pages:\s*(\d+)/m);
      if (match) return Number(match[1]);
    } catch {
      // Fall through.
    }
  }

  try {
    const { stdout } = await execFileAsync('unzip', ['-Z1', inputPath], { timeout: 10_000, maxBuffer: 1024 * 1024 * 10 });
    const slides = stdout
      .split(/\r?\n/)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name));
    return slides.length || null;
  } catch {
    return null;
  }
}

export function renderPptxViewerHtml({ title, slideCount = null } = {}) {
  const safeTitle = escapeHtml(title || 'Untitled presentation');
  const slideLabel = Number.isInteger(slideCount) ? `${slideCount} slides` : 'PPTX deck';
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="publish-slides-format" content="pptx">
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: dark; --bg: #070a12; --panel: #101827; --line: rgba(255,255,255,.12); --text: #edf2ff; --muted: #9aa7bd; --accent: #87f5ff; }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: radial-gradient(circle at top left, rgba(135,245,255,.18), transparent 28rem), var(--bg); color: var(--text); }
    .page { min-height: 100%; display: grid; grid-template-rows: auto minmax(0, 1fr); }
    header { display: flex; gap: 16px; align-items: center; justify-content: space-between; padding: 18px 22px; border-bottom: 1px solid var(--line); background: rgba(7,10,18,.88); backdrop-filter: blur(14px); }
    .title { min-width: 0; }
    .eyebrow { color: var(--accent); font-size: 12px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
    h1 { margin: 4px 0 0; font-size: clamp(22px, 4vw, 38px); line-height: 1.08; letter-spacing: -.04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .meta { color: var(--muted); font-size: 13px; margin-top: 6px; }
    .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
    button, a.button { border: 1px solid var(--line); border-radius: 999px; background: rgba(255,255,255,.06); color: var(--text); padding: 10px 13px; font: inherit; font-weight: 750; text-decoration: none; cursor: pointer; }
    button:hover, a.button:hover { border-color: rgba(135,245,255,.65); background: rgba(135,245,255,.12); }
    .primary { background: var(--text) !important; color: #0b1020 !important; }
    .viewer-shell { min-height: 0; padding: 14px; display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 10px; }
    .tabs { display: flex; gap: 8px; flex-wrap: wrap; }
    .tab[aria-pressed="true"] { border-color: rgba(135,245,255,.75); color: var(--accent); }
    .viewer { min-height: 0; border: 1px solid var(--line); border-radius: 18px; overflow: hidden; background: #0b1020; box-shadow: 0 24px 80px rgba(0,0,0,.32); }
    iframe, object { width: 100%; height: 100%; min-height: min(72vh, 900px); border: 0; display: block; background: white; }
    .fallback { padding: 28px; color: var(--muted); }
    .hidden { display: none; }
    body:fullscreen .viewer-shell, .viewer-shell:fullscreen { padding: 0; background: #000; }
    .viewer-shell:fullscreen .tabs { display: none; }
    .viewer-shell:fullscreen .viewer { border: 0; border-radius: 0; height: 100vh; }
    .viewer-shell:fullscreen iframe, .viewer-shell:fullscreen object { min-height: 100vh; }
    @media (max-width: 720px) {
      header { align-items: flex-start; flex-direction: column; }
      h1 { white-space: normal; }
      .actions { justify-content: flex-start; }
      .viewer-shell { padding: 8px; }
    }
  </style>
</head>
<body>
  <div class="page">
    <header>
      <div class="title">
        <div class="eyebrow">publish-slides · PPTX</div>
        <h1>${safeTitle}</h1>
        <div class="meta">원본 PPTX를 보존하고 PDF 미리보기로 표시합니다 · ${escapeHtml(slideLabel)}</div>
      </div>
      <nav class="actions" aria-label="presentation actions">
        <a class="button primary" href="source.pptx" download>원본 PPTX 다운로드</a>
        <a class="button" href="slides.pdf" target="_blank" rel="noopener">PDF 새 탭</a>
        <a class="button" id="office-link" href="#" target="_blank" rel="noopener">PowerPoint Online</a>
        <button id="fullscreen" type="button">전체화면</button>
      </nav>
    </header>
    <main class="viewer-shell" id="viewer-shell">
      <div class="tabs" role="group" aria-label="viewer mode">
        <button class="tab" type="button" data-view="pdf" aria-pressed="true">PDF 뷰어</button>
        <button class="tab" type="button" data-view="office" aria-pressed="false">PowerPoint Online 뷰어</button>
      </div>
      <section class="viewer" id="pdf-panel">
        <object data="slides.pdf#view=FitH&toolbar=1&navpanes=0" type="application/pdf">
          <div class="fallback">
            브라우저가 PDF 내장 뷰어를 지원하지 않습니다.
            <a href="slides.pdf">PDF를 직접 열어주세요.</a>
          </div>
        </object>
      </section>
      <section class="viewer hidden" id="office-panel" aria-live="polite">
        <iframe id="office-frame" title="${safeTitle} PowerPoint Online viewer" allowfullscreen></iframe>
      </section>
    </main>
  </div>
  <script>
    const pptxUrl = new URL('source.pptx', window.location.href).href;
    const officeUrl = 'https://view.officeapps.live.com/op/embed.aspx?src=' + encodeURIComponent(pptxUrl);
    const officeLink = document.getElementById('office-link');
    const officeFrame = document.getElementById('office-frame');
    const pdfPanel = document.getElementById('pdf-panel');
    const officePanel = document.getElementById('office-panel');
    const tabs = Array.from(document.querySelectorAll('.tab'));
    const shell = document.getElementById('viewer-shell');

    officeLink.href = officeUrl;

    function show(view) {
      const office = view === 'office';
      pdfPanel.classList.toggle('hidden', office);
      officePanel.classList.toggle('hidden', !office);
      if (office && !officeFrame.src) officeFrame.src = officeUrl;
      for (const tab of tabs) tab.setAttribute('aria-pressed', String(tab.dataset.view === view));
    }

    for (const tab of tabs) {
      tab.addEventListener('click', () => show(tab.dataset.view));
    }

    document.getElementById('fullscreen')?.addEventListener('click', async () => {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await shell.requestFullscreen();
      }
    });
  </script>
</body>
</html>
`;
}

export async function preparePptxDeck(inputPath, outputDir) {
  const sourcePath = path.resolve(inputPath);
  let info;
  try {
    info = await stat(sourcePath);
  } catch {
    throw new UserFacingError(`PPTX path does not exist: ${sourcePath}`);
  }
  if (!info.isFile() || !isPptxPath(sourcePath)) {
    throw new UserFacingError(`PPTX input must be a .pptx file: ${sourcePath}`);
  }

  await mkdir(outputDir, { recursive: true });
  await copyFile(sourcePath, path.join(outputDir, 'source.pptx'));
  const pdfPath = await convertPptxToPdf(sourcePath, outputDir);
  const slideCount = await countSlides(sourcePath, pdfPath);
  await generateThumbnail(pdfPath, outputDir);

  const title = humanizeName(path.basename(sourcePath));
  await writeFile(
    path.join(outputDir, 'index.html'),
    renderPptxViewerHtml({ title, slideCount }),
    'utf8'
  );

  return {
    format: 'pptx',
    layout: 'pptx-pdf-viewer',
    sourceDir: outputDir,
    slideCount,
    entryRel: 'index.html',
    firstSlideRel: 'index.html',
    titleRel: 'index.html',
    cleanupHtml: false,
    sourceFile: sourcePath,
    sourceName: path.basename(sourcePath),
    sourceMime: PPTX_MIME
  };
}
