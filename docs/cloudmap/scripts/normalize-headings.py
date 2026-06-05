#!/usr/bin/env python3
"""Normalize markdown heading levels from section numbers (e.g. 3.4.1 -> h3)."""
from __future__ import annotations

import re
from pathlib import Path

HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$")
SECTION_RE = re.compile(r"^(\d+(?:\.\d+)*)\.?\s*")


def section_depth(title: str) -> int | None:
    match = SECTION_RE.match(title.strip())
    if not match:
        return None
    return len(match.group(1).split("."))


def normalize_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=True)
    changed = False
    out: list[str] = []

    for line in lines:
        stripped = line.rstrip("\r\n")
        newline = line[len(stripped) :]
        match = HEADING_RE.match(stripped)
        if not match:
            out.append(line)
            continue

        title = match.group(2)
        depth = section_depth(title)
        if depth is None:
            out.append(line)
            continue

        level = min(depth, 6)
        new_line = f"{'#' * level} {title}{newline}"
        if new_line != line:
            changed = True
        out.append(new_line)

    if changed:
        path.write_text("".join(out), encoding="utf-8")
    return changed


def main() -> None:
    root = Path(__file__).resolve().parents[1] / "whitepaper" / "source"
    updated = 0
    for path in sorted(root.rglob("*.md")):
        if normalize_file(path):
            updated += 1
            print(f"updated: {path.relative_to(root.parent)}")
    print(f"done: {updated} file(s) updated")


if __name__ == "__main__":
    main()
