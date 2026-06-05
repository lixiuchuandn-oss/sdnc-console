# -*- coding: utf-8 -*-
"""Reorder chapter 3 major sections and renumber refs (see OLD_TO_NEW)."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "whitepaper" / "source"
CH03 = SOURCE / "ch03"

# old major section -> new major section (3.1–3.4 unchanged)
OLD_TO_NEW: dict[int, int] = {
    1: 1,
    2: 2,
    3: 3,
    4: 4,
    11: 5,   # 租户网络 → 紧随平台网络
    12: 6,   # 容器全栈
    10: 7,   # 云桌面（对齐 3.1.4 多元算力顺序）
    9: 8,    # 裸金属
    5: 9,    # 异构迁移
    13: 10,  # 云备份
    14: 11,  # 云数据库
    8: 12,   # 智算推理
    6: 13,   # 云原生生态（选配）
    7: 14,   # SaaS
    15: 15,  # 统一运维
}


def remap_text(text: str) -> str:
    out = text
    for old in sorted(OLD_TO_NEW.keys(), reverse=True):
        new = OLD_TO_NEW[old]
        out = re.sub(rf"3\.{old}\.", f"__S{new}__.", out)
        out = re.sub(rf"3\.{old}(?!\d)", f"__S{new}", out)
    out = re.sub(r"__S(\d+)__", r"3.\1", out)
    return out


def remap_filename(name: str) -> str:
    m = re.match(r"^(3)-(\d+)-(.+)$", name)
    if not m:
        return name
    major = int(m.group(2))
    if major not in OLD_TO_NEW:
        raise ValueError(f"Unmapped section file prefix: {name}")
    return f"3-{OLD_TO_NEW[major]}-{m.group(3)}"


def main() -> None:
    ch03_files = sorted(CH03.glob("3-*.md"))
    temp_map: dict[Path, Path] = {}

    for path in ch03_files:
        temp = path.with_name(f"__ord__{path.name}")
        path.rename(temp)
        temp_map[temp] = CH03 / remap_filename(path.name)

    for temp, final in temp_map.items():
        temp.rename(final)

    for path in SOURCE.rglob("*.md"):
        if "__ord__" in path.name:
            continue
        original = path.read_text(encoding="utf-8")
        updated = remap_text(original)
        if updated != original:
            path.write_text(updated, encoding="utf-8")

    manifest = SOURCE / "manifest.txt"
    manifest.write_text(remap_text(manifest.read_text(encoding="utf-8")), encoding="utf-8")

    # manifest: also reorder ch03 lines by new section major
    lines = manifest.read_text(encoding="utf-8").splitlines()
    ch03_lines = [ln for ln in lines if ln.startswith("ch03/3-") and not ln.startswith("ch03/_")]
    other_lines = [ln for ln in lines if ln not in ch03_lines]

    def sort_key(line: str) -> tuple[int, int, str]:
        m = re.search(r"ch03/3-(\d+)(?:-(\d+))?", line)
        if not m:
            return (999, 999, line)
        major = int(m.group(1))
        minor = int(m.group(2)) if m.group(2) else 0
        return (major, minor, line)

    ch03_lines.sort(key=sort_key)
    chapter_block: list[str] = []
    inserted = False
    for ln in lines:
        if ln.startswith("ch03/_chapter.md"):
            chapter_block.append(ln)
            chapter_block.extend(ch03_lines)
            inserted = True
        elif ln.startswith("ch03/3-"):
            continue
        else:
            chapter_block.append(ln)
    if not inserted:
        raise SystemExit("manifest missing ch03/_chapter.md")
    manifest.write_text("\n".join(chapter_block) + "\n", encoding="utf-8")

    print(f"Reordered {len(temp_map)} files; mapping: {OLD_TO_NEW}")


if __name__ == "__main__":
    main()
