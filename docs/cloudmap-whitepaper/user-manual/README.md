# Cloudmap 超融合平台 · 使用手册（Markdown 源稿）

> **可维护源稿**在 `user-manual/source/`；Word 由脚本生成。能力背景见同目录上一级的 [技术白皮书](../README.md)。

## 与白皮书的关系

| 文档         | 路径                  | 读者                   | 内容             |
| ------------ | --------------------- | ---------------------- | ---------------- |
| 技术白皮书   | `source/`             | 采购、架构、项目负责人 | 能力、架构、价值 |
| **使用手册** | `user-manual/source/` | 运维、租户管理员       | 控制台操作步骤   |

章节 **3.x 节号与白皮书对齐**，正文写操作路径；原理与部署形态请查阅白皮书对应小节。

## 目录结构

```
user-manual/
├── README.md                 # 本文件
├── writing-style.md          # 手册写作约束
├── COVERAGE.md               # 白皮书 ↔ 手册覆盖映射
├── SCREENSHOTS.md            # 截图清单与 Playwright 重跑说明
├── source/
│   ├── manifest.txt          # 合并顺序
│   ├── 01-阅读指南.md
│   ├── 02-控制台导航与资源池.md
│   ├── assets/               # 手册截图（Pandoc 相对路径引用）
│   └── ch03/                 # 与白皮书第 3 章对照
└── output/                   # 生成物（gitignore）

tests/manual/                 # 手册截图脚本（按章扩展）
tests/shared/manual-screenshot.cjs
```

## 生成 Word

需安装 [Pandoc](https://pandoc.org/)。在 `docs/cloudmap-whitepaper` 目录执行：

```powershell
# 仅使用手册
.\scripts\build-docx.ps1 -Variant manual -CopyToDeployment

# 白皮书 + 使用手册
.\scripts\build-docx.ps1 -Variant whitepaper -CopyToDeployment
.\scripts\build-docx.ps1 -Variant manual -CopyToDeployment
```

```bash
VARIANT=manual COPY_TO_DEPLOYMENT=1 ./scripts/build-docx.sh
```

输出：

- `user-manual/output/cloudmap-user-manual.docx`
- 加 `-CopyToDeployment` 时同步 `deployment/Cloudmap_user_manual.docx`

## HTML 预览

```powershell
.\scripts\build-html.ps1 -Variant manual -Open
```

## 维护建议

- 界面改版时 **先改手册步骤**，再按需回写白皮书「实现」句。
- 新功能合入：白皮书写能力，手册写 **入口 + 步骤 + 注意**；更新 `COVERAGE.md` 状态。
- 需要配图时：在 `SCREENSHOTS.md` 登记 → 增加 `tests/manual/capture-*.browser.cjs` → `npm run manual:shots:*`（见 `tests/manual/README.md`）。
- 写作细则见 `writing-style.md`。

## 完善路线图（摘要）

| 阶段 | 内容                                                           |
| ---- | -------------------------------------------------------------- |
| 0    | `COVERAGE` / `SCREENSHOTS` / 截图共享库（当前）                |
| 1    | 修 `3-0` 索引、manifest 与白皮书缺口对齐                       |
| 2    | 轮 1 加深：02 接入、3.2 创建向导、3.3 云盘、3.9 备份、`06` FAQ |
| 3    | 按 `SCREENSHOTS.md` 批量配图                                   |
