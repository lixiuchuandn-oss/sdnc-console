# 前端目录结构（权威 · SDNC）

> **适用范围**：`frontend/src/`（**SDNC 独立产品**，`REACT_APP_PRODUCT_FLAVOR=sdnc`）。  
> **本文件是前端源码目录划分与文件放置规则的唯一权威说明**；Code Review 与新增代码以本文为准。  
> **`frontend/README.md`** 仅作 **`frontend/` 包的入口**（本地运行命令等），**不写**第二套目录规范。

---

## 1. 产品范围

| 平台 | 说明 | `pages/` 目录 |
|------|------|---------------|
| **SDNCC** | IBR（VR / SRv6 / IPsec / ACL / NAT） | `pages/sdncc/ibr/` |
| **SETTINGS** | 用户、角色、审计、界面/集成/离线升级 | `pages/settings/` |
| **auth** | 登录 | `pages/auth/` |

路由与顶栏/侧栏以 `routes/RouteSpec.ts` 的 `platform: 'SDNCC' | 'SETTINGS'` 为准；`constants/navigation.ts` 与之对齐。

**不在本仓库前端维护**：CNMC / TENANTS / CNSOC / Harvester Cloudmap 等 Tower 全功能模块（已裁剪）。

---

## 2. 设计原则

1. **平台第一刀**：`pages/` 顶层仅 `auth/`、`sdncc/`、`settings/`（及占位 `coming-soon/`）。
2. **业务域**：SDNCC 仅 **`ibr/`**（IBR 运维）。
3. **域内第三刀**：`sections/`（列表/Tab 主体）、`drawers/`、`modals/`、`lib/`、`components/`（域内复用）。
4. **横切上浮**：跨平台 UI → `src/components/`；API → `src/services/`；路由 → `src/routes/`。
5. **URL 不必与目录同构**：`lazy(import)` 指向真实文件即可。

---

## 3. 命名规范

与仓库根 **`AGENTS.md`** 一致：

| 类型 | 约定 | 示例 |
|------|------|------|
| 业务目录 | 小写、`kebab-case` | `ipsec-vpn`、`ibr` |
| React 组件 | `PascalCase.tsx` | `ApplicationListSection.tsx` |
| 工具 / Hook 文件 | `camelCase.ts` 或 `use*.ts` | `roleGrantNormalize.ts` |
| 测试 | `*.test.ts(x)`，与实现就近 | `srv6Ipv6.test.ts` |
| 列表表格 | `className="std-table"` + 首列/操作列冻结 | 见 `docs/frontend-layout.md` |

**存量例外**：`pages/settings/Roles`、`Users` 使用 `Index.tsx`（大写 I）；新增 SETTINGS 子模块优先 `index.tsx`。

---

## 4. `src/` 顶层目录

```
frontend/src/
├── App.tsx
├── index.tsx
├── global-new.css
├── setupProxy.js
├── setupTests.ts
├── STRUCTURE.md              # 本文件
├── assets/
├── components/               # 跨平台 UI（PageContainer、AdminRoute 等）
├── constants/                # navigation、productFlavor 等
├── contexts/                 # Auth、License、Settings
├── hooks/
├── layouts/                  # AdminLayout、侧栏与顶栏
├── lib/                      # 弱业务复用（如 pools/cloudTypes）
├── pages/                    # auth、sdncc、settings、coming-soon
├── routes/                   # RouteSpec
├── services/                 # api.ts 及域 API（见 services/README.md）
├── types/
└── utils/
```

---

## 5. `pages/sdncc/ibr/` 结构

| 目录 | 导航分组（`RouteSpec.group`） | 职责 |
|------|------------------------------|------|
| `ibr/routers/` | IBR 管理 | IBR实例 |
| `ibr/ha-groups/` | IBR 管理 | IBR 高可用组（仅 CE / 标准模式）列表 + 向导 |
| `ibr/srv6/` | IBR 管理 | SRv6 隧道 |
| `ibr/ipsec-vpn/` | IBR 管理 | IPsec VPN |
| `ibr/acl/`、`ibr/nat/` | IBR 管理 | ACL / NAT |
| `ibr/lib/` | — | IBR 共享：`ibrVrCatalog`、`vrConfigDeployFlow`、`useIbrDeployWizard` 等；下发架构见 **`docs/ibr-vr-config-deploy.md`** |

**已删除**（勿重建）：`pages/sdncc/cross-domain/`、`sec-mgr-plane/`、`interconnect/`。

域内放置：`sections/`（页面根 Section）、`drawers/`、`modals/`、`lib/`、`components/`。

---

## 6. `pages/settings/` 结构

| 目录 | 说明 |
|------|------|
| `Roles/` | 角色与权限抽屉（`lib/`、`components/`） |
| `Users/` | 用户管理；安全管理以 **Drawer** 形式嵌入 |
| `AuditLogs.tsx` | 操作审计 |
| `GeneralSettings.tsx` | 界面设置 |
| `AdvancedSettings.tsx` | 高级集成 |
| `OfflineUpgradeSettings.tsx` | 离线升级 |

---

## 7. 放置判定

| 情况 | 放置 |
|------|------|
| 新 SDNCC 列表页 | `pages/sdncc/<域>/sections/` 或域根 `index.tsx` |
| 域内抽屉/向导 | `drawers/`、`modals/` |
| 纯函数 / 列定义 | `lib/`、`utils/*TableColumns.tsx` |
| HTTP 调用 | `services/`（聚合用 `api.ts`，域 API 独立文件） |
| 路由注册 | `routes/RouteSpec.ts` + `App.tsx` lazy 路由 |

**反模式**：把 SDNCC 强业务塞进 `src/components/`；在 `pages/` 下重建 `cnmc/`、`tenants/` 等已裁剪平台目录。

---

## 8. 本地命令

```bash
cd frontend
npm install
REACT_APP_PRODUCT_FLAVOR=sdnc npm run start
REACT_APP_PRODUCT_FLAVOR=sdnc npm run build
npx tsc --noEmit
```

---

## 9. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-04-11 | 原规范并入（Tower 全平台版） |
| 2026-07-08 | **SDNC 裁剪版**：仅 SDNCC + SETTINGS + auth；移除 CNMC/TENANTS/CNSOC/Harvester 映射 |
| 2026-07-09 | `ibr/lib` 补充统一下发流程文档索引；产品文案统一为 IBR / IBR实例 |
