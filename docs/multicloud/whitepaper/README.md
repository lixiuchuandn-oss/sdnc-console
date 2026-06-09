# 多云管理平台 · 技术白皮书（Markdown 源稿）

> **唯一可维护源稿**在 `source/`；Word / HTML 由脚本生成，勿手改 `output/` 后再反向当源稿。
> 写作口径见 [`../../cloudmap/whitepaper/writing-style.md`](../../cloudmap/whitepaper/writing-style.md)；构建说明见 [`../README.md`](../README.md)。

## 源稿目录

```
whitepaper/
├── README.md                 # 本文件
├── source/
│   ├── manifest.txt          # 章节合并顺序
│   ├── 01-产品概述.md … 14-术语与缩略语.md
│   └── assets/               # 架构图；英文 kebab-case 语义文件名（与 cloudmap 白皮书一致）
└── output/                   # 生成物（gitignore）
```

## 章节状态

全书 14 章正文已写满（01–14），按共用 `writing-style.md` 口径撰写，选配/项目化能力均带边界标注。

## 日常流程

1. **改 Markdown**：只编辑 `source/`，一节一文件，遵循共用 `writing-style.md`。
2. **插图**：优先稳定 URL；本地调试可放 `source/assets/`。
3. **生成 Word / HTML**：见 [`../README.md`](../README.md)（在 `docs/cloudmap` 目录执行，`DOC_ROOT` 指向本工程）。

## 与融合边缘云白皮书的关系

本书聚焦 **统一纳管异构多云**（ComputerTower / CNMC）；私有化超融合与边缘形态（Cloudmap OS）见 [`../../cloudmap/whitepaper/`](../../cloudmap/whitepaper/)，两书可交叉引用、避免重复论述。
