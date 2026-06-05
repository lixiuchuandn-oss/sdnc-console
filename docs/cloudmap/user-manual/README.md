# Cloudmap 超融合平台 · 使用手册（Markdown 源稿）

本目录维护 Cloudmap 使用手册源稿。正文源文件位于 `source/`，面向运维人员和租户管理员，内容聚焦控制台操作步骤。

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
.\scripts\build-docx.ps1 -Variant manual -CopyToDeployment
.\scripts\build-html.ps1 -Variant manual -Open
```

```bash
VARIANT=manual COPY_TO_DEPLOYMENT=1 ./scripts/build-docx.sh
```

输出：`output/cloudmap-user-manual.docx`；加 `-CopyToDeployment` 时同步 `deployment/Cloudmap_user_manual.docx`。

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
