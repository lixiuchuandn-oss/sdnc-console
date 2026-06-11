#!/usr/bin/env bash
# Cloudmap 白皮书 / 使用手册：Markdown -> HTML
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/../.." && pwd)"
VARIANT="${VARIANT:-whitepaper}"
OUTPUT="${1:-}"
OPEN="${OPEN:-0}"

# 文档根覆盖（泛化）：见 build-docx.sh 说明。可选 DOC_NAME / DOC_TITLE。
# 例：DOC_ROOT=docs/multicloud/whitepaper DOC_NAME=multicloud-whitepaper DOC_TITLE="多云管理平台 Whitepaper" ./scripts/build-html.sh
if [[ -n "${DOC_ROOT:-}" ]]; then
  case "$DOC_ROOT" in
    /*) : ;;
    *)  DOC_ROOT="$REPO_ROOT/$DOC_ROOT" ;;
  esac
  DEFAULT_NAME="${DOC_NAME:-$(basename "$DOC_ROOT")}.html"
  TITLE="${DOC_TITLE:-Whitepaper}"
elif [[ "$VARIANT" == "manual" ]]; then
  DOC_ROOT="$ROOT/user-manual"
  DEFAULT_NAME="cloudmap-user-manual.html"
  TITLE="Cloudmap 使用手册"
else
  DOC_ROOT="$ROOT/whitepaper"
  DEFAULT_NAME="cloudmap-whitepaper.html"
  TITLE="Cloudmap Whitepaper"
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

CSS="$ROOT/templates/preview.css"
WP_ASSETS="$ROOT/whitepaper/source/assets"
ARGS=(
  "${INPUTS[@]}"
  -o "$OUTPUT"
  --from markdown
  --to html5
  --standalone
  --toc
  --toc-depth=3
  --metadata "title=$TITLE"
  "--resource-path=$SOURCE:$WP_ASSETS"
)
# 将模板 CSS 拷入输出目录并按同目录引用，避免 DOC_ROOT 指向其它工程时
# 相对路径 ../templates/preview.css 解析到不存在目录（样式 404）。与 _build-doc.ps1 一致。
if [[ -f "$CSS" ]]; then
  cp -f "$CSS" "$OUTPUT_DIR/preview.css"
  ARGS+=( "--css=preview.css" )
fi

pandoc "${ARGS[@]}"

# 与 _build-doc.ps1 的 Set-HtmlSidebarLayout 对齐：将 <body> 内容包成
# 左侧目录(doc-sidebar) + 右侧正文(doc-content)，preview.css 依此布局。
if command -v perl >/dev/null 2>&1 && ! grep -q 'class="doc-layout"' "$OUTPUT"; then
  perl -0777 -i -pe 's{(<body>\s*)(<header id="title-block-header">.*?</header>\s*)(<nav id="TOC"[^>]*>.*?</nav>\s*)(.*?)(\s*</body>)}{$1<div class="doc-layout"><aside class="doc-sidebar">$2$3</aside><main class="doc-content">$4</main></div>$5}s' "$OUTPUT"
  grep -q 'class="doc-layout"' "$OUTPUT" || echo "WARN: HTML 侧边栏布局后处理跳过（结构不符）: $OUTPUT" >&2
fi

for ASSETS_SRC in "$SOURCE/assets" "$WP_ASSETS"; do
  if [[ -d "$ASSETS_SRC" ]]; then
    ASSETS_OUT="$OUTPUT_DIR/assets"
    mkdir -p "$ASSETS_OUT"
    cp -f "$ASSETS_SRC"/* "$ASSETS_OUT"/ 2>/dev/null || true
  fi
done

echo "已生成: $OUTPUT"

if [[ "$OPEN" == "1" ]]; then
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$OUTPUT"
  elif [[ "$OSTYPE" == darwin* ]]; then
    open "$OUTPUT"
  fi
fi
