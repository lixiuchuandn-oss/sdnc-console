# Compute Tower - 多云管理平台

## 项目概述

Compute Tower 是一个企业级多云管理平台，提供统一的云资源管理、SDN网络编排、安全运营和AI SOC能力。

### 核心能力

- **多云管理 (CNMC)**: 支持阿里云、华为云、腾讯云、Harvester(KubeVirt) 等多云资源的统一管理
- **租户管理 (TENANTS)**: 租户、组织、租户用户等与 CNMC **平级**的独立产品线（前端导航与 `RouteSpec.platform` 已单独切分）
- **容器管理**: 工作负载、Pod、任务、服务发现、镜像仓库、配置管理、高级调度策略等容器资源管理
- **SDN管理 (SDNCC)**: SRv6隧道、IPsec VPN、ACL、NAT、虚拟路由器等网络编排能力
- **AI SOC中心 (CNSOC)**: 安全运营、威胁分析、报告管理等安全能力
- **系统设置 (SETTINGS)**: 系统用户、RBAC 角色与权限、审计日志、系统配置与授权等（与租户管理产品线区分）

## 技术栈

### 后端
- **运行时**: Node.js 18+ + TypeScript 5.x
- **框架**: Express 4.x
- **数据库**: SQLite (TypeORM 0.3.x)
- **认证**: JWT + bcryptjs
- **WebSocket**: ws 8.x (SSH/VNC/KubeVirt)
- **云SDK**: 阿里云SDK、华为云SDK、腾讯云SDK

### 前端
- **框架**: React 18 + TypeScript 4.9
- **UI组件**: Ant Design 5.x
- **路由**: React Router 6
- **图表**: ECharts 5.x
- **终端**: xterm.js 5.x
- **远程控制**: noVNC 1.6.0
- **代码编辑**: CodeMirror 6 (@uiw/react-codemirror)
- **目录结构**: **`frontend/src/STRUCTURE.md`**（前端目录与放置规则唯一权威）；**`frontend/README.md`** 仅为 `frontend/` 包入口（运行命令）；Harvester 云详情子树见 `deployment/docs/specs/修改纪要_Harvester前端目录结构_域优先与shared.md`

## 架构文档分工

| 文档 | 职责 |
|------|------|
| **`AGENTS.md`**（本文件） | 项目总览、技术栈、环境与运行、**对外 HTTP API / WebSocket 路径**、Harvester 容器能力表、开发与质量约定 |
| **`frontend/src/STRUCTURE.md`** | 前端 `frontend/src/` 的目录划分、**平台（CNMC / TENANTS / SDNCC / CNSOC / SETTINGS）与 `pages/` 映射**、`sections` / `drawers` / `modals` / `shared` 等放置规则的唯一权威 |
| **`backend/src/STRUCTURE.md`** | 后端 `backend/src/` 的分层与落点、**路由 ↔ 服务 ↔ 实体** 约定、与前端平台的心智对照；**API 清单不重复维护**（以本文件为准） |
| **`deployment/docs/specs/...`** | Harvester 前端子树、权限、API 规格等专题文档 |

新增或搬迁源码时：**前端**以 `frontend/src/STRUCTURE.md` 为准，**后端**以 `backend/src/STRUCTURE.md` 为准；对外路径以 `backend/src/index.ts` 的挂载为准。

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
│   │   │   │   │       └── monitoring/    # 监控与日志
│   │   │   │   ├── console/
│   │   │   │   ├── tenants/   # 租户管理：平台 TENANTS（与 CNMC 平级）；源码暂放 cnmc 下（过渡期）
│   │   │   │   └── paas/      # PaaS 归属 CNMC（如 cloud-database/）
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

**后端**:
- `PORT`: 服务端口 (默认 5001)
- `JWT_SECRET`: JWT 密钥
- `DB_PATH`: SQLite 数据库路径
- `NODE_ENV`: 环境标识 (development/production)

**前端**:
- `REACT_APP_API_URL`: 后端 API 地址
- `HOST`: 监听地址
- `PORT`: 服务端口

## API 规范

### 路由前缀

**认证与用户**:
- `/api/auth`: 认证相关（登录、登出、令牌校验）
- `/api/users`: 系统用户管理
- `/api/tenants`: 租户管理

**云资源管理**:
- `/api/clouds`: 云资源管理（统一入口）
- `/api/clouds/aliyun/*`: 阿里云资源
- `/api/clouds/huawei/*`: 华为云资源
- `/api/clouds/harvester/*`: Harvester/KubeVirt 资源
- `/api/clouds/{id}/monitoring/storage-nodes`: Longhorn 节点（Steve `longhorn.io.nodes`，Cloudmap「分布式存储」）
- `/api/clouds/{id}/monitoring/ceph-clusters`: Rook `CephCluster` 列表（Steve 优先 `cephclusters.ceph.rook.io`，回退 `ceph.rook.io.cephclusters`；Cloudmap「Ceph 存储」）
- `/api/clouds/{id}/monitoring/ceph-resources`: Rook Ceph 聚合（`CephCluster`、`CephBlockPool`、`CephFilesystem`、`CephObjectStore` 四类 Steve 列表）

**Harvester 容器管理**:
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

**SDN 网络**:
- `/api/networks/srv6`: SRv6 隧道
- `/api/networks/ipsec`: IPsec VPN
- `/api/networks/acl`: ACL 规则
- `/api/networks/acl-groups`: ACL 分组
- `/api/networks/nat`: NAT 规则
- `/api/vr-config`: 虚拟路由器配置
- `/api/vr-cache`: VR 设备缓存（无需登录）

**安全与 AISOC**:
- `/api/security-domains`: 安全域管理
- `/api/services`: 服务目录
- `/api/security/traffic`: 流量编排
- `/api/threats`: 威胁事件

**系统**:
- `/api/system`: 系统配置
- `/api/system/license`: 授权管理
- `/api/audit-logs`: 审计日志
- `/api/dashboard`: 仪表盘数据

### WebSocket 路径
- `/ws/ssh`: WebSSH 终端
- `/ws/vnc`: WebVNC 远程控制
- `/ws/kv-vnc`: KubeVirt VNC
- `/ws/kv-pod-log`: KubeVirt Pod 日志
- `/ws/kv-pod-exec`: KubeVirt Pod 终端

## Harvester 容器管理

### 功能概览

Harvester 容器管理模块提供完整的 Kubernetes 容器资源管理能力：

| 功能模块 | 支持操作 | 状态 |
|---------|---------|------|
| 工作负载 | Deployment/StatefulSet/DaemonSet 创建、编辑、高级调度策略 | ✅ 已完成 |
| Pod | 列表、详情、日志、终端 | ✅ 已完成 |
| 任务 | Job/CronJob 创建、管理 | ✅ 已完成 |
| Service | 创建、编辑、YAML编辑、查看关联Pod | ✅ 已完成 |
| Ingress | 创建、编辑、YAML编辑 | ✅ 已完成 |
| Gateway API | Gateway/HTTPRoute/GRPCRoute 创建 | ✅ 已完成 |
| 镜像仓库 | 浏览、凭证管理 | ✅ 已完成 |
| 配置管理 | ConfigMap/Secret 创建、编辑 | ✅ 已完成 |
| PodDisruptionBudget | 列表、创建、删除、YAML编辑 | ✅ 已完成 |
| 高级调度策略 | 节点亲和性、Pod亲和性/反亲和性、污点容忍 | ✅ 已完成 |

### 关键组件

**工作负载管理**:
- `WorkloadForm.tsx`: 支持 Deployment/StatefulSet/DaemonSet 创建，含高级调度策略配置
- `WorkloadsSection.tsx`: 工作负载列表展示

**高级调度策略** (WorkloadForm 内置):
- **节点亲和性编辑器**: 配置 `required` (必须满足) 和 `preferred` (尽量满足) 规则
- **Pod 亲和性编辑器**: 支持标签选择器、命名空间选择、拓扑域配置
- **Pod 反亲和性编辑器**: 将 Pod 分散到不同节点
- **污点容忍编辑器**: 支持 Key/Operator/Value/Effect 配置，提供常用预设快速添加

**Pod 管理**:
- `PodsSection.tsx`: Pod 列表（含详情、日志、终端）
- `PodLogViewer.tsx`: Pod 日志查看（支持容器选择、tailLines、自动刷新、下载）
- `PodTerminal.tsx`: Pod 终端（xterm.js，支持多容器选择）

**任务管理**:
- `JobForm.tsx`: Job 创建表单
- `CronJobForm.tsx`: CronJob 创建表单（含 Cron 表达式助手）
- `JobsSection.tsx`: Job/CronJob 列表

**服务发现**:
- `ServiceForm.tsx`: Service 创建/编辑表单
- `IngressForm.tsx`: Ingress 创建/编辑表单
- `GatewayForm.tsx`: Gateway 创建表单
- `HTTPRouteForm.tsx`: HTTPRoute 创建表单
- `GRPCRouteForm.tsx`: GRPCRoute 创建表单
- `ServicesSection.tsx`: Service 列表（含关联 Pod 查看）
- `IngressesSection.tsx`: Ingress 列表
- `GatewayApiSection.tsx`: Gateway API 资源列表

**配置管理**:
- `ConfigMapForm.tsx`: ConfigMap 创建/编辑表单
- `SecretForm.tsx`: Secret 创建/编辑表单
- `ConfigsSection.tsx`: ConfigMap/Secret 列表

**镜像仓库**:
- `RegistryBrowser.tsx`: 镜像仓库浏览器
- `RegistryCredentialForm.tsx`: 仓库凭证管理
- `RegistriesSection.tsx`: 镜像仓库列表

**PodDisruptionBudget**:
- `PDBForm.tsx`: PDB 创建表单
- `PDBSection.tsx`: PDB 列表管理

**通用组件**:
- `YamlEditModal.tsx`: 通用 YAML 编辑弹窗
- `CodeEditor.tsx`: 代码编辑器（基于 CodeMirror）
- `YamlEditor.tsx`: YAML 专用编辑器
- `ServiceRelatedPodsTab.tsx`: Service 关联 Pod 展示

### Harvester 虚拟机与关联资源

虚拟机及存储、备份、集群、网络等 Section 按域分布在 `frontend/src/pages/cnmc/clouds/Harvester/` 下（与详情页 Tab 一致）：

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

## 开发规范

**目录落位**：前端见 **`frontend/src/STRUCTURE.md`**（平台、`pages/`、`sections`/`drawers`/`modals`/`shared`）；后端见 **`backend/src/STRUCTURE.md`**（`routes` → `services` → `entities`、多云目录对称、Harvester `handlers/`）。

### 命名约定
- **组件文件**: PascalCase (如 `PageContainer.tsx`)
- **工具文件**: camelCase (如 `harvesterUtils.ts`)
- **类型文件**: camelCase (如 `cloud.ts`)
- **常量文件**: camelCase (如 `pagination.ts`)

### API 调用
使用 `services/` 下的 API 服务函数，统一使用 `requestManager` 进行请求管理（支持去重、缓存、重试）。

### 组件开发
- 公共逻辑提取到 `components/` 或 `hooks/`
- 使用 TypeScript 类型定义，放在 `types/`
- 所有 API 调用通过 `services/` 层

### React 状态管理注意事项

使用 Ant Design Form 时，对于复杂嵌套数据的动态更新：

**问题**: `Form.useWatch` 对嵌套路径的监听不可靠，`form.setFieldsValue` 更新后 UI 可能不刷新。

**解决方案**: 使用本地 `useState` 管理复杂数据，配合 `useEffect` 初始化和 `syncToForm` 函数同步：

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

1. **优先使用标准 API**: 标准 API 与协议说明见 `deployment/docs/specs/api/` 等目录（根目录 `docs/` 已并入此处）
2. **发现缺失先核对**: 如果发现缺少某个接口，先提出来核对：
   - 是否实际存在该接口，只是未总结到文档
   - 是否可以用其他接口替代
   - 确认后再决定是否需要新增
3. **避免重复造轮子**: 不要一上来就从零开始开发，优先复用已有的 API 和代码

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

## 平台模块

| 平台 | 代码 | 说明 |
|------|------|------|
| 多云管理 | CNMC | 资源池、多云实例、云主机/网络、控制台、**PaaS**（源码在 `pages/cnmc/paas/`，与平台子能力一致） |
| 租户管理 | TENANTS | 租户、组织、租户用户等；与 CNMC **平级**的独立平台（`RouteSpec.platform` / 顶栏导航）；页面源码过渡期在 `pages/cnmc/tenants/` |
| 容器管理 | CONTAINER | 工作负载、Pod、任务、服务发现、镜像仓库、配置管理、高级调度策略 |
| SDN管理 | SDNCC | SRv6、IPsec、ACL、NAT、VR |
| AI SOC中心 | CNSOC | 安全运营、威胁分析、报告 |
| 系统设置 | SETTINGS | 用户、系统配置、授权、审计；页面规范落位 `pages/settings/`（与 `RouteSpec.platform` 一致，见 `frontend/src/STRUCTURE.md`） |

## 注意事项

1. **数据库**: 使用 SQLite，生产环境建议迁移到 PostgreSQL/MySQL
2. **安全**: 修改默认 `JWT_SECRET`，生产环境收紧 CORS 配置
3. **内存**: 前端设置了 `--max-old-space-size=4096` 以支持大型应用
4. **代理**: 开发环境前端通过 `setupProxy.js` 代理后端 API 和 WebSocket
5. **补丁**: 前端使用 `patch-package` 修复第三方库问题（novnc、zrender）
6. **代码规范**: 使用 Husky + lint-staged 进行提交前代码检查
7. **Cloudmap 网络拓扑**：物理网络拓扑仅在 Cloudmap「资源总览 → 网络拓扑」提供（`Harvester/hsm/`）；物理网络（ProviderNetwork）**详情抽屉不含拓扑 Tab**。子网详情中的「子网 → 虚拟机」拓扑复用 `hsm/lib/networkTopology/kubeOvnTopoPrimitives.tsx` 与 Kube-OVN 域数据。

## 前端代码质量

### Git Hooks
- 使用 Husky 进行 Git 钩子管理
- pre-commit 自动执行 lint-staged

### Lint-staged 配置
```json
{
  "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "*.{json,md,css,scss}": ["prettier --write"]
}
```

### 浏览器兼容性
- 生产环境: `>0.2%, not dead, not op_mini all`
- 开发环境: `last 1 chrome version, last 1 firefox version, last 1 safari version`