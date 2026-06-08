# Cloudmap 文档（技术白皮书 + 使用手册）

> **Markdown 源稿**在本目录；Word / HTML 由 Pandoc 脚本生成，勿手改 `output/` 后再反向当源稿。

## 目录结构

```
docs/cloudmap/
├── README.md
├── whitepaper/
├── user-manual/
├── scripts/
└── templates/
```

## Word 版式（使用手册）

构建前自动执行 `scripts/prepare-reference-docx.ps1`，套用 `templates/reference.docx`：微软雅黑蓝色标题、宋体正文 1.5 倍行距、章前分页；Lua 过滤器见 `templates/filters/`。

## 生成 Word

```powershell
cd docs/cloudmap
.\scripts\build-docx.ps1 -Variant manual
.\scripts\build-docx.ps1 -Variant whitepaper
```

详见 [whitepaper/README.md](./whitepaper/README.md) 与 [user-manual/README.md](./user-manual/README.md)。
