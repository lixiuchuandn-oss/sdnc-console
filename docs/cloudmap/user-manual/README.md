# Cloudmap 超融合平台 · 使用手册（Markdown 源稿）

本文件只面向文档维护者，不进入外发 Word。用户可阅读的内容以生成后的使用手册为准。

## 源稿目录

```
user-manual/
├── README.md
├── writing-style.md
├── COVERAGE.md               # 使用手册目录覆盖表
├── SCREENSHOTS.md            # 截图清单与 Playwright 说明
├── source/
│   ├── manifest.txt
│   ├── 01-阅读指南.md … 07-术语与索引.md
│   ├── assets/               # 手册截图
│   └── ch03/                 # 资源池功能章节
└── output/                   # 生成物（gitignore）
```

## 生成文档

版式与参考技术手册一致（微软雅黑标题、宋体正文、1.5 倍行距、章前分页、表格灰表头）。构建前自动执行 `../scripts/prepare-reference-docx.ps1` 套用 `../templates/reference.docx`。

在 **`docs/cloudmap`** 目录执行（需 [Pandoc](https://pandoc.org/)）：

```powershell
.\scripts\build-docx.ps1 -Variant manual
.\scripts\build-html.ps1 -Variant manual -Open
```

```bash
VARIANT=manual ./scripts/build-docx.sh
```

输出：`output/cloudmap-user-manual.docx`

## 相关文档

| 文档 | 路径 |
|------|------|
| 技术白皮书 | `../whitepaper/` |
| 招标参数 | `../tender-parameters/` |
| Hub 总览 | `../README.md` |

## 维护建议

- 配图：`SCREENSHOTS.md` 登记 → `tests/manual/capture-*.browser.cjs` → 见 `tests/manual/README.md`。
- 写作细则见 `writing-style.md`。

## 完善路线图（摘要）

| 阶段 | 内容 |
|------|------|
| 0 | `COVERAGE` / `SCREENSHOTS` / 截图共享库（当前） |
| 1 | 按资源池功能目录重排 manifest 与 ch03 |
| 2 | 轮 1 加深：02 接入、云主机创建向导、云存储、云备份、`06` FAQ |
| 3 | 按 `SCREENSHOTS.md` 批量配图 |
