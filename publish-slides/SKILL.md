---
name: publish-slides
description: Publish a local HTML slide deck folder to the WoRV Grip public slide hub at slides.worvgrip.com without requiring the user to have GCS permissions. The skill uploads videos/assets through the hosted publish-slides Cloud Run API, updates the shared gallery catalog, and returns shareable deck and gallery URLs. Use when the user says publish-slides, publish slides, share this deck, upload this deck, deploy deck, or asks to put an HTML/slides-grab presentation on slides.worvgrip.com.
---

# publish-slides

Publish a local HTML slide deck to the shared WoRV Grip slide hub.

## Workflow

1. Resolve the deck folder path from the user's request.
2. Do not require title, author, filename, or tags. The bundled CLI fills defaults:
   - title from deck HTML or folder name
   - author from config/env/git/OS user
   - tags from configured defaults plus detected deck format
3. Locate this skill directory and run the bundled CLI:

   ```bash
   SKILL_DIR="${PUBLISH_SLIDES_SKILL_DIR:-$HOME/.codex/skills/publish-slides}"
   if [ ! -f "$SKILL_DIR/scripts/publish-slides.mjs" ]; then
     SKILL_DIR="$HOME/.claude/skills/publish-slides"
   fi
   node "$SKILL_DIR/scripts/publish-slides.mjs" <deck-path>
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

## Publishing target

Default bundled config publishes through the hosted public API:

- domain: `slides.worvgrip.com`
- gallery: `https://slides.worvgrip.com/index.html`
- API: `https://publish-slides-api-qnxdv5m4qa-du.a.run.app`

## Requirements

- Node.js 20+
- Network access to the hosted publish-slides API

Users do **not** need `gcloud` or direct GCS permissions. Admins can force direct bucket publishing with `--upload-mode gcloud` when they have GCS IAM access.

The CLI removes known `slides-grab` local-only injection tags before upload. Public URLs are intentionally public; v1 access control is by random slug obscurity plus edit-token overwrite protection.
