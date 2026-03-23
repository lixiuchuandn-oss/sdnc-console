# Compute Tower - 多云管理平台

## 项目概述

Compute Tower 是一个企业级多云管理平台，提供统一的云资源管理、SDN网络编排、安全运营和AI SOC能力。

### 核心能力

- **多云管理 (CNMC)**: 支持阿里云、华为云、腾讯云、Harvester(KubeVirt) 等多云资源的统一管理
- **容器管理**: 工作负载、Pod、任务、服务发现、镜像仓库、配置管理等容器资源管理
- **SDN管理 (SDNCC)**: SRv6隧道、IPsec VPN、ACL、NAT、虚拟路由器等网络编排能力
- **AI SOC中心 (CNSOC)**: 安全运营、威胁分析、报告管理等安全能力
- **系统设置**: 用户管理、租户管理、RBAC权限控制、审计日志

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

## 项目结构

```
Compute.Tower/
├── backend/                    # 后端服务
│   ├── src/
│   │   ├── index.ts           # 服务入口
│   │   ├── config/            # 配置（数据库、运行时参数、系统设置）
│   │   ├── entities/          # TypeORM 实体定义
│   │   │   ├── harvester/     # Harvester/KubeVirt 相关实体
│   │   │   ├── kubeovn/       # KubeOVN 网络实体
│   │   │   ├── kubevirt/      # KubeVirt 虚拟化实体
│   │   │   ├── monitoring/    # 监控相关实体
│   │   │   ├── vRouter/       # 虚拟路由器实体
│   │   │   └── *.ts           # 业务实体（云、租户、用户等）
│   │   ├── routes/            # API 路由
│   │   │   ├── aisoc/         # AI SOC 路由
│   │   │   ├── auth/          # 认证路由
│   │   │   ├── clouds/        # 云资源路由
│   │   │   │   ├── aliyun/    # 阿里云
│   │   │   │   ├── harvester/ # Harvester/KubeVirt
│   │   │   │   │   ├── harvester.cache.*.routes.ts   # 缓存路由（集群、容器、网络、存储等）
│   │   │   │   │   ├── harvester.direct.*.routes.ts  # 直接路由（网络、存储、VM等）
│   │   │   │   │   ├── logging.routes.ts             # 日志路由
│   │   │   │   │   └── monitoring.routes.ts          # 监控路由
│   │   │   │   ├── huaweicloud/ # 华为云
│   │   │   │   ├── tencentcloud/ # 腾讯云
│   │   │   │   └── csm/       # CSM 控制面
│   │   │   ├── sdn/           # SDN 网络路由
│   │   │   ├── sysuser/       # 系统用户路由
│   │   │   ├── tenants/       # 租户路由
│   │   │   └── tools/         # 工具路由
│   │   ├── services/          # 业务服务层
│   │   │   ├── clouds/        # 云服务（阿里云、华为云、Harvester等）
│   │   │   ├── vrouter/       # 虚拟路由器服务
│   │   │   ├── CloudSyncService.ts    # 云资源同步服务
│   │   │   ├── LicenseService.ts      # 授权服务
│   │   │   └── StandardResourceService.ts # 标准资源服务
│   │   ├── middleware/        # 中间件（认证、审计、错误处理）
│   │   ├── seeders/           # 数据库种子数据
│   │   ├── utils/             # 工具函数
│   │   └── ws/                # WebSocket 服务
│   │       ├── ssh.ts         # WebSSH 终端
│   │       ├── vnc.ts         # WebVNC 远程控制
│   │       ├── kvVnc.ts       # KubeVirt VNC
│   │       ├── kvPodLog.ts    # KubeVirt Pod 日志
│   │       └── kvPodExec.ts   # KubeVirt Pod 终端
│   ├── public/                # 静态文件托管
│   ├── data/                  # 数据文件
│   └── package.json
├── frontend/                  # 前端应用
│   ├── src/
│   │   ├── App.tsx            # 应用入口
│   │   ├── index.tsx          # 入口文件
│   │   ├── global-new.css     # 全局样式
│   │   ├── setupProxy.js      # 开发环境代理配置
│   │   ├── assets/            # 静态资源
│   │   ├── components/        # 公共组件
│   │   │   ├── CodeEditor.tsx       # 代码编辑器（CodeMirror）
│   │   │   ├── YamlEditor.tsx       # YAML 编辑器
│   │   │   ├── PageContainer.tsx    # 列表页面容器
│   │   │   ├── PageDetailContainer.tsx  # 详情页容器
│   │   │   ├── PageDetailSection.tsx    # Tab 区块容器
│   │   │   └── ...
│   │   ├── constants/         # 常量定义
│   │   ├── contexts/          # React Context
│   │   ├── hooks/             # 自定义 Hooks
│   │   ├── layouts/           # 布局组件
│   │   ├── pages/             # 页面组件
│   │   │   ├── Access/        # 权限管理
│   │   │   ├── Alarms/        # 告警管理
│   │   │   ├── ApiDocs/       # API 文档
│   │   │   ├── Auth/          # 认证页面
│   │   │   ├── Clouds/        # 云资源管理
│   │   │   │   ├── Aliyun/    # 阿里云
│   │   │   │   ├── Harvester/ # Harvester/KubeVirt
│   │   │   │   │   ├── containers/    # 容器管理模块
│   │   │   │   │   │   ├── components/        # 容器相关组件
│   │   │   │   │   │   │   ├── ConfigMapForm.tsx      # ConfigMap 创建表单
│   │   │   │   │   │   │   ├── CronJobForm.tsx        # CronJob 创建表单
│   │   │   │   │   │   │   ├── CronExpressionHelper.tsx # Cron 表达式助手
│   │   │   │   │   │   │   ├── GatewayForm.tsx        # Gateway 创建表单
│   │   │   │   │   │   │   ├── HTTPRouteForm.tsx      # HTTPRoute 创建表单
│   │   │   │   │   │   │   ├── GRPCRouteForm.tsx      # GRPCRoute 创建表单
│   │   │   │   │   │   │   ├── IngressForm.tsx        # Ingress 创建/编辑表单
│   │   │   │   │   │   │   ├── JobForm.tsx            # Job 创建表单
│   │   │   │   │   │   │   ├── PodLogViewer.tsx       # Pod 日志查看组件
│   │   │   │   │   │   │   ├── PodTerminal.tsx        # Pod 终端组件
│   │   │   │   │   │   │   ├── RegistryBrowser.tsx    # 镜像仓库浏览器
│   │   │   │   │   │   │   ├── SecretForm.tsx         # Secret 创建表单
│   │   │   │   │   │   │   ├── ServiceForm.tsx        # Service 创建/编辑表单
│   │   │   │   │   │   │   ├── WorkloadForm.tsx       # 工作负载创建表单
│   │   │   │   │   │   │   ├── YamlEditModal.tsx      # YAML 编辑弹窗
│   │   │   │   │   │   │   └── ...
│   │   │   │   │   │   ├── ConfigsSection.tsx   # ConfigMap/Secret 列表
│   │   │   │   │   │   ├── GatewayApiSection.tsx # Gateway API 列表
│   │   │   │   │   │   ├── JobsSection.tsx       # Job/CronJob 列表
│   │   │   │   │   │   ├── PodsSection.tsx       # Pod 列表
│   │   │   │   │   │   ├── RegistriesSection.tsx # 镜像仓库列表
│   │   │   │   │   │   └── WorkloadsSection.tsx  # 工作负载列表
│   │   │   │   │   ├── sections/          # 虚拟机相关 Section
│   │   │   │   │   │   ├── ServicesSection.tsx    # Service 列表
│   │   │   │   │   │   ├── IngressesSection.tsx   # Ingress 列表
│   │   │   │   │   │   ├── VmSection.tsx           # 虚拟机列表
│   │   │   │   │   │   ├── VolumesSection.tsx      # 卷管理
│   │   │   │   │   │   ├── ImagesSection.tsx       # 镜像管理
│   │   │   │   │   │   └── ...
│   │   │   │   │   └── components/        # 共享组件
│   │   │   │   │       ├── HarvesterOpsinfoDrawer.tsx  # 详情抽屉
│   │   │   │   │       ├── ServiceRelatedPodsTab.tsx   # Service 关联 Pod Tab
│   │   │   │   │       └── ...
│   │   │   │   ├── Hw/        # 华为云
│   │   │   │   ├── Cloudmap/  # Cloudmap
│   │   │   │   └── Csm/       # CSM
│   │   │   ├── Dashboard/     # 仪表盘
│   │   │   ├── InterConnect/  # 互联互通
│   │   │   ├── SecMgrPlane/   # 安全管理面
│   │   │   ├── SecOps/        # 安全运营
│   │   │   ├── Security/      # 安全设置
│   │   │   ├── Settings/      # 系统设置
│   │   │   └── Tenants/       # 租户管理
│   │   ├── routes/            # 路由配置
│   │   ├── services/          # API 服务层
│   │   │   ├── harvesterApi.ts    # Harvester API 服务
│   │   │   └── ...
│   │   ├── types/             # TypeScript 类型定义
│   │   └── utils/             # 工具函数
│   ├── patches/               # npm 包补丁
│   └── package.json
├── docs/                      # 设计文档
├── scripts/                   # 工具脚本
│   ├── batch-update-token.js  # 批量更新令牌
│   ├── check-token-usage.js   # 检查令牌使用
│   ├── deploy-registry.js     # 部署镜像仓库
│   ├── deploy-registry.ts     # 部署镜像仓库（TS）
│   ├── import-image-job.json  # 镜像导入任务模板
│   ├── push-test-job.json     # 推送测试任务模板
│   └── verify-token-files.js  # 验证令牌文件
├── tools/                     # 外部工具
│   └── harvester-uploader/    # Harvester 上传工具
└── data/                      # 数据目录（授权文件等）
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
| 工作负载 | Deployment/StatefulSet/DaemonSet 创建、编辑 | ✅ 已完成 |
| Pod | 列表、详情、日志、终端 | ✅ 已完成 |
| 任务 | Job/CronJob 创建、管理 | ✅ 已完成 |
| Service | 创建、编辑、YAML编辑、查看关联Pod | ✅ 已完成 |
| Ingress | 创建、编辑、YAML编辑 | ✅ 已完成 |
| Gateway API | Gateway/HTTPRoute/GRPCRoute 创建 | ✅ 已完成 |
| 镜像仓库 | 浏览、凭证管理 | ✅ 已完成 |
| 配置管理 | ConfigMap/Secret 创建、编辑 | ✅ 已完成 |

### 关键组件

**工作负载管理**:
- `WorkloadForm.tsx`: 支持 Deployment/StatefulSet/DaemonSet 创建
- `WorkloadsSection.tsx`: 工作负载列表展示

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

**通用组件**:
- `YamlEditModal.tsx`: 通用 YAML 编辑弹窗
- `CodeEditor.tsx`: 代码编辑器（基于 CodeMirror）
- `YamlEditor.tsx`: YAML 专用编辑器
- `ServiceRelatedPodsTab.tsx`: Service 关联 Pod 展示

### Harvester 虚拟机管理

虚拟机管理功能位于 `frontend/src/pages/Clouds/Harvester/sections/`：

| Section 组件 | 功能 |
|-------------|------|
| `VmSection.tsx` | 虚拟机列表与管理 |
| `VolumesSection.tsx` | 卷管理 |
| `ImagesSection.tsx` | 镜像管理 |
| `BackupsSection.tsx` | 备份管理 |
| `SnapshotsSection.tsx` | 快照管理 |
| `NodesSection.tsx` | 节点管理 |
| `StorageClassesSection.tsx` | 存储类管理 |
| `IPPoolsSection.tsx` | IP 池管理 |
| `NadsSection.tsx` | 网络附件定义 |
| `SshKeysSection.tsx` | SSH 密钥管理 |
| `TemplatesSection.tsx` | 模板管理 |
| `RecycleBinSection.tsx` | 回收站 |

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

1. **优先使用标准 API**: 项目已整理的标准 API 文档位于 `docs/` 目录
2. **发现缺失先核对**: 如果发现缺少某个接口，先提出来核对：
   - 是否实际存在该接口，只是未总结到文档
   - 是否可以用其他接口替代
   - 确认后再决定是否需要新增
3. **避免重复造轮子**: 不要一上来就从零开始开发，优先复用已有的 API 和代码

### 全局样式
通用 CSS 样式文件：`frontend/src/global-new.css`

### Ant Design 表格固定列
使用 columns 配置中的 `fixed` 属性（'left' 或 'right'），配合 Table 的 `scroll={{ x: 宽度 }}` 属性。

```tsx
const columns = [
  { title: '任务ID', fixed: 'left', width: 100, dataIndex: 'id' },
  // ...其他列
  { title: '操作', fixed: 'right', width: 150 }
];

<Table columns={columns} scroll={{ x: 1200 }} />
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
| 多云管理 | CNMC | 云资源、云主机、云网络 |
| 容器管理 | CONTAINER | 工作负载、Pod、任务、服务发现、镜像仓库、配置管理 |
| SDN管理 | SDNCC | SRv6、IPsec、ACL、NAT、VR |
| AI SOC中心 | CNSOC | 安全运营、威胁分析、报告 |
| 系统设置 | SETTINGS | 用户、租户、权限、审计 |

## 注意事项

1. **数据库**: 使用 SQLite，生产环境建议迁移到 PostgreSQL/MySQL
2. **安全**: 修改默认 `JWT_SECRET`，生产环境收紧 CORS 配置
3. **内存**: 前端设置了 `--max-old-space-size=4096` 以支持大型应用
4. **代理**: 开发环境前端通过 `setupProxy.js` 代理后端 API 和 WebSocket
5. **补丁**: 前端使用 `patch-package` 修复第三方库问题（novnc、zrender）
6. **代码规范**: 使用 Husky + lint-staged 进行提交前代码检查

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
