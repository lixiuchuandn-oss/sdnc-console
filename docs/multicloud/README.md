# 多云管理平台文档（ComputerTower 多云管理 / CNMC）

> **Markdown 源稿**在本目录；Word / HTML 由 Pandoc 脚本生成。本工程**复用** `docs/cloudmap/` 的模板与构建脚本（模板：`docs/cloudmap/templates/`；脚本已泛化为支持文档根参数）。
> 写作口径沿用 [`../cloudmap/whitepaper/writing-style.md`](../cloudmap/whitepaper/writing-style.md)。

## 定位

本工程面向 **ComputerTower 多云管理平台**（统一纳管阿里云、华为云、腾讯云、Harvester、MAAS、Rancher 等异构云），与 `docs/cloudmap/`（**Cloudmap 融合边缘云**，私有化超融合 / 边缘）**并列**为两条产品线文档。

## 目录结构

```
docs/multicloud/
├── README.md
└── whitepaper/
    ├── README.md
    ├── source/
    │   ├── manifest.txt        # 章节合并顺序
    │   ├── 01-产品概述.md … 14-术语与缩略语.md
    │   └── assets/             # 架构图等（优先 URL，本地调试用相对路径）
    └── output/                 # 生成物（gitignore）
```

## 生成 Word / HTML（复用 cloudmap 脚本 + 文档根参数）

在 **`docs/cloudmap`** 目录执行（脚本以 `DOC_ROOT` 指向本工程，模板复用 cloudmap）：

```bash
# Word
DOC_ROOT=docs/multicloud/whitepaper DOC_NAME=multicloud-whitepaper ./scripts/build-docx.sh
# HTML 预览
DOC_ROOT=docs/multicloud/whitepaper DOC_NAME=multicloud-whitepaper DOC_TITLE="多云管理平台技术白皮书" ./scripts/build-html.sh
```

```powershell
# Word
.\scripts\build-docx.ps1 -DocRoot docs/multicloud/whitepaper -Name multicloud-whitepaper
# HTML 预览
.\scripts\build-html.ps1 -DocRoot docs/multicloud/whitepaper -Name multicloud-whitepaper -Title "多云管理平台技术白皮书" -Open
```

交付物：`docs/multicloud/whitepaper/output/multicloud-whitepaper.docx`。

## 相关文档

| 文档 | 路径 |
|------|------|
| 白皮书源稿说明 | [`whitepaper/README.md`](./whitepaper/README.md) |
| 写作约束（共用） | [`../cloudmap/whitepaper/writing-style.md`](../cloudmap/whitepaper/writing-style.md) |
| 融合边缘云白皮书 | [`../cloudmap/whitepaper/`](../cloudmap/whitepaper/) |
| 构建脚本 / 模板 | [`../cloudmap/scripts/`](../cloudmap/scripts/) · `../cloudmap/templates/` |
