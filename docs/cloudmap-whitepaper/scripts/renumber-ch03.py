# -*- coding: utf-8 -*-
"""Renumber chapter 3 sections after removing old 3.2 (3.3→3.2 … 3.16→3.15)."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CH03 = ROOT / "source" / "ch03"
SOURCE = ROOT / "source"


def remap_section_number(match: re.Match[str]) -> str:
    major = int(match.group(1))
    suffix = match.group(2) or ""
    if major >= 3:
        major -= 1
    return f"3.{major}{suffix}"


SECTION_RE = re.compile(r"3\.(\d{1,2})(\.\d+)?")


def remap_text(text: str) -> str:
    return SECTION_RE.sub(remap_section_number, text)


def remap_filename(name: str) -> str:
    m = re.match(r"^(3)-(\d+)-(.+)$", name)
    if not m:
        return name
    major = int(m.group(2))
    if major >= 3:
        major -= 1
    return f"3-{major}-{m.group(3)}"


def main() -> None:
    ch03_files = sorted(CH03.glob("3-*.md"))
    temp_map: dict[Path, Path] = {}

    for path in ch03_files:
        temp = path.with_name(f"__renum__{path.name}")
        path.rename(temp)
        temp_map[temp] = CH03 / remap_filename(path.name)

    for temp, final in temp_map.items():
        temp.rename(final)

    for path in SOURCE.rglob("*.md"):
        if path.name.startswith("__renum__"):
            continue
        original = path.read_text(encoding="utf-8")
        updated = remap_text(original)
        if updated != original:
            path.write_text(updated, encoding="utf-8")

    manifest = ROOT / "source" / "manifest.txt"
    manifest.write_text(remap_text(manifest.read_text(encoding="utf-8")), encoding="utf-8")

    print(f"Renamed {len(temp_map)} ch03 files; updated section refs in source/")


if __name__ == "__main__":
    main()
