# -*- coding: utf-8 -*-
"""Fix __SN placeholders and restore headings from filenames after reorder."""
from __future__ import annotations

import re
from pathlib import Path

CH03 = Path(__file__).resolve().parent.parent / "whitepaper" / "source" / "ch03"
SOURCE = Path(__file__).resolve().parent.parent / "whitepaper" / "source"


def parse_section(name: str) -> tuple[int, int | None]:
    stem = name.removesuffix(".md")
    parts = stem.split("-")
    major = int(parts[1])
    minor = int(parts[2]) if len(parts) >= 4 and parts[2].isdigit() else None
    return major, minor


def fix_placeholders(text: str) -> str:
    text = re.sub(r"__S(\d+)__", r"3.\1", text)
    text = re.sub(r"__S(\d+)\b", r"3.\1", text)
    text = re.sub(r"3\.__S(\d+)\b", r"3.3.\1", text)  # repair corrupted 3.3.x headings
    return text


def heading_line(path: Path, body: str) -> str | None:
    major, minor = parse_section(path.name)
    lines = body.splitlines()
    if not lines or not lines[0].startswith("#"):
        return None
    title = re.sub(r"^#+\s*[\d._S]+\s*", "", lines[0]).strip()
    if minor is not None:
        return f"### 3.{major}.{minor} {title}"
    return f"## 3.{major} {title}"


def main() -> None:
    for path in SOURCE.rglob("*.md"):
        text = fix_placeholders(path.read_text(encoding="utf-8"))
        path.write_text(text, encoding="utf-8")

    for path in sorted(CH03.glob("3-*.md")):
        text = path.read_text(encoding="utf-8")
        lines = text.splitlines()
        if not lines:
            continue
        new_heading = heading_line(path, text)
        if new_heading and lines[0].startswith("#"):
            lines[0] = new_heading
            path.write_text("\n".join(lines) + ("\n" if text.endswith("\n") else ""), encoding="utf-8")

    print("Fixed placeholders and headings in ch03/")


if __name__ == "__main__":
    main()
