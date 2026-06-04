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
├── source/
│   ├── manifest.txt          # 合并顺序
│   ├── 01-阅读指南.md
│   ├── 02-控制台导航与资源池.md
│   └── ch03/                 # 与白皮书第 3 章对照
└── output/                   # 生成物（gitignore）
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
- 新功能合入：白皮书写能力，手册写 **入口 + 步骤 + 注意**。
- 写作细则见 `writing-style.md`。
