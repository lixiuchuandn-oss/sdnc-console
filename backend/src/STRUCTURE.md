# 后端目录结构（权威）

> **适用范围**：`backend/src/`。  
> **本文件是后端源码目录划分与文件放置规则的唯一权威说明**；Code Review 与新增代码以本文为准。  
> **技术栈、环境变量、对外 API 路径总览、WebSocket 路径** 与运行方式见仓库根目录 **`AGENTS.md`**（与本文互补，不重复维护两套「API 清单」）。  
> **产品/平台心智**（CNMC / SDNCC / CNSOC / SETTINGS）与前端路由归属对齐，见 **`frontend/src/STRUCTURE.md`** —— 后端以 **HTTP 路径与业务域** 映射到这些平台，不要求目录名与前端 `pages/` 逐段同构。

---

## 1. 目的与读者

- 统一「后端文件该放哪」的判定规则，降低评审成本与跨模块耦合。
- 约定 **路由层薄、服务层厚、实体与类型集中**，与现有 Express + TypeORM 代码风格一致。
- 与前端平台划分对齐，便于全栈对照（同一能力在前端 `pages/` 与后端 `routes/` 各有落点）。

**读者**：后端开发、Code Review、架构与交付负责人。

---

## 2. 术语

| 术语 | 含义 |
|------|------|
| **平台** | `CNMC` / `SDNCC` / `CNSOC` / `SETTINGS`，与前端 `RouteSpec.platform` 及 `frontend/src/STRUCTURE.md` 一致。 |
| **业务域** | 平台内可独立讲解的一块能力（如多云下的 Harvester、阿里云 SDN、租户树）。 |
| **路由模块** | `routes/` 下挂载到 Express 的 Router 或子应用，负责 HTTP 契约、参数校验入口、调用 service。 |
| **服务模块** | `services/` 下封装对外部系统（云 API、K8s、VR 等）与复杂业务规则，**可被多个路由复用**。 |
| **实体（Entity）** | TypeORM `entities/` 下与表结构对应的定义；可按域分子目录。 |
| **横切** | 与具体路由弱相关、多模块复用：`middleware/`、`permissions/`、`utils/`、`constants/`。 |

---

## 3. 设计原则

1. **分层清晰**：`routes` → `services` → `entities` /外部客户端；避免在路由文件内堆积长业务流程与 SDK 调用。
2. **多云对称**：按云厂商或控制面划分的逻辑，在 `routes/clouds/<厂商或 csm>/` 与 `services/clouds/<同一子目录>/` **成对出现**，便于定位。
3. **Harvester 可拆则拆**：新增长路由优先落在 `routes/clouds/harvester/handlers/*.handlers.ts`，由 `*.provider.ts` 或聚合路由装配，避免单文件无限膨胀。
4. **实体按持久化域归类**：与 Harvester / KubeVirt / Kube-OVN / 监控 / VR 等相关的表，放入 `entities/` 下对应子目录；**跨域共用的平台表**（如 `User`、`Cloud`）保留在 `entities/` 根级。
5. **横切集中**：认证、审计、错误处理、权限校验中间件在 `middleware/`；细粒度 API 权限在 `permissions/`。
6. **WebSocket 独立**：终端、VNC、Pod 日志等长连接放在 `ws/`，由 `index.ts` 挂载到 HTTP Server，**不混入普通 REST 文件**。
7. **URL 不与目录强制同构**：对外 path 以 `index.ts` 的 `app.use` 为准；目录名体现 **维护边界**，不必逐段对应 URL。
8. **迁移可渐进**：拆分大文件时优先 **git mv**；每步 `npm run build`或 `npx tsc --noEmit`（若配置）验收。

---

## 4. 命名规范

| 对象 | 约定 | 示例 |
|------|------|------|
| **目录（通用）** | 小写；多词可用 `kebab-case` | `harvester`、`kube-ovn`（若未来引入） |
| **目录（云厂商）** | 与产品/前端称谓一致 | `aliyun`、`huaweicloud`、`tencentcloud`、`csm`、`harvester` |
| **TypeScript 源文件** | `camelCase.ts` | `cloudSyncService.ts` |
| **Handler 聚合（Harvester）** | `*.handlers.ts` | `ecs-direct-lifecycle.handlers.ts` |
| **路由装配/提供者** | `*.routes.ts` / `*.provider.ts` | `harvester.direct.routes.provider.ts` |
| **实体文件** | `PascalCase.ts`（与类名一致） | `HarvesterVmInventory.ts` |

与 **`AGENTS.md`** 中「工具 camelCase」一致；实体类仍用 PascalCase。

---

## 5. 平台与路由落点映射（心智模型）

以下为 **产品归属对照**，便于与前端平台对齐；**具体 URL 前缀** 以 `src/index.ts` 为准（详见 `AGENTS.md`）。

| 平台 | 主要能力 | 典型后端落点 |
|------|----------|----------------|
| **CNMC** | 资源池、多云实例、Harvester/各云 API、仪表盘入口、租户（若业务属 CNMC） | `routes/clouds.ts`、`routes/clouds/**`、`routes/dashboard.ts`、`routes/tenants/` |
| **SDNCC** | SRv6、IPsec、ACL、NAT、VR配置、云企业网等 | `routes/sdn/**`、`routes/clouds.ts` 中与网络编排相关部分（若有） |
| **CNSOC** | 安全域、服务目录、流量编排、威胁事件等 | `routes/sdn/securityDomains.ts`、`routes/sdn/services.ts`、`routes/sdn/trafficOrchestration.ts`、`routes/aisoc/**` |
| **SETTINGS** | 系统用户、系统配置、审计日志、授权 | `routes/sysuser/`、`routes/system.ts`、`routes/auditLogs.ts`、`routes/tools/license.ts` |

**认证横切**：`routes/auth/**`（如登录、令牌、SASE 相关认证路由按实际挂载）。

---

## 6. `src/` 顶层目录树与职责

**与当前仓库一致的典型顶层**：

```
backend/src/
├── index.ts                 # 应用入口：Express、路由挂载、静态资源、WebSocket
├── STRUCTURE.md             # 本文件（权威）
├── config/                  # 数据库、运行时与系统设置等配置
├── constants/               # 权限常量、RBAC 内置角色等
├── entities/                # TypeORM 实体（根级 + 按域子目录）
├── middleware/              # 认证、审计、错误处理等
├── permissions/             # API 级权限校验（含子文档时可保留 README）
├── routes/                  # HTTP 路由（按业务与云厂商拆分）
├── scripts/                 # 运维/初始化脚本（dbInit、checkUser 等，非请求入口）
├── seeders/                 # 种子数据（管理员、角色等）
├── services/                # 业务服务与云 SDK 封装
├── utils/                   # 日志、报表存储等通用工具
└── ws/                      # WebSocket：SSH、VNC、KubeVirt 等
```

### `config/`

数据源（`AppDataSource`）、运行参数、与库相关的系统设置读取等。

### `entities/`

- **根级**：平台核心对象（如 `Cloud`、`User`、`AuditLog` 等，以仓库实际文件为准）。
- **子目录**：`harvester/`、`kubeovn/`、`kubevirt/`、`monitoring/`、`vRouter/`（与 `services/vrouter/` 大小写不一致，见 **第 10 节**）等，与持久化边界一致。

**注意**：`entities/monitoring/monitoring/` 等为历史嵌套路径，新增实体优先放在语义清晰的一层目录，避免再加深无意义层级。

### `routes/`

- **聚合路由**：如 `clouds.ts`（资源池与统一云能力，体量较大时可按主题渐进拆分）。
- **子目录**：`auth/`、`clouds/<厂商>/`、`sdn/`、`aisoc/`、`sysuser/`、`tenants/`、`tools/` 等。

**`routes/clouds/harvester/`**：

- `handlers/`：按主题拆分的处理模块（推荐新增默认落点）。
- `*.provider.ts` / `*.routes.ts`：装配与注册。

**`routes/clouds/middleware/`**：仅 clouds 子树使用的路由级中间件，与顶层 `middleware/` 区分。

### `services/`

- **`services/clouds/<厂商>/`**：与各云 `routes/clouds/<厂商>/` 对应。
- **`services/vrouter/`**：虚拟路由器控制面等（与 `entities/vRouter/` 目录名不一致，统一方案见 **第 10 节**）。
- **`services/hms/`** 等：独立子系统客户端或业务封装。

**原则**：可复用的云调用、批量同步、重试与领域规则放在 service，路由只做编排与响应映射。

### `middleware/`、`permissions/`

全局或大范围 API 使用的请求预处理与权限模型；具体 API 的细粒度检查见 `permissions/` 与路由内组合方式。

### `utils/`

与业务弱耦合的纯工具、日志子模块、文件与报表辅助等。

### `ws/`

与 HTTP 分离的长连接实现；升级与路径约定见 `AGENTS.md`。

### `scripts/`、`seeders/`

- **scripts**：一次性或运维向 TypeScript 入口（如 `dbInit.ts`），通过 `package.json` 的 `npm run db:*` 调用；**不作为** Express 路由模块。
- **seeders**：启动或迁移时初始化数据。

---

## 7.放置判定表与反模式

| 情况 | 放置位置 |
|------|----------|
| 新增 REST 路由，属某公有云/Harvester/CSM | `routes/clouds/<对应目录>/`，必要时拆 `handlers/` |
| 同一云内多处路由复用的 SDK 封装 | `services/clouds/<对应目录>/` |
| 新数据库表 | `entities/` 根级或对应域子目录，并纳入 `AppDataSource` |
| 登录、鉴权、审计 | `routes/auth/`、`middleware/auth`、`middleware/audit` |
|全 API 可复用的校验函数 | `utils/` 或 `permissions/`（视是否属权限模型而定） |
| WebSocket | `ws/` |

**反模式**：

- 在 `routes/**/*.ts` 内直接写大量 TypeORM 复杂查询与云 SDK 细节，不抽到 service。
- 为图省事把某云专用逻辑写到 `routes/clouds.ts` 顶层文件，继续增大「上帝文件」。
- 把可执行脚本逻辑混进路由文件，导致 `import` 副作用与启动路径耦合。
- 在 `entities/` 下引入对 `routes/` 的反向依赖（应保持向内依赖：routes → services → entities）。

---

## 8. 与 `index.ts` 的关系

HTTP 前缀、是否挂载 `authMiddleware`、静态资源与 SPA 回退、WebSocket 绑定均在 **`index.ts`** 中体现。  
**新增对外 API 时**：先确认挂载点与鉴权策略，再实现路由模块；**不要将未挂载的 Router 留在孤立文件中**。

---

## 9. 迁移阶段与验收（渐进）

| 阶段 | 内容 | 验收 |
|------|------|------|
| 0 | 团队以本文 + `AGENTS.md` 为约定；新代码按分层与目录规则落位 | Review |
| 1 | 大文件（如 `routes/clouds.ts`）按主题拆出子模块，入口 re-export 或改挂载 | `npm run build` / `tsc` |

优先 **`git mv`**；Windows 上目录大小写重命名用两步 `git mv` 或团队约定流程。

**收敛自检（持续）**：

- [ ] 新增多云逻辑已同时考虑 `routes/clouds/...` 与 `services/clouds/...` 对称位置。
- [ ] Harvester 新接口优先落在 `handlers/`，避免单 PR 膨胀巨型文件。
- [ ] `npm run build` 通过；关键路径有手工或自动化回归。

---

## 10. 待统一事项（记录，延后实施）

以下已知问题**暂不改动代码**，仅作文档备案；排期实施时在 PR 中勾选并更新本文。

| 项 | 现状 | 为何要紧 | 建议动作（实施时） |
|------|------|-----------|-------------------|
| **VR 相关目录大小写** | 实体在 `entities/vRouter/`，服务在 `services/vrouter/` | 非单一文件：两侧目录名不一致，import 路径混用；在**大小写敏感**环境（如 Linux CI）下重命名或复制仓库时易产生「找不到模块」类问题 | 团队选定一种**目录**命名（与第 4 节「目录小写」一致时，宜统一为 `entities/vrouter/`）。对实体目录做 **`git mv`（Windows 上涉及仅大小写变更时用两步 `git mv`）**，再全局替换 `entities/vRouter` → `entities/vrouter` 的 import。**不要**改动各云 API 路径、JSON 字段里的 `vrouter` 等业务字符串 |

---

## 11. 本地开发命令

在仓库根目录进入 `backend/` 后（Windows 下脚本以仓库内 `package.json` 为准）：

```bash
cd backend
npm install
npm run dev      # 开发；默认端口等见 AGENTS.md
npm run build
npm run start
npm test
```

数据库初始化等见 `package.json` 中 `db:*` 脚本。

---

## 12. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-04-13 | 初版：对齐 `frontend/src/STRUCTURE.md` 体裁，定义 `backend/src` 权威结构与平台映射 |
| 2026-04-13 | 删除已废弃的 `routes/clouds/harvester/old/`（逻辑已由 `handlers/` + provider 承接；此前未纳入 `tsc` 编译） |
| 2026-04-13 | 新增「待统一事项」：`entities/vRouter` 与 `services/vrouter` 目录大小写备案，延后统一 |
