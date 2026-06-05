#!/usr/bin/env python3
"""一次性：从 deployment 下 docx 拆分为 source/*.md（按 Heading 1/2 分文件）。"""
from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    from docx import Document
except ImportError:
    print("pip install python-docx", file=sys.stderr)
    raise

PKG = Path(__file__).resolve().parents[1]
SOURCE = PKG / "whitepaper" / "source"
DOCX_CANDIDATES = [
    Path(__file__).resolve().parents[3] / "deployment" / "Cloudmap_超融合平台技术白皮书.docx",
    PKG / "whitepaper" / "output" / "cloudmap-whitepaper.docx",
    PKG / "whitepaper" / "output" / "Cloudmap_超融合平台技术白皮书.docx",
]


def slugify(text: str) -> str:
    t = re.sub(r"^\d+[\.\-]\s*", "", text.strip())
    t = re.sub(r"[（(][^）)]*[）)]", "", t)
    t = re.sub(r"[^\w\u4e00-\u9fff]+", "-", t)
    t = t.strip("-").lower()
    return t or "section"


def heading_level(style_name: str, text: str) -> int | None:
    if style_name.startswith("Heading"):
        try:
            return int(style_name.split()[-1])
        except ValueError:
            pass
    if re.match(r"^\d+(\.\d+)*\s+\S", text) and len(text) < 60:
        parts = text.split()[0].count(".") + 1
        if parts <= 4:
            return min(parts + 1, 4)
    return None


def para_to_md(text: str) -> str:
    t = text.strip()
    if not t:
        return ""
    if t.startswith("实现：") or t.startswith("能力：") or t.startswith("价值："):
        return t
    if "：" in t[:20] and not t.startswith("http"):
        label, rest = t.split("：", 1)
        if len(label) <= 12:
            return f"- **{label}**：{rest.strip()}"
    return t


def find_docx() -> Path:
    for p in DOCX_CANDIDATES:
        if p.exists():
            return p
    raise FileNotFoundError("未找到 Cloudmap_超融合平台技术白皮书.docx")


def main() -> None:
    docx = find_docx()
    doc = Document(str(docx))
    SOURCE.mkdir(parents=True, exist_ok=True)

    files: list[tuple[Path, list[str]]] = []
    current_path: Path | None = None
    current_lines: list[str] = []
    ch2_counter = 0

    def flush() -> None:
        nonlocal current_path, current_lines
        if current_path and current_lines:
            files.append((current_path, current_lines))
        current_lines = []

    for p in doc.paragraphs:
        text = p.text.strip()
        if not text:
            continue
        level = heading_level(p.style.name, text)
        if level == 1 or (level == 2 and re.match(r"^\d+\.\s", text)):
            flush()
            num = text.split()[0].rstrip(".")
            slug = slugify(text)
            current_path = SOURCE / f"{num.zfill(2)}-{slug}.md"
            current_lines = [f"# {text}", ""]
            continue
        if level is not None and level >= 2 and re.match(r"^\d+\.", text):
            hashes = "#" * min(level + 1, 4)
            current_lines.extend(["", f"{hashes} {text}", ""])
            continue
        line = para_to_md(text)
        if line:
            current_lines.append(line)
            current_lines.append("")

    flush()

    for path, lines in files:
        path.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")
        print("wrote", path.relative_to(PKG))

    print(f"\n来源: {docx}\n共 {len(files)} 个文件 -> {SOURCE}")


if __name__ == "__main__":
    main()
