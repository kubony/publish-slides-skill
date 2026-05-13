---
name: publish-slides
description: Publish a local HTML slide deck folder, PPTX file, Canva link, or Google Slides link to the WoRV Grip public slide hub at slides.worvgrip.com without requiring the user to have GCS permissions. The skill uploads videos/assets through the hosted publish-slides Cloud Run API, updates the shared gallery catalog, and returns shareable deck and gallery URLs. Use when the user says publish-slides, publish slides, share this deck, upload this deck, deploy deck, or asks to put an HTML/slides-grab/PPTX/Canva/Google Slides presentation on slides.worvgrip.com.
---

# publish-slides

Publish a local HTML slide deck, PPTX file, Canva link, or Google Slides link to the shared WoRV Grip slide hub.

## Workflow

1. Resolve the deck folder, PPTX file path, Canva URL, or Google Slides URL from the user's request.
2. Do not require title, author, filename, or tags. The bundled CLI fills defaults:
   - title from deck HTML or folder name
   - author from config/env/git/OS user
   - tags from configured defaults plus detected deck format
   - PPTX files are kept as the original `.pptx` and paired with a generated PDF web viewer instead of being rebuilt as HTML.
   - Canva links are kept hosted by Canva and published as a simple iframe wrapper.
   - Google Slides links are kept hosted by Google and published as a simple iframe wrapper.
3. Locate this skill directory and run the bundled CLI:

   ```bash
   SKILL_DIR="${PUBLISH_SLIDES_SKILL_DIR:-$HOME/.codex/skills/publish-slides}"
   if [ ! -f "$SKILL_DIR/scripts/publish-slides.mjs" ]; then
     SKILL_DIR="$HOME/.claude/skills/publish-slides"
   fi
   node "$SKILL_DIR/scripts/publish-slides.mjs" <deck-path-or-pptx-file-or-canva-url>
   ```

   If this skill is being used directly from a cloned repository, set `PUBLISH_SLIDES_SKILL_DIR` to the path containing this `SKILL.md`.

4. Pass optional metadata flags only when the user explicitly provides them:
   - `--title <title>`
   - `--author <name>`
   - `--description <text>`
   - `--tag <tag[,tag]>` (repeat when useful)
   - `--thumbnail <relative-path>`
   - `--slug <slug>` only when the user asks for a stable republish/update slug
   - `--edit-token <token>` only when republishing a slug from another machine
5. If the user only wants validation, add `--dry-run`.
6. Return the JSON result's `url` and `hubUrl` fields.
7. Treat `editToken` as sensitive. The CLI saves it locally for future republish attempts.

## Supported deck inputs

- A deck root with `slides/slide-*.html`
- A `slides` folder containing `slide-*.html`
- A generic folder with `index.html` or `viewer.html`
- A single `.pptx` file. This requires LibreOffice/`soffice` locally so the CLI can generate `slides.pdf` and a gallery thumbnail. The original PPTX is uploaded as `source.pptx`.
- A Canva `https://www.canva.com/design/.../view` URL, `https://canva.link/...` short link, or iframe embed code. The design must be public/viewable by link for visitors to see it.
- A Google Slides `https://docs.google.com/presentation/d/...` URL or iframe embed code. The deck must be public/shared with visitors.

## Publishing target

Default bundled config publishes through the hosted public API:

- domain: `slides.worvgrip.com`
- gallery: `https://slides.worvgrip.com/index.html`
- API: `https://publish-slides-api-329120583532.asia-northeast3.run.app`

## Requirements

- Node.js 20+
- Network access to the hosted publish-slides API
- LibreOffice/`soffice` only when publishing `.pptx` files

Users do **not** need `gcloud` or direct GCS permissions. Admins can force direct bucket publishing with `--upload-mode gcloud` when they have GCS IAM access.

The CLI removes known `slides-grab` local-only injection tags before upload. Public URLs are intentionally public; v1 access control is by random slug obscurity plus edit-token overwrite protection.
