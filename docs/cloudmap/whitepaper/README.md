# Cloudmap 融合边缘云 · 技术白皮书（Markdown 源稿）

> **唯一可维护源稿**在 `source/`；Word 由脚本生成，勿手改 `output/*.docx` 后再反向当源稿。  
> **使用手册**见 [`../user-manual/README.md`](../user-manual/README.md)；构建入口见 [`../README.md`](../README.md)。

## 源稿目录

```
whitepaper/
├── README.md                 # 本文件
├── writing-style.md          # 写作约束（政企白皮书口径）
├── OPTIMIZATION-SUMMARY.md   # 结构优化复盘（可选阅读）
├── source/
│   ├── manifest.txt          # 章节合并顺序
│   ├── 01-产品概述.md … 11-服务与支持.md
│   ├── ch03/                 # 第 3 章按节拆分
│   └── assets/               # 架构图等（优先 URL，本地调试用相对路径）
└── output/                   # 生成物（gitignore）
```

## 日常流程

1. **改 Markdown**：只编辑 `source/`；第 3 章改 `source/ch03/*.md`。
2. **插图**：优先稳定 URL；本地调试可放 `source/assets/`。
3. **生成 Word**（在 `docs/cloudmap` 目录）：

   ```powershell
   .\scripts\build-docx.ps1 -Variant whitepaper
   ```

4. **HTML 预览**：`.\scripts\build-html.ps1 -Variant whitepaper -Open`

交付物：`output/cloudmap-whitepaper.docx`。

## 从旧 Word 迁移（一次性）

```powershell
python docs/cloudmap/scripts/export-docx-to-md.py
python docs/cloudmap/scripts/split-ch03.py
```

## 相关文档

| 文档         | 路径                          |
| ------------ | ----------------------------- |
| 写作约束     | `writing-style.md`            |
| 使用手册     | `../user-manual/`             |
| 手册覆盖对照 | `../user-manual/COVERAGE.md`  |
| 构建脚本     | `../scripts/`                 |
| 版式模板     | `../templates/reference.docx` |
