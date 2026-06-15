#!/usr/bin/env python3
"""将 source/03-关键技术特性.md 按 #### 3.x 拆分为 ch03/*.md"""
from __future__ import annotations

import re
from pathlib import Path

PKG = Path(__file__).resolve().parents[1]
SRC = PKG / "whitepaper" / "source" / "03-关键技术特性.md"
OUT = PKG / "whitepaper" / "source" / "ch03"


def slug_from_heading(h: str) -> str:
    m = re.match(r"^3\.(\d+(?:\.\d+)*)", h)
    num = m.group(1).replace(".", "-") if m else "x"
    title = re.sub(r"^3\.[\d.]+\s*", "", h).strip()
    title = re.sub(r"[（(][^）)]*[）)]", "", title)
    title = re.sub(r"[^\w\u4e00-\u9fff]+", "-", title).strip("-").lower()
    return f"3-{num}-{title or 'section'}"


def main() -> None:
    if not SRC.exists():
        print("skip: no", SRC)
        return
    text = SRC.read_text(encoding="utf-8")
    lines = text.splitlines()
    chapter_intro: list[str] = []
    sections: list[tuple[str, list[str]]] = []
    current_title: str | None = None
    current_lines: list[str] = []

    def flush() -> None:
        nonlocal current_title, current_lines
        if current_title:
            sections.append((current_title, current_lines))
        current_title = None
        current_lines = []

    for line in lines:
        if line.startswith("#### 3."):
            flush()
            current_title = line.replace("#### ", "").strip()
            current_lines = []
            continue
        if current_title is None:
            if line.strip() and not line.startswith("# 3."):
                chapter_intro.append(line)
            continue
        current_lines.append(line)
    flush()

    OUT.mkdir(parents=True, exist_ok=True)
    intro_path = OUT / "_chapter.md"
    intro_body = "\n".join(chapter_intro).strip()
    intro_path.write_text(
        "# 3. 关键技术特性\n\n"
        + (intro_body + "\n\n" if intro_body else "")
        + "本章说明 Cloudmap 在私有化部署中可交付的功能，面向采购、项目与运维人员。\n",
        encoding="utf-8",
    )
    print("wrote", intro_path.relative_to(PKG))

    names: list[str] = []
    for title, body in sections:
        fname = slug_from_heading(title) + ".md"
        level = title.count(".")
        hashes = "#" * min(level + 2, 4)
        content = f"{hashes} {title}\n\n" + "\n".join(body).strip() + "\n"
        (OUT / fname).write_text(content, encoding="utf-8")
        names.append(fname)
        print("wrote", (OUT / fname).relative_to(PKG))

    # 更新 manifest 中 ch03 段
    manifest = PKG / "whitepaper" / "source" / "manifest.txt"
    if manifest.exists():
        raw = manifest.read_text(encoding="utf-8")
        if "ch03/" not in raw:
            print("manifest 需手动加入 ch03 文件列表")


if __name__ == "__main__":
    main()
