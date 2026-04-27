# publish-slides-skill

Codex/Claude Code skill for publishing local HTML slide decks to the WoRV Grip public gallery:

- Gallery: https://slides.worvgrip.com/index.html
- Bucket: `gs://worvgrip-slides`
- Project: `worvk-486221`

The repository contains a self-contained skill in `publish-slides/`: it bundles the publisher CLI, default config, and detection/cleanup/upload logic.

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

Or install both:

```bash
./install.sh both
```

## Requirements

- Node.js 20+
- `gcloud` installed
- `gcloud auth login` completed
- IAM permission to read/write `gs://worvgrip-slides`

## Use

In Codex/Claude:

```text
/path/to/my/deck 을 올려줘. $publish-slides
```

Direct CLI:

```bash
node ~/.codex/skills/publish-slides/scripts/publish-slides.mjs /path/to/my/deck
```

Optional metadata is not required. The CLI auto-fills title, author, tags, and slug.

Stable republish/update:

```bash
node ~/.codex/skills/publish-slides/scripts/publish-slides.mjs --slug my-stable-slug /path/to/my/deck
```

## Validate locally

```bash
cd publish-slides
npm test
node scripts/publish-slides.mjs --dry-run /path/to/deck
```
