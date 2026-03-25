# 容器功能模块设计文档

> 版本: 2.0
> 创建日期: 2026-03-10
> 最后更新: 2026-03-24

## 目录

1. [项目概述](#1-项目概述)
2. [功能架构](#2-功能架构)
3. [模块设计](#3-模块设计)
4. [数据流设计](#4-数据流设计)
5. [UI 设计](#5-ui-设计)
6. [技术实现细节](#6-技术实现细节)
7. [验收标准](#7-验收标准)
8. [三期功能设计](#8-三期功能设计)
9. [高级调度策略设计](#9-高级调度策略设计)
10. [NetworkPolicy 网络策略设计](#10-networkpolicy-网络策略设计)
11. [交互优化设计](#11-交互优化设计)
12. [租户视角设计](#12-租户视角设计)
13. [性能优化](#13-性能优化)
14. [变更记录](#14-变更记录)

---

## 1. 项目概述

### 1.1 项目背景

Compute Tower 是企业级多云管理平台，支持阿里云、华为云、腾讯云、Harvester(KubeVirt) 等多云资源的统一管理。Harvester 是基于 Kubernetes 的超融合基础设施(HCI)解决方案，提供虚拟机和容器双重能力。

容器功能模块的目标是：
- 对接 Harvester 资源池的容器能力
- 提供完整的 Kubernetes 容器资源管理
- 支持工作负载、Pod、任务、服务发现、配置管理等核心功能

### 1.2 技术栈

**后端**:
- 运行时: Node.js 18+ + TypeScript 5.x
- 框架: Express 4.x
- 数据库: SQLite (TypeORM 0.3.x)
- WebSocket: ws 8.x (SSH/VNC/KubeVirt)

**前端**:
- 框架: React 18 + TypeScript 4.9
- UI 组件: Ant Design 5.x
- 路由: React Router 6
- 终端: xterm.js 5.x
- 代码编辑: CodeMirror 6 (@uiw/react-codemirror)

### 1.3 分期规划

| 分期 | 功能范围 | 状态 |
|------|----------|------|
| **一期（基础版）** | 所有模块的列表查询、详情查看、基础操作 | 🟢 已完成 |
| **二期（增强版）** | 创建功能、编辑功能、Pod 终端、高级交互 | 🟢 已完成 |
| **三期（高级功能）** | 高级调度策略、NetworkPolicy、交互优化、租户视角 | 🟡 进行中 |

---

## 2. 功能架构

### 2.1 功能模块

```
容器功能模块
├── 工作负载管理
│   ├── Deployment 列表/创建/编辑/删除/扩缩容/重启
│   ├── StatefulSet 列表/创建/编辑/删除
│   └── DaemonSet 列表/创建/编辑/删除
│
├── Pod 管理
│   ├── 列表查询/详情查看
│   ├── 日志查看 (WebSocket)
│   └── 终端访问 (WebSocket)
│
├── 任务管理
│   ├── Job 列表/创建/删除/详情/重试
│   └── CronJob 列表/创建/删除/暂停/恢复/手动触发
│
├── 服务发现
│   ├── Service 列表/创建/编辑/删除/YAML编辑/关联Pod
│   ├── Ingress 列表/创建/编辑/删除/YAML编辑
│   └── Gateway API (Gateway/HTTPRoute/GRPCRoute)
│
├── 配置管理
│   ├── ConfigMap 列表/创建/编辑/删除
│   └── Secret 列表/创建/编辑/删除/脱敏展示
│
├── 镜像仓库
│   ├── 凭证管理
│   ├── 仓库列表
│   └── 镜像浏览器
│
├── 高级调度策略 (三期)
│   ├── 节点亲和性/反亲和性
│   ├── Pod 亲和性/反亲和性
│   ├── 污点容忍
│   └── PodDisruptionBudget
│
└── 网络策略 (三期)
    └── NetworkPolicy 管理
```

### 2.2 导航结构

```
云资源管理
└── Harvester 资源池详情
    ├── 概览
    ├── 虚拟机
    ├── 容器 ← 容器功能入口
    │   ├── 工作负载
    │   ├── Pod
    │   ├── 任务
    │   ├── 服务发现
    │   │   ├── Service
    │   │   ├── Ingress
    │   │   └── 网关路由
    │   ├── 配置管理
    │   ├── 镜像仓库
    │   └── 中断保护
    ├── 卷
    ├── 镜像
    └── ...
```

---

## 3. 模块设计

### 3.1 工作负载管理

#### 3.1.1 功能列表

| 功能 | Deployment | StatefulSet | DaemonSet |
|------|------------|-------------|-----------|
| 列表查询 | ✅ | ✅ | ✅ |
| 详情查看 | ✅ | ✅ | ✅ |
| 创建 (表单) | ✅ | ✅ | ✅ |
| 创建 (YAML) | ✅ | ✅ | ✅ |
| 编辑 | ✅ | ✅ | ✅ |
| 删除 | ✅ | ✅ | ✅ |
| 扩缩容 | ✅ | ✅ | - |
| 重启 | ✅ | ✅ | ✅ |
| YAML 编辑 | ✅ | ✅ | ✅ |

#### 3.1.2 组件设计

```
WorkloadsSection.tsx
├── 工作负载类型筛选 (Deployment/StatefulSet/DaemonSet)
├── 命名空间筛选
├── 工作负载列表 (Table)
│   ├── 名称、类型、命名空间
│   ├── 副本状态 (期望/当前/就绪)
│   ├── 镜像、创建时间
│   └── 操作列
└── 创建工作负载按钮 → WorkloadFormModal
    └── WorkloadForm.tsx
        ├── 步骤1: 基本信息 (名称、命名空间、类型、标签)
        ├── 步骤2: 容器配置 (镜像、资源、环境变量、端口)
        └── 步骤3: 高级配置 (调度策略、存储卷)
```

#### 3.1.3 创建表单字段

**基本信息**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| 名称 | string | 是 | 工作负载名称 |
| 命名空间 | select | 是 | 目标命名空间 |
| 类型 | select | 是 | Deployment/StatefulSet/DaemonSet |
| 标签 | key-value | 否 | Pod 标签 |
| 注解 | key-value | 否 | Pod 注解 |

**容器配置**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| 镜像 | string | 是 | 容器镜像地址 |
| 镜像拉取策略 | select | 否 | Always/IfNotPresent/Never |
| 副本数 | number | 是 | Deployment/StatefulSet 有效 |
| CPU 请求 | string | 否 | 如 "100m" |
| CPU 限制 | string | 否 | 如 "500m" |
| 内存请求 | string | 否 | 如 "128Mi" |
| 内存限制 | string | 否 | 如 "512Mi" |
| 环境变量 | key-value | 否 | 容器环境变量 |
| 端口配置 | array | 否 | 容器端口列表 |

### 3.2 Pod 管理

#### 3.2.1 功能列表

| 功能 | 说明 | 状态 |
|------|------|------|
| 列表查询 | 查询所有命名空间的 Pod | ✅ |
| 详情查看 | 查看 Pod 详细信息 | ✅ |
| 日志查看 | 实时查看容器日志 | ✅ |
| 终端访问 | 进入容器执行命令 | ✅ |
| 删除 | 删除 Pod | ✅ |

#### 3.2.2 WebSocket 接口

**Pod 日志**:
- 路径: `/ws/kv-pod-log`
- 参数: cloudId, namespace, podName, container, tailLines
- 数据流: 服务端 → 客户端 (实时推送)

**Pod 终端**:
- 路径: `/ws/kv-pod-exec`
- 参数: cloudId, namespace, podName, container
- 数据流: 双向 (命令输入/输出)

### 3.3 任务管理

#### 3.3.1 Job 管理

| 功能 | 说明 | 状态 |
|------|------|------|
| 列表查询 | 查询所有 Job | ✅ |
| 创建 | 创建一次性任务 | ✅ |
| 详情查看 | 查看 Job 状态和关联 Pod | ✅ |
| 日志查看 | 查看任务执行日志 | ✅ |
| 删除 | 删除 Job | ✅ |
| 重试 | 重新执行失败的任务 | ✅ |

#### 3.3.2 CronJob 管理

| 功能 | 说明 | 状态 |
|------|------|------|
| 列表查询 | 查询所有 CronJob | ✅ |
| 创建 | 创建定时任务 | ✅ |
| 详情查看 | 查看 CronJob 配置 | ✅ |
| 暂停/恢复 | 控制定时任务执行 | ✅ |
| 手动触发 | 立即执行一次 | ✅ |
| 删除 | 删除 CronJob | ✅ |

#### 3.3.3 Cron 表达式支持

**标准格式**: `分 时 日 月 周`

**宏表达式**:
| 宏 | 等效表达式 | 说明 |
|----|-----------|------|
| `@yearly` | `0 0 1 1 *` | 每年1月1日 |
| `@monthly` | `0 0 1 * *` | 每月1日 |
| `@weekly` | `0 0 * * 0` | 每周日 |
| `@daily` | `0 0 * * *` | 每天午夜 |
| `@hourly` | `0 * * * *` | 每小时 |

### 3.4 服务发现

#### 3.4.1 Service 管理

| 功能 | 说明 | 状态 |
|------|------|------|
| 列表查询 | 查询所有 Service | ✅ |
| 创建 | 创建 Service (ClusterIP/NodePort/LoadBalancer) | ✅ |
| 编辑 | 编辑 Service 配置 | ✅ |
| YAML 编辑 | 通过 YAML 编辑 | ✅ |
| 查看关联 Pod | 显示 Service 后端的 Pod | ✅ |
| 删除 | 删除 Service | ✅ |

**Service 类型**:
| 类型 | 说明 | 使用场景 |
|------|------|----------|
| ClusterIP | 集群内部访问 | 内部服务 |
| NodePort | 节点端口暴露 | 开发测试 |
| LoadBalancer | 负载均衡器 | 生产环境 |

#### 3.4.2 Ingress 管理

| 功能 | 说明 | 状态 |
|------|------|------|
| 列表查询 | 查询所有 Ingress | ✅ |
| 创建 | 创建 Ingress 规则 | ✅ |
| 编辑 | 编辑 Ingress 配置 | ✅ |
| YAML 编辑 | 通过 YAML 编辑 | ✅ |
| 删除 | 删除 Ingress | ✅ |

#### 3.4.3 Gateway API

> Gateway API 是 Kubernetes 官方推出的下一代入口流量管理 API，将替代 Ingress。

| 资源 | 说明 | 状态 |
|------|------|------|
| GatewayClass | 网关类（只读） | ✅ |
| Gateway | 网关实例 | ✅ |
| HTTPRoute | HTTP 路由规则 | ✅ |
| GRPCRoute | gRPC 路由规则 | ✅ |

### 3.5 配置管理

#### 3.5.1 ConfigMap 管理

| 功能 | 说明 | 状态 |
|------|------|------|
| 列表查询 | 查询所有 ConfigMap | ✅ |
| 创建 | 创建 ConfigMap | ✅ |
| 编辑 | 编辑 ConfigMap | ✅ |
| 详情查看 | 查看 ConfigMap 内容 | ✅ |
| 删除 | 删除 ConfigMap | ✅ |

#### 3.5.2 Secret 管理

| 功能 | 说明 | 状态 |
|------|------|------|
| 列表查询 | 查询所有 Secret | ✅ |
| 创建 | 创建 Secret (多种类型) | ✅ |
| 编辑 | 编辑 Secret | ✅ |
| 详情查看 | 查看 Secret 内容（支持脱敏） | ✅ |
| 删除 | 删除 Secret | ✅ |

**Secret 类型**:
| 类型 | 说明 |
|------|------|
| Opaque | 通用密钥（默认） |
| kubernetes.io/dockerconfigjson | Docker 镜像拉取 |
| kubernetes.io/tls | TLS 证书 |
| kubernetes.io/basic-auth | 基础认证 |
| kubernetes.io/ssh-auth | SSH 认证 |

### 3.6 镜像仓库

#### 3.6.1 功能列表

| 功能 | 说明 | 状态 |
|------|------|------|
| 凭证列表 | 查询镜像拉取凭证 | ✅ |
| 创建凭证 | 创建 Docker Registry 凭证 | ✅ |
| 仓库管理 | 添加/删除自定义仓库 | ✅ |
| 镜像浏览 | 浏览仓库中的镜像和标签 | ✅ |
| 镜像地址复制 | 一键复制镜像地址 | ✅ |

#### 3.6.2 支持的仓库类型

| 类型 | 说明 | 验证状态 |
|------|------|----------|
| Docker Registry | 官方轻量级仓库 | ✅ 已验证 |
| Harbor | 企业级仓库 | 🔴 待验证 |
| Nexus | 通用制品仓库 | 🔴 待验证 |

---

## 4. 数据流设计

### 4.1 架构层次

```
┌─────────────────────────────────────────────────────────────┐
│                      前端 (React)                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  Section    │  │   Form      │  │  Modal      │         │
│  │  Component  │  │  Component  │  │  Component  │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         │                │                │                 │
│         └────────────────┼────────────────┘                 │
│                          │                                   │
│                   ┌──────┴──────┐                            │
│                   │ harvesterApi│                            │
│                   │   Service   │                            │
│                   └──────┬──────┘                            │
└──────────────────────────┼──────────────────────────────────┘
                           │ HTTP/WS
┌──────────────────────────┼──────────────────────────────────┐
│                     后端 (Node.js)                           │
│                   ┌──────┴──────┐                            │
│                   │   Routes    │                            │
│                   │  (Express)  │                            │
│                   └──────┬──────┘                            │
│                          │                                   │
│         ┌────────────────┼────────────────┐                  │
│         │                │                │                  │
│   ┌─────┴─────┐   ┌─────┴─────┐   ┌─────┴─────┐            │
│   │   Cache   │   │   Proxy   │   │ WebSocket │            │
│   │   Routes  │   │   Routes  │   │  Server   │            │
│   └─────┬─────┘   └─────┬─────┘   └─────┬─────┘            │
└─────────┼───────────────┼───────────────┼───────────────────┘
          │               │               │
          └───────────────┼───────────────┘
                          │
              ┌───────────┴───────────┐
              │    Harvester/K8s API   │
              │    (KubeConfig)        │
              └───────────────────────┘
```

### 4.2 API 路由设计

**缓存路由** (`harvester.cache.container.routes.ts`):
```
/api/clouds/{id}/resources/harvester/containers/
├── workloads          # 工作负载列表
├── pods               # Pod 列表
├── jobs               # Job 列表
├── cronjobs           # CronJob 列表
├── services           # Service 列表
├── ingresses          # Ingress 列表
├── configmaps         # ConfigMap 列表
├── secrets            # Secret 列表
├── registries         # 镜像凭证列表
└── gateway/           # Gateway API
    ├── crd-status     # CRD 检测
    ├── gatewayclasses # GatewayClass 列表
    ├── gateways       # Gateway 列表/创建/删除
    ├── httproutes     # HTTPRoute 列表/创建/删除
    └── grpcroutes     # GRPCRoute 列表/创建/删除
```

### 4.3 缓存策略

**TTL 缓存** (30秒):
```typescript
interface CacheItem<T> {
  data: T;
  timestamp: number;
}

const resourceCache = new Map<string, CacheItem<any>>();
const CACHE_TTL = 30 * 1000; // 30 秒
```

**已缓存的资源**:
- Pod 列表
- ConfigMap 列表
- Secret 列表

---

## 5. UI 设计

### 5.1 页面模板

采用三层容器结构：

| 组件 | 用途 |
|------|------|
| `PageContainer` | 列表页面容器 |
| `PageDetailContainer` | 详情页容器（含 Tabs） |
| `PageDetailSection` | Tab 区块内容 |

### 5.2 工作负载列表

```
┌─────────────────────────────────────────────────────────────────────┐
│ 工作负载                                              [刷新] [创建] │
├─────────────────────────────────────────────────────────────────────┤
│ 类型: [全部 ▼]  命名空间: [全部 ▼]  搜索: [____________] [搜索]   │
├─────────────────────────────────────────────────────────────────────┤
│ ☐ 名称        类型        命名空间   副本    镜像        状态  操作 │
│ ─────────────────────────────────────────────────────────────────── │
│ ☐ nginx-app   Deployment  default   3/3     nginx:1.14  🟢    ⋮   │
│ ☐ redis       StatefulSet default   1/1     redis:6     🟢    ⋮   │
│ ☐ fluentd     DaemonSet   kube-sys   3/3    fluentd     🟢    ⋮   │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.3 创建工作负载弹窗

```
┌─────────────────────────────────────────────────────────────────────┐
│ 创建工作负载                                              [×]       │
├─────────────────────────────────────────────────────────────────────┤
│ 步骤指示器: [①基本信息] ─ ②容器配置 ─ ③高级配置                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   工作负载名称 *    [________________]                              │
│                                                                     │
│   命名空间 *        [default    ▼]                                  │
│                                                                     │
│   类型 *           [Deployment ▼]                                   │
│                     ○ Deployment  - 无状态应用                      │
│                     ○ StatefulSet - 有状态应用                      │
│                     ○ DaemonSet   - 每节点一个                      │
│                                                                     │
│   标签             [+] 添加标签                                     │
│                    ┌──────────────────────────────┐                │
│                    │ app: nginx                   │ [×]            │
│                    └──────────────────────────────┘                │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                           [取消]  [上一步]  [下一步]│
└─────────────────────────────────────────────────────────────────────┘
```

### 5.4 Pod 终端

```
┌─────────────────────────────────────────────────────────────────────┐
│ Pod 终端: nginx-pod / container-1                      [全屏] [×]  │
├─────────────────────────────────────────────────────────────────────┤
│ root@nginx-pod:/# ls -la                                            │
│ total 64                                                            │
│ drwxr-xr-x 1 root root 4096 Mar 10 10:00 .                          │
│ drwxr-xr-x 1 root root 4096 Mar 10 10:00 ..                         │
│ -rw-r--r-- 1 root root  570 Mar 10 10:00 Dockerfile                 │
│ drwxr-xr-x 1 root root 4096 Mar 10 10:00 app                        │
│ root@nginx-pod:/# _                                                 │
│                                                                     │
│                                                                     │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│ 容器: [container-1 ▼]                                               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 6. 技术实现细节

### 6.1 前端状态管理

使用 Ant Design Form 作为主要状态管理工具：

```typescript
// 核心原则：Form 是数据唯一来源
const [form] = Form.useForm();

// 读取数据
const values = form.getFieldsValue();

// 更新数据
form.setFieldsValue({ key: value });

// 监听变化
Form.useWatch('fieldName', form);
```

### 6.2 嵌套表单处理

对于复杂的嵌套数据（如亲和性规则），采用以下模式：

```typescript
// 1. 使用本地 state 触发 UI 重渲染
const [version, setVersion] = useState(0);

// 2. 所有操作先从 Form 读取，再更新 Form
const addRule = useCallback(() => {
  const current = form.getFieldValue('rules') || [];
  form.setFieldsValue({ rules: [...current, newRule] });
  setVersion(v => v + 1); // 触发重渲染
}, [form]);

// 3. 输入框使用 defaultValue + onBlur（非受控模式）
<Input
  defaultValue={item.value}
  onBlur={(e) => updateValue(index, e.target.value)}
/>
```

### 6.3 WebSocket 实现

**Pod 日志 WebSocket**:
```typescript
// 后端 (kvPodLog.ts)
wss.on('connection', (ws, req) => {
  const { cloudId, namespace, podName, container } = parseQuery(req);
  
  // 使用 K8s API 获取日志流
  const logStream = k8sApi.readNamespacedPodLogStream(...);
  
  logStream.on('data', (chunk) => {
    ws.send(chunk.toString());
  });
});
```

**Pod 终端 WebSocket**:
```typescript
// 后端 (kvPodExec.ts)
wss.on('connection', (ws, req) => {
  // 使用 K8s exec WebSocket 协议
  const channel = new WebSocketChannel(k8sExecStream);
  
  ws.on('message', (data) => {
    channel.send(data); // stdin
  });
  
  channel.on('data', (data) => {
    ws.send(data); // stdout/stderr
  });
});
```

### 6.4 YAML 编辑器

使用 CodeMirror 6 实现：

```typescript
import CodeMirror from '@uiw/react-codemirror';
import { yaml } from '@codemirror/lang-yaml';

<CodeMirror
  value={yamlContent}
  height="400px"
  extensions={[yaml()]}
  onChange={(value) => setYamlContent(value)}
/>
```

---

## 7. 验收标准

### 7.1 一期验收

- [x] 能够查看 Deployment/StatefulSet/DaemonSet 列表
- [x] 能够扩缩容、重启、删除 Deployment
- [x] 能够查看 Pod 列表和详情
- [x] 能够查看 Pod 日志
- [x] 命名空间筛选功能正常
- [x] 能够查看 Job/CronJob 列表
- [x] 能够查看 Service/Ingress 列表
- [x] 能够查看 ConfigMap/Secret 列表
- [x] 能够查看镜像凭证列表

### 7.2 二期验收

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
- [x] 能够创建 ConfigMap 和 Secret
- [x] Secret 值正确脱敏
- [x] 能够创建镜像凭证
- [x] 能够添加自定义镜像仓库
- [x] 能够浏览镜像仓库中的镜像和标签
- [x] 能够编辑 Service/Ingress
- [x] 能够通过 YAML 编辑 Service/Ingress
- [x] 能够查看 Service 关联的 Pod

### 7.3 三期验收

- [x] 能够配置节点亲和性/反亲和性
- [x] 能够配置 Pod 亲和性/反亲和性
- [x] 能够配置污点容忍
- [ ] 能够创建和管理 PodDisruptionBudget
- [ ] 能够创建和管理 NetworkPolicy
- [ ] 表单内快速创建关联资源
- [ ] 服务拓扑可视化

---

## 8. 三期功能设计

### 8.1 功能范围

| 模块 | 功能 | 优先级 | 状态 |
|------|------|--------|------|
| **高级调度策略** | 节点亲和性/反亲和性、Pod亲和性/反亲和性、污点容忍、PDB | 高 | 🟡 |
| **NetworkPolicy** | 网络策略可视化管理 | 高 | 🔴 |
| **交互优化** | 表单内快速创建关联资源 | 高 | 🔴 |
| **服务拓扑** | Ingress→Service→Pod 可视化 | 中 | 🔴 |
| **应用向导** | 引导式部署流程 | 中 | 🔴 |
| **租户视角** | 租户工作台、资源概览、配额管理 | 中 | 🔴 |

### 8.2 实施优先级

**阶段一** (立即开始):
1. 高级调度策略 (3-5天)
2. 表单内快速创建关联资源 (2-3天)

**阶段二** (短期规划):
3. NetworkPolicy 网络策略 (3-4天)
4. 服务拓扑可视化 (3-4天)

**阶段三** (中期规划):
5. 应用向导部署 (4-5天)
6. 租户视角基础框架 (5-7天)

---

## 9. 高级调度策略设计

### 9.1 功能说明

| 功能 | 描述 | Kubernetes 字段 |
|------|------|-----------------|
| **节点亲和性** | 控制 Pod 调度到特定节点 | `spec.affinity.nodeAffinity` |
| **节点反亲和性** | 避免调度到特定节点 | `spec.affinity.nodeAntiAffinity` |
| **Pod 亲和性** | 将 Pod 调度到与其他 Pod 相同节点 | `spec.affinity.podAffinity` |
| **Pod 反亲和性** | 将 Pod 分散到不同节点 | `spec.affinity.podAntiAffinity` |
| **污点容忍** | 允许 Pod 调度到有污点的节点 | `spec.tolerations` |
| **PodDisruptionBudget** | 限制自愿中断时的 Pod 数量 | `policy/v1/PodDisruptionBudget` |

### 9.2 UI 设计

```
WorkloadForm 步骤3: 高级配置
├── 调度策略
│   ├── 节点亲和性
│   │   ├── [+] 添加规则
│   │   │   ├── 匹配类型: required/preferred
│   │   │   ├── 匹配表达式 (标签选择器)
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

### 9.3 节点亲和性配置

**匹配表达式结构**:
```yaml
nodeAffinity:
  requiredDuringSchedulingIgnoredDuringExecution:
    nodeSelectorTerms:
      - matchExpressions:
          - key: kubernetes.io/arch
            operator: In
            values:
              - arm64
          - key: node-role.kubernetes.io/master
            operator: Exists
  preferredDuringSchedulingIgnoredDuringExecution:
    - weight: 100
      preference:
        matchExpressions:
          - key: another-node-label-key
            operator: In
            values:
              - another-node-label-value
```

### 9.4 Pod 亲和性配置

**匹配标签结构**:
```yaml
podAffinity:
  requiredDuringSchedulingIgnoredDuringExecution:
    - labelSelector:
        matchLabels:
          app: cache
      topologyKey: kubernetes.io/hostname
  preferredDuringSchedulingIgnoredDuringExecution:
    - weight: 100
      podAffinityTerm:
        labelSelector:
          matchExpressions:
            - key: app
              operator: In
              values:
                - web
        topologyKey: kubernetes.io/hostname
```

### 9.5 污点容忍配置

**常用预设**:
| 预设名称 | Key | Operator | Effect |
|---------|-----|----------|--------|
| 控制平面节点 | `node-role.kubernetes.io/control-plane` | Exists | NoSchedule |
| 主节点 | `node-role.kubernetes.io/master` | Exists | NoSchedule |
| 任意污点 | `` | Exists | |

**配置结构**:
```yaml
tolerations:
  - key: "key1"
    operator: "Equal"
    value: "value1"
    effect: "NoSchedule"
  - key: "key2"
    operator: "Exists"
    effect: "NoExecute"
    tolerationSeconds: 3600
```

### 9.6 PodDisruptionBudget 配置

**UI 设计**:
```
┌─────────────────────────────────────────────────────────────────────┐
│ 创建 PodDisruptionBudget                                             │
├─────────────────────────────────────────────────────────────────────┤
│ 名称 *        [________________]                                     │
│ 命名空间 *    [default    ▼]                                         │
│                                                                     │
│ 目标工作负载                                                        │
│ 类型 *        [Deployment ▼]                                        │
│ 名称 *        [nginx-app ▼]                                         │
│                                                                     │
│ 中断保护策略                                                        │
│ ○ 最小可用副本数 (minAvailable)                                     │
│   [___] 个或 [___]%                                                 │
│ ○ 最大不可用副本数 (maxUnavailable)                                 │
│   [___] 个或 [___]%                                                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 10. NetworkPolicy 网络策略设计

### 10.1 功能说明

NetworkPolicy 是 Kubernetes 原生资源，用于控制 Pod 之间的网络访问（类似安全组）。

### 10.2 UI 设计

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
│
├── 出站规则
│   └── (同入站规则结构)
│
└── 策略类型
    ├── 仅入站
    ├── 仅出站
    └── 入站+出站
```

### 10.3 导航位置

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

## 11. 交互优化设计

### 11.1 表单内快速创建

在创建工作负载时，发现需要 ConfigMap/Secret，无需退出表单，可直接在表单内快速创建。

**优化点**:
| 场景 | 当前体验 | 优化后 |
|------|----------|--------|
| 环境变量引用 | 需要退出→切换Tab→创建→返回 | 表单内弹窗快速创建 |
| 存储卷挂载 | 需要退出→切换Tab→创建→返回 | 表单内弹窗快速创建 |
| 镜像拉取凭证 | 需要退出→切换Tab→创建→返回 | 表单内下拉快速创建 |

**UI 设计**:
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

### 11.2 服务拓扑可视化

将 Ingress → Service → Pod 的调用链可视化展示：

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

## 12. 租户视角设计

### 12.1 概述

当前页面设计面向系统管理员视角，租户用户使用时存在以下问题：

- 所有页面位于 `/admin/*` 路由，租户共用管理员界面
- 缺少独立的租户门户/工作台
- 租户无法直观看到配额使用情况
- 功能复杂度高，租户学习成本高

### 12.2 租户路由结构设计

```
新增租户路由：

/tenant/
  ├── /dashboard           # 租户工作台
  │   ├── 资源概览（我的VM/容器数量、配额使用）
  │   ├── 快捷操作（快速部署、申请资源）
  │   └── 最近操作记录
  │
  ├── /my-resources        # 我的资源
  │   ├── 虚拟机
  │   ├── 工作负载
  │   ├── 存储卷
  │   └── 网络
  │
  ├── /my-quotas          # 配额管理
  │   ├── 当前配额
  │   ├── 使用趋势图表
  │   └── 申请扩容
  │
  └── /settings           # 租户设置
      ├── 成员管理
      ├── 密钥管理
      └── 操作日志
```

### 12.3 租户工作台设计

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 租户工作台 - XXX公司                                    [刷新] [帮助]  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  资源概览                                                               │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐           │
│  │  🖥️ 我的虚拟机   │ │  🐳 我的容器    │ │  💾 存储使用     │           │
│  │                 │ │                 │ │                 │           │
│  │  5 / 10 台      │ │  20 / 50 Pod   │ │  100GB / 500GB  │           │
│  │  cpu: 4/8核     │ │  cpu: 8/16核   │ │  使用率: 70%    │           │
│  │  mem: 16/32GB   │ │  mem: 32/64GB  │ │                 │           │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘           │
│                                                                         │
│  快速操作                                                               │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐                        │
│  │  🚀 快速部署  │ │  📦 创建VM  │ │  📁 申请配额  │                        │
│  └────────────┘ └────────────┘ └────────────┘                        │
│                                                                         │
│  最近操作 [查看全部]                                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  • 10:30 创建了工作负载 nginx-app                              │   │
│  │  • 09:15 扩容了虚拟机 test-vm (2核→4核)                        │   │
│  │  • 昨天  申请了 50GB 存储扩容 [审批中]                          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 12.4 我的资源页面

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 我的资源                                                                │
├─────────────────────────────────────────────────────────────────────────┤
│ [虚拟机] [工作负载] [存储卷] [网络]                                    │
│                                                                         │
│  虚拟机 (5台)                                                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ 名称           状态    CPU    内存    创建时间        操作     │   │
│  │ test-vm-1     🟢 运行中  2核   4GB    2026-03-10    [详情]   │   │
│  │ test-vm-2     🟢 运行中  4核   8GB    2026-03-09    [详情]   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  工作负载 (3个)                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ 名称           类型        副本    状态        操作             │   │
│  │ nginx-app     Deployment   3/3   🟢 正常    [详情][日志]      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 12.5 配额管理页面

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 配额管理                                                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  当前配额使用情况                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                                                                 │   │
│  │  CPU                    ████████░░░░  8核 / 16核                │   │
│  │  内存                   █████████░░░  32GB / 64GB               │   │
│  │  存储                   ██████░░░░░░  200GB / 500GB             │   │
│  │  虚拟机数量             █████░░░░░░░  5台 / 10台                │   │
│  │                                                                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  使用趋势 (近30天)                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  📈                                                           │   │
│  │     CPU使用率趋势图                                           │   │
│  │     (EChart面积图)                                            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  申请记录                                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ 申请时间       类型        申请规格      状态      操作         │   │
│  │ 2026-03-20   CPU扩容      +4核        ✅ 已批准   [查看]      │   │
│  │ 2026-03-15   存储扩容     +100GB     ⏳ 审批中   [撤销]      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  [+ 申请扩容]                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 12.6 前端路由与布局

**路由配置**:

```typescript
// routes/tenant.ts
export const tenantRoutes: RouteObject[] = [
  {
    path: '/tenant',
    element: <TenantLayout />,
    children: [
      { path: 'dashboard', element: <TenantDashboard /> },
      { path: 'my-resources', element: <TenantResources /> },
      { path: 'my-quotas', element: <TenantQuotas /> },
      { path: 'settings', element: <TenantSettings /> },
    ],
  },
];
```

**布局组件**:

```typescript
// TenantLayout.tsx
const TenantLayout: React.FC = () => {
  return (
    <Layout>
      <TenantSider />      {/* 租户菜单 */}
      <Layout.Content>
        <TenantHeader />   {/* 租户头部 */}
        <Outlet />         {/* 子路由 */}
      </Layout.Content>
    </Layout>
  );
};
```

### 12.7 权限控制

**权限点定义**:

| 权限点 | 说明 | 对应API |
|--------|------|---------|
| `tenant:dashboard:read` | 查看租户工作台 | `/tenant/dashboard` |
| `tenant:resources:read` | 查看我的资源 | `/tenant/my-resources` |
| `tenant:quotas:read` | 查看配额 | `/tenant/my-quotas` |
| `tenant:quotas:request` | 申请配额 | `POST /quotas/requests` |

**权限校验**:

```typescript
// 后端中间件
const checkTenantPermission = (permission: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    
    // 1. 检查用户类型
    if (user.type !== 'tenant') {
      return res.status(403).json({ message: '需要租户权限' });
    }
    
    // 2. 检查具体权限
    if (!user.permissions.includes(permission)) {
      return res.status(403).json({ message: '权限不足' });
    }
    
    next();
  };
};
```

---

## 13. 性能优化

### 13.1 问题背景

容器功能模块在获取大量 K8s 资源时出现性能问题：

| 操作 | 优化前耗时 | 问题描述 |
|------|-----------|----------|
| 容器 → 配置管理 → Secret | ~15秒 | 获取所有命名空间的 Secrets |
| 容器 → 镜像仓库 | ~19秒 | 重复请求 Secret API |
| 命名空间筛选 | 无效 | 选项来源不完整，搜索匹配不工作 |

### 13.2 优化方案

#### 1. 后端内存缓存

```typescript
// TTL 缓存机制 (30秒)
interface CacheItem<T> {
  data: T;
  timestamp: number;
}

const resourceCache = new Map<string, CacheItem<any>>();
const CACHE_TTL = 30 * 1000; // 30 秒
```

**已添加缓存的 API**:
| API | 缓存 Key 格式 | 缓存时间 |
|-----|---------------|----------|
| Pod 列表 | `pods:{cloudId}:{namespace\|'all'}` | 30 秒 |
| ConfigMap 列表 | `configmaps:{cloudId}:{namespace\|'all'}` | 30 秒 |
| Secret 列表 | `secrets:{cloudId}:{namespace\|'all'}` | 30 秒 |

#### 2. 前端数据复用

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

从实际的容器资源中提取命名空间：

```typescript
const namespacesOptions = useMemo(() => {
  const nsSet = new Set<string>();
  
  // 从多种资源中提取命名空间
  harvesterNamespaces?.forEach(n => nsSet.add(n.name));
  harvesterDeployments?.forEach(d => nsSet.add(d.namespace));
  harvesterPods?.forEach(p => nsSet.add(p.namespace));
  // ...
  
  return Array.from(nsSet).filter(Boolean).sort();
}, [harvesterNamespaces, harvesterDeployments, ...]);
```

#### 4. Select 组件搜索优化

```typescript
<Select
  showSearch
  optionFilterProp="label"  // 按显示文本搜索
  options={namespacesOptions.map((ns) => ({ label: ns, value: ns }))}
/>
```

### 13.3 优化效果

| 场景 | 优化前 | 优化后 |
|------|--------|--------|
| 首次加载 Secret | ~15秒 | ~15秒（需获取数据） |
| 30秒内再次加载 Secret | ~15秒 | <100ms（命中缓存） |
| 切换到镜像仓库 | ~19秒 | <100ms（复用 Secret 缓存） |
| 命名空间筛选 | 无效/匹配不全 | 正常工作 |

---

## 14. 变更记录

| 日期 | 版本 | 变更内容 |
|------|------|----------|
| 2026-03-10 | 1.0 | 初始版本，一期基础功能设计 |
| 2026-03-11 | 1.1 | 二期工作负载创建设计 |
| 2026-03-12 | 1.2 | 镜像仓库功能设计 |
| 2026-03-13 | 1.3 | Pod 终端设计 |
| 2026-03-14 | 1.4 | 任务管理设计 |
| 2026-03-15 | 1.5 | 服务发现设计 |
| 2026-03-16 | 1.6 | 配置管理设计 |
| 2026-03-17 | 1.7 | Gateway API 设计 |
| 2026-03-18 | 1.8 | 服务发现增强设计（编辑/YAML/关联Pod） |
| 2026-03-19 | 1.9 | YAML 编辑器升级设计 |
| 2026-03-20 | 2.0 | 三期功能规划（高级调度策略/NetworkPolicy/交互优化/租户视角） |
| 2026-03-24 | 2.1 | 高级调度策略验证完成，文档恢复重建 |
| 2026-03-25 | 2.2 | 补充技术实现细节、遗漏功能设计、四期规划 |

---

## 15. 技术实现细节补充

> 本章节基于代码审查补充已实现功能的详细技术设计。

### 15.1 工作负载管理模块

#### 15.1.1 核心组件架构

**WorkloadsSection.tsx** - 工作负载列表组件：
```typescript
// 关键实现：多类型工作负载合并展示
const workloads = useMemo(() => {
  const deployments = (harvesterDeployments || []).map(d => ({
    ...d,
    workloadType: 'Deployment',
  }));
  const statefulSets = (harvesterStatefulSets || []).map(s => ({
    ...s,
    workloadType: 'StatefulSet',
  }));
  const daemonSets = (harvesterDaemonSets || []).map(d => ({
    ...d,
    workloadType: 'DaemonSet',
  }));
  return [...deployments, ...statefulSets, ...daemonSets];
}, [harvesterDeployments, harvesterStatefulSets, harvesterDaemonSets]);
```

**WorkloadForm.tsx** - 工作负载创建表单：
- 采用分步骤表单（Steps Form）
- 步骤1：基本信息（名称、命名空间、类型、标签、注解）
- 步骤2：容器配置（镜像、资源、环境变量、端口、存储卷）
- 步骤3：高级配置（调度策略、镜像拉取凭证）

#### 15.1.2 高级调度策略实现

**核心架构原则**：
1. **Form 是数据唯一来源**：所有数据存储在 Ant Design Form 中
2. **本地 state 仅用于触发重渲染**：使用版本号或时间戳触发 UI 更新
3. **输入框使用非受控模式**：`defaultValue` + `onBlur` 避免 re-render 问题

**关键代码模式**：
```typescript
// 添加规则时：先从 Form 读取当前值，更新 Form，再触发重渲染
const addNodeAffinityRequired = useCallback(() => {
  const current = form.getFieldValue(['nodeAffinity', 'required']) || [];
  const newItem = {
    matchExpressions: [],
    matchFields: [],
  };
  form.setFieldValue(['nodeAffinity', 'required'], [...current, newItem]);
  setFormVersion(v => v + 1); // 仅触发重渲染
}, [form]);

// 表达式输入框使用 defaultValue + onBlur
<Input
  defaultValue={expression.key}
  onBlur={(e) => {
    const updated = [...expressions];
    updated[index] = { ...updated[index], key: e.target.value };
    form.setFieldValue(path, updated);
  }}
/>
```

**污点容忍预设值**：
```typescript
const tolerationPresets = [
  {
    name: '控制平面节点',
    toleration: {
      key: 'node-role.kubernetes.io/control-plane',
      operator: 'Exists',
      effect: 'NoSchedule',
    },
  },
  {
    name: '主节点（旧版）',
    toleration: {
      key: 'node-role.kubernetes.io/master',
      operator: 'Exists',
      effect: 'NoSchedule',
    },
  },
  {
    name: '任意污点',
    toleration: { operator: 'Exists' },
  },
];
```

### 15.2 Pod 管理模块

#### 15.2.1 WebSocket 实现

**Pod 日志 (kvPodLog.ts)**：
```typescript
// 后端核心逻辑
ws.on('connection', async (ws, req) => {
  const { cloudId, namespace, podName, container, tailLines } = parseQuery(req);
  
  const kc = await getKubeConfig(cloudId);
  const k8sApi = kc.makeApiClient(CoreV1Api);
  
  // 调用 K8s API 获取日志流
  const response = await k8sApi.readNamespacedPodLog(
    podName,
    namespace,
    container,
    undefined, // follow
    undefined, // insecureSkipTLSVerifyBackend
    undefined, // limitBytes
    tailLines ? parseInt(tailLines) : undefined,
    undefined, // pretty
    undefined, // previous
    undefined, // sinceSeconds
    undefined, // timestamps
    true       // follow - 实时流
  );
  
  // 发送日志数据
  ws.send(response.body);
});

// 前端 PodLogViewer.tsx
const ws = new WebSocket(
  `${wsBase}/ws/kv-pod-log?cloudId=${cloudId}&namespace=${namespace}&podName=${podName}&container=${container}&tailLines=${tailLines}`
);

ws.onmessage = (event) => {
  setLogs(prev => prev + event.data);
};
```

**Pod 终端 (kvPodExec.ts)**：
```typescript
// 后端使用 K8s exec WebSocket 协议
// 支持多种 channel 协议：channel.k8s.io、channel.k8s.io/2.0

const exec = new WebSocket(`https://${clusterHost}${execPath}`, [
  'v4.channel.k8s.io',
  'v3.channel.k8s.io',
  'v2.channel.k8s.io',
  'channel.k8s.io',
]);

// 数据格式转换（K8s exec 协议）
// 格式：[channel][data]
// channel 0 = stdin, 1 = stdout, 2 = stderr, 3 = error info, 4 = terminal resize

// 前端 PodTerminal.tsx 使用 xterm.js
const term = new Terminal({
  cursorBlink: true,
  fontSize: 14,
  fontFamily: 'Monaco, Menlo, Consolas, monospace',
});

// 双向数据传输
term.onData((data) => {
  ws.send(JSON.stringify({ type: 'stdin', data }));
});

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'stdout' || msg.type === 'stderr') {
    term.write(msg.data);
  }
};
```

### 15.3 任务管理模块

#### 15.3.1 Job 失败原因解析

```typescript
// 解析 Job 失败原因
const getJobFailureReason = (job: any): string | null => {
  if (!job.status?.failed) return null;
  
  const conditions = job.status?.conditions || [];
  const failedCondition = conditions.find(
    (c: any) => c.type === 'Failed' && c.status === 'True'
  );
  
  if (failedCondition) {
    return failedCondition.reason || failedCondition.message;
  }
  
  return null;
};

// 显示失败原因
{
  job.status?.failed > 0 && (
    <Tooltip title={getJobFailureReason(job)}>
      <Tag color="error">失败 {job.status.failed} 次</Tag>
    </Tooltip>
  )
}
```

#### 15.3.2 Cron 表达式助手

```typescript
// CronExpressionHelper.tsx
const cronMacros = [
  { macro: '@yearly', expression: '0 0 1 1 *', description: '每年执行一次' },
  { macro: '@monthly', expression: '0 0 1 * *', description: '每月执行一次' },
  { macro: '@weekly', expression: '0 0 * * 0', description: '每周执行一次' },
  { macro: '@daily', expression: '0 0 * * *', description: '每天执行一次' },
  { macro: '@hourly', expression: '0 * * * *', description: '每小时执行一次' },
];

// 字段解析
const parseCronExpression = (expression: string) => {
  if (expression.startsWith('@')) {
    const macro = cronMacros.find(m => m.macro === expression);
    return macro ? { expression: macro.expression, description: macro.description } : null;
  }
  
  const parts = expression.split(' ');
  return {
    minute: parts[0],
    hour: parts[1],
    dayOfMonth: parts[2],
    month: parts[3],
    dayOfWeek: parts[4],
  };
};
```

### 15.4 服务发现模块

#### 15.4.1 Service 关联 Pod 查询

```typescript
// ServiceRelatedPodsTab.tsx
const fetchRelatedPods = async () => {
  const selector = service.spec?.selector;
  if (!selector) {
    setPods([]);
    return;
  }
  
  // 构建 label selector 字符串
  const labelSelector = Object.entries(selector)
    .map(([key, value]) => `${key}=${value}`)
    .join(',');
  
  const response = await harvesterApi.getPods(cloudId, namespace, labelSelector);
  setPods(response.data || []);
};
```

#### 15.4.2 Gateway API CRD 检测

```typescript
// GatewayApiSection.tsx
const checkGatewayApiCRD = async () => {
  try {
    // 检测 GatewayClass CRD 是否存在
    await harvesterApi.getGatewayClasses(cloudId);
    setGatewayApiInstalled(true);
  } catch (error) {
    setGatewayApiInstalled(false);
  }
};

// 未安装时提示用户
if (!gatewayApiInstalled) {
  return (
    <Alert
      type="info"
      message="Gateway API 未安装"
      description={
        <span>
          当前集群未安装 Gateway API CRD。
          <a href="https://gateway-api.sigs.k8s.io/guides/" target="_blank">
            查看安装指南
          </a>
        </span>
      }
    />
  );
}
```

### 15.5 配置管理模块

#### 15.5.1 Secret 脱敏显示

```typescript
// SecretForm.tsx / Secret 详情展示
const [showSecret, setShowSecret] = useState(false);

// 脱敏显示
const maskValue = (value: string) => {
  if (showSecret) return value;
  if (value.length <= 4) return '****';
  return value.substring(0, 2) + '****' + value.substring(value.length - 2);
};

// 切换明文/脱敏
<Button onClick={() => setShowSecret(!showSecret)}>
  {showSecret ? '隐藏' : '显示'}敏感信息
</Button>
```

#### 15.5.2 配置数据语言检测

```typescript
// ConfigMapForm.tsx - 自动检测语言用于代码高亮
const detectLanguage = (content: string): string => {
  if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
    return 'json';
  }
  if (content.includes('\n') && content.includes(': ')) {
    return 'yaml';
  }
  if (content.includes('<') && content.includes('>')) {
    return 'xml';
  }
  return 'plaintext';
};
```

### 15.6 PodDisruptionBudget 模块

#### 15.6.1 IntOrString 格式化

```typescript
// PDBForm.tsx
// minAvailable 和 maxUnavailable 可以是整数或百分比
const formatIntOrString = (value: string, isPercent: boolean): string => {
  if (isPercent) {
    return value + '%';
  }
  return value;
};

// 解析后端返回的值
const parseIntOrString = (value: string): { value: number; isPercent: boolean } => {
  if (value.endsWith('%')) {
    return { value: parseInt(value), isPercent: true };
  }
  return { value: parseInt(value), isPercent: false };
};
```

#### 15.6.2 PDB 状态判断

```typescript
// PDBSection.tsx
const getPDBStatus = (pdb: any): { status: string; color: string } => {
  const disruptionsAllowed = pdb.status?.disruptionsAllowed ?? 0;
  const currentHealthy = pdb.status?.currentHealthy ?? 0;
  const desiredHealthy = pdb.status?.desiredHealthy ?? 0;
  
  if (currentHealthy >= desiredHealthy && disruptionsAllowed > 0) {
    return { status: '正常', color: 'success' };
  }
  if (currentHealthy < desiredHealthy) {
    return { status: '不健康', color: 'error' };
  }
  if (disruptionsAllowed === 0) {
    return { status: '禁止中断', color: 'warning' };
  }
  return { status: '未知', color: 'default' };
};
```

### 15.7 前端 API 服务层

#### 15.7.1 harvesterApi.ts 核心函数

```typescript
// 工作负载
export const harvesterApi = {
  // Deployment
  getDeployments: (cloudId: number, namespace?: string) =>
    request.get(`/api/clouds/${cloudId}/resources/harvester/containers/workloads`, {
      params: { type: 'deployment', namespace },
    }),
  
  createDeployment: (cloudId: number, data: any) =>
    request.post(`/api/clouds/${cloudId}/resources/harvester/containers/workloads`, data),
  
  scaleDeployment: (cloudId: number, namespace: string, name: string, replicas: number) =>
    request.put(
      `/api/clouds/${cloudId}/resources/harvester/containers/workloads/deployment/${namespace}/${name}/scale`,
      { replicas }
    ),
  
  // Pod
  getPods: (cloudId: number, namespace?: string, labelSelector?: string) =>
    request.get(`/api/clouds/${cloudId}/resources/harvester/containers/pods`, {
      params: { namespace, labelSelector },
    }),
  
  // Gateway API
  checkGatewayApi: (cloudId: number) =>
    request.get(`/api/clouds/${cloudId}/resources/harvester/containers/gateway/crd-status`),
  
  createGateway: (cloudId: number, data: any) =>
    request.post(`/api/clouds/${cloudId}/resources/harvester/containers/gateway/gateways`, data),
  
  // PDB
  createPDB: (cloudId: number, data: any) =>
    request.post(`/api/clouds/${cloudId}/resources/harvester/containers/pdbs`, data),
};
```

### 15.8 后端路由设计

#### 15.8.1 容器路由结构

```typescript
// harvester.cache.container.routes.ts
router.get('/workloads', async (req, res) => {
  const { type, namespace } = req.query;
  // 返回 Deployment/StatefulSet/DaemonSet
});

router.post('/workloads', async (req, res) => {
  // 创建工作负载
});

router.put('/workloads/deployment/:namespace/:name/scale', async (req, res) => {
  // 扩缩容
});

router.post('/workloads/deployment/:namespace/:name/restart', async (req, res) => {
  // 重启（通过更新 annotation 触发滚动更新）
});

// Gateway API 路由
router.get('/gateway/crd-status', checkGatewayCRD);
router.get('/gateway/gatewayclasses', getGatewayClasses);
router.post('/gateway/gateways', createGateway);
router.post('/gateway/httproutes', createHTTPRoute);
router.post('/gateway/grpcroutes', createGRPCRoute);

// PDB 路由
router.get('/pdbs', getPDBs);
router.post('/pdbs', createPDB);
router.delete('/pdbs/:namespace/:name', deletePDB);
```

---

## 16. 遗漏功能补充设计

> 本章节补充竞品对比分析中发现的三期遗漏功能。

### 16.1 TopologySpreadConstraints（拓扑分布约束）

**功能说明**：
比亲和性更现代的调度方式，用于跨可用区/节点均衡分布 Pod，确保高可用。

**与亲和性的区别**：
| 特性 | 节点亲和性 | Pod 亲和性/反亲和性 | TopologySpreadConstraints |
|------|-----------|-------------------|--------------------------|
| 主要目的 | 定向调度 | 聚合/分散 Pod | 均匀分布 Pod |
| 灵活性 | 中 | 高 | 高 |
| Kubernetes 版本 | 1.0+ | 1.4+ | 1.19+ 稳定 |
| 配置复杂度 | 中 | 高 | 低 |

**Kubernetes 资源结构**：
```yaml
spec:
  topologySpreadConstraints:
    - maxSkew: 1                          # 最大不平衡度
      topologyKey: topology.kubernetes.io/zone  # 拓扑域
      whenUnsatisfiable: DoNotSchedule    # 或 ScheduleAnyway
      labelSelector:
        matchLabels:
          app: my-app
      minDomains: 2                       # 可选：最小域数量
```

**UI 设计**：
```
WorkloadForm 步骤3: 高级配置
└── 调度策略
    └── 拓扑分布约束
        ├── [+] 添加约束
        │   ├── 最大不平衡度 (maxSkew): [1]
        │   ├── 拓扑域 (topologyKey): [kubernetes.io/hostname ▼]
        │   │   常用选项:
        │   │   - kubernetes.io/hostname (节点级)
        │   │   - topology.kubernetes.io/zone (可用区级)
        │   │   - topology.kubernetes.io/region (区域级)
        │   ├── 不满足时行为: [DoNotSchedule ▼]
        │   │   - DoNotSchedule: 不调度（严格模式）
        │   │   - ScheduleAnyway: 尽量调度（软约束）
        │   └── 标签选择器: [选择匹配的 Pod]
```

**前端实现建议**：
```typescript
// WorkloadForm.tsx 新增拓扑分布约束编辑器
const TopologySpreadConstraintsEditor: React.FC = () => {
  return (
    <Form.List name="topologySpreadConstraints">
      {(fields, { add, remove }) => (
        <>
          {fields.map(({ key, name }) => (
            <Card key={key} size="small">
              <Row gutter={16}>
                <Col span={6}>
                  <Form.Item name={[name, 'maxSkew']} label="最大不平衡度">
                    <InputNumber min={1} />
                  </Form.Item>
                </Col>
                <Col span={6}>
                  <Form.Item name={[name, 'topologyKey']} label="拓扑域">
                    <Select>
                      <Select.Option value="kubernetes.io/hostname">节点级</Select.Option>
                      <Select.Option value="topology.kubernetes.io/zone">可用区级</Select.Option>
                      <Select.Option value="topology.kubernetes.io/region">区域级</Select.Option>
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={6}>
                  <Form.Item name={[name, 'whenUnsatisfiable']} label="不满足时行为">
                    <Select>
                      <Select.Option value="DoNotSchedule">不调度</Select.Option>
                      <Select.Option value="ScheduleAnyway">尽量调度</Select.Option>
                    </Select>
                  </Form.Item>
                </Col>
              </Row>
              <LabelSelectorEditor name={[name, 'labelSelector']} />
            </Card>
          ))}
          <Button onClick={() => add()}>+ 添加约束</Button>
        </>
      )}
    </Form.List>
  );
};
```

### 16.2 HPA 水平自动伸缩

**功能说明**：
基于 CPU/内存使用率或自定义指标自动调整 Pod 副本数，生产环境必备功能。

**Kubernetes 资源结构**：
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: nginx-hpa
  namespace: default
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: nginx-deployment
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:  # 可选：控制伸缩行为
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 10
          periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Percent
          value: 100
          periodSeconds: 15
```

**UI 设计**：
```
┌─────────────────────────────────────────────────────────────────────┐
│ 创建 HorizontalPodAutoscaler                                         │
├─────────────────────────────────────────────────────────────────────┤
│ 名称 *        [________________]                                     │
│ 命名空间 *    [default    ▼]                                         │
│                                                                     │
│ 目标工作负载                                                        │
│ 类型 *        [Deployment ▼]                                        │
│ 名称 *        [nginx-app ▼]                                         │
│                                                                     │
│ 副本数配置                                                          │
│ 最小副本数 *  [___]                                                  │
│ 最大副本数 *  [___]                                                  │
│ 当前副本数    3 (只读)                                               │
│                                                                     │
│ 伸缩指标                                                            │
│ ☑ CPU 使用率    目标值: [___]%                                      │
│ ☑ 内存使用率    目标值: [___]%                                      │
│ ☐ 自定义指标    [+] 添加                                            │
│                                                                     │
│ 伸缩行为 (高级)                                                      │
│ ☐ 自定义伸缩行为                                                    │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                           [取消]            [创建]  │
└─────────────────────────────────────────────────────────────────────┘
```

**导航位置**：
```
容器 Tab
├── 工作负载
├── Pod
├── ...
├── 自动伸缩  ← 新增
│   ├── HPA (HorizontalPodAutoscaler)
│   └── VPA (VerticalPodAutoscaler) - 未来
└── ...
```

**后端 API 设计**：
```
/api/clouds/{id}/resources/harvester/containers/hpas
├── GET    /                    # 列表
├── POST   /                    # 创建
├── GET    /:namespace/:name    # 详情
├── PUT    /:namespace/:name    # 更新
└── DELETE /:namespace/:name    # 删除
```

### 16.3 ResourceQuota 配额管理

**功能说明**：
命名空间级别的资源配额限制，多租户场景必需。

**Kubernetes 资源结构**：
```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: compute-quota
  namespace: tenant-a
spec:
  hard:
    requests.cpu: "10"
    requests.memory: 20Gi
    limits.cpu: "20"
    limits.memory: 40Gi
    persistentvolumeclaims: "10"
    pods: "50"
    services: "10"
    secrets: "20"
    configmaps: "20"
```

**UI 设计**：
```
┌─────────────────────────────────────────────────────────────────────┐
│ 创建 ResourceQuota                                                   │
├─────────────────────────────────────────────────────────────────────┤
│ 名称 *        [________________]                                     │
│ 命名空间 *    [tenant-a  ▼]                                          │
│                                                                     │
│ 计算资源配额                                                        │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │               请求值          限制值                             │ │
│ │ CPU           [____] 核       [____] 核                         │ │
│ │ 内存          [____] Gi       [____] Gi                         │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│ 对象数量配额                                                        │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ Pod 数量上限          [____]                                    │ │
│ │ Service 数量上限      [____]                                    │ │
│ │ Secret 数量上限       [____]                                    │ │
│ │ ConfigMap 数量上限    [____]                                    │ │
│ │ PVC 数量上限          [____]                                    │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│ 存储配额                                                            │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ 持久卷请求总量        [____] Gi                                  │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                           [取消]            [创建]  │
└─────────────────────────────────────────────────────────────────────┘
```

### 16.4 LimitRange 默认限制

**功能说明**：
为 Pod/Container 设置默认资源请求和限制，防止资源滥用。

**Kubernetes 资源结构**：
```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
  namespace: tenant-a
spec:
  limits:
    - type: Container
      default:          # 默认限制
        cpu: 500m
        memory: 512Mi
      defaultRequest:   # 默认请求
        cpu: 100m
        memory: 128Mi
      max:              # 最大限制
        cpu: 2
        memory: 2Gi
      min:              # 最小请求
        cpu: 50m
        memory: 64Mi
    - type: PersistentVolumeClaim
      max:
        storage: 50Gi
      min:
        storage: 1Gi
```

**与 ResourceQuota 的关系**：
- ResourceQuota：命名空间总配额
- LimitRange：单个 Pod/PVC 的默认值和上下限

### 16.5 网络策略可视化

**功能说明**：
图形化展示 NetworkPolicy 的效果，降低配置理解门槛。

**UI 设计**：
```
┌─────────────────────────────────────────────────────────────────────┐
│ NetworkPolicy: api-network-policy                                    │
├─────────────────────────────────────────────────────────────────────┤
│ 策略效果预览                                                         │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                                                             │   │
│  │   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐  │   │
│  │   │ 外部入口     │────▶│ 目标 Pod    │────▶│ 外部出口     │  │   │
│  │   │             │     │ api-pods    │     │             │  │   │
│  │   │ ✅ 10.0.0.0/8│     │ namespace:  │     │ ✅ 10.0.0.0/8│  │   │
│  │   │ ✅ namespace:│     │   api       │     │ ❌ 其他      │  │   │
│  │   │   frontend  │     │             │     │             │  │   │
│  │   │ ❌ 其他      │     │ 3 pods      │     │             │  │   │
│  │   └─────────────┘     └─────────────┘     └─────────────┘  │   │
│  │                                                             │   │
│  │   图例: ✅ 允许  ❌ 拒绝  ⚪ 未配置规则                       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│ 入站规则 (Ingress)                                                  │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ #   来源                      端口                    操作     │ │
│ │ 1   namespace: frontend       TCP:8080               [编辑][删除]│ │
│ │ 2   ipBlock: 10.0.0.0/8       TCP:8080               [编辑][删除]│ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**技术方案**：
- 使用 AntV G6 或 React Flow 绘制拓扑图
- 实时计算策略效果
- 支持点击节点查看详情

### 16.6 事件中心

**功能说明**：
集中展示集群事件，便于问题排查。

**Kubernetes Event 结构**：
```yaml
apiVersion: v1
kind: Event
metadata:
  name: nginx-abc123.17a2b3c4
  namespace: default
involvedObject:
  kind: Pod
  name: nginx-abc123
  namespace: default
reason: Pulling
message: Pulling image "nginx:latest"
source:
  component: kubelet
  host: node-1
type: Normal  # Normal 或 Warning
firstTimestamp: "2026-03-25T10:00:00Z"
lastTimestamp: "2026-03-25T10:00:01Z"
count: 1
```

**UI 设计**：
```
┌─────────────────────────────────────────────────────────────────────┐
│ 集群事件                                           [刷新] [过滤]    │
├─────────────────────────────────────────────────────────────────────┤
│ 时间范围: [最近1小时 ▼]  类型: [全部 ▼]  资源类型: [全部 ▼]        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ ⚠️ Warning  10:30:15  Pod/nginx-abc123                             │
│    镜像拉取失败: Error: ImagePullBackOff                           │
│    来源: kubelet/node-1                                             │
│                                                                     │
│ ℹ️ Normal    10:30:00  Pod/nginx-abc123                             │
│    正在拉取镜像 nginx:latest                                        │
│    来源: kubelet/node-1                                             │
│                                                                     │
│ ℹ️ Normal    10:28:00  Deployment/nginx-deployment                  │
│    成功扩容至 3 个副本                                               │
│    来源: deployment-controller                                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 17. 四期功能规划

> 基于竞品对比分析，建议在三期完成后规划四期功能。

### 17.1 四期功能范围

| 模块 | 功能 | 优先级 | 预计工作量 |
|------|------|--------|-----------|
| **自动伸缩** | HPA 水平自动伸缩 | 🔴 高 | 3-4 天 |
| **配额管理** | ResourceQuota 创建/管理 | 🔴 高 | 2-3 天 |
| **配额管理** | LimitRange 默认限制 | 🔴 高 | 1-2 天 |
| **调度策略** | TopologySpreadConstraints | 🔴 高 | 2-3 天 |
| **监控集成** | Pod/Workload 监控指标 | 🟡 中 | 3-4 天 |
| **网络策略** | NetworkPolicy 可视化 | 🟡 中 | 3-4 天 |
| **事件中心** | 集群事件集中展示 | 🟡 中 | 2-3 天 |
| **监控集成** | Prometheus 告警规则 | 🟢 低 | 3-4 天 |
| **应用部署** | Helm Chart 部署 | 🟢 低 | 5-7 天 |
| **扩展性** | CRD 资源浏览器 | 🟢 低 | 2-3 天 |

### 17.2 四期实施路线

```
阶段 A（生产必需 - 1-2 周）
├── TopologySpreadConstraints 支持
├── ResourceQuota 基础功能
├── LimitRange 默认限制
└── HPA 水平自动伸缩

阶段 B（体验增强 - 2-3 周）
├── NetworkPolicy 可视化
├── 监控指标集成
├── 事件中心
└── 表单内快速创建关联资源（三期延续）

阶段 C（生态扩展 - 按需）
├── Helm Chart 部署
├── CRD 资源浏览器
├── VPA 推荐
└── 服务网格集成
```

### 17.3 与成熟产品的差距分析

| 功能领域 | Rancher | KubeSphere | OpenShift | Compute Tower 四期规划 |
|---------|---------|------------|-----------|----------------------|
| 调度策略 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 自动伸缩 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ (新增 HPA) |
| 网络策略 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ (新增可视化) |
| 配额管理 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ (新增 ResourceQuota) |
| 监控告警 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ (新增基础监控) |
| 应用部署 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ (表单+YAML) |
| 多租户 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ (三期租户视角) |

---

## 附录

### A. 关键文件列表

```
frontend/src/pages/Clouds/Harvester/containers/
├── index.ts                    # 导出文件
├── WorkloadsSection.tsx        # 工作负载组件
├── PodsSection.tsx             # Pod 组件
├── JobsSection.tsx             # 任务组件
├── ConfigsSection.tsx          # 配置管理组件
├── RegistriesSection.tsx       # 镜像仓库组件
├── GatewayApiSection.tsx       # Gateway API 组件
├── PDBSection.tsx              # PodDisruptionBudget 组件
└── components/
    ├── WorkloadForm.tsx        # 工作负载创建表单
    ├── WorkloadFormModal.tsx   # 工作负载创建弹窗
    ├── JobForm.tsx             # Job 创建表单
    ├── CronJobForm.tsx         # CronJob 创建表单
    ├── ServiceForm.tsx         # Service 创建表单
    ├── IngressForm.tsx         # Ingress 创建表单
    ├── GatewayForm.tsx         # Gateway 创建表单
    ├── HTTPRouteForm.tsx       # HTTPRoute 创建表单
    ├── GRPCRouteForm.tsx       # GRPCRoute 创建表单
    ├── ConfigMapForm.tsx       # ConfigMap 创建表单
    ├── SecretForm.tsx          # Secret 创建表单
    ├── PDBForm.tsx             # PDB 创建表单
    ├── PodTerminal.tsx         # Pod 终端组件
    ├── PodLogViewer.tsx        # Pod 日志组件
    ├── YamlEditModal.tsx       # YAML 编辑弹窗
    └── RegistryBrowser.tsx     # 仓库浏览器

backend/src/routes/clouds/harvester/
└── harvester.cache.container.routes.ts  # 容器 API 路由

backend/src/ws/
├── kvPodLog.ts                 # Pod 日志 WebSocket
└── kvPodExec.ts                # Pod 终端 WebSocket
```

### B. 参考文档

- [Kubernetes API 官方文档](https://kubernetes.io/docs/reference/kubernetes-api/)
- [Harvester 官方文档](https://docs.harvesterhci.io)
- [KubeVirt API 参考](https://kubevirt.io/api-reference/)
- [Gateway API 规范](https://kubernetes.io/zh-cn/docs/concepts/services-networking/gateway/)
