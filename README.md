# publish-slides-skill

Codex/Claude Code skill for publishing local HTML slide decks or PPTX files to the WoRV Grip public gallery without giving users GCS permissions.

- Gallery: https://slides.worvgrip.com/index.html
- Hosted upload API: https://publish-slides-api-329120583532.asia-northeast3.run.app
- Bucket behind the API: `gs://ainative-worvgrip-slides`

The repository contains a self-contained skill in `publish-slides/`: it bundles the publisher CLI, default public API config, and detection/cleanup/PPTX-viewer/upload logic.

## Install for Codex

```bash
git clone https://github.com/kubony/publish-slides-skill.git ~/projects/publish-slides-skill
cd ~/projects/publish-slides-skill
./install.sh codex
```

Or symlink the nested skill folder:

```bash
git clone https://github.com/kubony/publish-slides-skill.git ~/projects/publish-slides-skill
mkdir -p ~/.codex/skills
ln -s ~/projects/publish-slides-skill/publish-slides ~/.codex/skills/publish-slides
```

## Install for Claude Code

```bash
git clone https://github.com/kubony/publish-slides-skill.git ~/projects/publish-slides-skill
cd ~/projects/publish-slides-skill
./install.sh claude
```

Install both:

```bash
./install.sh both
```

## Requirements for normal users

- Node.js 20+
- Network access to `https://publish-slides-api-329120583532.asia-northeast3.run.app`
- LibreOffice/`soffice` only when publishing `.pptx` files, because the CLI creates a PDF preview before uploading

Normal users do **not** need `gcloud`, Google Cloud accounts, or GCS IAM permissions.

## Use

In Codex/Claude:

```text
/path/to/my/deck 을 올려줘. $publish-slides
```

Direct CLI:

```bash
node ~/.codex/skills/publish-slides/scripts/publish-slides.mjs /path/to/my/deck
node ~/.codex/skills/publish-slides/scripts/publish-slides.mjs "/path/to/마음AI WoRV 소개.pptx"
```

Optional metadata is not required. The CLI auto-fills title, author, tags, and slug. PPTX files are not rebuilt as HTML; the skill uploads the original file as `source.pptx`, creates `slides.pdf`, and serves an `index.html` viewer with PDF fullscreen plus a PowerPoint Online link.

Stable republish/update from the same machine:

```bash
node ~/.codex/skills/publish-slides/scripts/publish-slides.mjs --slug my-stable-slug /path/to/my/deck
```

The first publish returns an `editToken` and stores it locally in `~/.config/publish-slides/tokens.json`. Keep that token private; it authorizes future overwrites of the same slug.

## Admin fallback

Admins with GCS access can bypass the public API:

```bash
node ~/.codex/skills/publish-slides/scripts/publish-slides.mjs --upload-mode gcloud /path/to/my/deck
```

## Validate locally

```bash
cd publish-slides
npm test
node scripts/publish-slides.mjs --dry-run /path/to/deck
node scripts/publish-slides.mjs --dry-run "/path/to/deck.pptx"
```
