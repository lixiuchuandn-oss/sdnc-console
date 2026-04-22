# 容器功能模块实施计划

> 版本: 2.9
> 创建日期: 2026-03-10
> 最后更新: 2026-03-24

## 项目概览

| 项目 | 内容 |
|------|------|
| **项目名称** | Compute Tower 容器功能模块 |
| **目标** | 对接 Harvester 资源池的容器能力 |
| **设计文档** | `docs/container-feature-design.md` |
| **API 参考** | `docs/kubernetes-container-api-reference.md` |

---

## 分期总览

| 分期 | 功能范围 | 状态 |
|------|----------|------|
| **一期（基础版）** | 所有模块的列表查询、详情查看、基础操作 | 🟢 已完成 |
| **二期（增强版）** | 创建功能、编辑功能、Pod 终端、高级交互 | 🟢 已完成 |
| **三期（高级功能）** | 高级调度策略、NetworkPolicy、交互优化、租户视角 | 🟡 进行中 |

> **说明**: 端口转发功能经评估后已移除。该功能不符合多云管理平台产品定位，存在安全风险，且主流竞品均未提供。详见设计文档。

**状态说明**: 🟢 已完成 | 🟡 进行中 | 🔴 待开始

**二期进度**:
- ✅ 工作负载创建 (Deployment/StatefulSet/DaemonSet)
- ✅ Pod 终端
- ✅ 任务创建 (Job/CronJob)
- ✅ Service 创建/关联Pod
- ✅ Ingress 管理 (创建/编辑/YAML编辑)
- 🟡 网关路由 (Gateway API) - 开发完成待验证
- ✅ 镜像仓库增强
- ✅ Service/Ingress 增强 (编辑/YAML编辑)
- ✅ 配置管理创建 (ConfigMap/Secret 已验证)

**三期进度** (高级功能):
- 🟢 高级调度策略 (亲和性/容忍) - 已验证 (2026-03-24)
- 🟢 Pod中断保护 (PDB) - 已验证
- 🟢 NetworkPolicy 网络策略管理 - 已验证 (2026-03-27)
- 🟢 交互优化 (快速创建) - 已验证
- 🟢 服务拓扑可视化
- 🔴 应用部署向导
- 🔴 租户视角 (工作台/配额管理)
- 🔴 Gateway API 编辑功能 (当前环境未安装 Gateway API)

---

## 一期（基础版）

> **目标**: 完成所有模块的基础查看和操作功能

### 功能范围

| 模块 | 功能 | 状态 |
|------|------|------|
| **工作负载** | Deployment/StatefulSet/DaemonSet 列表查询、扩缩容、重启、删除 | 🟢 |
| **Pod** | 列表查询、详情查看、日志查看、删除 | 🟢 |
| **任务** | Job/CronJob 列表查询、删除 | 🟢 |
| **服务发现** | Service/Ingress 列表查询 | 🟢 |
| **配置管理** | ConfigMap/Secret 列表查询 | 🟢 |
| **镜像仓库** | 镜像凭证列表查询 | 🟢 |

### 一期任务清单

#### 1.1 工作负载 + Pod（已完成）

| 任务ID | 任务描述 | 状态 | 进度 |
|--------|----------|------|------|
| B1-01 | 创建 `harvester.cache.container.routes.ts` 路由文件 | 🟢 | 已验证 |
| B1-02 | 实现 Deployment/StatefulSet/DaemonSet 列表 API | 🟢 | 已验证 |
| B1-03 | 实现 Pod 列表和详情 API | 🟢 | 已验证 |
| B1-04 | 实现 Pod 日志 API | 🟢 | 已验证 |
| B1-05 | 实现扩缩容、重启、删除 API | 🟢 | 已验证 |
| F1-01 | 创建 `containers/` 目录结构 | 🟢 | 已验证 |
| F1-02 | 扩展 `harvesterApi.ts` 添加容器 API 函数 | 🟢 | 已验证 |
| F1-03 | 实现 `WorkloadsSection.tsx` 组件 | 🟢 | 已验证 |
| F1-04 | 实现 `PodsSection.tsx` 组件 | 🟢 | 已验证 |
| F1-05 | 集成到 `CloudDetailHarvester.tsx` 主页面 | 🟢 | 已验证 |

#### 1.2 任务 + 服务发现（已完成）

| 任务ID | 任务描述 | 状态 | 进度 |
|--------|----------|------|------|
| B1-06 | 实现 Job/CronJob 列表 API | 🟢 | 已验证 |
| B1-07 | 实现 Service/Ingress 列表 API | 🟢 | 已验证 |
| F1-06 | 实现 `JobsSection.tsx` 组件 | 🟢 | 已验证 |
| F1-07 | 增强 `ServicesSection.tsx` 组件 | 🟢 | 已验证 |
| F1-08 | 增强 `IngressesSection.tsx` 组件 | 🟢 | 已验证 |

#### 1.3 配置管理（已完成）

| 任务ID | 任务描述 | 状态 | 进度 |
|--------|----------|------|------|
| B1-08 | 实现 ConfigMap/Secret 列表 API | 🟢 | 已验证 |
| F1-09 | 实现 `ConfigsSection.tsx` 组件 | 🟢 | 已验证 |

#### 1.4 镜像仓库（已完成）

| 任务ID | 任务描述 | 状态 | 进度 |
|--------|----------|------|------|
| B1-09 | 实现镜像凭证列表 API | 🟢 | 已验证 |
| F1-10 | 实现 `RegistriesSection.tsx` 组件（凭证列表） | 🟢 | 已验证 |

### 一期验收标准

- [x] 能够查看 Deployment/StatefulSet/DaemonSet 列表
- [x] 能够扩缩容、重启、删除 Deployment
- [x] 能够查看 Pod 列表和详情
- [x] 能够查看 Pod 日志
- [x] 命名空间筛选功能正常
- [x] 能够查看 Job/CronJob 列表
- [x] 能够查看 Service/Ingress 列表
- [x] 能够查看 ConfigMap/Secret 列表
- [x] 能够查看镜像凭证列表

---

## 二期（增强版）

> **目标**: 完成所有模块的创建和高级交互功能

### 功能范围

| 模块 | 功能 | 状态 |
|------|------|------|
| **工作负载** | 创建 Deployment/StatefulSet/DaemonSet（表单 + YAML） | 🟢 |
| **Pod** | 终端访问 | 🟢 |
| **任务** | 创建 Job/CronJob，暂停/恢复 CronJob | 🟢 |
| **Service** | 创建/编辑/YAML编辑/删除/查看关联Pod | 🟢 |
| **Ingress** | 创建/编辑/YAML编辑/删除 | 🟢 |
| **网关路由** | Gateway API 支持（GatewayClass/Gateway/HTTPRoute/GRPCRoute） | 🟡 |
| **配置管理** | 创建/编辑 ConfigMap/Secret | 🔴 |
| **镜像仓库** | 创建镜像凭证，仓库列表管理，镜像浏览 | 🟢 |

> **说明**: 服务发现模块采用扁平化 Tab 结构，Service、Ingress、网关路由各自独立。

### 二期任务清单

#### 2.1 工作负载创建 ✅ 已完成

| 任务ID | 任务描述 | 状态 | 进度 |
|--------|----------|------|------|
| B2-01 | 实现工作负载创建 API | 🟢 | 已验证 |
| F2-01 | 实现 `WorkloadForm.tsx` 创建表单 | 🟢 | 已验证 |
| F2-02 | 实现 YAML 编辑器模式 | 🟢 | 已验证 |
| F2-13 | 实现工作负载编辑功能 | 🟢 | 已验证 |

**编辑功能特性**:
- 复用 WorkloadForm 组件，支持创建和编辑两种模式
- 自动填充现有配置信息
- 编辑模式下禁用不可修改字段（工作负载类型、名称、命名空间）
- 支持 YAML 模式编辑
- 触发滚动更新，无需手动删除重建

#### 2.2 Pod 终端 ✅ 已完成

| 任务ID | 任务描述 | 状态 | 进度 |
|--------|----------|------|------|
| B2-03 | 实现 Pod 终端 WebSocket 接口 | 🟢 | 已验证 |
| F2-03 | 实现 `PodTerminal.tsx` 组件 | 🟢 | 已验证 |
| F2-03b | 集成到 PodsSection.tsx | 🟢 | 已验证 |

**技术实现**:
- 后端 WebSocket 路径: `/ws/kv-pod-exec`
- 使用 Kubernetes exec WebSocket 协议 (v4.channel.k8s.io/v5.channel.k8s.io)
- 前端使用 xterm.js 渲染终端
- 支持多容器选择、终端大小自适应、全屏模式

**文件列表**:
| 文件 | 描述 |
|------|------|
| `backend/src/ws/kvPodExec.ts` | Pod 终端 WebSocket 服务 |
| `frontend/.../components/PodTerminal.tsx` | Pod 终端组件 |

#### 2.3 任务创建 ✅ 已完成

| 任务ID | 任务描述 | 状态 | 进度 |
|--------|----------|------|------|
| B2-04 | 实现 Job/CronJob 创建 API | 🟢 | 已验证 |
| B2-10 | 实现 Job 详情/删除 API | 🟢 | 已验证 |
| B2-11 | 实现 CronJob 详情/删除 API | 🟢 | 已验证 |
| B2-12 | 实现 CronJob 暂停/恢复 API | 🟢 | 已验证 |
| B2-13 | 实现 CronJob 手动触发 API | 🟢 | 已验证 |
| B2-14 | 实现获取 Job 关联 Pod 列表 API | 🟢 | 已验证 |
| B2-15 | 实现获取 Job Events API | 🟢 | 已验证 |
| F2-04 | 实现 `JobForm.tsx` 创建表单 | 🟢 | 已验证 |
| F2-05 | 实现 `CronJobForm.tsx` 创建表单 | 🟢 | 已验证 |
| F2-19 | 重构 Job 详情抽屉为 Tab 布局（概览/日志/事件） | 🟢 | 已验证 |
| F2-20 | 实现 Job 失败原因解析和展示 | 🟢 | 已验证 |
| F2-21 | 实现 Job 实时日志查看功能 | 🟢 | 已验证 |
| F2-22 | 实现 Job 重试操作功能 | 🟢 | 已验证 |
| F2-23 | 列表页显示 Job 失败状态提示 | 🟢 | 已验证 |
| F2-24 | 同步增强 CronJob 详情功能 | 🟢 | 已验证 |
| F2-25 | CronJobForm 移除创建时的暂停选项 | 🟢 | 已验证 |
| F2-26 | 实现 Cron 表达式实时解析助手 | 🟢 | 已验证 |

**后端 API 列表**:
| API | 方法 | 路径 | 说明 |
|-----|------|------|------|
| 创建 Job | POST | `/containers/create` | 通用创建 API |
| Job 详情 | GET | `/jobs/:namespace/:name` | 获取 Job 详情 |
| 删除 Job | DELETE | `/jobs/:namespace/:name` | 删除 Job |
| 创建 CronJob | POST | `/containers/create` | 通用创建 API |
| CronJob 详情 | GET | `/cronjobs/:namespace/:name` | 获取 CronJob 详情 |
| 删除 CronJob | DELETE | `/cronjobs/:namespace/:name` | 删除 CronJob |
| 暂停/恢复 | PATCH | `/cronjobs/:ns/:name/suspend` | 暂停或恢复 CronJob |
| 手动触发 | POST | `/cronjobs/:ns/:name/trigger` | 手动触发执行 |
| 获取 Job Pods | GET | `/jobs/:ns/:name/pods` | 获取 Job 关联的 Pod 列表 |
| 获取 Job Events | GET | `/jobs/:ns/:name/events` | 获取 Job 相关 Kubernetes Events |

**功能需求说明**:

1. **失败信息展示**
   - Job 级别：从 `status.conditions` 提取 `Failed` 状态的 reason/message
   - Pod 级别：获取关联 Pod 的 Events（镜像拉取失败、OOMKilled 等）
   - 容器级别：展示 Exit Code 和退出信号

2. **运行中任务监控**
   - 实时日志：获取 Pod 日志（支持 tailLines、实时跟随）
   - 事件流：展示 Kubernetes Events（调度、启动、容器创建等）
   - 执行进度：展示 active Pod 数量和完成进度

3. **成功任务结果**
   - 执行摘要：运行时长、开始/完成时间、重启次数
   - 执行日志：展示最后 N 行输出
   - 输出预览：格式化展示任务输出

4. **失败任务重试**
   - 重试操作：删除失败 Job + 使用相同配置重新创建
   - 克隆配置：基于失败 Job 预填充创建表单

5. **Cron 表达式增强**
   - 支持宏表达式：`@daily`、`@hourly`、`@weekly`、`@monthly` 等
   - 实时解析：输入时实时显示中文含义和最近执行时间
   - 格式验证：验证 5 字段格式（分 时 日 月 周）

#### 2.4 Service 管理 ✅ 已完成

> **功能范围**: 创建、编辑、YAML 编辑、删除、查看关联 Pod

| 任务ID | 任务描述 | 状态 | 进度 |
|--------|----------|------|------|
| B4-01 | 实现 Service 创建 API | 🟢 | 已验证 |
| B4-08 | 实现 Service 编辑 API (PUT) | 🟢 | 已验证 |
| B4-10 | 实现 Service YAML 获取 API | 🟢 | 已验证 |
| F4-03 | 实现 `ServiceForm.tsx` 创建表单 | 🟢 | 已验证 |
| F4-09 | ServiceForm 支持编辑模式 | 🟢 | 已验证 |
| F4-11 | 实现 YamlEditModal 通用 YAML 编辑弹窗 | 🟢 | 已验证 |
| F4-12 | Service 集成 YAML 编辑功能 | 🟢 | 已验证 |
| F4-13 | 实现查看关联 Pod Tab (ServiceRelatedPodsTab) | 🟢 | 已验证 |
| F4-14 | 关联 Pod 支持详情操作 | 🟢 | 已验证 |
| F4-15 | 关联 Pod 支持日志操作 | 🟢 | 已验证 |
| F4-16 | 关联 Pod 支持终端操作 | 🟢 | 已验证 |
| F4-17 | 修复时间格式（UTC 转本地时间） | 🟢 | 已验证 |
| F4-18 | 修复日志查看器默认容器选择问题 | 🟢 | 已验证 |
| F4-19 | 修复 Pod 终端 z-index 遮挡问题 | 🟢 | 已验证 |

#### 2.5 Ingress 管理 ✅ 已完成

> **功能范围**: 创建、编辑、YAML 编辑、删除

| 任务ID | 任务描述 | 状态 | 进度 |
|--------|----------|------|------|
| B4-02 | 实现 Ingress 创建 API | 🟢 | 已验证 |
| B4-09 | 实现 Ingress 编辑 API (PUT) | 🟢 | 已验证 |
| B4-11 | 实现 Ingress YAML 获取 API | 🟢 | 已验证 |
| F4-04 | 实现 `IngressForm.tsx` 创建表单 | 🟢 | 已验证 |
| F4-10 | IngressForm 支持编辑模式 | 🟢 | 已验证 |
| F4-12 | Ingress 集成 YAML 编辑功能 | 🟢 | 已验证 |

#### 2.6 网关路由 (Gateway API) 🟡 开发完成

> **背景**: Ingress-nginx 控制器将于 2026 年 3 月后停止维护，新增 Gateway API 支持作为下一代入口流量管理方案。
>
> **支持范围**: 仅实现 GA 稳定版资源（GatewayClass、Gateway、HTTPRoute、GRPCRoute）。
>
> **注意**: 当前环境未安装 Gateway API CRD，无法进行实际验证。需在安装 CRD 的环境中测试。

| 任务ID | 任务描述 | 状态 | 进度 |
|--------|----------|------|------|
| B4-03 | 实现 Gateway API CRD 检测接口 | 🟡 | 开发完成 |
| B4-04 | 实现 GatewayClass 列表 API (只读) | 🟡 | 开发完成 |
| B4-05 | 实现 Gateway 列表/创建/删除 API | 🟡 | 开发完成 |
| B4-06 | 实现 HTTPRoute 列表/创建/删除 API | 🟡 | 开发完成 |
| B4-07 | 实现 GRPCRoute 列表/创建/删除 API | 🟡 | 开发完成 |
| F4-01 | 重构 Tab 结构，拆分服务发现为独立 Tab | 🟡 | 开发完成 |
| F4-02 | 扩展 `harvesterApi.ts` 添加 Gateway API 函数 | 🟡 | 开发完成 |
| F4-05 | 实现 `GatewayApiSection.tsx` 主组件 | 🟡 | 开发完成 |
| F4-06 | 实现 `GatewayForm.tsx` 创建表单 | 🟡 | 开发完成 |
| F4-07 | 实现 `HTTPRouteForm.tsx` 创建表单 | 🟡 | 开发完成 |
| F4-08 | 实现 `GRPCRouteForm.tsx` 创建表单 | 🟡 | 开发完成 |

**后端 API 列表**:
| API | 方法 | 路径 | 说明 |
|-----|------|------|------|
| CRD 状态检测 | GET | `/gateway/crd-status` | 检测 Gateway API CRD 是否已安装 |
| GatewayClass 列表 | GET | `/gateway/gatewayclasses` | 获取所有 GatewayClass |
| Gateway 列表 | GET | `/gateway/gateways` | 获取所有 Gateway |
| Gateway 创建 | POST | `/gateway/gateways` | 创建 Gateway |
| Gateway 删除 | DELETE | `/gateway/gateways/:ns/:name` | 删除 Gateway |
| HTTPRoute 列表 | GET | `/gateway/httproutes` | 获取所有 HTTPRoute |
| HTTPRoute 创建 | POST | `/gateway/httproutes` | 创建 HTTPRoute |
| HTTPRoute 删除 | DELETE | `/gateway/httproutes/:ns/:name` | 删除 HTTPRoute |
| GRPCRoute 列表 | GET | `/gateway/grpcroutes` | 获取所有 GRPCRoute |
| GRPCRoute 创建 | POST | `/gateway/grpcroutes` | 创建 GRPCRoute |
| GRPCRoute 删除 | DELETE | `/gateway/grpcroutes/:ns/:name` | 删除 GRPCRoute |

#### 2.7 配置管理创建 ✅ 已完成

| 任务ID | 任务描述 | 状态 | 进度 |
|--------|----------|------|------|
| B2-06 | 实现 ConfigMap/Secret 创建/更新/详情/删除 API | 🟢 | 已验证 |
| F2-08 | 实现 `ConfigMapForm.tsx` 创建/编辑表单 | 🟢 | 已验证 |
| F2-09 | 实现 `SecretForm.tsx` 创建/编辑表单 | 🟢 | 已验证 |
| F2-10 | 实现 Secret 值脱敏展示（详情页支持显示/隐藏切换） | 🟢 | 已验证 |

**后端 API 列表**:
| API | 方法 | 路径 | 说明 |
|-----|------|------|------|
| 创建 ConfigMap | POST | `/containers/configmaps` | 创建 ConfigMap |
| ConfigMap 详情 | GET | `/containers/configmaps/:ns/:name` | 获取 ConfigMap 详情 |
| 更新 ConfigMap | PUT | `/containers/configmaps/:ns/:name` | 更新 ConfigMap |
| 删除 ConfigMap | DELETE | `/containers/configmaps/:ns/:name` | 删除 ConfigMap |
| 创建 Secret | POST | `/containers/secrets` | 创建 Secret (使用 stringData) |
| Secret 详情 | GET | `/containers/secrets/:ns/:name` | 获取 Secret 详情 (支持 reveal 参数) |
| 更新 Secret | PUT | `/containers/secrets/:ns/:name` | 更新 Secret |
| 删除 Secret | DELETE | `/containers/secrets/:ns/:name` | 删除 Secret |

**功能特性**:
- ConfigMap: 支持键值对配置数据管理
- Secret: 支持多种类型（Opaque、Basic Auth、SSH Auth、TLS）
- Secret 脱敏: 详情页支持显示/隐藏值切换
- 编辑模式: 名称、命名空间禁用，自动填充现有数据

#### 2.8 镜像仓库增强 ✅ 已完成

| 任务ID | 任务描述 | 状态 | 进度 |
|--------|----------|------|------|
| B2-07 | 实现镜像凭证创建 API | 🟢 | 已验证 |
| B2-08 | 实现 Registry Catalog/Tags API 代理 | 🟢 | 已验证 |
| B2-09 | 实现 HTTP 协议支持 (insecure 参数) | 🟢 | 已验证 |
| F2-11 | 实现镜像凭证创建表单 `RegistryCredentialModal.tsx` | 🟢 | 已验证 |
| F2-12 | 实现 `RegistryBrowser.tsx` 仓库浏览器 | 🟢 | 已验证 |
| F2-14 | 实现 `RegistryBrowserDrawer.tsx` 浏览器抽屉 | 🟢 | 已验证 |
| F2-15 | 实现 `RegistryInfoDrawer.tsx` 仓库详情抽屉 | 🟢 | 已验证 |
| F2-16 | 实现仓库列表管理（localStorage 持久化） | 🟢 | 已验证 |
| F2-17 | 重构 `RegistriesSection.tsx` Tab 切换布局 | 🟢 | 已验证 |
| F2-18 | 集成 Docker Registry 部署 | 🟢 | 已验证 |

### 二期验收标准

- [x] 能够通过表单创建 Deployment
- [x] 能够通过 YAML 创建 Deployment
- [x] 能够创建 StatefulSet
- [x] 能够创建 DaemonSet
- [x] 能够进入 Pod 终端
- [x] 能够创建 Job 和 CronJob
- [x] 能够暂停/恢复 CronJob
- [x] 能够查看 Job 失败原因和日志
- [x] 能够重试失败的 Job
- [x] 能够创建 Service
- [x] 能够创建 Ingress
- [ ] 能够检测 Gateway API CRD 是否已安装 - 🟡 开发完成待验证
- [ ] 能够查看 GatewayClass 列表 - 🟡 开发完成待验证
- [ ] 能够创建和删除 Gateway - 🟡 开发完成待验证
- [ ] 能够创建和删除 HTTPRoute - 🟡 开发完成待验证
- [ ] 能够创建和删除 GRPCRoute - 🟡 开发完成待验证
- [x] 能够创建 ConfigMap 和 Secret
- [x] Secret 值正确脱敏
- [x] 能够创建镜像凭证
- [x] 能够添加自定义镜像仓库
- [x] 能够浏览镜像仓库中的镜像和标签
- [x] 能够复制镜像地址
- [x] 能够编辑 Service（表单模式）
- [x] 能够编辑 Ingress（表单模式）
- [x] 能够通过 YAML 编辑 Service
- [x] 能够通过 YAML 编辑 Ingress
- [x] 能够查看 Service 关联的 Pod
- [x] 关联 Pod 支持详情/日志/终端操作
- [x] 时间格式正确显示为本地时间


## 三期（高级功能）

> **目标**: 补充高级调度策略、网络策略、交互优化、租户视角等功能

### 功能范围

| 模块 | 功能 | 优先级 | 状态 |
|------|------|--------|------|
| **高级调度策略** | 节点亲和性/反亲和性、Pod亲和性/反亲和性、污点容忍、PDB | 高 | 🟢 已完成 |
| **NetworkPolicy** | 网络策略可视化管理 | 高 | 🟢 已完成 |
| **交互优化** | 表单内快速创建关联资源 | 高 | 🟢 已完成 |
| **服务拓扑** | Ingress→Service→Pod 可视化 | 中 | 🟢 已完成 |
| **应用向导** | 引导式部署流程 | 中 | 🔴 待开始 |
| **租户视角** | 租户工作台、资源概览、配额管理 | 中 | 🔴 待开始 |
|**测试问题优化**|工作负载创建流程优化，实体的名称和别名调整，job和pod的联动|高|🟡 进行中|

---

### 3.10 Job Pod 清理策略

> **优先级**: 高 | **预计工作量**: 0.5天 | **创建日期**: 2026-04-21

#### 功能说明

为 Job 添加 `ttlSecondsAfterFinished` 配置，支持 Job 完成后自动清理 Pod。

#### 任务清单

| 任务ID | 任务描述 | 状态 | 进度 |
|--------|----------|------|------|
| F5-01 | JobForm 添加 ttlSecondsAfterFinished 表单字段 | 🔴 | 待开始 |
| F5-02 | 默认值设置为 3600 秒 | 🔴 | 待开始 |
| F5-03 | Job 详情页展示该配置值 | 🔴 | 待开始 |

#### 验收标准

- [ ] Job 创建表单包含 `ttlSecondsAfterFinished` 字段
- [ ] 默认值为 3600 秒
- [ ] Job 详情页展示该配置值

---

### 3.11 资源命名与标签规范（双轨制）

> **优先级**: 高 | **预计工作量**: 3-4天 | **创建日期**: 2026-04-21

#### 功能说明

为所有容器资源采用双轨制命名：
- 自动生成 ID 作为 `metadata.name`
- 用户输入作为 `metadata.annotations['tower.io/alias']`

#### 缩写映射表

| 资源类型 | 缩写 | ID 示例 |
|---------|------|---------|
| Deployment | dep | `id-dep-juhmrs3j0ie` |
| StatefulSet | sts | `id-sts-rs0m3keigh` |
| DaemonSet | ds | `id-ds-6e82c9gvc1f` |
| Job | job | `id-job-3k9z0x8af21` |
| CronJob | cjob | `id-cjob-7m2p5q1bh89` |
| Service | svc | `id-svc-4n8k2w6cd35` |
| Ingress | ing | `id-ing-1j3l9t7ef02` |
| ConfigMap | cm | `id-cm-5m8n1p3qr67` |
| Secret | sec | `id-sec-2j4k6l8mn01` |
| PDB | pdb | `id-pdb-9a1b3c5de78` |
| NetworkPolicy | np | `id-np-7m2p5q1bh89` |
| 镜像凭证 | imgsc | `id-imgsc-6f8g0h2ij45` |

#### 任务清单

| 任务ID | 任务描述 | 状态 | 进度 |
|--------|----------|------|------|
| F5-10 | 扩展 harvesterUtils.ts 缩写映射 | 🔴 | 待开始 |
| F5-11 | WorkloadForm 双轨制命名（先做验证） | 🔴 | 待开始 |
| F5-12 | WorkloadsSection 名称列显示别名+编辑按钮，新增ID列 | 🔴 | 待开始 |
| F5-13 | JobForm 双轨制命名 | 🔴 | 待开始 |
| F5-14 | CronJobForm 双轨制命名 | 🔴 | 待开始 |
| F5-15 | JobsSection 名称列显示别名+编辑按钮，新增ID列 | 🔴 | 待开始 |
| F5-16 | ServiceForm 双轨制命名 | 🔴 | 待开始 |
| F5-17 | ServicesSection 名称列显示别名+编辑按钮，新增ID列 | 🔴 | 待开始 |
| F5-18 | IngressForm 双轨制命名 | 🔴 | 待开始 |
| F5-19 | IngressesSection 名称列显示别名+编辑按钮，新增ID列 | 🔴 | 待开始 |
| F5-20 | ConfigMapForm 双轨制命名 | 🔴 | 待开始 |
| F5-21 | SecretForm 双轨制命名 | 🔴 | 待开始 |
| F5-22 | ConfigsSection 名称列显示别名+编辑按钮，新增ID列 | 🔴 | 待开始 |
| F5-23 | PDBForm 双轨制命名 | 🔴 | 待开始 |
| F5-24 | PDBSection 名称列显示别名+编辑按钮，新增ID列 | 🔴 | 待开始 |
| F5-25 | NetworkPolicyForm 双轨制命名 | 🔴 | 待开始 |
| F5-26 | NetworkPoliciesSection 名称列显示别名+编辑按钮，新增ID列 | 🔴 | 待开始 |
| F5-27 | RegistryCredentialForm 双轨制命名 | 🔴 | 待开始 |
| F5-28 | harvesterApi.ts 添加各资源 PATCH 方法 | 🔴 | 待开始 |
| F5-29 | 后端添加 PATCH 路由支持 | 🔴 | 待开始 |

#### 实施策略

**分阶段执行，先验证后推广**：
1. 先完成 F5-10（工具函数）和 F5-11（WorkloadForm）
2. 验证通过后，按表单 → 列表 → API 顺序推进其他资源

#### 验收标准

- [ ] 创建资源时自动生成 ID 作为 `metadata.name`
- [ ] 用户输入存为 `tower.io/alias`
- [ ] 列表页名称列显示别名
- [ ] 列表页新增 ID 列
- [ ] 支持通过编辑按钮修改别名
- [ ] 编辑现有资源时正确回显别名

---

### 3.1 高级调度策略

> **优先级**: 高 | **预计工作量**: 3-5天

#### 功能说明

| 功能 | 描述 | Kubernetes 字段 |
|------|------|-----------------|
| **节点亲和性** | 控制 Pod 调度到特定节点 | `spec.affinity.nodeAffinity` |
| **节点反亲和性** | 避免调度到特定节点 | `spec.affinity.nodeAntiAffinity` |
| **Pod 亲和性** | 将 Pod 调度到与其他 Pod 相同节点 | `spec.affinity.podAffinity` |
| **Pod 反亲和性** | 将 Pod 分散到不同节点 | `spec.affinity.podAntiAffinity` |
| **污点容忍** | 允许 Pod 调度到有污点的节点 | `spec.tolerations` |
| **拓扑分布约束** | 跨拓扑域均衡分布 Pod | `spec.topologySpreadConstraints` |
| **PodDisruptionBudget** | 限制自愿中断时的 Pod 数量 | `policy/v1/PodDisruptionBudget` |

#### 任务清单

| 任务ID | 任务描述 | 状态 | 进度 |
|--------|----------|------|------|
| B4-01 | 扩展 WorkloadForm 添加调度配置步骤 | 🟢 | 已验证 |
| F4-01 | 实现节点亲和性配置表单 | 🟢 | 已验证 |
| F4-02 | 实现 Pod 亲和性/反亲和性配置表单 | 🟢 | 已验证 |
| F4-03 | 实现污点容忍配置表单 | 🟢 | 已验证 |
| F4-04 | 实现拓扑分布约束配置表单 | ⏸️ | 暂缓（Pod反亲和性已满足分散需求） |
| F4-05 | 实现 PDB 创建/管理功能 | 🟢 | 已验证 |

#### 开发说明

**已完成内容**:
- 工作负载创建表单新增"调度策略"配置区域
- 节点亲和性编辑器：支持 required (必须) 和 preferred (偏好) 规则配置
- Pod 亲和性/反亲和性编辑器：支持标签选择器、命名空间选择、拓扑域配置
- 污点容忍编辑器：支持 Key/Operator/Value/Effect 配置，提供常用预设快速添加
- PodDisruptionBudget 独立功能：列表展示、创建、删除、YAML 编辑

**已验证内容** (2026-03-24):
- ✅ 前端按钮交互响应 - 所有添加/删除/编辑操作正常
- ✅ 表单数据与 YAML 的正确转换 - 亲和性/容忍配置正确序列化
- ✅ 节点亲和性/反亲和性 - 匹配表达式和匹配字段配置正常
- ✅ Pod 亲和性/反亲和性 - 匹配标签和匹配表达式配置正常
- ✅ 污点容忍 - 添加/删除/预设选择正常，表单布局优化完成

**已验证内容**:
- ✅ PDB 后端 API - 创建/列表/删除/YAML编辑功能已验证
- ✅ PDB 界面交互 - 表单创建、详情查看已验证
- ✅ PDB 保护机制 - 通过批量驱逐测试验证 PDB 规则生效

**暂缓内容**:
- ⏸️ 拓扑分布约束 (TopologySpreadConstraints) 配置表单 - Pod 反亲和性已满足分散需求

#### UI 设计

```
WorkloadForm 步骤3: 高级配置
├── 调度策略
│   ├── 节点亲和性
│   │   ├── [+] 添加规则
│   │   │   ├── 匹配类型: required/preferred
│   │   │   ├── 节点选择器 (标签匹配)
│   │   │   └── 权重 (preferred 时)
│   ├── Pod 亲和性
│   │   ├── [+] 添加规则
│   │   │   ├── 匹配类型: required/preferred
│   │   │   ├── 目标 Pod 选择器
│   │   │   ├── 拓扑域 (topologyKey)
│   │   │   └── 权重
│   └── 污点容忍
│       ├── [+] 添加容忍
│       │   ├── Key
│       │   ├── Operator (Equal/Exists)
│       │   ├── Effect (NoSchedule/NoExecute/PreferNoSchedule)
│       │   └── TolerationSeconds (可选)
```

---

### 3.2 NetworkPolicy 网络策略管理

> **优先级**: 高 | **预计工作量**: 3-4天

#### 功能说明

NetworkPolicy 是 Kubernetes 原生资源，用于控制 Pod 之间的网络访问（类似安全组）。

**与 Kube-OVN SNAT/DNAT 的区别**:
- SNAT/DNAT 是 NAT 规则，用于地址转换
- NetworkPolicy 是网络访问控制，用于安全隔离

#### 功能范围

| 功能 | 描述 | API |
|------|------|-----|
| 列表查询 | 查询所有 NetworkPolicy | `GET /apis/networking.k8s.io/v1/namespaces/{ns}/networkpolicies` |
| 创建 | 创建网络策略 | `POST /apis/networking.k8s.io/v1/namespaces/{ns}/networkpolicies` |
| 更新 | 更新网络策略 | `PUT /apis/networking.k8s.io/v1/namespaces/{ns}/networkpolicies/{name}` |
| 删除 | 删除网络策略 | `DELETE /apis/networking.k8s.io/v1/namespaces/{ns}/networkpolicies/{name}` |

#### 任务清单

| 任务ID | 任务描述 | 状态 | 进度 |
|--------|----------|------|------|
| B4-10 | 实现 NetworkPolicy 列表/创建/删除 API | 🟢 | 已验证 |
| F4-10 | 实现 `NetworkPoliciesSection.tsx` 组件 | 🟢 | 已验证 |
| F4-11 | 实现 `NetworkPolicyForm.tsx` 创建表单 | 🟢 | 已验证 |
| F4-12 | 实现入站规则配置 | 🟢 | 已验证 |
| F4-13 | 实现出站规则配置 | 🟢 | 已验证 |

#### UI 设计

```
NetworkPolicy 创建表单
├── 基本信息
│   ├── 名称
│   ├── 命名空间
│   └── Pod 选择器 (应用策略的目标 Pod)
│
├── 入站规则
│   ├── [+] 添加规则
│   │   ├── 规则类型: 允许/拒绝
│   │   ├── 来源类型
│   │   │   ├── Pod 选择器
│   │   │   ├── 命名空间选择器
│   │   │   ├── IP 地址块
│   │   │   └── 组合选择器
│   │   └── 端口配置
│   │       ├── 协议 (TCP/UDP/SCTP)
│   │       └── 端口号
│
├── 出站规则
│   └── (同入站规则结构)
│
└── 策略类型
    ├── 仅入站
    ├── 仅出站
    └── 入站+出站
```

#### 在导航中的位置

```
容器 Tab
├── 工作负载
├── Pod
├── 任务
├── Service
├── Ingress
├── 网关路由
├── 网络策略  ← 新增
├── 配置管理
└── 镜像仓库
```

---

### 3.3 交互优化 - 表单内快速创建

> **优先级**: 高 | **预计工作量**: 2-3天

#### 功能说明

在创建工作负载时，发现需要 ConfigMap/Secret，无需退出表单，可直接在表单内快速创建。

#### 优化点

| 场景 | 当前体验 | 优化后 |
|------|----------|--------|
| 环境变量引用 | 需要退出→切换Tab→创建→返回 | 表单内弹窗快速创建 |
| 存储卷挂载 | 需要退出→切换Tab→创建→返回 | 表单内弹窗快速创建 |
| 镜像拉取凭证 | 需要退出→切换Tab→创建→返回 | 表单内下拉快速创建 |

#### 任务清单

| 任务ID | 任务描述 | 状态 | 进度 |
|--------|----------|------|------|
| F4-20 | WorkloadForm 环境变量配置添加快速创建入口 | 🟢 | 已验证 |
| F4-21 | WorkloadForm 存储卷配置添加快速创建入口 | 🟢 | 已验证 |
| F4-22 | WorkloadForm 镜像凭证添加快速创建入口 | 🟢 | 已验证 |
| F4-23 | 实现快速创建 ConfigMap 弹窗 | 🟢 | 已验证 |
| F4-24 | 实现快速创建 Secret 弹窗 | 🟢 | 已验证 |

#### UI 设计

```
WorkloadForm - 容器配置步骤
├── 环境变量
│   ├── [从 ConfigMap 引入]  [选择现有 ▼]  [+ 快速创建]
│   │                                    └── 弹窗创建 ConfigMap
│   └── [从 Secret 引入]    [选择现有 ▼]  [+ 快速创建]
│                                        └── 弹窗创建 Secret
│
├── 存储卷挂载
│   ├── [ConfigMap 卷]      [选择现有 ▼]  [+ 快速创建]
│   ├── [Secret 卷]         [选择现有 ▼]  [+ 快速创建]
│   └── [PVC 持久卷]        [选择现有 ▼]  [+ 快速创建]
│
└── 镜像拉取凭证
    └── [选择凭证 ▼]  [+ 创建新凭证]
```

---

### 3.4 服务拓扑可视化

> **优先级**: 中 | **预计工作量**: 3-4天

#### 功能说明

将 Ingress → Service → Pod 的调用链可视化展示，帮助用户快速定位问题。

#### 任务清单

| 任务ID | 任务描述 | 状态 | 进度 |
|--------|----------|------|------|
| F4-30 | 实现服务拓扑数据聚合逻辑 | 🟢 | 已验证 |
| F4-31 | 实现 `ServiceTopology.tsx` 拓扑图组件 | 🟢 | 已验证 |
| F4-32 | 集成到服务发现 Tab | 🟢 | 已验证 |
| F4-33 | 拓扑节点点击交互（查看详情） | 🟢 | 已验证 |

#### UI 设计

```
┌─────────────────────────────────────────────────────────────┐
│  服务拓扑                                                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│     ┌─────────────────┐                                    │
│     │ Ingress         │                                    │
│     │ api.example.com │                                    │
│     └────────┬────────┘                                    │
│              │                                              │
│              ▼                                              │
│     ┌─────────────────┐                                    │
│     │ Service         │                                    │
│     │ my-service:8080 │                                    │
│     └────────┬────────┘                                    │
│              │                                              │
│     ┌────────┼────────┐                                    │
│     ▼        ▼        ▼                                    │
│  ┌──────┐ ┌──────┐ ┌──────┐                               │
│  │Pod-1 │ │Pod-2 │ │Pod-3 │                               │
│  │10.1  │ │10.2  │ │10.3  │                               │
│  └──────┘ └──────┘ └──────┘                               │
│                                                             │
│  💡 点击节点可查看详情/日志/终端                             │
└─────────────────────────────────────────────────────────────┘
```

---

### 3.5 应用向导部署

> **优先级**: 中 | **预计工作量**: 4-5天

#### 功能说明

为新用户提供引导式部署流程，无需理解 K8s 资源模型即可部署应用。

#### 任务清单

| 任务ID | 任务描述 | 状态 | 进度 |
|--------|----------|------|------|
| F4-40 | 实现应用向导入口 | 🔴 | 待开始 |
| F4-41 | 实现步骤1：应用类型选择 | 🔴 | 待开始 |
| F4-42 | 实现步骤2：基础配置 | 🔴 | 待开始 |
| F4-43 | 实现步骤3：容器配置 | 🔴 | 待开始 |
| F4-44 | 实现步骤4：存储配置 | 🔴 | 待开始 |
| F4-45 | 实现步骤5：网络配置 | 🔴 | 待开始 |
| F4-46 | 实现一键部署（自动创建所有资源） | 🔴 | 待开始 |

#### UI 流程

```
步骤1: 选择应用类型
┌─────────────────────────────────────────────────────────────┐
│  选择部署方式                                                │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │ 📦 从模板选择    │  │ ✏️ 自定义部署    │                  │
│  │                 │  │                 │                  │
│  │ 使用预置模板     │  │ 从零开始配置    │                  │
│  │ (Nginx/Redis等) │  │                 │                  │
│  └─────────────────┘  └─────────────────┘                  │
└─────────────────────────────────────────────────────────────┘

步骤2: 基础配置
┌─────────────────────────────────────────────────────────────┐
│  应用名称: [nginx-app        ]                              │
│                                                             │
│  命名空间: [default    ▼]  [+ 创建新命名空间]               │
│                                                             │
│  副本数:   [3]                                              │
└─────────────────────────────────────────────────────────────┘

步骤3-5: 容器/存储/网络配置 (略)

步骤6: 确认部署
┌─────────────────────────────────────────────────────────────┐
│  部署摘要                                                    │
│  ├── Deployment: nginx-app (3副本)                          │
│  ├── Service: nginx-app-svc (NodePort: 30080)              │
│  └── Ingress: nginx.example.com                            │
│                                                             │
│  [上一步]                        [🚀 开始部署]              │
└─────────────────────────────────────────────────────────────┘
```

---

### 3.6 租户视角设计

> **优先级**: 中 | **预计工作量**: 5-7天

#### 功能说明

为租户用户提供独立的门户和操作界面，与系统管理员视角区分。

#### 现状问题

| 问题 | 描述 |
|------|------|
| 共用管理员界面 | 所有页面位于 `/admin/*`，租户用户共用管理员界面 |
| 缺少独立门户 | 租户无法直观看到自己的资源概览 |
| 配额不可见 | 租户无法看到配额使用情况 |
| 自服务能力不足 | 租户无法自主管理组织、申请资源 |

#### 路由规划

```
/tenant/                      # 租户专属路由
├── dashboard                 # 租户工作台
├── my-resources              # 我的资源
│   ├── virtual-machines      # 虚拟机
│   ├── workloads             # 工作负载
│   ├── pods                  # Pod
│   ├── volumes               # 存储卷
│   └── networks              # 网络
├── my-quotas                 # 配额管理
│   ├── overview              # 配额概览
│   └── requests              # 申请记录
└── settings                  # 租户设置
    ├── members               # 成员管理
    └── keys                  # 密钥管理
```

#### 任务清单

| 任务ID | 任务描述 | 状态 | 进度 |
|--------|----------|------|------|
| B4-60 | 设计租户路由和布局结构 | 🔴 | 待开始 |
| B4-61 | 实现租户权限隔离增强 | 🔴 | 待开始 |
| F4-60 | 实现 `TenantLayout.tsx` 租户布局 | 🔴 | 待开始 |
| F4-61 | 实现 `TenantDashboard.tsx` 租户工作台 | 🔴 | 待开始 |
| F4-62 | 实现 `TenantResources.tsx` 我的资源 | 🔴 | 待开始 |
| F4-63 | 实现 `TenantQuotas.tsx` 配额管理 | 🔴 | 待开始 |
| F4-64 | 实现租户导航菜单 | 🔴 | 待开始 |

#### 租户工作台设计

```
┌─────────────────────────────────────────────────────────────┐
│ 租户工作台 - XXX公司                           [🔔] [👤]    │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐│
│ │ 我的虚拟机       │ │ 我的容器        │ │ 存储使用        ││
│ │                 │ │                 │ │                 ││
│ │   5 / 10       │ │  20 / 50 Pod    │ │  100GB / 500GB  ││
│ │   cpu: 4/8核   │ │  cpu: 8/16核    │ │   70% 已用      ││
│ │   mem: 16/32GB │ │  mem: 32/64GB   │ │                 ││
│ └─────────────────┘ └─────────────────┘ └─────────────────┘│
│                                                             │
│ 快速操作                                                    │
│ ┌────────────┐ ┌────────────┐ ┌────────────┐              │
│ │ 🚀 快速部署 │ │ 📦 创建VM  │ │ 📁 申请配额 │              │
│ └────────────┘ └────────────┘ └────────────┘              │
│                                                             │
│ 最近操作                              [查看全部]           │
│ ┌─────────────────────────────────────────────────────────┐│
│ │ • 10:30 创建了工作负载 nginx-app                         ││
│ │ • 09:15 扩容了虚拟机 test-vm (2核→4核)                   ││
│ │ • 昨天 申请了 50GB 存储扩容 [审批中]                     ││
│ └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```


### 3.7 工作负载多容器支持

> **优先级**: 高 | **预计工作量**: 3-4天

#### 功能说明

当前工作负载创建表单只支持单容器配置，需要支持多容器（Pod 中可以包含多个容器）。

**每个容器可独立配置**:
- 容器名称
- 镜像地址
- 端口配置
- 环境变量
- 资源限制（CPU/内存）
- 健康检查
- 存储卷挂载

#### 界面重构

参考 VM 创建向导的三列布局：
- **左侧**: 步骤导航
- **中间**: 表单内容
- **右侧**: 配置预览

```
┌─────────────────────────────────────────────────────────────────────┐
│ 创建工作负载                                                         │
├────────────┬──────────────────────────────┬────────────────────────┤
│ 步骤       │ 表单内容                      │ 配置预览               │
│            │                              │                        │
│ 1. 基本信息 │ ┌──────────────────────────┐│ 名称: nginx-app        │
│ 2. 容器配置 │ │ 容器列表                  ││ 命名空间: default      │
│ 3. 高级配置 │ │ ┌──────────────────────┐ ││ 类型: Deployment      │
│            │ │ │ 容器1: nginx          │ ││                        │
│            │ │ │ 镜像: nginx:latest    │ ││ 容器:                  │
│            │ │ │ [编辑] [删除]         │ ││ - nginx (nginx:latest)│
│            │ │ └──────────────────────┘ ││ - sidecar (busybox)   │
│            │ │ ┌──────────────────────┐ │ │                        │
│            │ │ │ 容器2: sidecar       │ ││ 副本数: 3              │
│            │ │ │ 镜像: busybox        │ ││                        │
│            │ │ │ [编辑] [删除]         │ ││                        │
│            │ │ └──────────────────────┘ │ │                        │
│            │ │ [+ 添加容器]             │ │                        │
│            │ └──────────────────────────┘│                        │
└────────────┴──────────────────────────────┴────────────────────────┘
```

#### 任务清单

| 任务ID | 任务描述 | 状态 | 进度 |
|--------|----------|------|------|
| F4-80 | 重构 WorkloadForm 为三列布局 | 🟢 | 已验证 |
| F4-81 | 实现容器列表动态增删 | 🟢 | 已验证 |
| F4-82 | 实现当前容器配置编辑区与容器切换 | 🟢 | 已验证 |
| F4-83 | 实现配置预览组件 | 🟢 | 已验证 |
| F4-84 | 更新 buildK8sResource 支持多容器 | 🟢 | 已验证 |

---

### 3.8 Pod 详情术语优化

> **优先级**: 中 | **预计工作量**: 1天

#### 问题说明

1. **命名混淆**: Pod 详情中的"条件"容易与 PDB 的"保护条件"混淆
2. **术语晦涩**: `PodScheduled`、`ContainersReady` 等专有名词不易理解

#### 解决方案

| 优化项 | 当前 | 优化后 |
|--------|------|--------|
| Tab 名称 | 条件 | 状态条件 |
| 类型字段 | 英文原文 | 英文 + Tooltip 说明 |

#### Tooltip 说明内容

| 类型 | 说明 |
|------|------|
| `PodScheduled` | Pod 已被调度到某个节点 |
| `Initialized` | Init 容器全部执行成功 |
| `ContainersReady` | 所有容器都已启动并通过就绪检查 |
| `Ready` | Pod 可以接收服务流量 |
| `PodReadyToStartContainers` | 网络和存储已就绪，容器可以启动（K8s 1.29+） |

#### 任务清单

| 任务ID | 任务描述 | 状态 | 进度 |
|--------|----------|------|------|
| F4-90 | PodsSection 条件 Tab 改名为"状态条件" | 🟡 | 开发完成 |
| F4-91 | 类型字段添加 Tooltip 说明 | 🟡 | 开发完成 |

### 3.9 工作负载表单交互优化

> **优先级**: 高 | **预计工作量**: 2-3天 | **创建日期**: 2026-04-17

#### 功能说明

优化工作负载创建表单的交互体验，包括：
1. Deployment翻译修正
2. 副本数移至基本信息步骤
3. 容器配置改为独立Card布局
4. 镜像拉取凭证移至容器级
5. 容器配置项折叠
6. PVC下拉框显示格式优化
7. 亲和性/污点容忍折叠
8. Cloudmap乱码修复

#### 任务清单

| 任务ID | 任务描述 | 状态 | 进度 |
|--------|----------|------|------|
| F4-100 | 修复Cloudmap backups_group/index.tsx乱码 | 🟢 | 已验证 |
| F4-101 | Deployment翻译改为"无状态副本集" | 🟢 | 已验证 |
| F4-102 | 副本数从高级配置移至基本信息步骤 | 🟢 | 已验证 |
| F4-103 | 容器配置改为独立Card布局（垂直排列） | 🟢 | 已验证 |
| F4-104 | 镜像拉取凭证移至每个容器镜像地址后 | 🟡 | 开发完成待验证 |
| F4-105 | 环境变量/资源限制/启动命令/健康检查折叠 | 🟢 | 已验证 |
| F4-106 | PVC下拉框显示"名称(ID)"格式 | 🟡 | 开发完成待验证 |
| F4-107 | 亲和性配置/污点容忍折叠 | 🟢 | 已验证 |

#### 修复记录

**后端API超时优化** (2026-04-17):
- 文件: `backend/src/services/clouds/harvester/utils.ts`
- 问题: K8s API请求超时导致secrets/imagePullSecrets数据加载失败
- 修复: `getJsonOnce` 函数超时时间从15秒增加到30秒
- 影响: 解决F4-104和F4-106的下拉框数据不显示问题

#### 详细设计

**1. Cloudmap乱码修复**:
- 文件: `frontend/src/pages/cnmc/clouds/Cloudmap/tabs/backups_group/index.tsx`
- 第92行: `'虚拟机备份'` ✅ 已修复
- 第111行: `'虚拟机快照'` ✅ 已修复
- 第130行: `'定时备份'` ✅ 已修复
- 第182行: `'恢复任务'` ✅ 已修复

**2. Deployment翻译**:
- 文件: `WorkloadsSection.tsx`
- 第142行、第486行: `'部署'` → `'无状态副本集'`

**3. 副本数移动**:
- 文件: `WorkloadForm.tsx`
- 删除: 第4541-4548行（高级配置中的副本数）
- 插入: 第4340行后（基本信息步骤）
- 约束: 仅对Deployment/StatefulSet显示

**4. 容器Card布局**:
- 重构 `renderContainerSwitchPanel` (4221-4281行)
- 每个容器独立Card，垂直排列
- Card标题栏: 容器名称 + 删除/复制按钮
- Card内容: 镜像、端口、折叠配置项
- 底部: 添加容器按钮

**5. 镜像拉取凭证移动**:
- 类型定义: `WorkloadContainerFormValue` 添加 `imagePullSecrets?: string[]`
- 工厂函数: `createEmptyContainer` 添加 `imagePullSecrets: []`
- UI渲染: 在镜像拉取策略后添加凭证选择器
- 提交逻辑: 收集所有容器凭证，合并去重后放到Pod spec
- 删除: 第4559-4609行（高级配置中的顶层imagePullSecrets）
- 添加Alert: 提示K8s限制

**6. 容器配置项折叠**:
- 环境变量 (4450-4461行) → Collapse ghost
- 资源限制 (4463-4485行) → Collapse ghost
- 启动命令 (4487-4509行) → Collapse ghost
- 健康检查 (4511-4513行) → Collapse ghost
- 默认状态: 折叠
- 标题显示: 已配置数量（如"环境变量 (3)"）

**7. PVC下拉框格式**:
- 文件: `VolumesEditor.tsx`
- 第1167-1170行: options映射改为 `alias (metadata.name)` 格式
- 数据来源: `pvc.metadata.annotations['tower.io/alias']`

**8. 亲和性/污点容忍折叠**:
- NodeAffinityEditor (1472-1800行): Collapse包裹
- PodAffinityEditor (1818-2447行): Collapse包裹
- TolerationsEditor (2459-2664行): Collapse包裹
- 渲染调用处 (4611-4628行): 移除Divider
- 默认状态: 折叠
- 标题显示: 已配置数量

#### 数量计算逻辑

```typescript
// 容器配置项
const envCount = env?.length || 0;
const resourceCount = (resources.requests || resources.limits) ? 1 : 0;
const commandCount = (command?.length || args?.length) ? 1 : 0;
const probeCount = (livenessProbe?.enabled ? 1 : 0) + (readinessProbe?.enabled ? 1 : 0);

// 亲和性配置
const affinityCount = requiredRules.length + preferredRules.length;
const tolerationCount = tolerations.length;
```

#### 验收标准

- [ ] Cloudmap备份组标签显示正常（无乱码）
- [ ] Deployment显示为"无状态副本集"
- [ ] 副本数在基本信息步骤配置
- [ ] 容器配置为垂直Card布局
- [ ] 每个容器可独立配置镜像拉取凭证
- [ ] 显示K8s限制提示Alert
- [ ] 环境变量/资源限制/启动命令/健康检查默认折叠
- [ ] 折叠项标题显示已配置数量
- [ ] PVC下拉框显示"名称(ID)"格式
- [ ] 亲和性/污点容忍默认折叠并显示数量
---

## 关键文件

### 已创建文件

```
frontend/src/pages/Clouds/Harvester/containers/
├── index.ts                    # 导出文件
├── WorkloadsSection.tsx        # 工作负载组件
├── PodsSection.tsx             # Pod 组件
├── JobsSection.tsx             # 任务组件 (Job/CronJob)
├── ConfigsSection.tsx          # 配置管理组件 (ConfigMap/Secret)
├── RegistriesSection.tsx       # 镜像仓库组件
├── GatewayApiSection.tsx       # Gateway API 主组件 ✨新增
└── components/
    ├── index.ts                # 组件导出
    ├── WorkloadForm.tsx        # 工作负载创建表单
    ├── WorkloadFormModal.tsx   # 工作负载创建弹窗
    ├── RegistryBrowser.tsx     # 仓库浏览器
    ├── RegistryBrowserDrawer.tsx # 浏览器抽屉
    ├── RegistryCredentialModal.tsx # 凭证创建弹窗
    ├── PodTerminal.tsx         # Pod 终端组件 ✨新增
    ├── JobForm.tsx             # Job 创建表单 ✨新增
    ├── CronJobForm.tsx         # CronJob 创建表单 ✨新增
    ├── ServiceForm.tsx         # Service 创建表单 ✨新增
    ├── ServiceFormModal.tsx    # Service 创建弹窗 ✨新增
    ├── IngressForm.tsx         # Ingress 创建表单 ✨新增
    ├── IngressFormModal.tsx    # Ingress 创建弹窗 ✨新增
    ├── GatewayForm.tsx         # Gateway 创建表单 ✨新增
    ├── GatewayFormModal.tsx    # Gateway 创建弹窗 ✨新增
    ├── HTTPRouteForm.tsx       # HTTPRoute 创建表单 ✨新增
    ├── HTTPRouteFormModal.tsx  # HTTPRoute 创建弹窗 ✨新增
    ├── GRPCRouteForm.tsx       # GRPCRoute 创建表单 ✨新增
    ├── GRPCRouteFormModal.tsx  # GRPCRoute 创建弹窗 ✨新增
    ├── YamlEditModal.tsx       # 通用 YAML 编辑弹窗 ✨新增
    └── PodLogViewer.tsx        # Pod 日志查看组件 ✨新增
    
    frontend/src/pages/Clouds/Harvester/sections/
    ├── ServicesSection.tsx     # Service 列表（含关联 Pod 操作）✨更新
    └── IngressesSection.tsx    # Ingress 列表 ✨更新
    
    frontend/src/pages/Clouds/Harvester/components/
    └── ServiceRelatedPodsTab.tsx  # Service 关联 Pod Tab ✨新增
backend/src/routes/clouds/harvester/
└── harvester.cache.container.routes.ts  # 容器 API 路由 (含 Registry API + Gateway API)

backend/src/ws/
├── ssh.ts                     # SSH 终端 WebSocket
├── vnc.ts                     # VNC WebSocket
├── kvVnc.ts                   # KubeVirt VNC WebSocket
├── kvPodLog.ts                # Pod 日志 WebSocket
└── kvPodExec.ts               # Pod 终端 WebSocket ✨新增
```

### 待创建文件

```
frontend/src/pages/Clouds/Harvester/containers/
└── components/
    ├── ConfigMapForm.tsx       # ConfigMap 创建表单 (二期剩余)
    └── SecretForm.tsx          # Secret 创建表单 (二期剩余)
```

### 三期新增文件

```
frontend/src/pages/Clouds/Harvester/containers/
├── NetworkPoliciesSection.tsx  # NetworkPolicy 列表
└── components/
    ├── NetworkPolicyForm.tsx   # NetworkPolicy 创建表单
    ├── PDBForm.tsx             # PodDisruptionBudget 创建表单
    ├── DeploymentWizard.tsx    # 部署向导组件
    └── ServiceTopology.tsx     # 服务拓扑可视化

frontend/src/pages/Tenant/
├── TenantDashboard.tsx         # 租户工作台
├── TenantWorkloads.tsx         # 租户工作负载视图
└── TenantQuotas.tsx            # 租户配额管理

backend/src/routes/clouds/harvester/
└── harvester.cache.container.routes.ts  # 新增 NetworkPolicy/PDB API
```

---

## 开发规范

### API 使用原则

1. **优先使用已有 API**: 参考 `docs/kubernetes-container-api-reference.md`
2. **遇到缺失先核对**: 发现缺少接口时先提出讨论，不自行实现
3. **避免重复造轮子**: 复用 Harvester 已有的代理机制

### 代码规范

1. **组件命名**: PascalCase (如 `WorkloadsSection.tsx`)
2. **服务命名**: camelCase (如 `fetchDeployments`)
3. **类型定义**: 放在 `types/` 目录或组件内
4. **样式**: 使用 Ant Design 组件，必要时添加内联样式

### Git 提交规范

```
feat(containers): 添加工作负载管理功能
fix(containers): 修复 Pod 日志显示问题
docs(containers): 更新容器功能设计文档
```

---

## 变更记录

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|----------|------|
| 2026-03-10 | 1.0 | 初始版本 | - |
| 2026-03-10 | 1.1 | Phase 1 基础功能完成：工作负载列表、Pod列表/详情/日志 | - |
| 2026-03-10 | 1.2 | 重构为一期/二期划分，清晰标注功能范围 | - |
| 2026-03-10 | 1.3 | 一期任务+服务发现完成：Job/CronJob/Service/Ingress 列表查询 | - |
| 2026-03-10 | 1.4 | 一期配置管理完成：ConfigMap/Secret 列表查询 | - |
| 2026-03-10 | 1.5 | 一期镜像仓库完成：镜像凭证列表查询 | - |
| 2026-03-10 | 1.6 | 一期优化：命名空间筛选修复、Select搜索匹配、性能优化 | - |
| 2026-03-11 | 1.7 | 二期工作负载创建完成：WorkloadForm 表单/YAML双模式 | - |
| 2026-03-11 | 1.8 | 二期工作负载编辑完成：复用表单组件、自动填充配置、滚动更新 | - |
| 2026-03-12 | 1.9 | 二期镜像仓库完成：凭证创建、仓库管理、镜像浏览器、Docker Registry 部署 | - |
| 2026-03-12 | 2.0 | 添加镜像仓库方案对比（Docker Registry/Harbor/Nexus）、部署经验总结、后续验证计划 | - |
| 2026-03-13 | 2.1 | 二期 Pod 终端完成：WebSocket 服务、xterm.js 终端组件、多容器支持 | - |
| 2026-03-13 | 2.1 | 二期 Pod 终端完成：WebSocket 服务、xterm.js 终端组件、多容器支持 | - |
| 2026-03-14 | 2.2 | 添加进度列：一期标注已验证，二期绿色球标注开发完成，红色球标注未开始 | - |
| 2026-03-16 | 2.3 | 镜像仓库增强任务全部标记为已验证 | - |
| 2026-03-17 | 2.4 | 工作负载创建功能验证完成：Deployment/StatefulSet/DaemonSet 创建均已验证 | - |
| 2026-03-17 | 2.5 | 任务创建后端 API 完成：Job/CronJob 创建/详情/删除/暂停恢复/手动触发均已验证 | - |
| 2026-03-18 | 2.6 | 添加 Gateway API 支持：设计文档更新、Tab 结构扁平化、任务拆解 | - |
| 2026-03-18 | 2.7 | 服务发现模块开发完成：Service/Ingress/Gateway API 后端API已验证、前端表单已完成 | - |
| 2026-03-18 | 2.8 | Service/Ingress 增强功能完成：编辑、YAML编辑、查看关联Pod（含详情/日志/终端）、时间格式修复、Bug修复 | - |
| 2026-03-19 | 2.9 | Service/Ingress 增强功能验证完成：表单编辑、YAML编辑（含语法高亮、Tab缩进、滚动条）、关联Pod YAML查看 | - |
| 2026-03-19 | 3.0 | YAML编辑器升级：集成 CodeMirror 6，支持语法高亮、代码折叠、Tab缩进；过滤 managedFields 干扰字段 | - |
| 2026-03-23 | 2.9 | 移除端口转发功能：经评估该功能不符合多云管理平台定位，存在安全风险，主流竞品未提供，故从三期规划中移除 | - |
| 2026-03-23 | 3.0 | 新增三期规划：高级调度策略、NetworkPolicy网络策略、交互优化（表单内快速创建/服务拓扑/应用向导）、租户视角设计、实施优先级规划 | - |
| 2026-03-24 | 3.1 | 高级调度策略验证完成：节点亲和性/反亲和性、Pod亲和性/反亲和性、污点容忍已验证；PDB开发完成待验证；界面文案优化 | - |
| 2026-03-25 | 3.2 | PDB 功能验证完成：创建/列表/删除/YAML编辑、保护机制测试通过；安全驱逐功能保留但隐藏入口 | - |
| 2026-03-25 | 3.3 | 交互优化完成：环境变量/存储卷/镜像凭证快速创建入口；新增 QuickCreateConfigMapModal、QuickCreateSecretModal、QuickCreateRegistrySecretModal 组件 | - |
| 2026-03-26 | 3.4 | NetworkPolicy 网络策略管理开发完成：后端 API（列表/详情/创建/删除）、前端列表组件、创建表单（支持Pod选择器/命名空间选择器/IP块/端口配置）| - |
| 2026-03-26 | 3.5 | 新增后续优化计划：工作负载多容器支持、Pod详情术语优化（状态条件+tooltip）、WorkloadForm界面重构（三列布局）| - |
| 2026-04-02 | 3.6 | 服务拓扑可视化验证完成：Ingress→Service→Pod 拓扑图展示、节点点击交互、命名空间过滤、运维信息 Tab 切换、实时数据查看 | - |
| 2026-04-21 | 3.7 | 新增 Job Pod 清理策略设计（ttlSecondsAfterFinished）和资源命名双轨制设计 | - |
| 2026-04-22 | 3.8 | 新增容器网络配置设计（扁平子网支持）：支持扁平子网、VPC子网、自定义NAD | - |
| 2026-04-22 | 3.9 | 容器网络配置功能验证完成：网络配置步骤、扁平子网/VPC子网/NAD选择器、静态IP配置、网络注解生成、选项格式优化、Harvester隐藏扁平子网选项 | - |
| 2026-04-22 | 4.0 | 创建表单自动填写优化：工作负载/Service/Ingress/ConfigMap/Secret/Job/CronJob/PDB/NetworkPolicy 自动生成名称和默认命名空间 | - |

---

## 性能优化记录

### 问题背景

容器功能模块在获取大量 K8s 资源时出现性能问题：

| 操作 | 优化前耗时 | 问题描述 |
|------|-----------|----------|
| 容器 → 配置管理 → Secret | ~15秒 | 获取所有命名空间的 Secrets |
| 容器 → 镜像仓库 | ~19秒 | 重复请求 Secret API |
| 命名空间筛选 | 无效 | 选项来源不完整，搜索匹配不工作 |

### 优化方案

#### 1. 后端内存缓存

**文件**: `backend/src/routes/clouds/harvester/harvester.cache.container.routes.ts`

```typescript
// TTL 缓存机制 (30秒)
interface CacheItem<T> {
  data: T;
  timestamp: number;
}

const resourceCache = new Map<string, CacheItem<any>>();
const CACHE_TTL = 30 * 1000; // 30 秒

const getCached = <T>(key: string): T | null => { ... };
const setCache = <T>(key: string, data: T): void => { ... };
```

**已添加缓存的 API**:

| API | 缓存 Key 格式 | 缓存时间 |
|-----|---------------|----------|
| Pod 列表 | `pods:{cloudId}:{namespace\|'all'}` | 30 秒 |
| ConfigMap 列表 | `configmaps:{cloudId}:{namespace\|'all'}` | 30 秒 |
| Secret 列表 | `secrets:{cloudId}:{namespace\|'all'}` | 30 秒 |

#### 2. 前端数据复用

**文件**: `frontend/src/pages/Clouds/Harvester/CloudDetailHarvester.tsx`

```typescript
// 镜像仓库复用已加载的 Secret 数据，避免重复请求
if (harvesterSecrets.length > 0 && !force) {
  const dockerSecrets = harvesterSecrets.filter(
    (item) => item?.type === 'kubernetes.io/dockerconfigjson'
  );
  setHarvesterImagePullSecrets(dockerSecrets);
}
```

#### 3. 命名空间选项优化

**问题**: 原来只从 `harvesterNamespaces` 获取命名空间（主要是 VM 相关），缺少 K8s 系统命名空间

**修复**: 从实际的容器资源中提取命名空间

```typescript
const namespacesOptions = useMemo(() => {
  const nsSet = new Set<string>();
  
  // 1. 从 harvesterNamespaces 获取（VM 相关）
  (harvesterNamespaces || []).forEach(...);
  
  // 2. 从容器资源中提取命名空间
  harvesterDeployments.forEach(addNamespace);
  harvesterPods.forEach(addNamespace);
  harvesterSecrets.forEach(addNamespace);
  // ... 其他资源
  
  return Array.from(nsSet).filter(Boolean).sort();
}, [harvesterNamespaces, harvesterDeployments, ...]);
```

#### 4. Select 组件搜索优化

**问题**: Ant Design Select 的 `showSearch` 默认按 value 搜索，但我们的 value 和 label 相同

**修复**: 添加 `optionFilterProp="label"` 属性

```typescript
<Select
  showSearch
  optionFilterProp="label"  // 按显示文本搜索
  options={namespacesOptions.map((ns) => ({ label: ns, value: ns }))}
/>
```

### 优化效果

| 场景 | 优化前 | 优化后 |
|------|--------|--------|
| 首次加载 Secret | ~15秒 | ~15秒（需获取数据） |
| 30秒内再次加载 Secret | ~15秒 | <100ms（命中缓存） |
| 切换到镜像仓库 | ~19秒 | <100ms（复用 Secret 缓存） |
| 命名空间筛选 | 无效/匹配不全 | 正常工作 |

---

## 镜像仓库方案对比

### 方案概览

在二期镜像仓库功能开发中，提出了三种镜像仓库方案：

| 方案 | 描述 | 特点 | 验证状态 |
|------|------|------|----------|
| **Docker Registry** | 官方轻量级镜像仓库 | 部署简单、无依赖、无 UI | ✅ 已验证 |
| **Harbor** | 企业级镜像仓库 | UI 界面、RBAC、漏洞扫描、镜像签名 | 🔴 待验证 |
| **Nexus** | 通用制品仓库 | 多包类型支持、Maven/NPM 等 | 🔴 待验证 |

### Docker Registry 部署验证记录 (2026-03-12)

**部署环境**:
- 平台: Harvester (Kubernetes)
- 节点架构: ARM64 (aarch64)
- 镜像: `registry:2`
- 服务端口: NodePort 30500

**部署步骤**:
1. 准备 ARM64 架构镜像
2. 通过 Kubernetes Job 导入镜像到 containerd
3. 创建 Deployment 和 Service

**关键问题及解决**:

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| ImagePullBackOff | 架构不匹配 (AMD64 vs ARM64) | 使用 ARM64 镜像 |
| ctr import 失败 | 默认 unpack 在 ARM64 上失败 | 添加 `--unpack=false` 参数 |
| TLS 握手错误 | HTTP Registry 被当作 HTTPS | 后端支持 `insecure` 参数 |

**验证结果**: ✅ 成功部署，支持镜像推送和浏览

**局限性**:
- 无 Web UI
- 无用户认证
- 无法通过 API 删除镜像

### Harbor 部署计划 (待验证)

**目标**: 提供企业级镜像仓库能力

**部署方式**:
- Helm Chart 部署
- 需要数据库 (PostgreSQL/MySQL)
- 需要存储 (PVC)
- 需要暴露 NodePort 或 Ingress

**资源需求**:
- CPU: 2 核+
- 内存: 4GB+
- 存储: 50GB+

**验证步骤** (待执行):
- [ ] 准备 Helm Chart
- [ ] 配置持久化存储
- [ ] 部署 Harbor
- [ ] 配置访问地址
- [ ] 测试镜像推送/拉取
- [ ] 测试用户认证
- [ ] 测试 API 集成

### Nexus 部署计划 (待验证)

**目标**: 提供通用制品仓库能力

**部署方式**:
- Helm Chart 或 StatefulSet
- 内置数据库
- 需要较大内存

**资源需求**:
- CPU: 2 核+
- 内存: 8GB+
- 存储: 100GB+

**验证步骤** (待执行):
- [ ] 准备部署配置
- [ ] 配置持久化存储
- [ ] 部署 Nexus
- [ ] 配置 Docker 仓库
- [ ] 测试镜像推送/拉取
- [ ] 测试 API 集成

### 后续优化建议

| 优先级 | 项目 | 描述 |
|--------|------|------|
| 高 | Registry 持久化 | 使用 PVC 替代 HostPath |
| 中 | Registry 认证 | 添加 htpasswd 基础认证 |
| 中 | Registry HTTPS | 配置 TLS 证书 |
| 中 | Harbor 部署 | 企业级功能验证 |
| 低 | Nexus 部署 | 通用制品仓库验证 |

---

---
## 实施优先级规划

### 阶段一 (立即开始)

| 序号 | 功能 | 预计工作量 | 原因 |
|------|------|-----------|------|
| 1 | 高级调度策略 | 3-5天 | 当前最重要的缺失功能，生产环境必需 |
| 2 | 表单内快速创建关联资源 | 2-3天 | 显著提升用户体验，解决交互痛点 |

### 阶段二 (短期规划)

| 序号 | 功能 | 预计工作量 | 原因 |
|------|------|-----------|------|
| 3 | NetworkPolicy 网络策略 | 3-4天 | 安全必需功能，与调度策略同等重要 |
| 4 | 服务拓扑可视化 | 3-4天 | 提升运维效率，问题定位利器 |

### 阶段三 (中期规划)

| 序号 | 功能 | 预计工作量 | 原因 |
|------|------|-----------|------|
| 5 | 应用向导部署 | 4-5天 | 降低使用门槛，提升用户满意度 |
| 6 | 租户视角 - 基础框架 | 5-7天 | 满足租户使用需求，区分管理员视角 |

### 后续规划 (需详细设计)

| 序号 | 功能 | 说明 |
|------|------|------|
| 7 | 应用商店/Helm | 属于 APaaS 范畴，需要详细架构设计 |
| 8 | CI/CD 流水线集成 | 需要与 DevOps 工具链集成 |
| 9 | 日志聚合平台对接 | 对接 ELK/Loki 或内部日审平台 |
| 10 | 成本管理/计费 | 当前暂不考虑 |


---

## 3.12 容器网络配置（扁平子网支持）

> **优先级**: 高 | **预计工作量**: 3-4天 | **创建日期**: 2026-04-22

### 功能说明

为容器工作负载（Deployment/StatefulSet/DaemonSet）添加网络配置能力，支持使用资源池中的扁平子网、VPC子网和自定义NAD。

### 设计文档

详见 `container-feature-design.md` 第21章「容器网络配置设计（扁平子网支持）」。

### 任务清单

#### Phase1 - 核心功能（当前阶段）

| 任务ID | 任务描述 | 状态 | 进度 |
|--------|----------|------|------|
| F6-01 | WorkloadForm 新增网络配置步骤（步骤3，原高级配置移为步骤4） | 🟢 | 已验证 |
| F6-02 | 数据获取：加载扁平子网列表（kubeSubnets） | 🟢 | 已验证 |
| F6-03 | 数据获取：加载VPC列表（kubeVpcs） | 🟢 | 已验证 |
| F6-04 | 数据获取：加载NAD列表（nads） | 🟢 | 已验证 |
| F6-05 | 实现网络类型选择器（默认网络/扁平子网/VPC子网/自定义NAD） | 🟢 | 已验证 |
| F6-06 | 实现扁平子网选择器（复用VM向导逻辑，过滤VPC=ovn-internal） | 🟢 | 已验证 |
| F6-07 | 实现VPC子网选择器（VPC+Subnet级联选择） | 🟢 | 已验证 |
| F6-08 | 实现自定义NAD输入框 | 🟢 | 已验证 |
| F6-09 | 实现静态IP配置（可选） | 🟢 | 已验证 |
| F6-10 | 实现buildNetworkAnnotations函数 | 🟢 | 已验证 |
| F6-11 | 在buildK8sResource中集成网络注解 | 🟢 | 已验证 |
| F6-12 | 添加NetworkConfig类型定义 | 🟢 | 已验证 |
| F6-13 | 配置预览面板展示网络配置信息 | 🟢 | 已验证 |
| F6-14 | 后端API验证：扁平子网/VPC/NAD API可用性 | 🟢 | 已验证 |
| F6-15 | 选项显示格式优化：别名(id)@cidr | 🟢 | 已验证 |
| F6-16 | Harvester资源池隐藏扁平子网选项 | 🟢 | 已验证 |
| F6-17 | 创建表单自动填写名称和命名空间 | 🟢 | 已验证 |

#### Phase2 - 扩展功能（预留）

| 任务ID | 任务描述 | 状态 | 进度 |
|--------|----------|------|------|
| F6-20 | SR-IOV直通网卡支持 | 🔴 | 待开始 |
| F6-21 | Macvtap直通网卡支持 | 🔴 | 待开始 |
| F6-22 | 多网卡（辅助网卡）配置支持 | 🔴 | 待开始 |

### 验收标准

- [x] 工作负载创建表单新增"网络配置"步骤
- [x] 网络类型支持：默认网络、扁平子网、VPC子网、自定义NAD
- [x] 扁平子网选择器正确过滤和展示
- [x] VPC子网选择器支持级联选择
- [x] 生成的YAML包含正确的网络注解
- [x] 使用扁平子网的Pod能正常获取IP
- [x] 创建表单自动填写名称和默认命名空间

### 关键文件

| 文件 | 修改内容 |
|------|---------|
| `containers/components/WorkloadForm.tsx` | 新增网络配置步骤，集成buildNetworkAnnotations |
| `types/harvester.ts` | 新增NetworkConfig类型定义 |
| `services/harvesterApi.ts` | 确保kubeSubnets/kubeVpcs/nads API可用 |
| `kube-ovn/lib/kubeOvnSubnetConstants.ts` | 扁平子网识别常量（复用） |

### 并行任务分析

以下任务可并行执行：
1. **F6-02/F6-03/F6-04** - 数据获取任务（可同时开发）
2. **F6-05/F6-06/F6-07/F6-08** - UI选择器组件（可并行开发，最后集成）
3. **F6-12** - 类型定义（可独立进行）



---

## 备注

- 所有状态更新请及时同步到本文档
- 每个阶段完成后进行验收测试
- 遇到阻塞问题及时反馈
