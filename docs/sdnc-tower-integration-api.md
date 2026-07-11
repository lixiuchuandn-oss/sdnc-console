# Tower（主平台）↔ SDNC（附属平台）集成接口清单

> **适用范围（必读）**  
> 本文描述 **Tower 与 SDNC 分体联部署** 时的 BFF / 北向 / iframe 约定（`PRODUCT_FLAVOR=tower` + `SDNC_PLATFORM_URL`）。  
> **SDNC 独立产品**（默认 `REACT_APP_PRODUCT_FLAVOR=sdnc` / `PRODUCT_FLAVOR=sdnc`）以同进程 IBR 页面为准，**可忽略** §2 嵌入与 §5 `embed-url`；租户数据走本机 `/api/tenants` 等接口。
>
> **状态**：草案（2026-07）  
> **基线分支**：`sdwan-dev-vr-20260527`（tag `srv6-hub-spoke-create-v1.0.3` 为 Hub-Spoke 能力裁剪前标记）  
> **前提**：Tower 保留多云 / 运营 / 租户主数据；SDNC 独立部署承载 IBR / SRv6 / IPsec / ACL / NAT 等编排面。

---

## 1. 集成关系（三条线）

```text
┌──────────────────────────────────────────────────────────────────┐
│ Tower（主平台）                                                   │
│  · 租户 / 组织 CRUD、网际路由域（IRD）编排                         │
│  · 页面 iframe / 深链嵌入 SDNC                                    │
│  · BFF 拼装嵌入 URL（`/api/sdnc-platform/embed-url`）            │
└────────────┬───────────────────────────────┬─────────────────────┘
             │ ① 嵌套 UI（IRD 详情 IBR Tab 等）
             ▼
┌────────────────────────────┐
│ SDNC（附属平台）            │
│  · IBR / SRv6 / 策略编排   │
└────────────┬───────────────┘
             │ ② 租户主数据只读
             ▼
     Tower 租户查询 API

Tower 租户「SDN 资产」Tab：仅 IRD 列表（Tower `/api/security-domains`）
SDNC 北向：仅 VR 查询（非租户资产页）
```

| # | 方向 | 原则 |
|---|------|------|
| 1 | Tower → SDNC UI | 主平台 **iframe 嵌套** SDNC；IBR/SRv6 等实际操作在附属平台完成 |
| 2 | SDNC → Tower | **租户 / 组织主数据权威在 Tower**；SDNC 只读查询，不自建租户表 |
| 3 | Tower 租户 · SDN 资产 | **仅展示 IRD**（`GET /api/security-domains`），数据在 Tower 本地，**不调** SDNC 北向 |
| 4 | Tower → SDNC 北向 | **仅** `GET /api/v1/vr-instances?tenant_id=`（供 IRD 详情选 VR、运维集成等，**非**租户资产 Tab） |

---

## 2. 嵌入契约（Tower → SDNC UI）

> **SDNC 独立构建**：IRD 详情在同进程内嵌 `VrPage` / `SRv6Page` 等，**不使用** iframe。下列约定仅 Tower 联部署需要。

### 2.1 推荐 URL 形态

| 场景 | Tower 入口 | SDNC 路径（示例） | Query |
|------|------------|-------------------|-------|
| 全局 IBR 管理 | SDN 顶栏 | `/admin/interconnect/vr` | `embedded=1` |
| 租户上下文 IBR | IRD 详情 · IBR Tab（iframe） | `/admin/interconnect/vr` 等 | `embedded=1&scopedVrUuid={uuid}` |
| Hub-Spoke 向导 | 同上 | `/admin/interconnect/srv6/create` | `tenant_id` + `scopedVrUuid`（可选） |

前端嵌入参数类型：`frontend/src/pages/sdncc/ibr/lib/embedProps.ts`（`embedded`、`scopedVrUuid`）。

Tower 联部署 IRD 详情 IBR Tab 推荐 **iframe 深链**（`SDNC_BASE_URL` + query）；同域微前端或 SSO 子应用为后续选项。

### 2.2 SSO / 鉴权（待实现）

| 项 | 说明 |
|----|------|
| `SDNC_BASE_URL` | Tower 环境变量，附属平台根地址 |
| `TOWER_SDNC_SERVICE_TOKEN` | Tower BFF → SDNC 北向 |
| `SDNC_TOWER_SERVICE_TOKEN` | SDNC → Tower 租户只读 API |
| 用户会话 | 推荐 Tower 签发短期 embed JWT（含 `sub`、`tenant_id`、`permissions`），SDNC 校验后建立本地 session |

---

## 3. SDNC → Tower：租户只读接口

> 仅 **分体部署且租户权威在 Tower** 时需要。SDNC 独立部署使用本机 `/api/tenants` 等，**禁止**在 SDNC 侧实现租户 CRUD 的约束仍适用于分体场景。

### 3.1 已有（Tower 侧）

| 方法 | 路径 | 用途 | SDNC 使用场景 |
|------|------|------|---------------|
| `GET` | `/api/tenants` | 租户列表 | VR 绑定租户下拉、`fetchTenants()` |
| `GET` | `/api/tenants/:id` | 租户详情 | 展示租户名、状态 |
| `GET` | `/api/tenants/:id/organizations` | 组织树 | VR 绑定组织、IRD 表单 |
| `GET` | `/api/tenants/:id/full` | 租户全量导出 | 运维导出；含 IRD，**不含** VR/SRv6 资产（见 §6） |
| `GET` | `/api/tenants/:tenantId/users` | 租户用户 | 仅当 SDNC 需展示联系人时 |
| `GET` | `/api/tenants/:tenantId/organizations/:orgId/users` | 组织用户 | 同上 |

### 3.2 建议新增（Tower 主平台）

| 方法 | 路径 | 用途 | 优先级 |
|------|------|------|--------|
| `GET` | `/api/tenants/batch` | 组织分层批量（用户/计算/安全/SDN） | P1 |
| `GET` | `/api/tenants/lookup` | `?ids=` 批量解析租户名 | P2 |
| `GET` | `/api/tenants/:id/organizations/lookup` | 扁平组织列表（下拉） | P2 |

### 3.3 调用约束

- 仅 **服务间 Token** 或 **管理员角色** 可拉全量租户；租户用户 JWT 只能访问本租户（与现 `getTenantContext` 一致）。
- SDNC 侧缓存租户目录：**短 TTL 只读缓存**，权威仍以 Tower 为准。

---

## 4. Tower → SDNC：北向 API（定稿 · 仅 VR 查询）

> 前缀 **`/api/v1/`**；Tower BFF：`GET /api/sdnc-platform/vr-instances`。  
> **租户「SDN 资产」页不使用北向**（只读 IRD，见 §6）。

| 方法 | 北向路径 | 说明 |
|------|----------|------|
| `GET` | `/api/v1/vr-instances?tenant_id=` | 按租户（及可选 `organization_id`）查询已绑定 VR |
| `GET` | `/api/sdnc-platform/embed-url` | Tower BFF：拼装 iframe 深链（非北向资产查询） |

实现：`backend/src/routes/sdnc/northboundV1.ts`、`backend/src/routes/sdnc/towerSdncBff.ts`。

**不含**：SRv6 / IPsec / ACL / NAT 列表、资产摘要、VR 绑定写接口（绑定在 SDNC 控制台内完成）。

---

## 5. Tower 侧 BFF（主平台代调 SDNC）

| 方法 | Tower BFF 路径 | 说明 |
|------|----------------|------|
| `GET` | `/api/sdnc-platform/embed-url` | 拼装 iframe 深链（IRD 详情 IBR Tab 等） |

**不含**：`vr-instances`、`assets/summary`、`srv6/tunnels` 等租户资产聚合 BFF。

环境变量：

- `SDNC_PLATFORM_URL`
- `SDNC_PLATFORM_SERVICE_TOKEN`

---

## 6. Tower 租户 · SDN 资产（定稿）

### 6.1 展示范围

租户组织管理 → **「SDN 资产」** Tab：**仅 IRD（网际路由域）列表**。

| 区块 | 数据来源 |
|------|----------|
| IRD 列表 | Tower `GET /api/security-domains`（按租户/组织过滤） |
| 进入 IBR / SRv6 等 | IRD **详情**内 IBR Tab → iframe 嵌套 SDNC（Tower 联部署；`scopedVrUuid` 等） |

**不展示**：VR 列表、SRv6 隧道、IPsec / ACL / NAT、北向 `assets/summary`。

### 6.2 实现落点（Tower 全功能树）

- `frontend/src/pages/tenants/components/TenantSdnAssetsPanel.tsx`（Tower 分支）
- `frontend/src/pages/tenants/sections/OrgManageWorkspace.tsx`

`GET /api/tenants/:id/full` 仍可含 IRD 导出；租户页列表以 security-domains 同源数据为准。

---

## 7. 能力归属（避免双写）

| 数据 | 权威系统 | 说明 |
|------|----------|------|
| 租户、组织、用户 | **Tower**（分体） / **本机**（SDNC 独立） | 分体时 SDNC 只读 Tower |
| IRD、邻居、跨域应用 | **Tower**（分体编排枢纽） / **SDNC 本机**（独立产品） | 以部署形态为准 |
| `vr_config`（角色、tenant_id、config_json） | **SDNC** | Tower 不保留 `VRCache*` |
| SRv6 / IPsec / ACL / NAT 编排 | **SDNC** | 原 `routes/sdn/srv6.*` 等 |
| CSM 安全域订单 | **Tower** | 与 VR 无直接依赖；IRD 详情可并存展示 |

---

## 8. 实施分期

### P0 · 分支与基线

- [x] SDNC 产品形态开关：`REACT_APP_PRODUCT_FLAVOR=sdnc` / `PRODUCT_FLAVOR=sdnc`
- [x] SDNC 前端裁剪：仅 SDNCC + SETTINGS 路由
- [ ] Tower main 保持全功能，按本文加 BFF 与嵌入

### P1 · 北向与租户 SDN 资产（Tower 联部署）

- [x] SDNC：`GET /api/v1/vr-instances?tenant_id=`
- [x] Tower：`GET /api/sdnc-platform/embed-url`（`PRODUCT_FLAVOR=tower` 时挂载）
- [ ] Tower：租户组织管理 · SDN 资产 Tab = 仅 IRD
- [ ] Tower：IRD 详情 IBR Tab → iframe 嵌套 SDNC
- [ ] embed JWT 与跨域 SSO

### P2 · 嵌入与 SSO

- [x] IBR 路由 `IbrEmbedOutlet`：解析 `embedded=1&tenant_id=&scopedVrUuid=`
- [ ] embed JWT 与跨域 SSO

### P3 · 已取消

原「租户维度 VR / SRv6 / assets/summary 聚合」方案已废弃。

### P4 · 运维与发版

- [ ] SDNC 独立 version 与 Tower 分别发版；集成契约版本写入发版说明

---

## 9. 与 main 主线的差异说明

| 项 | `main`（Compute Tower） | SDNC 独立 / sdwan 分支 |
|----|-------------------------|--------------------------------|
| IBR / SRv6 代码 | 已迁出，仅 `ibr-platform` 代理 | **完整在仓** |
| Tower BFF | `/api/ibr-platform/vr-instances` | `/api/sdnc-platform/*`（联部署） |
| 集成文档 | `ibr-platform-independence-design.md` | 本文 |

---

## 10. 参考源码索引

| 领域 | 路径 |
|------|------|
| IBR 前端 | `frontend/src/pages/sdncc/ibr/` |
| IRD 详情 | `frontend/src/pages/sdncc/cross-domain/internetwork-routing/Detail/index.tsx` |
| 嵌入参数 | `frontend/src/pages/sdncc/ibr/lib/embedProps.ts` |
| VR 列表 API | `backend/src/routes/sdn/vrInstances.ts` |
| Tower BFF | `backend/src/routes/sdnc/towerSdncBff.ts` |
| 租户 API | `backend/src/routes/tenants/tenantCrudRoutes.ts` |
| 前端拉租户 | `frontend/src/services/api.ts` → `fetchTenants` |
