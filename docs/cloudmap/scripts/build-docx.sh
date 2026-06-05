#!/usr/bin/env bash
# Cloudmap 白皮书 / 使用手册：Markdown -> Word
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VARIANT="${VARIANT:-whitepaper}"
OUTPUT="${1:-}"
COPY_DEPLOY="${COPY_TO_DEPLOYMENT:-0}"

if [[ "$VARIANT" == "manual" ]]; then
  DOC_ROOT="$ROOT/user-manual"
  DEFAULT_NAME="cloudmap-user-manual.docx"
  DEPLOY_NAME="Cloudmap_user_manual.docx"
else
  DOC_ROOT="$ROOT/whitepaper"
  DEFAULT_NAME="cloudmap-whitepaper.docx"
  DEPLOY_NAME="Cloudmap_whitepaper.docx"
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
WP_ASSETS="$ROOT/whitepaper/source/assets"
ARGS=( "${INPUTS[@]}" -o "$OUTPUT" --from markdown --to docx --toc --toc-depth=3 "--resource-path=$SOURCE:$WP_ASSETS" )
[[ -f "$REF" ]] && ARGS+=( "--reference-doc=$REF" )

pandoc "${ARGS[@]}"
echo "已生成: $OUTPUT"

if [[ "$COPY_DEPLOY" == "1" ]]; then
  DEPLOY="$(cd "$ROOT/../.." && pwd)/deployment"
  mkdir -p "$DEPLOY"
  cp -f "$OUTPUT" "$DEPLOY/$DEPLOY_NAME"
  echo "已复制到: $DEPLOY/$DEPLOY_NAME"
fi
