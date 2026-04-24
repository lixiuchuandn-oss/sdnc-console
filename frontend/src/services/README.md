# Services 目录说明

> **目录**: `frontend/src/services`  
> **用途**: 集中管理所有 API 服务函数，提供统一的接口调用方式  
> **最后更新**: 2024

---

## 📋 目录结构

本目录包含所有 API 服务文件，按功能模块分类：

```
services/
├── api.ts                    # 核心 API 服务（统一请求函数）
├── harvesterApi.ts          # Harvester 云平台 API
├── aliyunApi.ts             # 阿里云 API
├── huaweiApi.ts             # 华为云 API
├── securityDomainApi.ts     # 自定义 业务 安全域 API
├── securityGroups.ts        # 公有云 安全组 API
├── virtualRouterApi.ts      # 自研 虚拟路由器VR API（包含 VR 生命周期、配置、ACL、NAT）
├── trafficOrchestration.ts  # 自研 虚拟交换机VSW 流量编排 API
├── monitoringApi.ts         # 监控与告警 API
├── loggingApi.ts            # 日志管理 API
├── systemApi.ts             # 系统配置 API
└── aiSocApi.ts              # AI SOC（威胁事件）API
```

---

## 🔧 核心基础文件

### `api.ts` - 核心 API 服务

**作用**: 提供统一的 API 请求函数，所有其他服务文件应该使用这些函数

**主要导出**:
- `apiRequest(endpoint, options?)` - GET 请求（带缓存、去重、重试）
- `apiPost(endpoint, body)` - POST 请求（带重试）
- `apiDelete(endpoint)` - DELETE 请求（带重试）
- `apiPatch(endpoint, body)` - PATCH 请求（带重试）
- `proxyApiRequest(path, method, other, body, accessKey?, secretKey?)` - 代理 API 请求（用于 CSM CTL 通信）
- `getProxyAuthInfo(path, method, other, bodyRaw, accessKey?, secretKey?)` - 获取代理 API 签名信息
- `getAuthHeaders()` - 获取认证头
- `API_BASE_URL` - API 基础 URL

**特性**:
- ✅ 自动处理认证（token）
- ✅ 自动错误处理
- ✅ 请求去重（相同请求只发送一次）
- ✅ 请求缓存（GET 请求缓存 5 分钟）
- ✅ 请求重试（失败自动重试 2 次，指数退避）

**使用示例**:
```typescript
import { apiRequest, apiPost, apiDelete } from './api';

// GET 请求
const data = await apiRequest('/api/users');

// POST 请求
const result = await apiPost('/api/users', { name: 'test' });

// DELETE 请求
await apiDelete('/api/users/123');
```

---

## ☁️ 云平台相关

### `harvesterApi.ts` - Harvester 云平台 API

**作用**: 管理 Harvester 云平台的所有资源

**主要功能**:
- **VM 管理**: 创建、查询、启动、停止、删除、迁移、备份、恢复
- **存储管理**: Volume、Snapshot、StorageClass、Image
- **网络管理**: VPC、Subnet、NAD、ClusterNetwork、IPPool
- **其他资源**: Namespace、SSH Key、CloudInit、Ingress、Service、LoadBalancer、Template、USB 设备
- **Kube-OVN**: Subnet、VPC、EIP、FIP、SNAT、DNAT 规则
- **监控**: Events、Pods、Node 详情

**API 路径**: `/api/clouds/{cloudId}/resources/harvester/*`

**状态**: ✅ **已统一** - 使用 `apiRequest`, `apiPost`, `apiDelete`, `apiPatch`

---

### `aliyunApi.ts` - 阿里云 API

**作用**: 管理阿里云平台的所有资源

**主要功能**:
- **ECS 管理**: 启动、停止、重启、删除、VNC、监控指标、历史事件
- **网络管理**: VPC、VSwitch、ENI、EIP、VPN Gateway
- **安全组**: 创建、更新、删除、规则管理
- **路由**: Route Table、Route Entry
- **其他**: LoadBalancer、NAT Gateway、Network ACL

**API 路径**: `/api/clouds/{cloudId}/resources/*` 或 `/api/clouds/{cloudId}/ecs/*`

**状态**: ✅ **已统一** - 使用 `apiRequest`, `apiPost`, `apiDelete`, `apiPatch`

---

### `huaweiApi.ts` - 华为云 API

**作用**: 管理华为云平台的所有资源

**主要功能**:
- **ECS 管理**: 监控指标（CES）、审计日志、审计追踪
- **网络管理**: VPC、Subnet、Port、EIP 绑定/解绑
- **安全组**: 创建、更新、删除、规则管理

**API 路径**: `/api/clouds/{cloudId}/resources/*`

**状态**: ✅ **已统一** - 使用 `apiRequest`, `apiPost`, `apiDelete`, `apiPatch`

---

## 🌐 网络与安全

### `virtualRouterApi.ts` - 虚拟路由器 API（包含网络配置）

**作用**: 管理虚拟路由器的完整生命周期和网络配置

**主要功能**:
- **VR 生命周期**: 创建、更新、删除、查询 VR 实例（直接调用 CSM CTL）
- **VR 配置管理**: 保存、获取、角色设置（PE/CE/标准/SASE）
- **VR 发现和缓存**: 分页列表、实时列表、缓存管理
- **ACL 管理**: 
  - ACL 组：创建、更新、删除、绑定/解绑 VR
  - ACL 规则：创建、更新、删除（支持组内规则和独立规则）
  - 配置下发：推送 ACL 配置到 VR 设备（推送到 CSM CTL）
- **NAT 管理**: 创建、删除 NAT 规则（SNAT、DNAT、静态 NAT）

**API 路径**: 
- CSM CTL 直接调用：`/api-proxy/V2/ctcontrol/VR1/*`
- 后端 API：`/api/vr-config/*`, `/api/vr-instances/*`, `/api/networks/acl*`, `/api/networks/nat*`

**状态**: ✅ **已统一** - 使用 `apiRequest`, `apiPost`, `apiDelete`, `apiPatch`, `proxyApiRequest`

**注意**: `networkApi.ts` 已合并到此文件，所有 ACL 和 NAT 相关功能现在都在 `virtualRouterApi.ts` 中。

---

### `securityDomainApi.ts` - 安全域 API

**作用**: 管理安全域（Security Domain）

**主要功能**:
- 查询、创建、更新、删除安全域
- 支持 VPC 模式和扁平网络模式

**API 路径**: `/api/security-domains/*`

**状态**: ✅ **已统一** - 使用 `apiRequest`, `apiPost`, `apiPatch`, `apiDelete`

---

### `securityGroups.ts` - 安全组 API

**作用**: 管理云平台安全组（跨云平台通用）

**主要功能**:
- 查询、创建、更新、删除安全组
- 查询安全组详情
- 管理安全组规则（创建、删除）

**API 路径**: `/api/clouds/{cloudId}/resources/security-groups/*`

**状态**: ✅ **已统一** - 使用 `apiRequest`, `apiPost`, `apiDelete`, `apiPatch`

---

### `virtualRouterApi.ts` - 虚拟路由器 API

**作用**: 管理虚拟路由器（VR）设备

**主要功能**:
- **生命周期**: 创建、查询、更新、删除 VR 实例（通过 CSM CTL）
- **配置管理**: 保存、查询 VR 配置（缓存和实时）
- **角色管理**: 设置、查询 VR 角色（PE、CE、标准、SASE）
- **缓存管理**: VR 列表缓存、实时列表

**API 路径**: 
- `/api-proxy/*` - CSM CTL 代理（生命周期）
- `/api/vr-config/*` - VR 配置管理
- `/api/vr-instances/*` - VR 实例聚合（列表、单条、刷新）

**状态**: ✅ **已统一** - 配置管理使用 `apiRequest`, `apiPost`，生命周期使用 `proxyApiRequest`

---

### `trafficOrchestration.ts` - 流量编排 API

**作用**: 管理流量编排（安全域、保护对象、服务链）

**主要功能**:
- **安全域**: 查询、创建、更新、删除（实际调用 Security Domain API）
- **保护对象**: 查询、创建、更新、删除
- **服务链**: 查询、创建、更新、删除

**API 路径**: `/api/security/traffic/*`, `/api/security-domains/*`

**状态**: ✅ **已统一** - 使用 `apiRequest`, `apiPost`, `apiDelete`, `apiPatch`

---

## 📊 监控与日志

### `monitoringApi.ts` - 监控与告警 API

**作用**: 管理监控指标和告警配置

**主要功能**:
- **监控概览**: 存储节点、节点资源、节点指标、VM 实例、块设备
- **指标查询**: Prometheus 范围查询（用于图表）
- **告警规则**: PrometheusRule 查询
- **告警配置**: AlertmanagerConfig、告警通知对象（邮件、钉钉、网站）
- **告警密钥**: Secret 管理（用于告警通知认证）

**API 路径**: `/api/clouds/{cloudId}/monitoring/*`

**状态**: ✅ **已统一** - 内部使用统一 API 函数，保持向后兼容的返回格式 `{ data, ok, error }`

---

### `loggingApi.ts` - 日志管理 API

**作用**: 管理集群日志配置和资源组日志外发

**主要功能**:
- **集群日志**: ClusterFlow、ClusterOutput（集群级别）
- **资源组日志**: Flow、Output（命名空间级别）
- **节点管理**: 日志节点列表
- **Harvester 集成**: VM Pod 查询、事件查询

**API 路径**: `/api/clouds/{cloudId}/logging/*`

**状态**: ✅ **已统一** - 内部使用统一 API 函数，保持向后兼容的返回格式 `{ data, ok, error }`

---

## ⚙️ 系统与工具

### `systemApi.ts` - 系统配置 API

**作用**: 管理系统配置和工具功能

**主要功能**:
- **系统设置**: 获取、更新系统设置
- **安全日志**: 上传、列表查询
- **威胁事件**: CSV 导入、列表查询

**API 路径**: `/api/system/*`, `/api/threats/*`

**状态**: ✅ **已统一** - 使用 `apiRequest`, `apiPost`, `apiPatch`, `apiUpload`

---

### `aiSocApi.ts` - AI SOC API

**作用**: AI 安全运营中心（威胁事件查询）

**主要功能**:
- 按租户代码查询威胁事件报告任务

**API 路径**: `/api/threats/proxy/api/v1/report-tasks/*`

**状态**: ✅ **已统一** - 使用 `apiRequest`

---

## 📝 使用规范

### ✅ 推荐做法

所有新的 API 服务函数应该：

1. **导入统一函数**:
```typescript
import { apiRequest, apiPost, apiDelete, apiPatch } from './api';
```

2. **使用统一函数**:
```typescript
export const fetchUsers = async () => {
  return await apiRequest('/api/users');
};

export const createUser = async (payload: any) => {
  return await apiPost('/api/users', payload);
};
```

3. **移除手动 token 处理**:
```typescript
// ❌ 不要这样做
const token = getToken();
const res = await fetch(url, {
  headers: { 'Authorization': token ? `Bearer ${token}` : '' }
});

// ✅ 应该这样做
return await apiRequest(url);
```

### ⚠️ 特殊情况

以下情况可能需要保留 `fetch`:

1. **流式响应** (EventSource/WebSocket):
   - 需要 token 在 URL 参数中
   - 例如: `new EventSource(url + '?token=' + token)`

2. **代理 API** (`/api-proxy/*`):
   - 需要特殊的签名逻辑
   - 使用 `proxyApiRequest` 函数

3. **文件上传** (FormData):
   - 可能需要特殊的 Content-Type
   - 可以封装为专门的函数

---

## 🔄 迁移状态

### ✅ 已统一（使用统一 API 函数）

- `api.ts` - 核心文件（提供统一函数）
- `virtualRouterApi.ts` - 完全统一（包含原 `networkApi.ts` 的功能）
- `securityDomainApi.ts` - 完全统一
- `harvesterApi.ts` - 完全统一（约 212 处已替换）
- `aliyunApi.ts` - 完全统一
- `huaweiApi.ts` - 完全统一
- `securityGroups.ts` - 完全统一
- `trafficOrchestration.ts` - 完全统一
- `systemApi.ts` - 完全统一（包括文件上传）
- `aiSocApi.ts` - 完全统一
- `monitoringApi.ts` - 完全统一（内部使用统一函数，保持向后兼容格式）
- `loggingApi.ts` - 完全统一（内部使用统一函数，保持向后兼容格式）
- `virtualRouterApi.ts` - 完全统一（配置管理使用统一函数，生命周期使用 `proxyApiRequest`）

### ⚠️ 特殊说明

- `monitoringApi.ts` 和 `loggingApi.ts` 内部使用统一 API 函数，但保持向后兼容的返回格式 `{ data, ok, error }`，以便现有代码无需修改
- `virtualRouterApi.ts` 的 CSM CTL 通信使用 `proxyApiRequest` 统一处理签名和请求

---

## 🎯 最佳实践

1. **统一使用 `api.ts` 中的函数**: 所有 API 调用应通过 `apiRequest`, `apiPost`, `apiDelete`, `apiPatch` 进行

2. **按功能模块组织**: 每个文件对应一个业务模块，便于维护

3. **导出类型定义**: 在服务文件中定义并导出相关的 TypeScript 接口

4. **错误处理**: 统一函数已处理错误，无需在每个函数中重复处理

5. **文档注释**: 为每个导出的函数添加 JSDoc 注释，说明参数和返回值

---

## 📚 相关文档

- 仓库级说明与规范：`AGENTS.md`、`deployment/docs/`（含 `specs/api/`、`architecture/` 等）
- 以下曾计划在根目录 `docs/` 下的专题稿若未落库，请以代码与 `deployment/docs` 为准

---

**最后更新**: 2024
