# Compute Tower - 多云管理平台

## 项目概述

Compute Tower 是一个企业级多云管理平台，提供统一的云资源管理、SDN网络编排、安全运营和AI SOC能力。

### 核心能力

- **多云管理 (CNMC)**： 支持阿里云、华为云、腾讯云、Harvester(KubeVirt) 等多云资源的统一管理
- **租户管理 (TENANTS)**： 租户、组织、租户用户等与 CNMC **平级**的独立产品线（前端导航与 `RouteSpec.platform` 已单独切分）
- **容器管理**： 工作负载、Pod、任务、服务发现、镜像仓库、配置管理、高级调度策略等容器资源管理
- **SDN管理 (SDNCC)**： SRv6隧道、IPsec VPN、ACL、NAT、虚拟路由器等网络编排能力
- **AI SOC中心 (CNSOC)**： 安全运营、威胁分析、报告管理等安全能力
- **系统设置 (SETTINGS)**： 系统用户、RBAC 角色与权限、审计日志、系统配置与授权等（与租户管理产品线区分）

## 技术栈

### 后端
- **运行时**： Node.js 18+ + TypeScript 5.x
- **框架**： Express 4.x
- **数据库**： SQLite (TypeORM 0.3.x)
- **认证**： JWT + bcryptjs
- **WebSocket**： ws 8.x (SSH/VNC/KubeVirt)
- **云SDK**： 阿里云SDK、华为云SDK、腾讯云SDK

### 前端
- **框架**： React 18 + TypeScript 4.9
- **UI组件**： Ant Design 5.x
- **路由**： React Router 6
- **图表**： ECharts 5.x
- **终端**： xterm.js 5.x
- **远程控制**： noVNC 1.6.0
- **代码编辑**： CodeMirror 6 (@uiw/react-codemirror)
- **目录结构**： **`frontend/src/STRUCTURE.md`**（前端目录与放置规则唯一权威）；**`frontend/README.md`** 仅为 `frontend/` 包入口（运行命令）；Harvester 云详情子树见 `deployment/docs/specs/修改纪要_Harvester前端目录结构_域优先与shared.md`

## 架构文档分工

| 文档 | 职责 |
|------|------|
| **`AGENTS.md`**（本文件） | 项目总览、**文档导读**、技术栈、环境与运行、**平台模块**索引、**平台发布版本管理约定**、**对外 HTTP / WebSocket 路径**、Harvester 云详情前端落位、开发与质量约定 |
| **`frontend/src/STRUCTURE.md`** | 前端 `frontend/src/` 的目录划分、**平台（CNMC / TENANTS / SDNCC / CNSOC / SETTINGS）与 `pages/` 映射**、`sections` / `drawers` / `modals` / `shared` 等放置规则的唯一权威 |
| **`backend/src/STRUCTURE.md`** | 后端 `backend/src/` 的分层与落点、**路由 ↔ 服务 ↔ 实体** 约定、与前端平台的心智对照；**API 清单不重复维护**（以本文件为准） |
| **`deployment/docs/specs/...`** | Harvester 前端子树、权限、API 规格等专题文档 |

新增或搬迁源码时：**前端**以 `frontend/src/STRUCTURE.md` 为准，**后端**以 `backend/src/STRUCTURE.md` 为准；对外路径以 `backend/src/index.ts` 的挂载为准。

## 文档导读

本文件按 **产品地图 → 运行与仓库树 → 发版与对外契约 → 专题落位 → 研发规范 → 认证与后台** 组织；长文查阅可先对照下表。

| 推荐阅读顺序 | 章节 | 说明 |
|-------------|------|------|
| 1 | **项目概述**、**技术栈**、**架构文档分工**、**平台模块** | 能力边界、文档权威、平台与源码归属 |
| 2 | **构建与运行**、**项目结构** | 本地启动与环境变量，再对照仓库树 |
| 3 | **版本管理（平台发布版本）** | 平台 `version`、离线包与发版约定 |
| 4 | **API 规范** | HTTP / WebSocket 路径索引 |
| 5 | **Harvester 云详情 · 前端落位** | 多云 Harvester 详情 Tab ↔ `Harvester/` 下 Section |
| 6 | **开发规范** | 落位、请求与缓存、数据展示与刷新、页面容器、表格版式、API 对接、前端质量工具 |
| 7 | **认证与权限**、**后台服务**、**注意事项** | 角色与 Token、后台定时任务、运维提示 |

## 平台模块

| 平台 | 代码 | 说明 |
|------|------|------|
| 多云管理 | CNMC | 资源池、多云实例、云主机/网络、控制台、**云数据库**（Cloudmap 资源池 VM，源码在 `pages/cnmc/clouds/Harvester/cloud-database/`） |
| 租户管理 | TENANTS | 租户、组织、租户用户等；与 CNMC **平级**的独立平台（`RouteSpec.platform` / 顶栏导航）；页面源码过渡期在 `pages/cnmc/tenants/` |
| 容器管理 | CONTAINER | 工作负载、Pod、任务、服务发现、镜像仓库、配置管理、高级调度策略 |
| SDN 管理 | SDNCC | SRv6、IPsec、ACL、NAT、VR |
| AI SOC 中心 | CNSOC | 安全运营、威胁分析、报告 |
| 系统设置 | SETTINGS | 用户、系统配置、授权、审计；页面规范落位 `pages/settings/`（与 `RouteSpec.platform` 一致，见 `frontend/src/STRUCTURE.md`） |

## 构建与运行

### 环境要求
- Node.js 18+
- npm 或 yarn

### 后端

```bash
cd backend
npm install
npm run dev      # 开发模式 (端口 5001)
npm run build    # 编译
npm run start    # 生产模式
npm run test     # 运行测试
```

### 前端

```bash
cd frontend
npm install
npm run start    # 开发模式 (端口 5000)
npm run build    # 生产构建
npm run test     # 运行测试
```

### 环境变量

**后端**：
- `PORT`: 服务端口 (默认 5001)
- `JWT_SECRET`: JWT 密钥
- `DB_PATH`: SQLite 数据库路径
- `NODE_ENV`: 环境标识 (development/production)

**前端**：
- `REACT_APP_API_URL`: 后端 API 地址
- `HOST`: 监听地址
- `PORT`: 服务端口

## 项目结构

```
Compute.Tower/
├── backend/                    # 后端服务
│   ├── src/
│   │   ├── index.ts           # 服务入口（Express 挂载、静态资源、WebSocket）
│   │   ├── STRUCTURE.md       # 后端目录权威（见上文「架构文档分工」）
│   │   ├── config/            # 配置（数据库、运行时参数、系统设置）
│   │   ├── constants/         # 权限常量、内置角色等
│   │   ├── entities/          # TypeORM 实体定义
│   │   │   ├── harvester/     # Harvester/KubeVirt 相关实体
│   │   │   ├── kubeovn/       # KubeOVN 网络实体
│   │   │   ├── kubevirt/      # KubeVirt 虚拟化实体
│   │   │   ├── monitoring/    # 监控相关实体
│   │   │   ├── vRouter/       # 虚拟路由器实体（与 services/vrouter/ 大小写差异见 backend/src/STRUCTURE.md）
│   │   │   └── *.ts           # 业务实体（云、租户、用户等，根级平台表）
│   │   ├── middleware/        # 中间件（认证、审计、错误处理）
│   │   ├── permissions/       # API 级权限注册与校验
│   │   ├── routes/            # HTTP 路由（薄；复杂逻辑下沉 services）
│   │   │   ├── clouds.ts      # 多云聚合入口（体量大时可按主题渐进拆分）
│   │   │   ├── aisoc/         # AI SOC 路由
│   │   │   ├── auth/          # 认证路由
│   │   │   ├── clouds/        # 按云厂商 /控制面拆分
│   │   │   │   ├── aliyun/    # 阿里云
│   │   │   │   ├── harvester/ # Harvester/KubeVirt（handlers/ + *.provider.ts / *.routes.ts 装配）
│   │   │   │   │   ├── handlers/              # 按主题拆分（新增接口优先落此）
│   │   │   │   │   ├── harvester.cache.*.routes.ts    # 缓存路由（集群、容器、网络、存储等）
│   │   │   │   │   ├── harvester.direct.*.routes.ts   # 直接路由（网络、存储、VM 等）
│   │   │   │   │   ├── logging.routes.ts              # 日志路由
│   │   │   │   │   └── monitoring.routes.ts           # 监控路由
│   │   │   │   ├── huaweicloud/ # 华为云
│   │   │   │   ├── tencentcloud/ # 腾讯云
│   │   │   │   ├── csm/       # CSM 控制面
│   │   │   │   └── middleware/ # 仅 clouds 子树使用的路由中间件
│   │   │   ├── sdn/           # SDN 网络路由
│   │   │   ├── sysuser/       # 系统用户路由
│   │   │   ├── tenants/       # 租户路由
│   │   │   └── tools/         # 工具路由（如授权）
│   │   ├── services/          # 业务服务层（与 routes/clouds/<厂商>/ 对称）
│   │   │   ├── clouds/        # 各云 SDK 与领域逻辑
│   │   │   ├── vrouter/       # 虚拟路由器服务
│   │   │   ├── hms/           # 等独立子系统客户端（以仓库为准）
│   │   │   ├── CloudSyncService.ts    # 云资源同步服务
│   │   │   ├── LicenseService.ts      # 授权服务
│   │   │   └── StandardResourceService.ts # 标准资源服务
│   │   ├── scripts/           # 运维/初始化脚本（非 HTTP 入口，见 package.json db:* 等）
│   │   ├── seeders/           # 数据库种子数据
│   │   ├── utils/             # 工具函数
│   │   └── ws/                # WebSocket 服务
│   │       ├── ssh.ts         # WebSSH 终端
│   │       ├── vnc.ts         # WebVNC 远程控制
│   │       ├── kvVnc.ts       # KubeVirt VNC
│   │       ├── kvPodLog.ts    # KubeVirt Pod 日志
│   │       └── kvPodExec.ts   # KubeVirt Pod 终端
│   ├── public/                # 静态文件托管
│   ├── data/                  # 运行期数据（授权、系统设置等；须在 backend 目录启动服务，勿使用仓库根 `data/`）
│   └── package.json
├── frontend/                  # 前端应用
│   ├── src/
│   │   ├── App.tsx            # 应用入口
│   │   ├── index.tsx          # 入口文件
│   │   ├── global-new.css     # 全局样式
│   │   ├── setupProxy.js      # 开发环境代理配置
│   │   ├── setupTests.ts      # 测试 setup（勿因静态分析未引用而删除）
│   │   ├── STRUCTURE.md       # 前端目录权威（见上文「架构文档分工」）
│   │   ├── assets/            # 静态资源
│   │   ├── components/        # 公共组件（跨平台或弱业务复用）
│   │   │   ├── CodeEditor.tsx       # 代码编辑器（CodeMirror）
│   │   │   ├── YamlEditor.tsx       # YAML 编辑器
│   │   │   ├── PageContainer.tsx    # 列表页面容器
│   │   │   ├── PageDetailContainer.tsx  # 详情页容器
│   │   │   ├── PageDetailSection.tsx    # Tab 区块容器
│   │   │   └── ...
│   │   ├── constants/         # 常量定义（含导航、权限目录等）
│   │   ├── contexts/          # React Context
│   │   ├── hooks/             # 自定义 Hooks
│   │   ├── layouts/           # 布局组件
│   │   ├── pages/             # 按平台与业务域组织（细则见 frontend/src/STRUCTURE.md）
│   │   │   ├── auth/          # 登录
│   │   │   ├── coming-soon/   # 占位页等（可选）
│   │   │   ├── cnmc/          # CNMC：资源总览、资源池、多云、控制台、PaaS 等（租户管理产品线见 TENANTS）
│   │   │   │   ├── dashboard/ # 资源总览
│   │   │   │   ├── pools/     # 资源池列表、选云闸门、实例详情入口等
│   │   │   │   ├── clouds/    # 各云厂商与 Cloudmap
│   │   │   │   │   ├── Aliyun/
│   │   │   │   │   ├── Hw/
│   │   │   │   │   ├── Csm/
│   │   │   │   │   ├── Cloudmap/
│   │   │   │   │   └── Harvester/     # Harvester/KubeVirt（域优先；细则见 deployment/docs 修改纪要）
│   │   │   │   │       ├── containers/    # K8s 容器：sections + components（表单、拓扑等）
│   │   │   │   │       ├── cluster/       # 集群、节点、Service、存储类等
│   │   │   │   │       ├── ecs/           # 计算、镜像、模板、回收站、VM 弹窗向导
│   │   │   │   │       ├── ebs/           # 卷、快照
│   │   │   │   │       ├── cbr/           # 备份与计划任务
│   │   │   │   │       ├── nad/           # NAD、负载均衡、IP 池
│   │   │   │   │       ├── kube-ovn/      # VPC、子网、EIP/FIP、安全组等
│   │   │   │   │       ├── hsm/           # Tower HSM：Cloudmap 资源总览（机房拓扑、网络拓扑）；拓扑图与样式见 `hsm/lib/networkTopology/`
│   │   │   │   │       ├── shared/components/  # 跨域详情抽屉与 Tab
│   │   │   │   │       ├── monitoring/    # 监控与日志
│   │   │   │   │       └── cloud-database/  # 云数据库（Cloudmap 资源池 VM；与侧栏 paas_databases 对应）
│   │   │   │   ├── console/
│   │   │   │   ├── tenants/   # 租户管理：平台 TENANTS（与 CNMC 平级）；源码暂放 cnmc 下（过渡期）
│   │   │   ├── sdncc/         # SDN 管理
│   │   │   ├── cnsoc/         # 安全运营等
│   │   │   └── settings/      # SETTINGS：规范目标目录名；存量可能仍为 Settings/（迁移见 STRUCTURE.md）
│   │   ├── routes/            # RouteSpec、路由装配（platform 与页面归属一致）
│   │   ├── services/          # API 服务层
│   │   │   ├── harvesterApi.ts    # Harvester API 服务
│   │   │   └── ...
│   │   ├── types/             # TypeScript 类型定义
│   │   └── utils/             # 工具函数
│   ├── patches/               # npm 包补丁
│   └── package.json
├── deployment/docs/           # 设计/规范/API 说明（含 Harvester、权限、UI 规格等；根目录已无独立 `docs/`）
├── tools/                     # 外部工具
│   └── harvester-uploader/    # Harvester 上传工具
```

## 版本管理（平台发布版本）

本节约定 **Compute Tower 平台自身**（前后端一体交付）的版本号口径，与 **License / 商业功能授权** 无关。

### 「当前软件版本」从哪里来

- **系统设置 → 离线升级** 页展示的「当前软件版本」，来自 **`GET /api/system/offline-upgrade/status`** 响应中的 **`runtimeVersion`**。
- **实现**：`backend/src/services/OfflineUpgradeService.ts` 的 `getStatus()` 从运行进程可访问的目录向上查找 **`backend/package.json`**（`name === "compute-tower-backend"`），读取其 **`version`** 字段；缺失时返回字符串 **`unknown`**。
- **含义**：表示**当前部署目录中后端 npm 包的 `version`**，与磁盘上的 `backend/package.json` 一致；**不是** License 载荷中的产品标识，**不是**数据库内单独维护的市场版本表；**不**读取 `frontend/package.json`（若仅前端构建与后端 `version` 未对齐，该字段无法反映前端包版本）。

### 权威版本号（研发约定）

1. **唯一权威**：平台对外发布、运维工单、管理界面「当前软件版本」对齐的 **SemVer**，以 **`backend/package.json` → `version`** 为准。
2. **粒度**：主版本长期固定为 `x.0.0`、从不递增 **PATCH** 会显得版本号「过粗」、无法与迭代节奏对齐；**默认可交付单元**应以 **PATCH**（`x.y.Z`）体现小步发版；需要区分**同 PATCH 下多次构建**时，可采用 SemVer **build metadata**（形如 `1.0.1+20260429` 或 `1.0.1+build.42`，`+` 后不参与 npm 依赖比较，仅供运维/流水线识别，展示上仍可读 `package.json` 全串）。
3. **前端同步**：**`frontend/package.json` → `version`** 应与后端 **同级版本号保持一致**（同一发版单元）；发版或打离线包前**同时修改**两处，避免「界面显示 1.2.0、前端包实为 1.1.9」类歧义。
4. **离线包 `manifest.json` 的 `version`**（见 `deployment/docs/specs/offline-upgrade-bundle.md`）：仅作**包内标注**并写入升级记录；**不会**自动回写 `package.json`。若希望升级后展示号与包内标注一致，应在构建离线包时让 `server/` 内已包含更新后的 `package.json`（或发版流程显式 bump 后再打包）。

### 发版与 bump 建议

- 采用 **SemVer** `MAJOR.MINOR.PATCH`：破坏性 API/行为 → MAJOR；向下兼容功能 → MINOR；修复与补丁 → PATCH。
- **正式发布**：更新 `backend/package.json` 与 `frontend/package.json` 的 `version`，提交后打 Git 标签（如 `v1.2.3` 与 version 对齐），再构建前端产物与后端 `dist/` 并组离线 zip。
- **仅替换静态资源**：可只发前端 `public/`；若后端逻辑未变，可不 bump 后端 `version`——为减少认知成本，仍建议前后端 **PATCH** 同步 bump。

### 实现与文档索引

- 读版本：`OfflineUpgradeService.getStatus()`（`backend/src/services/OfflineUpgradeService.ts`）
- 状态路由：`GET /api/system/offline-upgrade/status`（`backend/src/routes/system.ts`）
- 离线包目录约定：`deployment/docs/specs/offline-upgrade-bundle.md`

## API 规范

### 路由前缀

**认证与用户**：
- `/api/auth`: 认证相关（登录、登出、令牌校验）
- `/api/users`: 系统用户管理
- `/api/tenants`: 租户管理

**云资源管理**：
- `/api/clouds`: 云资源管理（统一入口）
- `/api/clouds/aliyun/*`: 阿里云资源
- `/api/clouds/huawei/*`: 华为云资源
- `/api/clouds/harvester/*`: Harvester/KubeVirt 资源
- `/api/clouds/{id}/monitoring/storage-nodes`: Longhorn 节点（Steve `longhorn.io.nodes`，Cloudmap「分布式存储」）
- `/api/clouds/{id}/monitoring/ceph-clusters`: Rook `CephCluster` 列表（Steve 优先 `cephclusters.ceph.rook.io`，回退 `ceph.rook.io.cephclusters`；Cloudmap「Ceph 存储」）
- `/api/clouds/{id}/monitoring/ceph-resources`: Rook Ceph 聚合（`CephCluster`、`CephBlockPool`、`CephFilesystem`、`CephObjectStore` 四类 Steve 列表）

**Harvester 容器管理**：
- `/api/clouds/{id}/resources/harvester/containers/workloads`: 工作负载
- `/api/clouds/{id}/resources/harvester/containers/pods`: Pod 管理
- `/api/clouds/{id}/resources/harvester/containers/jobs`: Job 管理
- `/api/clouds/{id}/resources/harvester/containers/cronjobs`: CronJob 管理
- `/api/clouds/{id}/resources/harvester/containers/services`: Service 管理
- `/api/clouds/{id}/resources/harvester/containers/ingresses`: Ingress 管理
- `/api/clouds/{id}/resources/harvester/containers/gateways`: Gateway 管理
- `/api/clouds/{id}/resources/harvester/containers/httproutes`: HTTPRoute 管理
- `/api/clouds/{id}/resources/harvester/containers/grpcroutes`: GRPCRoute 管理
- `/api/clouds/{id}/resources/harvester/containers/registries`: 镜像仓库
- `/api/clouds/{id}/resources/harvester/containers/configmaps`: ConfigMap 管理
- `/api/clouds/{id}/resources/harvester/containers/secrets`: Secret 管理
- `/api/clouds/{id}/resources/harvester/containers/pdbs`: PodDisruptionBudget 管理

**SDN 网络**：
- `/api/networks/srv6`: SRv6 隧道
- `/api/networks/ipsec`: IPsec VPN
- `/api/networks/acl`: ACL 规则
- `/api/networks/acl-groups`: ACL 分组
- `/api/networks/nat`: NAT 规则
- `/api/vr-config`: 虚拟路由器配置
- `/api/vr-cache`: VR 设备缓存（无需登录）

**安全与 AISOC**：
- `/api/security-domains`: 安全域管理
- `/api/services`: 服务目录
- `/api/security/traffic`: 流量编排
- `/api/threats`: 威胁事件

**系统**：
- `/api/system`: 系统配置
- `/api/system/license`: 授权管理
- `/api/system/offline-upgrade/status`、`/api/system/offline-upgrade/apply`：离线升级（zip）；**包结构与构建约定**见 `deployment/docs/specs/offline-upgrade-bundle.md`
- `/api/audit-logs`: 审计日志
- `/api/dashboard`: 仪表盘数据

### WebSocket 路径
- `/ws/ssh`: WebSSH 终端
- `/ws/vnc`: WebVNC 远程控制
- `/ws/kv-vnc`: KubeVirt VNC
- `/ws/kv-pod-log`: KubeVirt Pod 日志
- `/ws/kv-pod-exec`: KubeVirt Pod 终端

## Harvester 云详情 · 前端落位

Harvester 多云实例详情按 Tab 拆分；源码根目录为 `frontend/src/pages/cnmc/clouds/Harvester/`，目录与放置规则以 **`frontend/src/STRUCTURE.md`** 为准。下表统一按 **「详情 Tab 列表入口（Section）→ 相对路径 → 职责摘要」** 索引，不另维护「功能矩阵 + 组件清单」两套写法。

### 容器管理（Kubernetes）

| Section 组件 | 路径（相对 Harvester 根） | 功能 |
|-------------|---------------------------|------|
| `WorkloadsSection.tsx` | `containers/sections/` | 工作负载列表；Deployment/StatefulSet/DaemonSet 创建与编辑；高级调度（节点/Pod 亲和与反亲和、污点容忍等）在 `containers/components/WorkloadForm.tsx` |
| `PodsSection.tsx` | `containers/sections/` | Pod 列表；详情、日志、终端（`containers/components/PodLogViewer.tsx`、`PodTerminal.tsx`） |
| `JobsSection.tsx` | `containers/sections/` | Job / CronJob 列表与表单 |
| `ServicesSection.tsx` | `containers/sections/` | Service 列表；创建/编辑、YAML、关联 Pod |
| `ServiceTopologySection.tsx` | `containers/sections/` | Service 拓扑 |
| `IngressesSection.tsx` | `containers/sections/` | Ingress 列表与表单 |
| `GatewayApiSection.tsx` | `containers/sections/` | Gateway API（Gateway、HTTPRoute、GRPCRoute 等）列表与表单入口 |
| `ConfigsSection.tsx` | `containers/sections/` | ConfigMap / Secret 列表与表单 |
| `RegistriesSection.tsx` | `containers/sections/` | 镜像仓库列表；浏览与凭证 |
| `PDBSection.tsx` | `containers/sections/` | PodDisruptionBudget 列表与表单 |
| `NetworkPoliciesSection.tsx` | `containers/sections/` | NetworkPolicy 列表与表单 |

各 Tab 下的表单、弹窗、拓扑子件在 **`containers/components/`**（含 `YamlEditModal.tsx` 等）。全站复用的编辑基座在 **`frontend/src/components/`**（如 `CodeEditor.tsx`、`YamlEditor.tsx`）。

### 虚拟机与关联资源

| Section 组件 | 路径（相对 Harvester 根） | 功能 |
|-------------|---------------------------|------|
| `VmSection.tsx` | `ecs/sections/` | 虚拟机列表与管理 |
| `VolumesSection.tsx` | `ebs/sections/` | 卷管理 |
| `ImagesSection.tsx` | `ecs/sections/` | 镜像管理 |
| `BackupsSection.tsx` | `cbr/sections/` | 备份管理 |
| `SnapshotsSection.tsx` | `ebs/sections/` | 快照管理 |
| `NodesSection.tsx` | `cluster/sections/` | 节点管理 |
| `StorageClassesSection.tsx` | `cluster/sections/` | 存储类管理 |
| `IPPoolsSection.tsx` | `nad/sections/` | IP 池管理 |
| `NadsSection.tsx` | `nad/sections/` | 网络附件定义 |
| `SshKeysSection.tsx` | `ecs/sections/` | SSH 密钥管理 |
| `TemplatesSection.tsx` | `ecs/sections/` | 模板管理 |
| `RecycleBinSection.tsx` | `ecs/sections/` | 回收站 |
| `NetworkTopologySection.tsx` | `hsm/sections/` | Cloudmap 资源总览 · 网络拓扑（物理网络 React Flow；实现位于 `hsm/lib/networkTopology/`） |
| `DatacenterTopologySection.tsx` | `hsm/sections/` | Cloudmap 资源总览 · 机房拓扑 |

## 开发规范

**目录落位**：前端见 **`frontend/src/STRUCTURE.md`**（平台、`pages/`、`sections`/`drawers`/`modals`/`shared`）；后端见 **`backend/src/STRUCTURE.md`**（`routes` → `services` → `entities`、多云目录对称、Harvester `handlers/`）。

### 命名约定
- **组件文件**： PascalCase (如 `PageContainer.tsx`)
- **工具文件**： camelCase (如 `harvesterUtils.ts`)
- **类型文件**： camelCase (如 `cloud.ts`)
- **常量文件**： camelCase (如 `pagination.ts`)

### API 调用
使用 `services/` 下的 API 服务函数，统一使用 `requestManager` 进行请求管理（支持去重、缓存、重试）。

### 数据展示与刷新（强制）

本节统一约束**数据可能已变化**时，界面如何与对端状态对齐：须避免假刷新、陈旧缓存，以及「只读本机库却冒充已同步」。触发分两类——**用户显式刷新**与**写操作（增删改）成功后的重载**；两类均须满足对端语义，并在读路径上使用 **`skipCache: true`**、**`onRefresh(true)`**、**`force=true`**、**`clearCache`** 等与项目既有实现一致的约定，**不得**省略应发起的网络请求或等效同步。

#### 用户显式刷新

凡由用户**显式触发**的「刷新」行为（页面/区块工具栏刷新按钮、详情抽屉或侧栏的刷新、`ReloadOutlined` / `SyncOutlined` 等触发的重新加载），须同时满足：

1. **对端真实拉取（数据源）**  
   刷新必须导致**经后端访问对端权威数据源**（云厂商 / 集群 / 设备 / CSM 控制面 / 其它外部服务）的拉取或经后端实现的**等效强制同步**（例如先执行同步任务再读库），**不得**将「仅读取 Tower 本机数据库、且未触发任何对端同步」的接口作为该次刷新的**唯一**数据路径。  
   **例外**：界面明确标注为「仅本地 / 草稿 / 平台已保存副本」的视图，可使用只读库表；此类 Tab 或按钮**不得**单独冒充整页「同步刷新」，且不应在用户未进入该视图时作为全局刷新的附带请求。

2. **前端不喂陈旧内存缓存**  
   **禁止**依赖 `requestManager` GET 内存缓存命中或其它陈旧快照冒充最新状态；刷新路径上的 `apiRequest` GET 须 **`skipCache: true`**（已 `enableCache: true` 的接口同样如此）。

3. **禁止假刷新**  
   **禁止**将「仅重绘本地 `useState` / 表单占位、不发起请求」当作刷新。

#### 写操作成功后的列表与视图重载

凡含「列表 + 创建/编辑/删除」的页面，**须**使操作成功后的当前页列表与后端一致，**不**要求用户整页刷新才能看到结果；且与上节一致，重载须**真实拉取/同步**并**跳过陈旧缓存**（例如列表刷新前已触发或未省略后端的强制同步接口）。

1. **写操作成功后必须触发列表重载**  
   在 `onSuccess` 或提交成功分支中，在 `await` 写接口完成之后，调用与当前表格同源的加载函数，或使用父级传入的 `onRefresh` / `onRefresh(true)`。

2. **列表对应 GET 若使用 `enableCache: true`（或项目内对读接口开了缓存）**  
   于上述成功后的重载中须**强制新读**：`apiRequest(path, { skipCache: true })`，或对 `frontend/src/utils/requestManager.ts` 中 `clearCache` 所支持的精确 path 先 `clearCache` 再 GET。

3. **Harvester 云详情内各 Section / Tab**  
   成功回调中重载列表时，与现有一致：使用 **`onRefresh(true, …)`**（第一参为 force，由内部配合 `skipCache` 与/或查询参数 `force=true` 等，以项目内既有实现为准）。

| 场景 | 要求 |
|------|------|
| 新增/编辑/删除成功 | 同一次成功路径内执行列表重载，不得仅关弹窗或仅提示成功。 |
| 读列表可能走前端缓存 | 重载时 `skipCache: true` 或 `clearCache` 后再请求。 |
| Harvester 子模块 | 使用 `onRefresh(true, …)` 等既有约定，不另起一套。 |

**自测**：完成一条增/删/改后，当前页列表应已更新，无需 F5 / Ctrl+F5。

**全站检索（审计同类问题时用）**  
在 `frontend/src` 内可配合检索（命中后人工判断是否应在成功路径上强制重载）：

- 无参 `onRefresh()` / `onRefresh?.()`：成功路径与工具栏「刷新」应使用 `onRefresh(true)` 或 `onRefresh(true, true)`（与子组件、父级数据加载约定一致）。**勿**将 `onClick={onRefresh}` 直接绑到 Button（会把点击事件当第一参传入）。
- `onSuccess={onRefresh}`：以**子组件在成功时如何调用**为准；若子组件已传 `(true, true)` 则与上表「Harvester 子模块」及本节第 3 条约定一致。
- 个别 `apiRequest(…, { enableCache: true })` 仍见 `hooks`、仪表盘等；与列表强一致时写操作后重载须 `skipCache: true` 或 `clearCache`（见本节写操作重载第 2 条）。

`services/api.ts` 中 **`fetchTenants` / `fetchUsers` / `fetchAvailableResourcePools` / `fetchUserSpaces` 对 GET 未再默认叠一层 `enableCache`**，与其它列表读法一致，避免多入口改数据后仍读内存旧值。`pages/cnmc/tenants/index.tsx` 内本地 `fetchTenants(force)` 与 `?force=true` 行为保留。新改列表与增删改仍须依本节写操作三条与**自测**；合入前可抽查检索上面两条。

**公共组件对齐**：`PageContainer` 工具栏刷新按钮已对 `onRefresh` **固定传入 `true`**（与 `PageDetailSection` → `SharedToolbar` 行为一致），避免 `onClick={onRefresh}` 把 React 点击事件误当作 `force`。业务页仍须在写成功后自行调用列表重载。

**覆盖范围与边界（为何不可能「一次改完全库」）**  
上述约定针对的是 **列表数据与写接口结果一致**（及显式刷新时的对端语义），下列情况要么已走乐观/局部更新、要么不是「列表 GET 缓存」类问题，需单独产品/技术判断，**不能**仅靠一次全局替换解决：

- **监控/告警/日志等子模块**：部分创建成功走 **本地 `setState` 合并**（不再次请求列表），或需 **轮询/长延迟** 才与集群一致；要按页内是否应 `loadX(true)` 或 `skipCache` 评审。
- **零参函数绑在 `onClick={load}` 上**：若 `load` 签名为 `(force?: boolean)`，点击会误把 **事件对象** 当 `force`（真值）；应改为 `onClick={() => load(true)}` 或 `() => void load()`。 arity 为 0 的 `async () =>` 无此问题（多余实参被忽略）。
- **仪表盘** `enableCache: true`、**权限定义** 等慢变只读；仅当产品要求「改配置后同页必须立刻变」时，在对应写成功路径上对该 GET 加 `skipCache`。
- **后端/集群最终一致**：K8s 等对象晚几秒才出现在 list 接口，前端只能 **延迟重试/轮询**，与 F5 无关。

新功能合入时仍应做**自测**与上表「全站检索」抽查；旧页不可能在某次提交里全部穷举改完。

### 组件开发
- 公共逻辑提取到 `components/` 或 `hooks/`
- 使用 TypeScript 类型定义，放在 `types/`
- 所有 API 调用通过 `services/` 层

### React 状态管理注意事项

使用 Ant Design Form 时，对于复杂嵌套数据的动态更新：

**问题**： `Form.useWatch` 对嵌套路径的监听不可靠，`form.setFieldsValue` 更新后 UI 可能不刷新。

**解决方案**： 使用本地 `useState` 管理复杂数据，配合 `useEffect` 初始化和 `syncToForm` 函数同步：

```tsx
const [rules, setRules] = useState<Rule[]>([]);

// 初始化时从 form 读取
useEffect(() => {
  setRules(form.getFieldValue('rules') || []);
}, [form]);

// 添加规则 - 直接更新本地 state，UI 立即响应
const addRule = useCallback(() => {
  const updated = [...rules, newRule];
  setRules(updated);
  form.setFieldsValue({ rules: updated });
}, [rules, form]);
```

### 页面模板组件

前端页面开发遵循三层容器结构：

| 组件 | 路径 | 用途 |
|------|------|------|
| `PageContainer` | `components/PageContainer.tsx` | 列表页面容器，如资源池管理页面 |
| `PageDetailContainer` | `components/PageDetailContainer.tsx` | 详情页容器，如某个资源池详情页 |
| `PageDetailSection` | `components/PageDetailSection.tsx` | 详情页 Tab 区块，如弹性计算、块存储等 |

**使用示例**：

```tsx
// 1. 列表页面 (PageContainer)
<PageContainer
  title="资源池管理"
  icon={<CloudOutlined />}
  primaryAction={{ text: '新增', onClick: handleAdd }}
  onRefresh={handleRefresh}
  tableProps={{ columns, dataSource, rowKey: 'id' }}
/>

// 2. 详情页面 (PageDetailContainer)
<PageDetailContainer
  title={cloud.name}
  icon={<CloudOutlined />}
  onBack={() => navigate(-1)}
  tabs={[
    { key: 'compute', label: '弹性计算', children: <ComputeTab /> },
    { key: 'storage', label: '块存储', children: <StorageTab /> },
  ]}
/>

// 3. Tab 区块内容 (PageDetailSection)
<PageDetailSection
  title="虚拟机列表"
  toolbarLeft={<Input.Search placeholder="搜索" />}
  onRefresh={handleRefresh}
>
  <Table columns={columns} dataSource={vms} />
</PageDetailSection>
```

### API 开发原则

开发功能对接标准实体时，遵循以下原则：

1. **优先使用标准 API**： 标准 API 与协议说明见 `deployment/docs/specs/api/` 等目录（根目录 `docs/` 已并入此处）
2. **发现缺失先核对**： 如果发现缺少某个接口，先提出来核对：
   - 是否实际存在该接口，只是未总结到文档
   - 是否可以用其他接口替代
   - 确认后再决定是否需要新增
3. **避免重复造轮子**： 不要一上来就从零开始开发，优先复用已有的 API 和代码

### 全局样式
通用 CSS 样式文件：`frontend/src/global-new.css`

### 列表表格（.std-table，**全站版式 A**）

全站**统一版式 A**：标准数据列表**首列左冻结、行操作列右冻结**，并**配横向滚动**；**不采用**「全表不钉列、无 `scroll`」作为新列表默认。样式与表级 `min-width` 等以 **`frontend/src/global-new.css`** 中 `.std-table` 及注释为唯一落点。

1. **Table 与 `scroll`**
   - 列表 `Table` 使用 `className="std-table"`。
   - **列冻结要求**：**首列**须 **`fixed: 'left'`**（最左一列，一般为多选/名称/主标识等主入口列，含行多选时与现网大表一致，多选列在左则一并纳入左端冻结区）；有**行级操作**时，**操作列**须 **`fixed: 'right'`**。中间业务列不钉。
   - 因已含左/右 `fixed`，**必须**同表写 `scroll={{ x: true }}`（或等价的 `scroll.x: minWidth` 等），否则 Ant Design 下固定列易错位。
   - 新增、整改、复制**按上条**实现；曾无首列/操作列冻结的列表**应**补全并对齐全站，避免两套路长期并存。无行操作列的只读/极窄子表，经评审可例外，不在此默认内。

2. **列宽（与内容、样式分工）**
   - **列宽以内容 + `.std-table` 表级规则为主**：`columns` 里**原则上不**写 `width: <固定 px>` 作为常规手段；表体宽度由单元格内容与本节全局样式（如 `.std-table` 中 `min-width: max(100%, max-content)` 等）**随内容推宽/换行策略**一起决定，而不是在每一列上写死像素宽。
   - **单元格内**对超长文案做省略、加 `maxWidth` 等，属**格内**展示约束，**不等同于**在 `columns` 上写整列 `width`；可单独用于 Tooltip、多行等场景。
   - 仅当 Ant Design/固定列在个别浏览器下**确需**最小可测宽度、且经排查无法用内容与样式解决时，再**个案**加最小约束，**禁止**因习惯把大表每列都写成固定 `width` 列阵。

3. **列展示（`useTableColumnSettings` / `TableColumnSettingsButton`）**
   - 已设 `fixed` 的列**不允许**在「列展示」中关闭；行为由 `useTableColumnSettings` 将此类列**锁定为常显**、选项 **disabled**，全不选时**仅保留冻结列**。

4. **其它**
   - **勿**为和某页「看起来一致」擅自给 `Table` 或 `pagination` 加 `size="small"` 等，除非产品/设计明确要求。

```tsx
// 首列 fixed: 'left'、行操作列 fixed: 'right'，并 scroll.x（见上节 1）
<Table className="std-table" columns={columns} scroll={{ x: true }} />
```

### 前端代码质量

#### Git Hooks
- 使用 Husky 进行 Git 钩子管理
- pre-commit 自动执行 lint-staged

#### Lint-staged 配置

```json
{
  "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "*.{json,md,css,scss}": ["prettier --write"]
}
```

#### 浏览器兼容性
- 生产环境：`>0.2%, not dead, not op_mini all`
- 开发环境：`last 1 chrome version, last 1 firefox version, last 1 safari version`

## 认证与权限

### 用户角色
- `super_admin`: 超级管理员 (全部权限)
- `admin`: 管理员
- `tenant`: 租户用户
- `sase_device`: SASE 设备

### 权限系统
采用 RBAC (基于角色的访问控制)，权限通过 `permissions` 数组传递，`*` 表示全部权限。

### Token 存储
前端 Token 存储使用 `utils/tokenStorage`，支持 localStorage 和 sessionStorage。

## 后台服务

### 云资源同步服务
- `CloudSyncService`: 定时同步各云平台的资源数据
- 自动在服务启动时初始化

### VR 缓存服务
- `VRCacheService`: 虚拟路由器列表缓存同步
- 延迟 10s 启动，避免启动冲突

### 回收站清理服务
- `RecycleBinCleanupService`: 定时清理 Harvester 回收站
- 延迟 30s 启动

## 注意事项

1. **数据库**： 使用 SQLite，生产环境建议迁移到 PostgreSQL/MySQL
2. **安全**： 修改默认 `JWT_SECRET`，生产环境收紧 CORS 配置
3. **内存**： 前端设置了 `--max-old-space-size=4096` 以支持大型应用
4. **代理**： 开发环境前端通过 `setupProxy.js` 代理后端 API 和 WebSocket
5. **补丁**： 前端使用 `patch-package` 修复第三方库问题（novnc、zrender）
6. **代码规范**： 使用 Husky + lint-staged 进行提交前代码检查
7. **Cloudmap 网络拓扑**：物理网络拓扑仅在 Cloudmap「资源总览 → 网络拓扑」提供（`Harvester/hsm/`）；物理网络（ProviderNetwork）**详情抽屉不含拓扑 Tab**。子网详情中的「子网 → 虚拟机」拓扑复用 `hsm/lib/networkTopology/kubeOvnTopoPrimitives.tsx` 与 Kube-OVN 域数据。