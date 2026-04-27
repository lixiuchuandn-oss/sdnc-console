# 前端目录结构（权威）

> **适用范围**：`frontend/src/`。  
> **本文件是前端源码目录划分与文件放置规则的唯一权威说明**；Code Review 与新增代码以本文为准。  
> **Harvester 云详情子树**（域优先、`shared/`、`sections`/`modals` 等细则）见仓库 **`deployment/docs/specs/修改纪要_Harvester前端目录结构_域优先与shared.md`**——仅约束 `pages/cnmc/clouds/Harvester/` 内部，不重复全站规则。  
> **`frontend/README.md`** 仅作 **`frontend/` 包的入口**（本地运行命令等），**不写**与目录规范有关的第二套说明。

---

## 1. 目的与读者

- 统一「文件该放哪」的判定规则，降低认知成本与评审成本。
- 对齐平台心智：**CNMC / TENANTS / SDNCC / CNSOC / SETTINGS**（与 `constants/navigation.ts`、`routes/RouteSpec.ts` 的 `platform` 一致）。
- 明确 **产品层级 ≠ 文件夹必须逐层同构**：目录可为懒加载与团队边界服务；**产品归属**以路由与本文 **§3、§5** 为准。

**读者**：前端开发、Code Review、架构与交付负责人。

---

## 2. 术语

| 术语 | 含义 |
|------|------|
| **平台** | `CNMC` / **`TENANTS`（租户管理，独立平台）** / `SDNCC` / `CNSOC` / `SETTINGS`，见 `constants/navigation.ts`。 |
| **业务域** | 平台内可独立讲解的一块能力（如 Harvester 下的 `ecs`、`ebs`、`containers`、`kube-ovn`）。 |
| **前端角色** | 同一域内按 UI 职责划分：`sections`、`drawers`、`modals`、`lib`、`components` 等。 |
| **横切** | 与具体页面弱相关、多模块复用的代码，放在 `src/components`、`hooks`、`utils` 等根级目录。 |

---

## 3. 设计原则

1. **平台第一刀**：`pages/` 顶层按 **平台** 划分（`cnmc/`、`sdncc/`、`cnsoc/`、`settings/` 等），与 `RouteSpec.platform` 一致，或经团队登记的例外。**租户管理**在产品与路由上为独立平台 **`TENANTS`**（与 CNMC 平级）；源码当前仍落在 **`pages/cnmc/tenants/`** 属整改过渡期路径，**不以文件夹名否定 `platform: 'TENANTS'`**（未来可选物理迁至 `pages/tenants/` 等，以团队登记为准）。
2. **业务域第二刀**：平台内再按 **业务域** 分（云厂商、功能子系统、PaaS 子模块等）。
3. **域内按前端角色第三刀**：在业务域内使用 `sections/`、`drawers/`、`modals/`、`lib/`（大域必选；小域可先扁平，膨胀后再拆）。
4. **跨域复用进 shared**：仅当 **≥2 个业务域** 明确依赖时，再上浮到该云类型下的 `shared/`（Harvester 见上述修改纪要）；**跨平台**复用进 `src/components` 等根级。
5. **PaaS 归属 CNMC**：云数据库等托管能力业务上依赖资源池，**不是**与「多云管理」平级的独立顶层产品；源码放在 **`pages/cnmc/paas/`**（如 `cloud-database/`）。
6. **URL 不与目录强制同构**：对外 path 无需与文件夹逐段对应；`lazy(import)` 指向真实文件即可。
7. **迁移可渐进**：允许过渡期 barrel 再导出等；每步 **`npx tsc --noEmit`**验收。

---

## 4. 命名规范

| 对象 | 约定 | 示例 |
|------|------|------|
| **目录（pages 内，通用）** | 小写、`kebab-case` | `cloud-database`、`sec-mgr-plane` |
| **目录（云厂商等）** | 小写、与产品/后端称谓一致 | `harvester`、`aliyun`、`huawei`、`cloudmap` |
| **React 组件文件** | `PascalCase.tsx` | `VmSection.tsx` |
| **非组件 TS/TSX** | `camelCase.ts` | `vmWizardUtils.ts` |
| **样式** | 与组件同目录或 `*.module.css`；全局样式在 `global-new.css` 等约定位置 | — |

与仓库根目录 **`AGENTS.md`** 中「组件 PascalCase、工具 camelCase」一致。

---

## 5. 平台与 `pages/` 顶层映射

| 平台 | 说明 | `pages/` 典型目录 |
|------|------|-------------------|
| **CNMC** | 资源总览、资源池、云详情、控制台、**PaaS** 等（**不含**租户管理产品线） | `pages/cnmc/`（租户页源码过渡期见下 **`TENANTS`**） |
| **TENANTS** | **租户管理**（租户列表、组织、租户用户等）；与 CNMC **平级**的独立平台 | 路由与导航见 `RouteSpec.platform: 'TENANTS'`；**源码当前**：`pages/cnmc/tenants/`（与 CNMC 物理目录并存，属已切分平台后的过渡落位） |
| **SDNCC** | 见下表「`pages/sdncc/` 与导航分组」；与 `RouteSpec.platform: 'SDNCC'` 一致 | `pages/sdncc/` |
| **CNSOC** | AI SOC、态势、SecOps 等（不含已归 SDNCC 的安全管理面与流量编排） | `pages/cnsoc/` |
| **SETTINGS** | 通用设置、审计、授权、访问控制 | `pages/settings/` |

**`pages/sdncc/` 与导航分组（`RouteSpec.group`）的对应**（产品层级，目录当前多为平铺，按 **跨域互联 / 安全管理面 / 流量编排** 维护）：

| 导航 / 能力 | 典型 `RouteSpec.group` 或 `requiredFeature` | 典型源码目录（`pages/sdncc/` 下） |
|-------------|----------------------------------------------|----------------------------------|
| **跨域互联** | `group: 跨域互联`；`sdn.interconnect` | `interconnect/acl/`、`interconnect/nat/`、`interconnect/srv6/`、`interconnect/ipsec-vpn/`、`interconnect/vr/`（与 RouteSpec 分组一致，kebab-case） |
| **安全管理面** | `group: 安全管理面` 等；`sdn.cascade` | `sec-mgr-plane/` |
| **流量编排** | `group: 流量编排` 等；`sdn.traffic` | `traffic/`（其下如 `CsmPools/`、`ServiceChains/`、`ProtectedObjects/`、`Policies/`，PascalCase 与现有一致） |

**不放入 `pages/` 的壳层与横切**（保持在 `src/` 根下）：

`components/`、`layouts/`、`contexts/`、`hooks/`、`constants/`、`routes/`、`services/`、`types/`、`utils/`、`assets/`，以及 `App.tsx`、`index.tsx`。

---

## 6. `src/` 顶层目录树与职责

**当前仓库典型顶层（与代码一致）**：

```
frontend/src/
├── App.tsx
├── index.tsx
├── global-new.css
├── setupProxy.js
├── setupTests.ts
├── STRUCTURE.md           # 本文件（权威）
├── assets/                # 静态资源（图片、图标等）
├── components/            # 全局可复用 UI（弱业务或跨平台）
├── constants/             # 常量；含 navigation、权限与导航目录等
├── contexts/              # React Context（如 Auth、License、Settings）
├── hooks/                 # 全局或跨页面 Hooks
├── layouts/               # 布局壳
├── pages/                 # 按平台与业务域组织的页面（见 §7）
├── routes/                # RouteSpec、路由装配
├── services/              # API 调用层
├── types/
└── utils/
```

### `assets/`

静态资源：图片、图标等。

### `components/`

全局复用组件，例如：`PageContainer` / `PageDetailContainer` / `PageDetailSection`，`StdFormModal` / `StdSideDrawer`，`TableColumnSettingsButton`（配合 `hooks/useTableColumnSettings`），`ResourceActionsDropdown`，`AdminRoute` / `PrivateRoute` 等。

**注意**：CNMC 下**强业务**、且仅某一云或某一域使用的块，优先放在对应 `pages/cnmc/...` 域内，避免无故塞进全局 `components/`（见 §9 反模式）。

### `constants/`

业务常量、`navCatalog.ts`、`cloudPermissions.ts` 等与导航/权限相关定义。

### `contexts/`

如：`AuthContext`、`LicenseContext`、`SettingsContext`。

### `hooks/`

如：`useTableColumnSettings`；仅某一业务域使用的 Hook 可放在该域内（若已拆域）。

### `layouts/`

应用级布局组件。

### `pages/`

页面与大型业务模块根组件；**顶层按平台分**（§5、§7）。

### `routes/`

`RouteSpec.ts` 等；**`platform` 字段须与页面归属一致**（或登记例外）。

### `services/`

API 封装：`api.ts`、`harvesterApi.ts`、`aliyunApi.ts` 等。

### `types/`、`utils/`

类型定义与通用工具；访问权限映射、格式化等。

---

## 7. `pages/` 结构（目标形态与当前方向）

以下为 **规范目标形态**；子目录会随迁移继续收敛，新增代码 **按此方向** 落位。

```
frontend/src/pages/
├── auth/                    # 登录等
├── coming-soon/
│
├── cnmc/                    # ========== CNMC ==========
│   ├── dashboard/           # 资源总览
│   ├── pools/             # 资源池列表、详情闸门、实例详情入口等
│   ├── clouds/
│   │   ├── Harvester/     # 云详情：域 + sections/modals/shared（细则见 Harvester 修改纪要）
│   │   ├── Aliyun/、Hw/、Cloudmap/ 等（与仓库目录名一致；CSM 详情在 sdncc/traffic/CsmPools/：CloudDetailCsm、sections/、modals/）
│   ├── console/           # WebSSH、控制台等
│   ├── tenants/           # 租户管理：产品平台为 TENANTS（独立）；源码暂放此路径（过渡期）
│   └── paas/
│       ├── cloud-database/  # sections / modals / drawers、index 聚合导出
│       └── …                # 未来其他托管子模块
│
├── sdncc/                   # ========== SDNCC ==========
│   ├── interconnect/        # 跨域互联：acl、nat、srv6、ipsec-vpn、vr（见上表；与 `/admin/interconnect/…` 产品域一致）
│   ├── sec-mgr-plane/       # 安全管理面：安全域、级联通道、应用、安全服务等
│   └── traffic/             # 流量编排：CsmPools/（安全资源池列表/详情、modals/ 接入与 VM 详情、sections/）、ServiceChains/、ProtectedObjects/、Policies/ 等
│
├── cnsoc/                   # ========== CNSOC ==========
│   └── （如 sec-ops、aisoc 等；与 SDN 编排能力解耦）
│
└── settings/                # ========== SETTINGS ==========
    └── （通用设置、审计、授权、访问控制等）
```

**补充**：

- `pools/` 承载资源池列表与选云后的壳；各云深度实现放在 `clouds/<vendor>/`。
- Harvester **内部**目录树 **不在此重复展开**；必须遵守 **`deployment/docs/specs/修改纪要_Harvester前端目录结构_域优先与shared.md`**。
- 可选：在 `tsconfig.json` 配置路径别名（如 `@/`）缩短 import。

---

## 8. 业务域内子目录角色（通用）

| 子目录 | 用途 |
|--------|------|
| `sections/` | 列表页、详情 Tab 主内容区等大型区块 |
| `drawers/` | 侧滑详情、复杂表单抽屉 |
| `modals/` | 对话框、向导弹窗 |
| `lib/` | 域内纯函数、常量、非 UI 拼装逻辑 |
| `components/` | 域内复用、但不足以单独成 section 的块 |

**判定**：只服务 **一个** 业务域 → 放在该域对应子目录；**≥2 域** → 该云下的 `shared/`（Harvester）或上浮至 `src/components`（跨平台）。

---

## 9. 放置判定表与反模式

| 情况 | 放置位置 |
|------|----------|
| 新页面路由归属某平台 | `pages/<平台>/...`，且与 `RouteSpec.platform` 一致；**租户管理**须 **`platform: 'TENANTS'`**，源码过渡期可继续落在 `pages/cnmc/tenants/`（见 §5） |
| 仅某云类型使用 | `pages/cnmc/clouds/<vendor>/...` 下对应域 |
| 仅 Harvester 某域使用 | `Harvester/<域>/sections|drawers|modals|lib|components/` |
| Harvester 多域共用 | `Harvester/shared/...`（见修改纪要） |
| 多平台或全局复用 UI | `src/components/` 或 `src/hooks/` |
| API 封装 | `src/services/` |
| 路由声明 | `src/routes/RouteSpec.ts` 等 |

**反模式**：

- 在云目录根长期堆积 **仅单域使用** 的 `modals/`、`components/`（应迁入域内或 `shared`）。
- 因路径或文件夹名把 **PaaS** 口头说成与 **CNMC** 平级产品（与 `platform` 矛盾）。
- 为省事把 CNMC 强业务组件塞进 `src/components`，造成全局耦合（应先域内，再评估上浮）。

---

## 10. URL、懒加载与路由

- 对外 **path**（如 `/admin/paas/databases`）无需与 `pages/cnmc/paas/...` 逐段对应。
- 目录调整 **不改变** 对外 URL 时，更新 `lazy(() => import('…'))` 与 import 即可。

---

## 11. 迁移阶段与验收（渐进）

| 阶段 | 内容 | 验收 |
|------|------|------|
| 0 | 团队以本文 + Harvester 修改纪要为约定；**新代码按目标路径** | Review |
| 1 | 新目录壳、必要时 barrel 再导出 | `npx tsc --noEmit` |
| 2–n | 存量页面与 import 按 §5、§7 持续收敛 | `tsc` + 关键路径手工点选 |

优先 **`git mv`** 保留历史；Windows 上目录 **大小写** 重命名用两步 `git mv` 或团队约定流程，避免索引未更新。

**收敛完成度自检（持续维护）**：

- [ ] `RouteSpec.platform` 与产品归属一致，或本文档登记例外（租户相关须为 **`TENANTS`**，勿标为 CNMC）。
- [ ] PaaS 源码在 `pages/cnmc/paas/`，语义上属 CNMC 子能力。
- [ ] Harvester 符合修改纪要（域 / `shared` / `monitoring` 小写等）。
- [ ] `npx tsc --noEmit` 通过；发版前生产构建通过。

---

## 12. 仓库内已做过的整理（参考）

1. **空目录清理**：历史 `domains/`、`src/shared/`、`catalogs/` 等已删除或迁移（`navCatalog` 等已归 `constants/`）。
2. **样式**：`global.css` 已弃用，统一 `global-new.css`。
3. **未引用代码**：持续用 `npx knip` 等辅助；`setupProxy.js`、`setupTests.ts`、`*.test.ts(x)` 常被静态分析标为未引用，**属正常，勿删**。
4. **`pages/` 顶层**：已按平台收敛为 **`cnmc/`、`sdncc/`、`cnsoc/`、`settings/`** 等与 §5 一致的方向；**租户管理**在产品侧已切为独立平台 **`TENANTS`**（导航与 `RouteSpec`），源码过渡期仍在 **`cnmc/tenants/`**（其下各业务仍在演进）。

---

## 13. 本地开发命令

在仓库根目录进入 `frontend/` 后：

```bash
cd frontend
npm install
npm run start    # 开发；端口与代理见 package.json / setupProxy.js
npm run build
npx tsc --noEmit
```

---

## 14. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-04-11 | 原 `deployment/docs/specs/前端目录结构规范.md` 全文并入本文；本文成为唯一权威 |
| 2026-04-11 | 对齐当前 `pages/` 平台顶层与 `cnmc` 子目录；补充与 `README`、Harvester 纪要的分工 |
| 2026-04-13 | 与 `frontend/README.md` 合并职责：`README` 仅入口；规范与命令统一以本文为准 |
| 2026-04-27 | 租户管理为独立平台 **`TENANTS`**（与 CNMC 平级）；更正 §5/§7 与 CNMC 混写；注明 `pages/cnmc/tenants/` 为过渡期源码路径 |
