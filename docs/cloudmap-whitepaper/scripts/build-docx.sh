#!/usr/bin/env bash
# Cloudmap 白皮书：Markdown 源稿 -> Word
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT/source"
OUTPUT_DIR="$ROOT/output"
MANIFEST="$SOURCE/manifest.txt"
OUTPUT="${1:-$OUTPUT_DIR/cloudmap-whitepaper.docx}"
COPY_DEPLOY="${COPY_TO_DEPLOYMENT:-0}"

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
ARGS=( "${INPUTS[@]}" -o "$OUTPUT" --from markdown --to docx --toc --toc-depth=3 "--resource-path=$SOURCE" )
[[ -f "$REF" ]] && ARGS+=( "--reference-doc=$REF" )

pandoc "${ARGS[@]}"
echo "已生成: $OUTPUT"

if [[ "$COPY_DEPLOY" == "1" ]]; then
  DEPLOY="$(cd "$ROOT/../.." && pwd)/deployment"
  mkdir -p "$DEPLOY"
  cp -f "$OUTPUT" "$DEPLOY/Cloudmap_超融合平台技术白皮书.docx"
  echo "已复制到: $DEPLOY/Cloudmap_超融合平台技术白皮书.docx"
fi
