# Cloudmap 文档（技术白皮书 + 使用手册 + 招标参数）

> **Markdown 源稿**在本目录；Word / HTML 由 Pandoc 脚本生成，勿手改 `output/` 后再反向当源稿。

## 目录结构

```
docs/cloudmap/
├── README.md
├── whitepaper/
├── user-manual/
├── tender-parameters/     # 招标技术参数、报价表、竞品摘录
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
.\scripts\build-docx.ps1 -Variant tender
```

详见 [whitepaper/README.md](./whitepaper/README.md)、[user-manual/README.md](./user-manual/README.md) 与 [tender-parameters/README.md](./tender-parameters/README.md)。
