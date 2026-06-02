# Cloudmap 融合边缘云 · 技术白皮书（Markdown 源稿）

> **唯一可维护源稿**在本目录 `source/`；Word 由脚本生成，勿手改 `output/*.docx` 后再反向当源稿。

## 目录结构

```
docs/cloudmap-whitepaper/
├── README.md                 # 本文件：流程与约定
├── writing-style.md          # 写作硬性约束（政企白皮书口径）
├── 优化亮点总结清单.md       # 本轮结构、内容、技术、逻辑、格式优化说明
├── source/
│   ├── manifest.txt          # 章节合并顺序（build 按此读取）
│   ├── 01-产品概述.md
│   ├── 02-产品架构.md
│   ├── ch03/                 # 第 3 章按节拆分（便于协作与 diff）
│   │   ├── _chapter.md
│   │   ├── 3-1-*.md
│   │   └── ...
│   ├── 04-*.md …
│   └── assets/               # 可选：本地图片（优先用 URL，见下）
├── templates/
│   └── reference.docx        # 可选：pandoc 版式模板（标题/字体）
├── scripts/
│   ├── export-docx-to-md.py  # 一次性：从 deployment 旧 docx 导入
│   ├── split-ch03.py         # 若恢复整章 md 时拆分用
│   ├── build-docx.ps1        # Windows 生成 Word
│   ├── build-docx.sh         # Linux/macOS 生成 Word
│   ├── build-html.ps1        # Windows 生成 HTML 预览
│   └── build-html.sh         # Linux/macOS 生成 HTML 预览
└── output/
    ├── cloudmap-whitepaper.docx   # Word 生成物
    └── cloudmap-whitepaper.html   # HTML 预览（浏览器打开）
```

## 日常流程

1. **改 Markdown**：只编辑 `source/` 下 `.md`；第 3 章改 `source/ch03/*.md`。
2. **插图**：在 md 中使用 URL（内网图床、对象存储、Git 托管 raw 链接均可）：

   ```markdown
   ![分布式统一存储架构](https://example.com/cloudmap/storage-arch.png)
   ```

   本地调试时可放 `source/assets/`，用相对路径 `![](assets/xxx.png)`；发布建议改为稳定 URL。

3. **生成 Word**（需安装 [Pandoc](https://pandoc.org/)）：

   ```powershell
   cd docs/cloudmap-whitepaper
   .\scripts\build-docx.ps1 -CopyToDeployment
   ```

   ```bash
   COPY_TO_DEPLOYMENT=1 ./scripts/build-docx.sh
   ```

4. **浏览器预览整本**（需 Pandoc）：

   ```powershell
   cd docs/cloudmap-whitepaper
   .\scripts\build-html.ps1 -Open
   ```

   ```bash
   OPEN=1 ./scripts/build-html.sh
   ```

   输出 `output/cloudmap-whitepaper.html`，含目录；标题编号以源稿 md 中的章节号为准（构建时不启用 Pandoc 自动编号）。样式见 `templates/preview.css`。

5. **交付**：`output/` 下 docx；加 `-CopyToDeployment` 时同步到 `deployment/`（该目录不入 git）。

## 从旧 Word 迁移（一次性）

```powershell
python docs/cloudmap-whitepaper/scripts/export-docx-to-md.py
python docs/cloudmap-whitepaper/scripts/split-ch03.py
# 核对 source/ 与 manifest.txt 后按 writing-style.md 逐步改写
```

## 版式模板（可选）

将现有 Word 的样式导出为 pandoc 参考文档：

```powershell
pandoc -o docs/cloudmap-whitepaper/templates/reference.docx --print-default-data-file reference.docx
# 或在 Word 中调好标题/正文样式后另存为 reference.docx 放入 templates/
```

构建时若存在 `templates/reference.docx`，会自动套用。

## 与仓库其他文档的关系

| 文档                                        | 关系                                   |
| ------------------------------------------- | -------------------------------------- |
| `docs/cloudmap-whitepaper/writing-style.md` | 白皮书专用写作约束与融合边缘云术语口径 |
| `deployment/*.docx`                         | **生成输出**（gitignore），非源稿      |
| `AGENTS.md`                                 | 产品能力以代码为准；白皮书须与实现一致 |

## 维护建议

- 新能力：**先改对应 md 小节**，再 `build-docx` 出稿。
- 大章（如第 3 章）保持 **一节一文件**，避免单文件上千行。
- 跨节引用用「详见 3.4.6」，不要复制粘贴整段。
- 合入 PR 时提交 **md 变更**；docx 可选作为附件，非必须入库。
