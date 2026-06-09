# 文档 Hub（`AGENTS.md` 子文档）

> **`AGENTS.md`** 为唯一入口（产品地图、强制约定摘要、API 索引）。  
> 本目录存放 **可提交** 的长文细则；新增专题文档优先落此处，并在 **`AGENTS.md` · 架构文档分工** 登记。

### 命名约定（Hub 内 `.md`）

- 格式：**`{主题}-{范围}.md`**，全小写 **kebab-case**（仅 `README.md` 例外）。
- **主题**取固定词表：`code-quality`、`frontend-layout`、`cloudmap-pool-rbac`、`maas-integration`、`remote-access-architecture`；新增文档须先归入或扩展词表，避免 `pr-`、`page-` 等缩写与冗词。
- 交叉引用写完整路径：`docs/frontend-layout.md` §5.2。

| 文档                                                                     | 说明                                                                                           |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| [contributing.md](./contributing.md)                                     | **贡献与合入前检查**：按改动路径跑命令、Prettier、PR 清单                                      |
| [ci.md](./ci.md)                                                         | **CI 与合入门禁**：Actions job、本地复现、Branch protection 勾选清单                           |
| [quality-improvement-plan.md](./quality-improvement-plan.md)             | **质量改进执行清单**：ESLint 清零、巨型文件拆分、bundle 与 E2E 分阶段计划                      |
| [code-quality.md](./code-quality.md)                                     | **代码质量**（§1～§9 合入清单；§10～§12 可选评分；五十条附录）                                 |
| [frontend-layout.md](./frontend-layout.md)                               | **前端布局**：壳层、三层容器、侧栏与 Tab；列表 **§5.1**、工具栏 **§5.2**（样板 **VmSection**） |
| [cloudmap-pool-rbac.md](./cloudmap-pool-rbac.md)                         | **Cloudmap 池 RBAC**：以页面为实体（入口 / 展示 / 操作）                                       |
| [maas-integration.md](./maas-integration.md)                             | **MAAS 对接**：北向 API、BFF/Adapter、v2/v3 约定                                               |
| [remote-access-architecture.md](./remote-access-architecture.md)         | **云桌面网关总体架构**：扁平网 + admin 体系、Cloudmap/MAAS、资源池接入；租户暂不涉及           |
| [integrate-guacamole.md](./integrate-guacamole.md)                       | **云桌面网关引擎**：Guacamole REST、admin 用户同步、Connection 赋权、client_url                |
| [hsm-device-profile-h3c-comware.md](./hsm-device-profile-h3c-comware.md) | **HSM 设备模板**：H3C Comware 专用 `h3c-comware-like`（JSON + 验收，交 HSM 实现）              |
| [tower-crd-security-group.md](./tower-crd-security-group.md)             | **Tower 底座 CRD**：安全组 `SecurityGroup`（部署集 CRD 暂缓，待功能定稿）                      |
| [cloudmap/README.md](./cloudmap/README.md)                               | **Cloudmap 文档总览**：白皮书 + 使用手册 + 招标参数、构建脚本与目录约定                         |
| [cloudmap/whitepaper/README.md](./cloudmap/whitepaper/README.md)         | **Cloudmap 技术白皮书**：Markdown 源稿、`manifest` 合并顺序、Pandoc 生成 Word                  |
| [cloudmap/user-manual/README.md](./cloudmap/user-manual/README.md)       | **Cloudmap 使用手册**：控制台操作步骤，章节与白皮书 3.x 对照（**可提交**）                     |
| [cloudmap/tender-parameters/README.md](./cloudmap/tender-parameters/README.md) | **Cloudmap 招标参数**：资源池技术参数、多云平台参数、报价表与竞品摘录（**可提交**）        |
| [multicloud/README.md](./multicloud/README.md)                           | **多云管理平台文档**：ComputerTower 多云管理（CNMC）产品线，与 Cloudmap 并列；复用 cloudmap 模板/脚本 |
| [multicloud/whitepaper/README.md](./multicloud/whitepaper/README.md)     | **多云管理平台技术白皮书**：统一纳管异构多云；`manifest` 合并顺序、`DOC_ROOT` 复用 Pandoc 构建      |

**源码旁文档**（不在此 Hub，但与 Hub 并列权威）：

| 文档                                                               | 说明                                                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `frontend/src/STRUCTURE.md`                                        | 前端目录与放置规则                                                        |
| `backend/src/STRUCTURE.md`                                         | 后端分层与落点                                                            |
| `frontend/.../Cloudmap/pool/README.md`                             | Cloudmap 池刷新样板（compute / cluster / storage / paas_databases / hsm） |
| `frontend/.../Harvester/{ecs,cluster,ebs,ceph,database}/README.md` | Harvester / Ceph 各业务域说明                                             |
| `frontend/.../maas/README.md`                                      | MAAS 池 Tab ↔ Section；对接规格见 **`maas-integration.md`**               |

**本地、不入库**：`deployment/`（见 `.gitignore`）。
