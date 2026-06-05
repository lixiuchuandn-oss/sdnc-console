# Cloudmap 超融合平台 · 使用手册（Markdown 源稿）

> **可维护源稿**在 `source/`；Word 由脚本生成。能力背景见 [技术白皮书](../whitepaper/README.md)。

## 与白皮书的关系

| 文档 | 路径 | 读者 | 内容 |
|------|------|------|------|
| 技术白皮书 | `../whitepaper/source/` | 采购、架构、项目负责人 | 能力、架构、价值 |
| **使用手册** | `source/` | 运维、租户管理员 | 控制台操作步骤 |

章节 **3.x 节号与白皮书对齐**；正文写操作路径，原理与部署形态查白皮书对应小节。

## 源稿目录

```
user-manual/
├── README.md
├── writing-style.md
├── COVERAGE.md               # 白皮书 ↔ 手册覆盖映射
├── SCREENSHOTS.md            # 截图清单与 Playwright 说明
├── source/
│   ├── manifest.txt
│   ├── 01-阅读指南.md … 07-术语与索引.md
│   ├── assets/               # 手册截图
│   └── ch03/                 # 与白皮书第 3 章对照
└── output/                   # 生成物（gitignore）
```

## 生成 Word / HTML

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

- 界面改版时 **先改手册步骤**，再按需回写白皮书「实现」句。
- 新功能：白皮书写能力，手册写 **入口 + 步骤 + 注意**；更新 `COVERAGE.md`。
- 配图：`SCREENSHOTS.md` 登记 → `tests/manual/capture-*.browser.cjs` → 见 `tests/manual/README.md`。
- 写作细则见 `writing-style.md`。

## 完善路线图（摘要）

| 阶段 | 内容 |
|------|------|
| 0 | `COVERAGE` / `SCREENSHOTS` / 截图共享库（当前） |
| 1 | 修 `3-0` 索引、manifest 与白皮书缺口对齐 |
| 2 | 轮 1 加深：02 接入、3.2 创建向导、3.3 云盘、3.9 备份、`06` FAQ |
| 3 | 按 `SCREENSHOTS.md` 批量配图 |
