# -*- coding: utf-8 -*-
"""Renumber chapter 3 sections 3.6→3.5 … 3.15→3.14 after merging old 3.5 into 3.4."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "whitepaper" / "source"
CH03 = SOURCE / "ch03"


def remap_section_number(match: re.Match[str]) -> str:
    major = int(match.group(1))
    suffix = match.group(2) or ""
    if major >= 6:
        major -= 1
    return f"3.{major}{suffix}"


SECTION_RE = re.compile(r"3\.(\d{1,2})(\.\d+)?")


def remap_text(text: str) -> str:
    return SECTION_RE.sub(remap_section_number, text)


def remap_filename(name: str) -> str | None:
    m = re.match(r"^(3)-(\d+)-(.+)$", name)
    if not m:
        return None
    major = int(m.group(2))
    if major >= 6:
        major -= 1
        return f"3-{major}-{m.group(3)}"
    return None


def main() -> None:
    to_rename: list[tuple[Path, Path]] = []
    for path in sorted(CH03.glob("3-*.md")):
        new_name = remap_filename(path.name)
        if new_name:
            to_rename.append((path, path.with_name(new_name)))

    for path, final in sorted(to_rename, key=lambda x: int(re.match(r"3-(\d+)-", x[0].name).group(1)), reverse=True):
        if final.exists() and final != path:
            raise SystemExit(f"Conflict: {final} already exists")
        path.rename(final)

    for path in SOURCE.rglob("*.md"):
        original = path.read_text(encoding="utf-8")
        updated = remap_text(original)
        if updated != original:
            path.write_text(updated, encoding="utf-8")

    manifest = SOURCE / "manifest.txt"
    manifest.write_text(remap_text(manifest.read_text(encoding="utf-8")), encoding="utf-8")

    readme = ROOT / "whitepaper" / "README.md"
    if readme.exists():
        readme.write_text(remap_text(readme.read_text(encoding="utf-8")), encoding="utf-8")

    style = ROOT / "whitepaper" / "writing-style.md"
    if style.exists():
        style.write_text(remap_text(style.read_text(encoding="utf-8")), encoding="utf-8")

    print(f"Renamed {len(to_rename)} ch03 files; updated section refs (3.6+ → 3.5+).")


if __name__ == "__main__":
    main()
