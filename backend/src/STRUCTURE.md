# 后端目录结构（权威 · SDNC）

> **适用范围**：`backend/src/`；**默认产品形态 SDNC**（`PRODUCT_FLAVOR=sdnc`）。  
> **本文件是后端源码目录划分与文件放置规则的唯一权威说明**；Code Review 与新增代码以本文为准。  
> **技术栈、环境变量、对外 API 路径总览** 见仓库根目录 **`AGENTS.md`**。

---

## 1. 目的与读者

- 统一「后端文件该放哪」的判定规则。
- 约定 **路由层薄、服务层厚、实体与类型集中**。
- **SDNC 构建**仅挂载 IBR + 设置 + 租户（VR 绑定）+ CSMCTL 代理。

**读者**：后端开发、Code Review、架构与交付负责人。

---

## 2. 术语

| 术语 | 含义 |
|------|------|
| **平台（SDNC）** | `SDNCC`（IBR）、`SETTINGS`（用户/RBAC/审计/系统配置） |
| **路由模块** | `routes/` 下挂载到 Express 的 Router |
| **服务模块** | `services/` 下封装外部系统与复杂业务规则 |
| **实体（Entity）** | TypeORM `entities/` 下表结构定义 |

---

## 3. 设计原则

1. **分层清晰**：`routes` → `services` → `entities` / 外部客户端。
2. **SDN 逻辑落 `routes/sdn/`**：SRv6、VR、ACL、NAT、IPsec。
3. **CSMCTL 客户端**：`services/vrouter/vrController.ts`、`csmClient.ts` → `CSMCTL_ADDRESS`。
4. **租户 API**：`routes/tenants/` 供 VR 租户/组织绑定下拉；不含云池分配。

---

## 4. 平台与路由落点

| 域 | 挂载 | 典型落点 |
|----|------|----------|
| **IBR** | 是 | `routes/sdn/srv6*.ts`、`ipsec.ts`、`acl*.ts`、`nat.ts`、`vrInstances.ts`、`vrConfig.ts`、`ibrHaGroups.ts`、`rrDomains.ts`；实体 `entities/vRouter/RrDomain*.ts`；服务 `services/vrouter/rrDomain*.ts`、`ibrHaGroup*`、`haGroupVrrp*` |
| **租户** | 是 | `routes/tenants/`（列表、组织树、租户用户） |
| **SETTINGS** | 是 | `routes/sysuser/`、`routes/system.ts`、`routes/auditLogs.ts` |
| **北向** | 是 | `routes/sdnc/northboundV1.ts` → `/api/v1/vr-instances` |
| **CSMCTL 代理** | 是 | `routes/apiProxy.ts` → `/api-proxy` |

**认证横切**：`routes/auth/**`。

**已从源码删除（勿重建）**：`routes/clouds/`、`routes/harbor/`、`ws/`、`services/clouds/`、跨域 SDN 路由（CEN/IRD/应用/流量编排）。

---

## 5. `src/` 顶层目录树

```
backend/src/
├── index.ts                 # Express 入口（IBR + 系统 API）
├── STRUCTURE.md             # 本文件
├── config/                  # database、systemSettings
├── constants/               # permissions、effectivePermissions、productFlavor
├── routes/
│   ├── sdn/                 # IBR
│   ├── sdnc/                # 北向 v1
│   ├── tenants/
│   ├── auth/、sysuser/、system.ts、auditLogs.ts
│   └── apiProxy.ts
├── services/
│   ├── vrouter/             # VR 缓存、csmClient、csmctlEndpoint
│   └── sdnc/
├── entities/                # User/Tenant/Organization + vRouter/*（IBR 表）
├── middleware/、permissions/、seeders/、utils/
└── ws/                      # 已删除
```

---

## 6. 新增代码检查清单

1. 路由是否挂在 `index.ts` 且属于 IBR / 设置 / 租户 / 北向？
2. 复杂逻辑是否下沉 `services/`？
3. SDNC RBAC 新权限是否注册于 `effectivePermissions.ts`？
4. 勿重新引入 `/api/clouds` 或 Harvester 依赖。

---

## 7. VR 配置下发（IBR）

> 长文见 **`docs/ibr-vr-config-deploy.md`**。

| 类型 | 落点 | 下发方式 |
|------|------|----------|
| **日常运维** ACL / NAT | `aclGroups.ts` + `natSync.ts` → `vr_config` | `*/deploy/push` → `pushVRConfig` |
| **向导** IPsec / SRv6 | `routes/sdn/ipsec.ts`、`srv6.ts` | 同上 |
| **网关** | `services/vrouter/vrConfigDeploy.ts` | 读设备 → 分域 merge → 漂移 → POST |
| **初始化 / 专家** | `vrConfig.ts`、`apiProxy`；前端 `EditVRConfig`、`*Wizard.tsx` | `proxyApiRequest` 直推，**不**走 `pushVRConfig` |

NAT 实体：`NATAddressGroup`、`NATStaticMapping`（无独立 `NATRule` 线）。

IBR 全栈组件对照（`ibr-local-web` / `ibr-controller` / `ibr-local-agent` 与 SDNC 主仓）见 **`docs/ibr-stack-components.md`**。

---

## 8. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-09 | 新增 §7 VR 配置下发索引；指向 `docs/ibr-vr-config-deploy.md` |
