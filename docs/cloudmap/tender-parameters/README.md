# Cloudmap · 招标参数（Markdown 源稿）

本目录维护 **采购标书 / 验收** 相关的技术参数与报价表源稿；竞品摘录放在 `source/references/`，供对标参考，默认不并入外发 Word。

## 源稿目录

```
tender-parameters/
├── README.md
├── source/
│   ├── manifest.txt              # 主文档合并顺序
│   ├── 00-编写说明.md
│   ├── 01-cloudmap-资源池-招标技术参数.md
│   ├── 02-多算力池统一管理-招标参数.md
│   ├── 03-虚拟化场景-多云管理平台报价表.md
│   └── references/               # 竞品摘录（安超云、华三 HCI 等）
└── output/                       # 生成物（gitignore）
```

## 生成 Word

版式与使用手册一致（`templates/reference.docx`）。在 **`docs/cloudmap`** 目录执行：

```powershell
.\scripts\build-docx.ps1 -Variant tender
.\scripts\build-docx.ps1 -Variant tender -CopyToDeployment
```

```bash
VARIANT=tender ./scripts/build-docx.sh
```

输出：`output/cloudmap-tender-parameters.docx`；加 `-CopyToDeployment` 时同步 `deployment/Cloudmap_tender_parameters.docx`。

## 维护说明

- **主交付物**优先改 `01-cloudmap-资源池-招标技术参数.md`；多云平台、报价表为独立章节，可按项目裁剪 manifest。
- 研发向 RBAC/路由规范 **不属于** 招标口径，仍放 `deployment/docs/specs/cloudmap-pool-page-rbac.md`（本地，不入库）。
- 从 `deployment/docs/specs/` 迁入本工程的一次性脚本：`scripts/_migrate-tender-specs.py`（已执行可删）。

## 相关文档

| 文档 | 路径 |
|------|------|
| 技术白皮书 | `../whitepaper/` |
| 使用手册 | `../user-manual/` |
| Hub 总览 | `../README.md` |
