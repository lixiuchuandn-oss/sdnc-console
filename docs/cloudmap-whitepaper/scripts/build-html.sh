#!/usr/bin/env bash
# Cloudmap 白皮书：Markdown 源稿 -> HTML（浏览器预览整本）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT/source"
OUTPUT_DIR="$ROOT/output"
MANIFEST="$SOURCE/manifest.txt"
OUTPUT="${1:-$OUTPUT_DIR/cloudmap-whitepaper.html}"
OPEN="${OPEN:-0}"

if [[ ! -f "$MANIFEST" ]]; then
  echo "缺少 $MANIFEST" >&2
  exit 1
fi

if ! command -v pandoc >/dev/null 2>&1; then
  echo "请先安装 pandoc: https://pandoc.org/installing.html" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
mapfile -t FILES < <(grep -v '^#' "$MANIFEST" | grep -v '^[[:space:]]*$' || true)
INPUTS=()
for rel in "${FILES[@]}"; do
  p="$SOURCE/$(echo "$rel" | tr -d '\r')"
  [[ -f "$p" ]] || { echo "找不到: $p" >&2; exit 1; }
  INPUTS+=("$p")
done

CSS="$ROOT/templates/preview.css"
ARGS=(
  "${INPUTS[@]}"
  -o "$OUTPUT"
  --from markdown
  --to html5
  --standalone
  --toc
  --toc-depth=3
  --metadata title="Cloudmap Whitepaper"
  "--resource-path=$SOURCE"
)
[[ -f "$CSS" ]] && ARGS+=( "--css=../templates/preview.css" )

pandoc "${ARGS[@]}"

ASSETS_SRC="$SOURCE/assets"
ASSETS_OUT="$OUTPUT_DIR/assets"
if [[ -d "$ASSETS_SRC" ]]; then
  mkdir -p "$ASSETS_OUT"
  cp -f "$ASSETS_SRC"/* "$ASSETS_OUT"/
fi

echo "已生成: $OUTPUT"

if [[ "$OPEN" == "1" ]]; then
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$OUTPUT"
  elif [[ "$OSTYPE" == darwin* ]]; then
    open "$OUTPUT"
  fi
fi
