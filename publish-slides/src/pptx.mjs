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

async function generateSlideImages(pdfPath, outputDir) {
  const slidesDir = path.join(outputDir, 'slides');
  await mkdir(slidesDir, { recursive: true });
  const base = path.join(slidesDir, 'page');
  if (!(await tryExec('pdftoppm', ['-png', '-r', '144', pdfPath, base]))) return [];

  const outputs = (await readdir(slidesDir))
    .map((name) => {
      const match = name.match(/^page-(\d+)\.png$/i);
      return match ? { name, index: Number(match[1]) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index);

  const relPaths = [];
  for (let i = 0; i < outputs.length; i += 1) {
    const targetName = `slide-${String(i + 1).padStart(3, '0')}.png`;
    await rename(path.join(slidesDir, outputs[i].name), path.join(slidesDir, targetName));
    relPaths.push(`slides/${targetName}`);
  }
  return relPaths;
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

export function renderPptxViewerHtml({ title, slideCount = null, imageSlides = [] } = {}) {
  const safeTitle = escapeHtml(title || 'Untitled presentation');
  const slideLabel = Number.isInteger(slideCount) ? `${slideCount} slides` : 'PPTX deck';
  const slidesJson = JSON.stringify(imageSlides).replace(/</g, '\\u003c');
  const hasImages = imageSlides.length > 0;
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="publish-slides-format" content="pptx">
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: dark; --bg: #070a12; --line: rgba(255,255,255,.14); --text: #edf2ff; --muted: #9aa7bd; --accent: #87f5ff; }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body { margin: 0; overflow: hidden; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: radial-gradient(circle at top left, rgba(135,245,255,.10), transparent 28rem), var(--bg); color: var(--text); }
    .topbar { position: fixed; z-index: 10; top: 12px; left: 12px; right: 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; pointer-events: none; }
    .title, .actions, .nav { pointer-events: auto; border: 1px solid var(--line); background: rgba(7,10,18,.72); backdrop-filter: blur(14px); border-radius: 999px; box-shadow: 0 12px 40px rgba(0,0,0,.22); }
    .title { min-width: 0; max-width: min(54vw, 680px); padding: 9px 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 14px; font-weight: 800; }
    .title small { margin-left: 8px; color: var(--muted); font-weight: 650; }
    .actions { display: flex; gap: 4px; padding: 4px; }
    button, a.button { border: 0; border-radius: 999px; background: transparent; color: var(--text); padding: 8px 10px; font: inherit; font-size: 13px; font-weight: 760; text-decoration: none; cursor: pointer; }
    button:hover, a.button:hover { background: rgba(255,255,255,.10); }
    .stage { width: 100vw; height: 100vh; display: grid; place-items: center; padding: 58px 24px 24px; }
    .slide { position: relative; width: min(100%, calc((100vh - 92px) * 16 / 9)); max-width: 1600px; aspect-ratio: 16 / 9; border-radius: 8px; overflow: hidden; background: #fff; box-shadow: 0 28px 90px rgba(0,0,0,.45); }
    .slide img, .slide object, .slide iframe { width: 100%; height: 100%; border: 0; display: block; background: white; }
    .slide img { object-fit: contain; }
    .nav { position: fixed; z-index: 10; left: 50%; bottom: 14px; transform: translateX(-50%); display: ${hasImages ? 'flex' : 'none'}; align-items: center; gap: 4px; padding: 4px; }
    .counter { min-width: 74px; text-align: center; color: var(--muted); font-size: 13px; font-weight: 760; }
    .fallback { padding: 28px; color: var(--muted); }
    body:fullscreen .stage, .stage:fullscreen { padding: 0; background: #000; }
    body:fullscreen .slide, .stage:fullscreen .slide { width: 100vw; height: 100vh; max-width: none; border-radius: 0; box-shadow: none; }
    @media (max-width: 720px) {
      .topbar { align-items: stretch; flex-direction: column; }
      .title { max-width: none; }
      .actions { align-self: flex-end; flex-wrap: wrap; justify-content: flex-end; }
      .stage { padding: 110px 8px 56px; }
      .slide { width: 100%; }
    }
  </style>
</head>
<body>
  <div class="topbar">
    <div class="title" title="${safeTitle}">${safeTitle}<small>${escapeHtml(slideLabel)}</small></div>
    <nav class="actions" aria-label="presentation actions">
      <a class="button" href="source.pptx" download>PPTX</a>
      <a class="button" href="slides.pdf" target="_blank" rel="noopener">PDF</a>
      <a class="button" id="office-link" href="#" target="_blank" rel="noopener">Online</a>
      <button id="fullscreen" type="button">전체</button>
    </nav>
  </div>
  <main class="stage" id="stage">
    <section class="slide" aria-label="${safeTitle}">
      ${hasImages ? '<img id="slide-image" src="" alt="presentation slide">' : `<object data="slides.pdf#view=FitH&toolbar=0&navpanes=0" type="application/pdf">
          <div class="fallback">
            브라우저가 PDF 내장 뷰어를 지원하지 않습니다.
            <a href="slides.pdf">PDF를 직접 열어주세요.</a>
          </div>
        </object>`}
    </section>
  </main>
  <div class="nav" aria-label="slide navigation">
    <button id="prev" type="button" aria-label="Previous slide">‹</button>
    <div class="counter"><span id="current">1</span> / <span id="total">1</span></div>
    <button id="next" type="button" aria-label="Next slide">›</button>
  </div>
  <script>
    const slides = ${slidesJson};
    const pptxUrl = new URL('source.pptx', window.location.href).href;
    const officeUrl = 'https://view.officeapps.live.com/op/embed.aspx?src=' + encodeURIComponent(pptxUrl);
    const officeLink = document.getElementById('office-link');
    const stage = document.getElementById('stage');
    const image = document.getElementById('slide-image');
    const current = document.getElementById('current');
    const total = document.getElementById('total');
    let index = 0;

    officeLink.href = officeUrl;
    if (total) total.textContent = String(slides.length || 1);

    function showSlide(nextIndex) {
      if (!image || !slides.length) return;
      index = (nextIndex + slides.length) % slides.length;
      image.src = slides[index];
      image.alt = '${safeTitle} ' + (index + 1);
      if (current) current.textContent = String(index + 1);
    }

    document.getElementById('prev')?.addEventListener('click', () => showSlide(index - 1));
    document.getElementById('next')?.addEventListener('click', () => showSlide(index + 1));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') showSlide(index - 1);
      if (event.key === 'ArrowRight' || event.key === ' ') {
        event.preventDefault();
        showSlide(index + 1);
      }
      if (event.key.toLowerCase() === 'f') document.getElementById('fullscreen')?.click();
    });

    document.getElementById('fullscreen')?.addEventListener('click', async () => {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await stage.requestFullscreen();
      }
    });

    showSlide(0);
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
  const imageSlides = await generateSlideImages(pdfPath, outputDir);
  if (imageSlides.length > 0) {
    await copyFile(path.join(outputDir, imageSlides[0]), path.join(outputDir, 'thumbnail.png'));
  } else {
    await generateThumbnail(pdfPath, outputDir);
  }

  const title = humanizeName(path.basename(sourcePath));
  await writeFile(
    path.join(outputDir, 'index.html'),
    renderPptxViewerHtml({ title, slideCount, imageSlides }),
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
    title,
    sourceMime: PPTX_MIME
  };
}
