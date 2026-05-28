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

1. **平台第一刀**：`pages/` 顶层按 **平台** 划分（`cnmc/`、**`tenants/`**、`sdncc/`、`cnsoc/`、`settings/` 等），与 `RouteSpec.platform` 一致。**租户管理**为独立平台 **`TENANTS`**（与 CNMC 平级），源码在 **`pages/tenants/`**。
2. **业务域第二刀**：平台内再按 **业务域** 分（云厂商、功能子系统、PaaS 子模块等）。
3. **域内按前端角色第三刀**：在业务域内使用 `sections/`、`drawers/`、`modals/`、`lib/`（大域必选；小域可先扁平，膨胀后再拆）。
4. **跨域复用进 shared**：仅当 **≥2 个业务域** 明确依赖时，再上浮到该云类型下的 `shared/`（Harvester 见上述修改纪要）；**跨平台**复用进 `src/components` 等根级。
5. **云数据库（Cloudmap 资源池）**：托管能力仅基于 **Harvester/Cloudmap 资源池虚拟机**，**不是**与「多云管理」平级的独立顶层产品，且**不**适用于阿里云/华为云等公有云控制台；与侧栏/路由 `paas_databases` 对应。源码按 Harvester 域命名，放在 **`pages/cnmc/clouds/Harvester/database/`**（`kebab-case`，与 `kube-ovn` 等域同级）。
6. **URL 不与目录强制同构**：对外 path 无需与文件夹逐段对应；`lazy(import)` 指向真实文件即可。
7. **迁移可渐进**：允许过渡期 barrel 再导出等；每步 **`npx tsc --noEmit`**验收。

---

## 4. 命名规范

与仓库根目录 **`AGENTS.md`**（组件 PascalCase、工具 camelCase）一致；本节补充 **`pages/` 内习惯用法**与**已登记例外**。

### 4.1 目录命名

| 对象 | 约定 | 示例 |
|------|------|------|
| **`pages/` 下通用业务目录** | 小写、`kebab-case` | `database`、`sec-mgr-plane`、`ipsec-vpn` |
| **云厂商 / 地图等（`clouds/` 下）** | 与仓库、产品称谓一致；多为 **PascalCase** 或约定短名 | `Harvester/`、`Aliyun/`、`Hw/`、`Cloudmap/` |
| **Harvester 内业务域** | 小写或 `kebab-case` | `ecs`、`kube-ovn`、`database` |

**已登记例外（存量允许；新增优先仍走 kebab-case / 与同级一致）**：

| 位置 | 现状 | 说明 |
|------|------|------|
| `pages/cnmc/clouds/Cloudmap/pool/panels/*` | 多为 **`snake_case`**（如 `paas_databases`、`logs_config`、`kube_ovn`） | 与资源池侧栏/后端 key 等历史对齐；**新面板目录**优先 `kebab-case`，若必须与线上 key 一致可继续 snake 并在 PR 说明。 |
| `pages/sdncc/traffic/`、`sec-mgr-plane/` 部分子目录 | **`PascalCase` 段**（如 `CsmPools`、`ServiceChains`、`SecurityDomain`、`Applications`） | §5、§7 目标树已采用；与 `interconnect/` 下 kebab-case **并存**，不视为错误。 |
| `pages/settings/Roles`、`Users` | 子目录 **PascalCase** | 历史路径；**新建 SETTINGS 子模块**推荐 `kebab-case`（如 `roles/`），迁移时用 `git mv` 并注意 Windows 大小写。 |
| `pages/cnmc/clouds/rancher/` | 小写厂商目录 | CNMC 多云扩展；与 `Aliyun`/`Hw` 等并列，需在评审中区分「资源池 Rancher」与 Harvester。 |

### 4.2 文件命名（`frontend/src`）

| 类型 | 约定 | 示例 | 反例 / 避免 |
|------|------|------|-------------|
| **React 组件**（含页面壳、Section、Modal、Drawer、Wizard 步骤） | **`PascalCase.tsx`** | `VmSection.tsx`、`CloudDetailHw.tsx`、`RouteTableCreateModalAliyun.tsx` | `vmSection.tsx` |
| **仅导出 hooks 的文件** | **`use` 前缀 + PascalCase 或 camelCase**，以仓库现有风格为准 | `useTableColumnSettings.ts`、`useVmDeviceGpuMenuSync.ts` | 与组件同名的 hook 文件避免混在 `components/` 根下无区分 |
| **非组件 TS**（工具、常量拼装、纯逻辑） | **`camelCase.ts`** | `vmWizardUtils.ts`、`poolDataDeps.ts` | `VmWizardUtils.ts`（除非文件内仅有类型工厂等团队约定例外） |
| **域内类型 / 模型** | **`camelCase.ts`** 或 **`types.ts`** | `securityDomainModel.ts`、`types.ts` | 巨型单文件可拆 `*Types.ts` 仍用 Pascal 仅用于 **type 别名导出文件** 时需在域内统一 |
| **测试** | **`*.test.ts` / `*.test.tsx`**，与实现就近或 `__tests__/` | `serviceTopologyUtils.test.ts` | 与实现文件名无关联的模糊命名 |
| **样式** | 与组件**同名** `Component.css` / **`Component.module.css`**；全局只在 `global-new.css` 等约定处 | `InstanceWizard.css` | 在 `pages` 内新增全局散落的 `style.css` |
| **路由 / 目录入口** | 优先小写 **`index.ts` / `index.tsx`** 作为目录入口或 barrel | `containers/index.ts` | 混用无规范 |
| **SETTINGS 子模块页面** | 存量 **`Index.tsx`（大写 I）** | `settings/Users/Index.tsx` | **新增代码推荐改为小写 `index.tsx`**，与全仓 entry 习惯对齐；改动的团队需做一次性迁移。 |

**多云 / 厂商后缀**：同一概念在多云并存时，可在文件名末尾加厂商缩写，如 `*Aliyun.tsx`、`*Hw.tsx`，与 **`sections/`、`modals/`** 并列即可，**无**强制「厂商必须前缀或后缀」；同一云目录内保持**一种**习惯即可。

### 4.3 命名自检：典型问题与扩展提醒

**本节不是「全仓问题清单」**，只列评审中最常遇到的类型与示例；**未点名 ≠ 仓库里不存在其它命名债**（拼写、历史别名、多团队习惯并存等需靠检索与 Review 持续收敛）。

**已在仓库中出现的典型示例**：

- **`Index.tsx` vs `index.tsx`**：`settings/` 下为大写 **I**，与多数工具链默认小写 `index` **不一致**，在大小写敏感环境下易踩坑；长期应收敛为小写（见 §4.2）。
- **拼写与可读性**：如 `CloudWizardeasy.tsx` 缺少词边界（更宜 `CloudWizardEasy.tsx`）；**新增文件**避免随意缩写（如过短的 `InsDet`），除非域内有统一缩写表。
- **组件与同名文件仅大小写差**：避免 `Foo.tsx` 与 `foo.ts`（跨 OS 协作易混淆）。
- **非 React 的 `.tsx`**：无 UI 的纯逻辑优先 **`.ts`**（除极少数含 JSX 的常量/片段文件）。

**其它常见类别（仍非穷举，供自查）**：

- **同一概念多云命名不统一**：如有的用 `*ModalAliyun`、有的用 `Aliyun*Modal`；不强制统一全仓，但**同一 `clouds/<Vendor>/` 目录内**宜保持一致。
- **过长或无主题前缀的文件名**：单文件承载多职责时，宁可拆文件或加域前缀，避免 `utils.ts`、`helpers.ts` 等泛名堆叠。
- **`services/`、`types/` 根文件**：`camelCase` 与 `*Api.ts` 并存可接受；**新增**优先与邻文件一致。
- **测试与故事文件**：除 `*.test.*` 外，若引入 Storybook 等，勿与实现文件同名不同扩展却在 import 上易混——按团队约定前缀/后缀。
- **含空格或非常规 Unicode 的文件名**：**禁止**用于源码文件（工具链、跨平台风险）。

---

## 5. 平台与 `pages/` 顶层映射

| 平台 | 说明 | `pages/` 典型目录 |
|------|------|-------------------|
| **CNMC** | 资源总览、资源池、云详情、控制台、**PaaS** 等（**不含**租户管理产品线） | `pages/cnmc/` |
| **TENANTS** | **租户管理**（租户列表、组织、租户用户等）；与 CNMC **平级**的独立平台 | `pages/tenants/`；路由与导航见 `RouteSpec.platform: 'TENANTS'` |
| **SDNCC** | 见下表「`pages/sdncc/` 与导航分组」；与 `RouteSpec.platform: 'SDNCC'` 一致 | `pages/sdncc/` |
| **CNSOC** | AI SOC、态势、SecOps 等（不含已归 SDNCC 的安全管理面与流量编排） | `pages/cnsoc/` |
| **SETTINGS** | 通用设置、审计、授权、访问控制 | `pages/settings/` |

**`pages/sdncc/` 与导航分组（`RouteSpec.group`）的对应**（产品层级，目录当前多为平铺，按 **跨域互联 / 安全管理面 / 流量编排** 维护）：

| 导航 / 能力 | 典型 `RouteSpec.group` 或 `requiredFeature` | 典型源码目录（`pages/sdncc/` 下） |
|-------------|----------------------------------------------|----------------------------------|
| **跨域互联** | `group: 跨域互联`；`sdn.interconnect` | `interconnect/acl/`、`interconnect/nat/`、`interconnect/srv6/`、`interconnect/ipsec-vpn/`、`interconnect/vr/`（与 RouteSpec 分组一致，kebab-case） |
| **安全管理面** | `group: 安全管理面` 等；`sdn.cascade` | `sec-mgr-plane/`（级联通道、应用等；**安全域/安全服务** 的 `group` 为 **流量编排**，与 RouteSpec 一致，源码仍在本目录） |
| **流量编排** | `group: 流量编排`；`sdn.cascade`（安全域/安全服务）与 `sdn.traffic`（资源池/服务链/策略 等） | `sec-mgr-plane/SecurityDomain`、`sec-mgr-plane/SecurityServices` 与 `traffic/`（`CsmPools/` 安全资源池列表/详情及 `sections/` 内各块含 **防护对象** `CsmPoolAssetsSection` 等、ServiceChains、Policies 等） |

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

全局复用组件，例如：`PageContainer` / `PageDetailContainer` / `PageDetailSection`，`StdSideDrawer`，`TableColumnSettingsButton`（配合 `hooks/useTableColumnSettings`），`ResourceActionsDropdown`，`AdminRoute` / `PrivateRoute` 等。列表加载使用 **`antd` `Table` 的 `loading`**（见 `deployment/docs/specs/frontend-loading-skeleton.md`）。表单类弹窗统一使用 Ant Design `Modal` + `Form`。

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
│   │   ├── maas/          # MAAS 裸金属资源池（`?tab=` + `layouts/admin/maas/`）；见 `maas/README.md`
│   │   ├── Aliyun/、Hw/、Cloudmap/ 等（与仓库目录名一致；CSM 详情在 sdncc/traffic/CsmPools/：CloudDetailCsm、sections/、modals/）
│   ├── console/           # 租户 Cloudmap 控制台（`/console`）：`CloudConsole.tsx` + `hooks/`、`lib/`、`sections/`
│
├── tenants/                 # ========== TENANTS ========== 租户管理（与 CNMC 平级；`sections/`、`hooks/`、`modals/`、`lib/`）
│
├── sdncc/                   # ========== SDNCC ==========
│   ├── interconnect/        # 跨域互联：acl、nat、srv6、ipsec-vpn、vr（见上表；与 `/admin/interconnect/…` 产品域一致）
│   ├── sec-mgr-plane/       # 安全管理面：级联通道、应用等；安全域/安全服务导航归「流量编排」但源码仍在 sec-mgr-plane
│   └── traffic/             # 流量编排：CsmPools/（安全资源池列表/详情、modals/、sections/ 含 CsmPoolAssetsSection 防护对象 等）、ServiceChains/、Policies/ 等
│
├── cnsoc/                   # ========== CNSOC ==========
│   └── （如 `AiSocFrame.tsx`、`AiSocPlaceholder.tsx` 等；与 SDN 编排能力解耦）
│
└── settings/                # ========== SETTINGS ==========
    └── （通用设置、审计、授权、访问控制等）
```

**补充**：

- `pools/` 承载资源池列表与选云后的壳；各云深度实现放在 `clouds/<vendor>/`（含 **`rancher/`** 等扩展厂商目录，与 `Aliyun`/`Hw`/`Harvester`/`Cloudmap` 并列，产品归属仍为 CNMC）。
- **云数据库（`database`）** 仅依赖 **Harvester 资源池虚拟机**，源码在 **`clouds/Harvester/database/`**，**不**与阿里云/华为云等公有云详情混放；云数据库入口为资源池内 `/admin/clouds/:id/paas_databases` 等（见 `RouteSpec` / Cloudmap 侧栏），与目录名不必同构。
- Harvester **内部**目录树 **不在此重复展开**；必须遵守 **`deployment/docs/specs/修改纪要_Harvester前端目录结构_域优先与shared.md`**（其中可含 `paas/`）。
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

**抽屉「壳层 UI」与落位**：与入口一对一的装配层为 **`ecs/drawers/vm-detail/VmDetailDrawerShell.tsx`**（Drawer 骨架、工具栏、Segmented Tab、`VmDetailTab` 与各业务子抽屉挂载；与胶水入口 **`VmDetailDrawer.tsx` 同目录**），其 **大块 JSX/UI 保留在该壳层文件内**。同目录另有 **`useVmDetailMoreMenu.tsx`**（「⋯」下拉项）、**`VmDetailEjectCdromModal.tsx`**（光驱弹出 Modal）。**`shell/`、`lib/`**（含 `tabs/`）侧放数据/控制 hooks、Derived、`types`、各 Tab 拼装等 **非壳层大块 JSX**；**不因「好找」再把同一页 UI 拆成多级 `parts/`、`*Chrome.tsx` 碎片文件**。独立功能的业务子抽屉（磁盘/网卡/规格、`vm-diagnosis` 虚拟机诊断、`vm-realtime-logs` 实时日志「⋯」打开等）仍各占 `ecs/drawers/` 下单目录，与本条不冲突。

**判定**：只服务 **一个** 业务域 → 放在该域对应子目录；**≥2 域** → 该云下的 `shared/`（`lib/`、`components/`、**`context/`** 等；Harvester 见修改纪要）或上浮至 `src/components`（跨平台）。

**Harvester `shared/context/`**：Cloudmap 池详情等 **多域共用** 的 React Provider（如 **`HarvesterPublicNamespacesProvider`**，挂载于 `Cloudmap/pool/PoolDetailPage.tsx`）。单域 Tab 内 Context 仍放 **`<域>/context/`**（如 `monitoring/context/`）。

**Harvester 根级不设 `hooks/`、`context/`**：Section 编排 hook 放 **`Harvester/<域>/hooks/`**；跨域 Provider 放 **`Harvester/shared/context/`**（勿在 `Harvester/hooks/` 或已废弃的根级 `Harvester/context/` 新建文件）。

### 8.1 Harvester 域 README 索引（Cloudmap 池 / cluster 导航）

Harvester 云详情按 **域优先** 分目录；下列域已对齐 Cloudmap 池样板（`loadTabResource` + Section `runHarvesterSectionRefresh`），细则见各域 **`README.md`** 与 **`Harvester/cluster/README.md`**（聚合导航）。

| 域目录 | 典型 Cloudmap 入口 | 域 README |
|--------|-------------------|-----------|
| `Harvester/cbr/` | 侧栏 `backups/...` | `Harvester/cbr/README.md` |
| `Harvester/nad/` | cluster 导航 `nads` / `load_balancers` / `ippools` | `Harvester/nad/README.md` |
| `Harvester/cluster/` | cluster 导航（本域 Section + 聚合装配说明） | `Harvester/cluster/README.md` |
| `Harvester/ecs/`、`ebs/`、`kube-ovn/` 等 | 见 Cloudmap 池 `panels/*` 与修改纪要 | 各域内 README（若有） |
| `maas/` | `/admin/clouds/vendor/maas/:id?tab=` | `maas/README.md` |

新增 Harvester 域时：在域根补 **`README.md`**（Tab ↔ Section ↔ 池 key ↔ 刷新例外），并在上表或 **`AGENTS.md` · Harvester 云详情** 保持索引一致。

---

## 9. 放置判定表与反模式

| 情况 | 放置位置 |
|------|----------|
| 新页面路由归属某平台 | `pages/<平台>/...`，且与 `RouteSpec.platform` 一致；**租户管理**须 **`platform: 'TENANTS'`**，源码在 **`pages/tenants/`**（见 §5） |
| 仅某云类型使用 | `pages/cnmc/clouds/<vendor>/...` 下对应域 |
| 仅 Harvester 某域使用 | `Harvester/<域>/sections|drawers|modals|lib|hooks|components/`（域 README 见 **§8.1**） |
| Harvester `monitoring` 域（对齐 ecs/kube-ovn） | Tab 主体在 **`sections/`**（如监控概览）；数据钩子在 **`hooks/`**；纯函数与解析在 **`lib/`**（勿再用 `utils/`）；卡片与小件在 **`components/`**；**仅本域**跨 Tab Context 在 **`monitoring/context/`**；根级 `MonitoringOverview.tsx` 等可作 barrel 再导出以兼容既有 import |
| Harvester 多域共用 | `Harvester/shared/...`（`lib/`、`components/`、**`context/`** 跨域 Provider；见修改纪要） |
| 多平台或全局复用 UI | `src/components/` 或 `src/hooks/` |
| API 封装 | `src/services/` |
| 路由声明 | `src/routes/RouteSpec.ts` 等 |

**反模式**：

- 在云目录根长期堆积 **仅单域使用** 的 `modals/`、`components/`（应迁入域内或 `shared`）。
- 因路径或文件夹名把 **PaaS** 口头说成与 **CNMC** 平级产品（与 `platform` 矛盾）。
- 为省事把 CNMC 强业务组件塞进 `src/components`，造成全局耦合（应先域内，再评估上浮）。

---

## 10. URL、懒加载与路由

- 对外 **path**（如 `/admin/clouds/:id/paas_databases`、控制台路由）无需与 `pages/.../Harvester/database/...` 逐段对应。
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
- [ ] 云数据库（`database`）源码在 `pages/cnmc/clouds/Harvester/database/`，产品仍属 CNMC 下能力而非独立顶层平台。
- [ ] Harvester 符合修改纪要（域 / `shared` / `monitoring` 小写等）。
- [ ] `npx tsc --noEmit` 通过；发版前生产构建通过。
- [ ] 新增/搬迁文件符合 **§4.2**（组件 PascalCase、工具 camelCase、入口 `index.tsx` 小写优先）。

---

## 12. 仓库内已做过的整理（参考）

1. **空目录清理**：历史 `domains/`、`src/shared/`、`catalogs/` 等已删除或迁移（`navCatalog` 等已归 `constants/`）。
2. **样式**：`global.css` 已弃用，统一 `global-new.css`。
3. **未引用代码**：持续用 `npx knip` 等辅助；`setupProxy.js`、`setupTests.ts`、`*.test.ts(x)` 常被静态分析标为未引用，**属正常，勿删**。
4. **`pages/` 顶层**：含 **`cnmc/`、`tenants/`、`sdncc/`、`cnsoc/`、`settings/`** 等与 §5 一致；**租户管理**为 **`TENANTS`**，源码在 **`pages/tenants/`**。

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
| 2026-04-27 | 租户管理为独立平台 **`TENANTS`**（与 CNMC 平级）；更正 §5/§7 与 CNMC 混写 |
| 2026-05-18 | 租户源码由 `pages/cnmc/tenants/` 迁至 **`pages/tenants/`**，与 TENANTS 平台顶层目录对齐 |
| 2026-05-07 | §4 扩展目录/文件命名与登记例外；§4.3 明确**非穷举**并补充多云后缀、泛名、`services`/`types`、测试命名、禁止异常文件名等；§7 `rancher/`；§11 自检增文件命名项 |
| 2026-05-13 | §8「抽屉壳层 UI」路径：`vm-detail/VmDetailDrawerShell.tsx`（原 `VmDetailDrawerView`）；`useVmDetailMoreMenu.tsx`、`VmDetailEjectCdromModal.tsx` 同目录；`shell/` 仅存数据/控制 hooks、types 等非壳层大块 JSX |
