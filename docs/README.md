# 文档 Hub（`AGENTS.md` 子文档）

> **`AGENTS.md`** 为唯一入口（产品地图、强制约定摘要、API 索引）。  
> 本目录存放 **可提交** 的长文细则；新增专题文档优先落此处，并在 **`AGENTS.md` · 架构文档分工** 登记。

### 命名约定（Hub 内 `.md`）

- 格式：**`{主题}-{范围}.md`**，全小写 **kebab-case**（仅 `README.md` 例外）。
- **主题**取固定词表：`code-quality`、`frontend-layout`、`cloudmap-pool-rbac`、`maas-integration`、`remote-access-architecture`；新增文档须先归入或扩展词表，避免 `pr-`、`page-` 等缩写与冗词。
- 交叉引用写完整路径：`docs/frontend-layout.md` §5.2。

| 文档 | 说明 |
|------|------|
| [ci.md](./ci.md) | **CI 与合入门禁**：Actions job、本地复现、Branch protection 勾选清单 |
| [code-quality.md](./code-quality.md) | **代码质量**（§1～§9 合入清单；§10～§12 可选评分；五十条附录） |
| [frontend-layout.md](./frontend-layout.md) | **前端布局**：壳层、三层容器、侧栏与 Tab；列表 **§5.1**、工具栏 **§5.2**（样板 **VmSection**） |
| [cloudmap-pool-rbac.md](./cloudmap-pool-rbac.md) | **Cloudmap 池 RBAC**：以页面为实体（入口 / 展示 / 操作） |
| [maas-integration.md](./maas-integration.md) | **MAAS 对接**：北向 API、BFF/Adapter、v2/v3 约定 |
| [remote-access-architecture.md](./remote-access-architecture.md) | **云桌面网关总体架构**：扁平网 + admin 体系、Cloudmap/MAAS、资源池接入；租户暂不涉及 |
| [integrate-guacamole.md](./integrate-guacamole.md) | **云桌面网关引擎**：Guacamole REST、admin 用户同步、Connection 赋权、client_url |

**源码旁文档**（不在此 Hub，但与 Hub 并列权威）：

| 文档 | 说明 |
|------|------|
| `frontend/src/STRUCTURE.md` | 前端目录与放置规则 |
| `backend/src/STRUCTURE.md` | 后端分层与落点 |
| `frontend/.../Cloudmap/pool/README.md` | Cloudmap 池刷新样板（compute / cluster / storage / paas_databases / hsm） |
| `frontend/.../Harvester/{ecs,cluster,ebs,ceph,database}/README.md` | Harvester / Ceph 各业务域说明 |
| `frontend/.../maas/README.md` | MAAS 池 Tab ↔ Section；对接规格见 **`maas-integration.md`** |

**本地、不入库**：`deployment/`（见 `.gitignore`）。
