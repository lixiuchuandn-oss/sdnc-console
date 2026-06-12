# Compute Tower · 租户全量查询接口说明

> **版本**：2026-06  
> **受众**：对接 Compute Tower 北向 API 的下游系统（VR、SASE、运营平台等）  
> **用途**：按租户 ID 一次性拉取租户及其组织、用户、资源池分配、网际路由域与关联 CSM 安全域信息。

---

## 1. 概述

本接口在原有「租户详情」能力之上，聚合输出租户侧**全量配置视图**，便于下游系统同步租户上下文，无需多次拼装子接口。

| 维度 | 说明 |
|------|------|
| 租户 | 租户基本信息 |
| 组织 | 组织树 + 扁平组织列表 |
| 用户 | 各组织下的租户用户（**不含密码**） |
| 计算 / 存储 / 安全 | 组织已分配的资源池及配额 |
| 网络 | 组织下的 **网际路由域（IRD）**：VPC/CIDR、VR 绑定等 |
| CSM 安全 | 每条 IRD 关联的 **CSM 安全域** 及防护对象、安全服务、服务链（实时投影） |

### 1.1 术语

| 名称 | 含义 |
|------|------|
| **网际路由域（IRD）** | Tower SDN 编排对象，对应库表 `security_domains`，`roleKind=internetwork_routing` |
| **CSM 安全域** | CSM 资源池内的逻辑安全包；与 IRD **1:1** 关联，字段为 `linkedCsmSecurityDomainId` |
| **资源池** | Tower 纳管的云实例（`clouds`），按组织分配（`user_spaces`） |

> 安全能力（防护对象、网元组、服务链）**只来自 CSM 投影**，不再使用已废弃的 `securityServiceIds` 等本地挂接字段。

---

## 2. 环境与认证

### 2.1 服务地址

将下文 `{tower-host}` 替换为实际 Tower 部署地址，例如 `https://tower.example.com`。

- API 前缀：`{tower-host}/api`
- 协议：HTTPS（生产环境推荐）或 HTTP（内网调试）

### 2.2 获取 Token

使用平台**系统用户**（管理员账号）登录，获取 JWT：

**请求**

```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "your-password"
}
```

**成功响应（节选）**

```json
{
  "message": "登录成功",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "...",
    "username": "admin",
    "role": "super_admin",
    "permissions": ["*"]
  }
}
```

**后续请求**在 Header 中携带：

```http
Authorization: Bearer <token>
```

- Token 有效期默认 **24 小时**，过期后需重新登录。
- 本接口挂载在 `/api/tenants` 下，需 **企业版授权**；试用版调用将返回 `403`。

---

## 3. 接口定义

### 3.1 租户全量查询

| 项目 | 说明 |
|------|------|
| **方法** | `GET` |
| **路径（推荐）** | `/api/tenants/{tenantId}/full` |
| **路径（等价）** | `/api/tenants/{tenantId}?scope=full` |
| **路径参数** | `tenantId`：租户 UUID |
| **请求体** | 无 |

**示例**

```bash
curl -sS "{tower-host}/api/tenants/0256670d-ef74-5816-80cf-c47fa094ab66/full" \
  -H "Authorization: Bearer <token>"
```

### 3.2 成功响应

**HTTP 200**

```json
{
  "message": "查询成功",
  "data": {
    "tenant": { },
    "exportedAt": "2026-06-12T08:00:00.000Z",
    "organizationTree": [ ],
    "organizations": [ ],
    "summary": {
      "organizationCount": 1,
      "userCount": 1,
      "resourcePoolAssignmentCount": 2,
      "internetworkRoutingDomainCount": 1
    }
  }
}
```

### 3.3 错误响应

| HTTP | `message` 示例 | 说明 |
|------|----------------|------|
| `401` | （登录相关） | 未携带 Token 或 Token 无效/过期 |
| `403` | 当前为试用版授权… | 非企业版授权 |
| `404` | 租户不存在 | `tenantId` 无效 |
| `500` | 租户全量查询失败 | 服务端异常，可重试并联系运维 |

---

## 4. 响应字段说明

### 4.1 顶层 `data`

| 字段 | 类型 | 说明 |
|------|------|------|
| `tenant` | object | 租户实体，见 §4.2 |
| `exportedAt` | string | ISO8601 导出时间（服务端生成） |
| `organizationTree` | array | 组织树（根节点数组，节点含 `children`） |
| `organizations` | array | 扁平组织列表（含用户、资源池、IRD），见 §4.3 |
| `summary` | object | 计数摘要 |

### 4.2 `tenant` 主要字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 租户 UUID |
| `name` | string | 租户名称（唯一） |
| `description` | string | 描述 |
| `status` | string | `active` / `inactive` / `suspended` |
| `rootOrganizationId` | string | 根组织 ID（可空） |
| `createdAt` / `updatedAt` | string | 创建/更新时间 |

### 4.3 `organizations[]` 主要字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 组织 UUID |
| `name` | string | 组织名称 |
| `description` | string | 描述 |
| `level` | number | 层级 |
| `parentId` | string | 父组织 ID（根组织为空） |
| `tenantId` | string | 所属租户 ID |
| `status` | string | 组织状态 |
| `users` | array | 该组织下租户用户，见 §4.4 |
| `resourcePools` | object | 资源池分配，见 §4.5 |
| `internetworkRoutingDomains` | array | 网际路由域列表，见 §4.6 |

### 4.4 `users[]`（租户用户）

返回 `TenantUser` 全字段，**不包含 `password`**。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 用户 UUID |
| `username` | string | 登录名 |
| `email` | string | 邮箱 |
| `fullName` | string | 显示名 |
| `role` | string | 租户内角色 |
| `organizationId` | string | 所属组织 |
| `tenantId` | string | 所属租户 |
| `status` | string | `active` / `inactive` |
| `lastLoginAt` | string | 最后登录时间（可空） |

### 4.5 `resourcePools`（资源池分配）

按三类划分，与 Tower 租户管理「组织 → 资源分配」界面一致：

| 键 | 分类规则 |
|----|----------|
| `compute` | 非 CSM、非对象/文件存储的云池（Cloudmap、公有云、MAAS 等） |
| `storage` | `cloud.type` 为 `object_storage` 或 `file_storage` |
| `security` | `cloud.config.provider` 为 `cloudmap.csm`（CSM 安全资源池） |

**`resourcePools.{compute|storage|security}[]` 元素**

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 分配记录 ID（`user_spaces.id`） |
| `cloudId` | string | 资源池（云实例）ID |
| `organizationId` | string | 组织 ID |
| `namespace` | string | 绑定的 K8s 命名空间/项目（可空） |
| `permissions` | string[] | 功能权限列表 |
| `status` | string | 分配状态 |
| `cpuQuota` | number | CPU 配额 |
| `memoryQuota` | number | 内存配额 |
| `storageQuota` | number | 存储配额 |
| `category` | string | `compute` / `storage` / `security`（与所在数组一致） |
| `cloud` | object | 关联云实例摘要（**已脱敏**），见 §4.7 |

### 4.6 `internetworkRoutingDomains[]`（网际路由域 + CSM）

每条记录包含 IRD 持久化字段，并附带 **CSM 安全域实时投影**。

#### 4.6.1 IRD 常用字段（网络 / VR）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | **网际路由域 ID**（下游 `domain_id` 等均指此值） |
| `name` | string | 名称 |
| `roleKind` | string | 固定为 `internetwork_routing`（本接口仅返回此类） |
| `tenantId` / `organizationId` | string | 归属 |
| `cloudId` | string | 关联计算云池 ID |
| `vpcId` | string | 绑定 VPC ID（可空） |
| `cidr` | string | 单段 IPv4 CIDR（可空） |
| `cidr4` | string[] | IPv4 CIDR 列表（由 `cidr` 或存量字段归一） |
| `cidr6` | string | IPv6 CIDR（可空，可逗号分隔） |
| `category` | string | 网络子类，如 `vpc:公有云VPC网络` |
| `vrUuid` | string | 绑定 VR 实例 UUID（与 `vr_unique_id` 同义） |
| `vrName` | string | VR 名称 |
| `csmCloudId` | string | CSM 资源池 ID（Tower `clouds.id`） |
| `csmOrgId` | string | CSM 侧组织 ID |
| `linkedCsmSecurityDomainId` | string | 关联的 **CSM 安全域 ID**（1:1，安全能力查询入口） |
| `status` | string | 状态 |
| `createdAt` / `updatedAt` | string | 创建/更新时间 |

#### 4.6.2 CSM 投影字段（重点）

| 字段 | 类型 | 说明 |
|------|------|------|
| `linkedCsmSecurityDomain` | object \| null | CSM 安全域摘要（`id`、`name`、`networkCidrs` 等） |
| `csmProtectionObjects` | array | 防护对象列表（CSM 资产 API 按关联域过滤） |
| `securityServices` | array | 安全服务（网元组等），元素见下表 |
| `serviceChains` | array | 服务链（CSM `service-chains`） |
| `csmProjectionReady` | boolean | `true` 表示投影成功且下列数组可信 |
| `csmProjectionError` | string | 投影失败原因（仅 `csmProjectionReady=false` 时有意义） |

**`securityServices[]` 元素（节选）**

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 网元组/服务 ID |
| `name` | string | 名称 |
| `type` | string | 类型 |
| `vendor` | string | 厂商（可空） |
| `defenseType` | string | 防护类型（可空） |
| `neCount` | number | 网元数量 |
| `status` | string | 状态 |
| `source` | string | 固定为 `csm_security_domain` |
| `vmIds` | string[] | 关联 VM ID（SSO 等场景） |
| `webIds` | string[] | Web 控制台 ID（SSO 等场景） |

**消费建议**

1. 拉取安全能力前，先确认 `linkedCsmSecurityDomainId` 非空。
2. 仅当 `csmProjectionReady === true` 时，将 `csmProtectionObjects` / `securityServices` / `serviceChains` 作为权威数据。
3. `csmProjectionReady === false` 时，读 `csmProjectionError`（常见：CSM 池未配置运营账号、网络不通、关联域不存在）。
4. **勿**使用已废弃字段 `securityServiceIds`；**勿**将 `id`（IRD ID）当作 CSM 安全域 ID。

### 4.7 `cloud` 脱敏规则

资源池分配中的 `cloud` 对象经 Tower 脱敏：

- `accessKey` / `secretKey`：仅保留末尾 4 位，前缀为 `***`
- `type` / `status`：统一为小写字符串

---

## 5. 完整响应示例（结构示意）

```json
{
  "message": "查询成功",
  "data": {
    "tenant": {
      "id": "0256670d-ef74-5816-80cf-c47fa094ab66",
      "name": "test0529",
      "description": null,
      "status": "active",
      "rootOrganizationId": "f7042693-8436-5594-9af3-5d3ffe65d925",
      "createdAt": "2025-05-29T00:00:00.000Z",
      "updatedAt": "2025-05-29T00:00:00.000Z"
    },
    "exportedAt": "2026-06-12T08:00:00.000Z",
    "organizationTree": [
      {
        "id": "f7042693-8436-5594-9af3-5d3ffe65d925",
        "name": "test0529",
        "level": 1,
        "parentId": null,
        "children": []
      }
    ],
    "organizations": [
      {
        "id": "f7042693-8436-5594-9af3-5d3ffe65d925",
        "name": "test0529",
        "level": 1,
        "parentId": null,
        "tenantId": "0256670d-ef74-5816-80cf-c47fa094ab66",
        "status": "active",
        "users": [
          {
            "id": "user-uuid",
            "username": "tenant-user",
            "email": "user@example.com",
            "fullName": "示例用户",
            "role": "user",
            "organizationId": "f7042693-8436-5594-9af3-5d3ffe65d925",
            "tenantId": "0256670d-ef74-5816-80cf-c47fa094ab66",
            "status": "active"
          }
        ],
        "resourcePools": {
          "compute": [
            {
              "id": "assignment-uuid",
              "cloudId": "cloud-uuid",
              "organizationId": "f7042693-8436-5594-9af3-5d3ffe65d925",
              "namespace": "tenant-ns",
              "permissions": ["clouds.console:read"],
              "status": "active",
              "cpuQuota": 100,
              "memoryQuota": 200,
              "storageQuota": 500,
              "category": "compute",
              "cloud": {
                "id": "cloud-uuid",
                "name": "Cloudmap-Pool",
                "type": "private",
                "endpoint": "https://...",
                "accessKey": "***abcd",
                "secretKey": "***efgh"
              }
            }
          ],
          "storage": [],
          "security": [
            {
              "id": "csm-assignment-uuid",
              "cloudId": "csm-cloud-uuid",
              "category": "security",
              "cpuQuota": 0,
              "memoryQuota": 0,
              "storageQuota": 0,
              "status": "active"
            }
          ]
        },
        "internetworkRoutingDomains": [
          {
            "id": "ird-uuid",
            "name": "ird-example",
            "roleKind": "internetwork_routing",
            "organizationId": "f7042693-8436-5594-9af3-5d3ffe65d925",
            "tenantId": "0256670d-ef74-5816-80cf-c47fa094ab66",
            "cloudId": "cloud-uuid",
            "vpcId": "vpc-xxx",
            "cidr4": ["10.0.0.0/16"],
            "vrUuid": "vr-uuid",
            "linkedCsmSecurityDomainId": "6a18f28b18f4904b306eb6d6",
            "linkedCsmSecurityDomain": {
              "id": "6a18f28b18f4904b306eb6d6",
              "name": "CSM-Domain-1",
              "networkCidrs": ["10.0.0.0/16"]
            },
            "csmCloudId": "csm-cloud-uuid",
            "csmProtectionObjects": [],
            "securityServices": [
              {
                "id": "svc-1",
                "name": "FW-Group",
                "type": "firewall",
                "neCount": 2,
                "status": "active",
                "source": "csm_security_domain",
                "vmIds": ["vm-1"],
                "webIds": ["web-1"]
              }
            ],
            "serviceChains": [],
            "csmProjectionReady": true,
            "csmProjectionError": null
          }
        ]
      }
    ],
    "summary": {
      "organizationCount": 1,
      "userCount": 1,
      "resourcePoolAssignmentCount": 2,
      "internetworkRoutingDomainCount": 1
    }
  }
}
```

---

## 6. 与相关接口的关系

| 场景 | 建议 |
|------|------|
| 仅需单个 IRD 详情 | `GET /api/security-domains/{irdId}`（含相同 CSM 投影字段） |
| VR / SASE 按 VR 查域 | `GET /api/sase/gateways/info?vr_uuid=` |
| 仅租户基本信息 | `GET /api/tenants/{tenantId}`（不含组织/用户/IRD） |
| 租户列表 | `GET /api/tenants` |

网际路由域与 CSM 字段语义详见：[vr-sase-downstream-notice.md](./vr-sase-downstream-notice.md)、[internetwork-routing-domain.md](./internetwork-routing-domain.md)。

---

## 7. 对接检查清单

- [ ] 已获取企业版环境下的有效 JWT
- [ ] 已知目标 `tenantId`（可由 `GET /api/tenants` 列表获取）
- [ ] 解析组织树或扁平 `organizations` 之一即可满足编排需求
- [ ] 安全侧以 `linkedCsmSecurityDomainId` + `csmProjectionReady` 为准
- [ ] 未依赖已删除字段 `securityServiceIds`
- [ ] 生产环境使用 HTTPS，Token 勿写入日志

---

## 8. 变更记录

| 日期 | 说明 |
|------|------|
| 2026-06 | 首次发布：`GET /api/tenants/{id}/full` 与 `?scope=full`；IRD 附带 CSM 安全域投影 |
