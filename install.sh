#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE="$ROOT/publish-slides"
TARGET_KIND="${1:-codex}"

case "$TARGET_KIND" in
  codex)
    DEST="${CODEX_HOME:-$HOME/.codex}/skills/publish-slides"
    ;;
  claude)
    DEST="$HOME/.claude/skills/publish-slides"
    ;;
  both)
    "$0" codex
    "$0" claude
    exit 0
    ;;
  *)
    echo "Usage: ./install.sh [codex|claude|both]" >&2
    exit 2
    ;;
esac

mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
cp -R "$SOURCE" "$DEST"
echo "Installed publish-slides skill to $DEST"
