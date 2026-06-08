#!/usr/bin/env bash
# Cloudmap 白皮书 / 使用手册：Markdown -> Word
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VARIANT="${VARIANT:-whitepaper}"
OUTPUT="${1:-}"

if [[ "$VARIANT" == "manual" ]]; then
  DOC_ROOT="$ROOT/user-manual"
  DEFAULT_NAME="cloudmap-user-manual.docx"
else
  DOC_ROOT="$ROOT/whitepaper"
  DEFAULT_NAME="cloudmap-whitepaper.docx"
fi

SOURCE="$DOC_ROOT/source"
OUTPUT_DIR="$DOC_ROOT/output"
MANIFEST="$SOURCE/manifest.txt"
OUTPUT="${OUTPUT:-$OUTPUT_DIR/$DEFAULT_NAME}"

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

REF="$ROOT/templates/reference.docx"
LUA_FILTER="$ROOT/templates/filters/docx-cleanup.lua"
BODY_FILTER="$ROOT/templates/filters/manual-body-format.lua"
CHAPTER_FILTER="$ROOT/templates/filters/manual-chapter-break.lua"
WP_ASSETS="$ROOT/whitepaper/source/assets"
TOC_DEPTH=3
[[ "$VARIANT" == "manual" ]] && TOC_DEPTH=2
ARGS=( "${INPUTS[@]}" -o "$OUTPUT" --from markdown --to docx --toc "--toc-depth=$TOC_DEPTH" "--resource-path=$SOURCE:$WP_ASSETS" )
if [[ "$VARIANT" == "manual" && -f "$BODY_FILTER" ]]; then
  ARGS+=( "--lua-filter=$BODY_FILTER" )
fi
[[ -f "$LUA_FILTER" ]] && ARGS+=( "--lua-filter=$LUA_FILTER" )
if [[ "$VARIANT" == "manual" && -f "$CHAPTER_FILTER" ]]; then
  ARGS+=( "--lua-filter=$CHAPTER_FILTER" )
fi
[[ -f "$REF" ]] && ARGS+=( "--reference-doc=$REF" )

pandoc "${ARGS[@]}"
echo "已生成: $OUTPUT"
