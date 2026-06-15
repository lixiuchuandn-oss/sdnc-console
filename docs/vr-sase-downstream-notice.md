# VR / SASE 网关下游对接说明（网际路由域 · Breaking Change）

> **受众**：VR 控制面、SASE 网关、PaaS VR 镜像侧研发  
> **生效**：2026-06（无现网设备，**不保留**旧「安全域本地挂服务」兼容）  
> **权威实现**：`backend/src/utils/csmSecurityDomainProjection.ts`

---

## 1. 产品更名

Tower SDN 编排对象由 **「安全域」** 更名为 **「网际路由域」（IRD）**。

- **CSM 安全域**：能力池内逻辑包（防护对象、网元组、服务链），与 IRD **1:1 关联**，非同一对象。
- 下游文档与日志请使用 **网际路由域** / **CSM 安全域**，勿单独写「安全域」。

---

## 2. Breaking Change 摘要（VR 侧必改）

| 已删除 / 废弃 | 新做法 |
|---------------|--------|
| 网际路由域字段 `securityServiceIds`（本地挂网元组 ID） | **不再存在**；安全服务只来自 **CSM 安全域投影** |
| Tower 本地 `ServiceChain` 表聚合进 IRD 详情 | **不再使用**；服务链来自 **CSM API** |
| `GET /api/sase/gateways/info` 中的 `otherSecurityServices` | **已删除** |
| 用 `domainId`（IRD id）当 CSM 安全域 ID | 使用 **`linkedCsmSecurityDomainId`** |

### 2.1 必读关联字段

| 字段 | 含义 |
|------|------|
| `id` | 网际路由域 ID（Tower `security_domains.id`） |
| `linkedCsmSecurityDomainId` | 关联的 **CSM 安全域 ID**（1:1，**安全能力查询入口**） |
| `csmCloudId` | CSM 资源池（Tower `clouds.id`，`provider=cloudmap.csm`） |
| `vrUuid` | VR 注册 uuid（与 `vr_unique_id` 同义） |

---

## 3. 网际路由域内部元素（定稿）

### 3.1 Tower 自有（IRD Tab）

| Tab | 内容 |
|-----|------|
| 总览 / 网络 / 资产 / 应用 / 邻居 | 租户、VPC/CIDR、云主机、SASE 扫描资产、邻居 |
| **IBR 管理** | VR、SRv6、IPsec、ACL、NAT（按 `vrUuid` 域内筛选） |

### 3.2 CSM 投影（「CSM 安全域」Tab）

须先配置 **`linkedCsmSecurityDomainId`**，否则三项均为空：

| 子 Tab | 数据来源 |
|--------|----------|
| **防护对象** | CSM 资产 API，按关联安全域过滤 → `csmProtectionObjects` |
| **安全服务** | CSM 网元组 + 服务链引用 → `securityServices`（`source: csm_security_domain`） |
| **服务链** | CSM `service-chains` → `serviceChains` |

---

## 4. VR / SASE 北向 API

### 4.1 认证

- `POST /api/sase/auth/login`

### 4.2 网关

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/sase/gateways/bind` | 绑定租户 |
| `POST` | `/api/sase/gateways/report-assets` | 上报资产；`vr_unique_id` → 解析 IRD 写入 `domainId` |
| `GET` | `/api/sase/gateways/assets` | Query：`domain_id`（**网际路由域 ID**） |
| `GET` | `/api/sase/gateways/info?vr_uuid=` | 见 §4.3 |

### 4.3 `GET /api/sase/gateways/info` 响应（VR 侧整改要点）

1. 按 `vr_uuid` 查 **网际路由域**；未绑定 → `404` + `message_zh`。
2. **`securityServices` / `serviceChains` / `csmProtectionObjects`**：仅当 IRD 已设 **`linkedCsmSecurityDomainId`** 且 CSM 池可用时填充；否则为空数组。
3. **`securityServices[]`** 元素含 `id`、`name`、`vmIds`、`webIds`（SSO 用）、`source: "csm_security_domain"`。
4. **`ssoEndpoint`**：`/api/clouds/{csmCloudId}/csm/security/domain/attach/callOnSSO`（`csmCloudId` 来自投影，非计算云池 id）。
5. **勿再解析** `securityServiceIds`、`otherSecurityServices`。

### 4.4 网际路由域 CRUD

| 方法 | 路径 |
|------|------|
| `GET` | `/api/security-domains` |
| `GET` | `/api/security-domains/:id`（含 §3.2 投影字段） |
| `GET` | `/api/security-domains/suggest-vr?cloudId=&vpcId=` |

详情响应新增/统一字段：

```json
{
  "linkedCsmSecurityDomainId": "csm-domain-uuid",
  "linkedCsmSecurityDomain": { "id": "...", "name": "...", "networkCidrs": [] },
  "csmCloudId": "tower-cloud-uuid",
  "csmProtectionObjects": [],
  "securityServices": [],
  "serviceChains": [],
  "csmProjectionReady": true,
  "csmProjectionError": null
}
```

---

## 5. VR 侧整改清单

1. **命名**：日志/UI 改用「网际路由域」；CSM 策略侧用 `linkedCsmSecurityDomainId`。
2. **拉安全能力**：只读 `GET .../info` 或 `GET .../security-domains/:id` 的 **CSM 投影字段**；删除对 `securityServiceIds` 的解析。
3. **SSO**：`ssoEndpoint` 使用响应中的 **`csmCloudId`** 拼路径。
4. **资产上报**：继续 `POST .../report-assets` + `vr_unique_id`；Tower 仍反查 IRD 写 `sase_discovered_assets.domainId`（IRD id，非 CSM 域 id）。
5. **创建 IRD**：在 Tower UI/API 配置 `linkedCsmSecurityDomainId` + `csmCloudId`；网元与服务链在 **CSM** 编排，不在 Tower 本地挂 ID。

---

## 6. 路径与实体名（暂未改 URL）

对外 REST 仍为 `/api/security-domains`、实体表 `security_domains`；仅**语义与聚合逻辑**按本文 Breaking Change 执行。

---

## 7. 租户全量查询（对外）

完整接口说明（可单独发给对接方）：**[tenant-full-export-api.md](./tenant-full-export-api.md)**

| 方法 | 路径 |
|------|------|
| `GET` | `/api/tenants/{tenantId}/full`（推荐） |
| `GET` | `/api/tenants/{tenantId}?scope=full` |

---

## 8. 延伸阅读

- [internetwork-routing-domain.md](./internetwork-routing-domain.md)
- [AGENTS.md](../AGENTS.md)
