#!/usr/bin/env node
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  finalizeApiUpload,
  initApiUpload,
  savedEditToken,
  uploadFilesToSignedUrls,
  uploadModeForConfig
} from '../src/api-upload.mjs';
import { isCanvaInput, prepareCanvaDeck } from '../src/canva.mjs';
import { cleanStagedHtml } from '../src/clean.mjs';
import { defaultAuthor } from '../src/defaults.mjs';
import { detectDeck, urlForEntry, UserFacingError } from '../src/detect.mjs';
import { listFiles } from '../src/files.mjs';
import {
  buildCatalogEntry,
  emptyCatalog,
  hubUrl,
  normalizeHubConfig,
  parseCatalogText,
  renderHubPage,
  upsertCatalogEntry
} from '../src/hub.mjs';
import { isGoogleSlidesInput, prepareGoogleSlidesDeck } from '../src/google-slides.mjs';
import { isPptxPath, preparePptxDeck } from '../src/pptx.mjs';
import { randomSlug, validateSlug } from '../src/slug.mjs';
import { ensureGcloudReady, readObjectText, slugExists, uploadStage, uploadTextObject } from '../src/upload.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function usage() {
  return `Usage: publish-slides [options] <deck-dir|pptx-file|canva-url|google-slides-url>

Publishes an HTML slide deck folder, a .pptx file, a Canva link, or a Google
Slides link to configured hosting, then updates the central catalog and hub page.

Options:
  By default, title comes from deck HTML/folder name, author comes from
  config/env/git/OS username, and tags include configured defaults + format.

  --dry-run                 Validate and show the catalog entry without uploading
  --slug <slug>             Use or update a stable slug
  --title <title>           Override the auto-detected deck title
  --author <name>           Set the deck author/publisher
  --description <text>      Add a short deck description for the hub
  --tag <tag[,tag]>         Add hub tags; may be repeated
  --thumbnail <path>        Relative thumbnail path inside the deck folder
  --edit-token <token>      Token returned by a prior API publish for republish
  --upload-mode <mode>      Force upload mode: api or gcloud
  --config <path>           Use a specific publish-slides config file
  -h, --help                Show this help
`;
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    slug: '',
    configPath: '',
    deckPath: '',
    title: '',
    author: '',
    description: '',
    tags: [],
    thumbnail: '',
    editToken: '',
    uploadMode: ''
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--slug') {
      options.slug = argv[++i] || '';
    } else if (arg === '--config') {
      options.configPath = argv[++i] || '';
    } else if (arg === '--title') {
      options.title = argv[++i] || '';
    } else if (arg === '--author') {
      options.author = argv[++i] || '';
    } else if (arg === '--description') {
      options.description = argv[++i] || '';
    } else if (arg === '--tag') {
      options.tags.push(argv[++i] || '');
    } else if (arg === '--thumbnail') {
      options.thumbnail = argv[++i] || '';
    } else if (arg === '--edit-token') {
      options.editToken = argv[++i] || '';
    } else if (arg === '--upload-mode') {
      options.uploadMode = argv[++i] || '';
    } else if (arg.startsWith('--')) {
      throw new UserFacingError(`Unknown option: ${arg}`);
    } else if (!options.deckPath) {
      options.deckPath = arg;
    } else {
      throw new UserFacingError(`Unexpected extra argument: ${arg}`);
    }
  }
  return options;
}

function configCandidates(explicitPath) {
  if (explicitPath) return [path.resolve(explicitPath)];
  if (process.env.PUBLISH_SLIDES_CONFIG) return [path.resolve(process.env.PUBLISH_SLIDES_CONFIG)];
  return [
    path.resolve(process.cwd(), 'publish-slides.config.local.json'),
    path.resolve(process.cwd(), 'publish-slides.config.json'),
    path.join(repoRoot, 'publish-slides.config.local.json'),
    path.join(repoRoot, 'publish-slides.config.json')
  ];
}

async function loadConfig(explicitPath) {
  const found = configCandidates(explicitPath).find((candidate) => existsSync(candidate));
  if (!found) {
    throw new UserFacingError('No config found. Create publish-slides.config.json or pass --config <path>.');
  }
  const config = normalizeHubConfig(JSON.parse(await readFile(found, 'utf8')));
  for (const key of ['bucket', 'domain']) {
    if (!config[key] || typeof config[key] !== 'string') {
      throw new UserFacingError(`Config is missing required string field: ${key}`);
    }
  }
  config.slugLength = Number(config.slugLength || 12);
  if (!Number.isInteger(config.slugLength) || config.slugLength < 6 || config.slugLength > 64) {
    throw new UserFacingError('Config field slugLength must be an integer between 6 and 64.');
  }
  if (!config.hub.catalogPath || !config.hub.indexPath) {
    throw new UserFacingError('Config hub.catalogPath and hub.indexPath must be non-empty strings.');
  }
  return { config, configPath: found };
}

async function chooseSlug(config, requestedSlug, dryRun) {
  if (requestedSlug) {
    const message = validateSlug(requestedSlug);
    if (message) throw new UserFacingError(message);
    return requestedSlug;
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const slug = randomSlug(config.slugLength);
    const message = validateSlug(slug);
    if (message) throw new UserFacingError(message);
    if (dryRun || !(await slugExists(config, slug))) return slug;
  }
  throw new UserFacingError('Could not find a free slug after 10 attempts. Try --slug <custom-slug>.');
}

async function loadRemoteCatalog(config) {
  const text = await readObjectText(config, config.hub.catalogPath);
  return parseCatalogText(text, config);
}

async function uploadHub(config, catalog) {
  const catalogJson = `${JSON.stringify(catalog, null, 2)}\n`;
  const indexHtml = renderHubPage(catalog, config);
  await uploadTextObject(config, config.hub.catalogPath, catalogJson);
  await uploadTextObject(config, config.hub.indexPath, indexHtml);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.deckPath) {
    throw new UserFacingError(usage());
  }

  const { config, configPath } = await loadConfig(options.configPath);
  options.author = await defaultAuthor({ explicitAuthor: options.author, config, cwd: process.cwd() });
  if (!options.dryRun) {
    const mode = uploadModeForConfig(config, options.uploadMode);
    if (mode === 'gcloud') {
      await ensureGcloudReady(config);
    } else if (mode !== 'api') {
      throw new UserFacingError(`Unsupported upload mode: ${mode}`);
    }
  }
  const stageDir = await mkdtemp(path.join(os.tmpdir(), 'publish-slides-'));

  try {
    let deck;
    if (isCanvaInput(options.deckPath)) {
      deck = await prepareCanvaDeck(options.deckPath, stageDir, { title: options.title });
    } else if (isGoogleSlidesInput(options.deckPath)) {
      deck = await prepareGoogleSlidesDeck(options.deckPath, stageDir, { title: options.title });
    } else if (isPptxPath(options.deckPath)) {
      deck = await preparePptxDeck(options.deckPath, stageDir);
    } else {
      deck = await detectDeck(options.deckPath);
      await cp(deck.sourceDir, stageDir, { recursive: true, force: true });
    }
    const cleanedFiles = deck.cleanupHtml ? await cleanStagedHtml(stageDir) : 0;
    const mode = uploadModeForConfig(config, options.uploadMode);
    let apiUpload = null;
    let slug = '';
    if (!options.dryRun && mode === 'api') {
      const files = await listFiles(stageDir);
      const editToken = options.editToken || process.env.PUBLISH_SLIDES_EDIT_TOKEN || await savedEditToken(options.slug);
      apiUpload = await initApiUpload(config, {
        requestedSlug: options.slug,
        editToken,
        files
      });
      slug = apiUpload.slug;
      options.editToken = editToken;
    } else {
      slug = await chooseSlug(config, options.slug, options.dryRun);
    }

    const url = urlForEntry({ domain: config.domain, slug, entryRel: deck.entryRel });
    const now = new Date();
    let catalog = emptyCatalog(config, now);
    if (!options.dryRun && mode === 'gcloud' && config.hub.enabled) {
      catalog = await loadRemoteCatalog(config);
    }
    const existingEntry = catalog.decks.find((entry) => entry.slug === slug) || null;
    const catalogEntry = await buildCatalogEntry({
      config,
      deck,
      slug,
      url,
      options,
      existingEntry,
      now
    });
    const updatedCatalog = config.hub.enabled ? upsertCatalogEntry(catalog, catalogEntry, now) : catalog;

    let apiResult = null;
    if (!options.dryRun) {
      if (mode === 'api') {
        await uploadFilesToSignedUrls(stageDir, apiUpload.files);
        apiResult = await finalizeApiUpload(config, {
          slug,
          editToken: options.editToken,
          catalogEntry,
          entryRel: deck.entryRel
        });
      } else {
        await uploadStage(config, stageDir, slug);
      }
      if (mode === 'gcloud' && config.hub.enabled) {
        await uploadHub(config, updatedCatalog);
      }
    }

    console.log(JSON.stringify({
      ok: true,
      dryRun: options.dryRun,
      uploadMode: mode,
      apiEndpoint: mode === 'api' ? (config.upload?.apiEndpoint || process.env.PUBLISH_SLIDES_API_URL || null) : null,
      configPath,
      sourcePath: deck.sourceFile || deck.sourceDir,
      sourceDir: deck.sourceFile ? null : deck.sourceDir,
      format: deck.format,
      layout: deck.layout,
      slideCount: deck.slideCount,
      cleanedFiles,
      bucket: config.bucket,
      slug,
      url: apiResult?.url || url,
      hubEnabled: config.hub.enabled,
      hubUrl: apiResult?.hubUrl || (config.hub.enabled ? hubUrl(config) : null),
      editToken: apiResult?.editToken || null,
      editTokenStore: apiResult?.editToken ? process.env.PUBLISH_SLIDES_TOKEN_STORE || '~/.config/publish-slides/tokens.json' : null,
      catalogPath: config.hub.enabled ? config.hub.catalogPath : null,
      catalogEntry: apiResult?.catalogEntry || catalogEntry,
      catalogDeckCount: apiResult?.catalogDeckCount || (config.hub.enabled ? updatedCatalog.decks.length : null)
    }, null, 2));
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  if (error instanceof UserFacingError) {
    console.error(`publish-slides: ${error.message}`);
  } else {
    console.error(`publish-slides: unexpected error: ${error.message}`);
  }
  process.exitCode = 1;
});
