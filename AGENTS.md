# SDN Console（Compute Tower · SDNC · IBR）

> **本仓库默认产品形态为 SDNC 独立控制台**（`PRODUCT_FLAVOR=sdnc`）：业务面仅 **IBR 管理**（IBR实例、SRv6、IPsec、ACL、NAT）+ **系统设置（SETTINGS）**。网际路由域、邻居（CEN）、应用管理、流量编排、多云 UI、商业 License 门控等**已从源码删除**；后端仅挂载 IBR + 认证/用户/租户/系统 API。**无功能拆分授权**，访问控制仅 RBAC。

## 项目概述

Compute Tower **SDNC** 是 **IBR** 运维控制台（默认 `PRODUCT_FLAVOR=sdnc`）。

### 核心能力（SDNC 默认构建）

- **IBR 管理 (SDNCC)**：IBR实例、SRv6、IPsec VPN、ACL、NAT
- **系统设置 (SETTINGS)**：用户、RBAC、审计、界面/集成/离线升级（**无 License 页/门控**）
- **后端依赖（无独立 UI）**：`/api/tenants` 供 VR 租户/组织绑定下拉
- **CSMCTL（同仓可选）**：`csm-controller/`；见 **`docs/sdnc-stack-integration.md`**

> 本分支源码已物理裁剪为 SDNC；`PRODUCT_FLAVOR=tower` 仅保留少量兼容常量，**不恢复** Tower 全功能前端与 `/api/clouds`。

## 技术栈

### 后端
- **运行时**： Node.js 18+ + TypeScript 5.x
- **框架**： Express 4.x
- **数据库**： SQLite (TypeORM 0.3.x)
- **认证**： JWT + bcryptjs
- **外置依赖（联调）**： CSMCTL（`csm-controller/`，MongoDB）；见 **`docs/sdnc-stack-integration.md`**
- **（Tower only）**： WebSocket（ws 8.x）、多云 SDK（阿里云/华为云/腾讯云）、Harvester Steve 等 — SDNC 默认不挂载/不启动

### 前端
- **框架**： React 18 + TypeScript 4.9
- **UI组件**： Ant Design 5.x
- **路由**： React Router 6
- **拓扑（IBR 域内）**： react-flow-renderer
- **目录结构**： **`frontend/src/STRUCTURE.md`**（SDNC 前端目录权威）；**`frontend/README.md`** 仅为包入口（运行命令）

## 架构文档分工

| 文档 | 职责 |
|------|------|
| **`AGENTS.md`**（本文件） | 项目总览、运行、API 索引、SDNC 开发规范摘要 |
| **`frontend/src/STRUCTURE.md`** | 前端 `pages/sdncc/`、`pages/settings/` 目录与放置规则（**SDNC 权威**） |
| **`backend/src/STRUCTURE.md`** | 后端 `backend/src/` 的分层与落点、**路由 ↔ 服务 ↔ 实体** 约定、与前端平台的心智对照；**API 清单不重复维护**（以本文件为准） |
| **`docs/`**（Hub） | 索引见 **`docs/README.md`**：**`sdnc-stack-integration.md`**（全栈整合）、**`ibr-stack-components.md`**（SDNC/CSMCTL/agent/设备 Console）、**`ibr-vr-config-deploy.md`**（VR 分域下发与初始化边界）、**`internetwork-routing-domain.md`**、SRv6 系列、**`sdnc-tower-integration-api.md`**（Tower 联部署可选）、**`code-quality.md`**、**`frontend-layout.md`** |
| **`csm-controller/README.md`** | CSMCTL 构建、Docker、北向 API 与 Tower 联调 |
| **`tests/E2E_COVERAGE.md`** | **SDNC E2E 覆盖索引**；终端一览 `cd tests && npm run e2e:status`；登记 `tests/e2e-manifest.cjs` |
| **`deployment/`** | 本地设计/规格，**不入库**（见 `.gitignore`） |

新增或搬迁源码时：**前端**以 `frontend/src/STRUCTURE.md` 为准，**后端**以 `backend/src/STRUCTURE.md` 为准；对外路径以 `backend/src/index.ts` 的挂载为准。

## 文档导读

本文件按 **产品地图 → 运行与仓库树 → 发版与对外契约 → 专题落位 → 研发规范 → 认证与后台** 组织；长文查阅可先对照下表。

| 推荐阅读顺序 | 章节 | 说明 |
|-------------|------|------|
| 1 | **项目概述**、**技术栈**、**架构文档分工**、**平台模块** | 能力边界、文档权威、平台与源码归属 |
| 2 | **构建与运行**、**项目结构** | 本地启动与环境变量，再对照仓库树 |
| 3 | **版本管理（平台发布版本）** | 平台 `version`、离线包与发版约定 |
| 4 | **API 规范** | HTTP 路径索引（IBR / 设置 / 租户） |
| 5 | **开发规范**（摘要） | 落位、布局、刷新、`.std-table`；详见 **`docs/frontend-layout.md`** |

## 平台模块（SDNC 默认）

| 平台 | 代码 | 说明 |
|------|------|------|
| IBR 管理 | SDNCC | VR / SRv6 / IPsec / ACL / NAT；`pages/sdncc/ibr/` |
| 系统设置 | SETTINGS | 用户、RBAC、审计、界面/集成/升级；`pages/settings/` |

后端保留 `/api/tenants`（VR 归属绑定）；**不挂载** `/api/clouds`、CEN、网际路由域、应用、流量编排等 API。

## 构建与运行

### 环境要求
- **生产 / 联调（推荐）**：Docker + Docker Compose
- **源码开发**：Node.js 18+、npm

### 生产部署（统一：全容器）

仓库根目录一条命令拉起 **MongoDB + CSMCTL + SDNC 控制台**（前后端一体，端口 `5001`）：

```bash
# 首次或升级后重新构建
docker compose up -d --build

# 查看状态
docker compose ps
curl http://127.0.0.1:5001/health
```

浏览器访问 **`http://<主机>:5001`**，默认账号 **`admin` / `admin123`**。

| 服务 | 容器名 | 端口 | 说明 |
|------|--------|------|------|
| SDNC 控制台 | `sdnc-console` | 5001 | Node 托管 API + 前端静态资源（`Dockerfile` 多阶段构建） |
| CSMCTL | `sdnc-csmctl` | 8016 | VR 控制面 |
| MongoDB | `mongodb` | 27017 | CSMCTL 数据 |

**持久化**：`sdnc-app-data` 卷挂载 `/opt/sdnc/data`（SQLite、`system-settings.json`、上传暂存）。

**必改环境变量**（`docker-compose.yml` 或 `.env`）：
- `JWT_SECRET`：生产环境务必修改（默认 `change-me-in-production`）

**版本升级（容器）**：

```bash
git pull
docker compose up -d --build
```

容器内默认关闭离线升级后的进程自重启（`TOWER_AUTO_RESTART_ON_UPGRADE=false`）；勿依赖 pm2。

**仅本机源码开发**（前后端热重载，依赖仍走容器）：

```bash
docker compose up -d mongodb sdnc-csmctl
cd backend && npm run dev
cd frontend && npm run start   # :5000 → 代理 :5001
```

### 源码命令（开发 / CI）

**后端**：

```bash
cd backend
npm install
npm run dev      # 开发模式 (端口 5001)
npm run build    # 编译
npm run start    # 生产模式（裸机部署时用；生产推荐容器）
npm run test     # 运行测试
```

**前端**：

```bash
cd frontend
npm install
npm run start    # 开发模式 (端口 5000)
npm run build    # 生产构建
npm run test     # 运行测试
```

### 环境变量

**SDNC 容器（`docker-compose.yml` → `sdnc` 服务）**：
- `JWT_SECRET`：JWT 密钥（**生产必改**）
- `CSMCTL_ADDRESS`：默认 `https://sdnc-csmctl:8016`（Compose 内网）
- `DB_PATH`：默认 `/opt/sdnc/data/data.sqlite`
- `PRODUCT_FLAVOR`：`sdnc`

**后端（裸机 / 开发）**：
- `PORT`: 服务端口 (默认 5001)
- `JWT_SECRET`: JWT 密钥
- `DB_PATH`: SQLite 数据库路径
- `NODE_ENV`: 环境标识 (development/production)
- `PRODUCT_FLAVOR`: `sdnc`（默认）
- `CSMCTL_ADDRESS`: 裸机联调默认 `https://127.0.0.1:8016`（与 `docker compose` 映射端口一致）

**前端（仅开发）**：
- `REACT_APP_API_URL`: 后端 API 地址（生产容器内前后端同源，构建时不设）
- `REACT_APP_PRODUCT_FLAVOR`: `sdnc`
- `HOST` / `PORT`: 开发服务器

**CSMCTL**：细则见 **`csm-controller/README.md`**、**`docs/sdnc-stack-integration.md`**

## 项目结构

```
Compute.Tower/
├── docker-compose.yml          # 全栈：mongodb + sdnc-csmctl + sdnc-console
├── Dockerfile                  # SDNC 控制台镜像（前端 build + 后端 dist）
├── csm-controller/             # CSMCTL VR 控制面（Java/Maven）；北向 /V2/ctcontrol
├── tests/                      # E2E / 业务测试（tests/E2E_COVERAGE.md）
├── tools/                      # 运维脚本：离线升级包构建、git 单文件恢复
│   ├── build-offline-upgrade-bundle.ps1
│   └── restore-file-from-git.mjs
├── docs/                       # 技术 Hub（docs/README.md）
├── deployment/docs/            # 本地设计/规格（deployment/ 不入库）
├── AGENTS.md                   # 本文件
├── backend/
│   ├── src/
│   │   ├── index.ts            # Express 入口（IBR + 系统 API）
│   │   ├── STRUCTURE.md        # 后端目录权威
│   │   ├── constants/          # productFlavor、effectivePermissions（SDNC RBAC）等
│   │   ├── config/             # database、systemSettings（含 CSMCTL_ADDRESS 默认）
│   │   ├── routes/
│   │   │   ├── sdn/            # IBR：SRv6、VR、ACL、NAT、IPsec
│   │   │   ├── sdnc/           # 北向 /api/v1
│   │   │   ├── tenants/        # VR 绑定下拉
│   │   │   ├── auth/、sysuser/、system.ts、auditLogs.ts
│   │   │   └── apiProxy.ts     # /api-proxy → CSMCTL
│   │   ├── services/
│   │   │   ├── vrouter/        # VRCacheService、vrController → CSMCTL
│   │   │   └── sdnc/           # 北向查询
│   │   ├── entities/           # User、Tenant、Organization、VR 缓存等
│   │   ├── middleware/、permissions/、seeders/、utils/
│   ├── data/                   # 运行期数据（须在 backend/ 目录启动；gitignore）
│   │   ├── system-settings.json
│   │   └── temp_uploads/       # 离线升级等上传暂存
│   ├── data.sqlite             # SQLite 主库（与 data/ 并列）
│   └── package.json
└── frontend/
    ├── patches/                # patch-package（react-dev-utils 开发代理修复）
    ├── public/                 # CRA 静态资源（index.html、登录背景图）
    ├── src/
    │   ├── STRUCTURE.md        # 前端目录权威（SDNC）
    │   ├── setupProxy.js       # 开发代理 /api、/api-proxy
    │   ├── pages/
    │   │   ├── auth/           # AdminLogin
    │   │   ├── sdncc/ibr/      # SDNCC：VR / SRv6 / IPsec / ACL / NAT
    │   │   ├── settings/       # SETTINGS：用户、角色、审计、界面/集成/升级
    │   │   └── coming-soon/    # 占位
    │   ├── routes/             # RouteSpec（platform: SDNCC | SETTINGS）
    │   ├── services/           # api.ts、systemApi.ts、virtualRouterApi.ts
    │   ├── components/、layouts/、constants/、contexts/、hooks/、utils/
    │   └── global-new.css
    └── package.json
```

**已删除、勿重建**：
- 前端：`pages/cnmc/`、`pages/tenants/`、`pages/cnsoc/`、`pages/sdncc/cross-domain/`、`sec-mgr-plane/`、`interconnect/`
- 后端：`routes/clouds/`、`routes/tools/`（license/ssh-keygen）、`backend/keys/`、`LicenseService`、`ws/`
- 运行期空壳：`backend/uploads/`、`backend/dev/`、`frontend/scripts/`（已清理）

## 版本管理（平台发布版本）

本节约定 **SDNC 平台自身**（前后端一体交付）的版本号口径。

### 「当前软件版本」从哪里来

- **系统设置 → 离线升级** 页展示的「当前软件版本」，来自 **`GET /api/system/offline-upgrade/status`** 响应中的 **`runtimeVersion`**。
- **实现**：`backend/src/services/OfflineUpgradeService.ts` 的 `getStatus()` 从运行进程可访问的目录向上查找 **`backend/package.json`**（`name === "compute-tower-backend"`），读取其 **`version`** 字段；缺失时返回字符串 **`unknown`**。
- **含义**：表示**当前部署目录中后端 npm 包的 `version`**，与磁盘上的 `backend/package.json` 一致；**不是**数据库内单独维护的市场版本表；**不**读取 `frontend/package.json`（若仅前端构建与后端 `version` 未对齐，该字段无法反映前端包版本）。

### 权威版本号（研发约定）

1. **唯一权威**：平台对外发布、运维工单、管理界面「当前软件版本」对齐的 **SemVer**，以 **`backend/package.json` → `version`** 为准。
2. **粒度**：主版本长期固定为 `x.0.0`、从不递增 **PATCH** 会显得版本号「过粗」、无法与迭代节奏对齐；**默认可交付单元**应以 **PATCH**（`x.y.Z`）体现小步发版；需要区分**同 PATCH 下多次构建**时，可采用 SemVer **build metadata**（形如 `1.0.1+20260429` 或 `1.0.1+build.42`，`+` 后不参与 npm 依赖比较，仅供运维/流水线识别，展示上仍可读 `package.json` 全串）。
3. **前端同步**：**`frontend/package.json` → `version`** 应与后端 **同级版本号保持一致**（同一发版单元）；发版或打离线包前**同时修改**两处，避免「界面显示 1.2.0、前端包实为 1.1.9」类歧义。
4. **离线包 `manifest.json` 的 `version`**（见 `deployment/docs/specs/offline-upgrade-bundle.md`）：仅作**包内标注**并写入升级记录；**不会**自动回写 `package.json`。若希望升级后展示号与包内标注一致，应在构建离线包时让 `server/` 内已包含更新后的 `package.json`（或发版流程显式 bump 后再打包）。

### 发版与 bump 建议

- 采用 **SemVer** `MAJOR.MINOR.PATCH`：破坏性 API/行为 → MAJOR；向下兼容功能 → MINOR；修复与补丁 → PATCH。
- **正式发布**：更新 `backend/package.json` 与 `frontend/package.json` 的 `version`，提交后打 Git 标签（如 `v1.2.3` 与 version 对齐），再构建前端产物与后端 `dist/` 并组离线 zip（可用 `tools/build-offline-upgrade-bundle.ps1`）。
- **仅替换静态资源**：可只发前端 `public/`；若后端逻辑未变，可不 bump 后端 `version`——为减少认知成本，仍建议前后端 **PATCH** 同步 bump。

### 实现与文档索引

- 读版本：`OfflineUpgradeService.getStatus()`（`backend/src/services/OfflineUpgradeService.ts`）
- 状态路由：`GET /api/system/offline-upgrade/status`（`backend/src/routes/system.ts`）
- 离线包目录约定：`deployment/docs/specs/offline-upgrade-bundle.md`

## API 规范

> **挂载以 `backend/src/index.ts` 为准**。下列为 SDNC 当前路由。

### SDNC 默认路由

**认证与用户**：
- `/api/auth`、`/auth`：登录、登出、令牌校验
- `/api/users`：系统用户管理

**租户（IBR 绑定，无运营前端）**：
- `/api/tenants`：租户与组织下拉（VR 归属绑定）

**IBR**：
- `/api/vr-instances`：IBR 实例聚合列表（API 路径保留 `vr` 前缀）
- `/api/vr-config`：VR 配置（写经 CSMCTL，见 **`docs/sdnc-stack-integration.md`**）
- `/api/networks/srv6`：SRv6（含 reconcile、hub、baseline、deploy）
- `/api/networks/ipsec`、`/api/networks/acl`、`/api/networks/acl-groups`、`/api/networks/nat`

**北向与代理**：
- `/api/v1`：SDNC 北向 API（如 `GET /api/v1/vr-instances`）
- `/api-proxy`：CSMCTL 北向代理（如 `POST /api-proxy/api/sign`）

**IBR 配置下发（分域）**：日常策略（ACL / NAT / IPsec / SRv6）经 `pushVRConfig` 全量 POST，详见 **`docs/ibr-vr-config-deploy.md`**。专家模式与 VR 角色向导为初始化通道，不经过该网关。

**系统**：
- `/api/system`：系统配置、RBAC、离线升级（`offline-upgrade/status|apply`）
- `/api/audit-logs`：操作审计

**健康检查**：
- `GET /health`：进程存活；SDNC 下附带 `dependencies.csmctl` 探活

### 已移除（源码已删、运行时未挂载）

以下能力已从路由与前端页面**物理删除**，表中仅作迁移对照：

| 路径 | 说明 |
|------|------|
| `/api/system/license`、`backend/keys/` | 商业 License 签发/验签（SDNC 已删） |
| `/api/clouds`、Harvester/多云子树 | 云池 inventory |
| `/api/cens`、`/api/security-domains`、`/api/services`、`/api/security/traffic`、`/api/sase/*` | 跨域互联 |
| `/api/dashboard`、`/api/harbor` | Tower 仪表盘 / 镜像仓库 |
| `/ws/*` | WebSSH / VNC / KubeVirt 终端 |

## 开发规范

**目录落位**：前端见 **`frontend/src/STRUCTURE.md`**；后端见 **`backend/src/STRUCTURE.md`**。

**RBAC 按钮显隐（强制）**：
- 页面功能可见（有 read）但无对应按钮 write 权限时，**操作按钮/菜单项必须隐藏**，**禁止置灰（disabled）**。
- 适用范围：工具栏主按钮、行操作下拉、批量操作、详情页动作按钮。

### 命名约定
- **组件文件**： PascalCase (如 `PageContainer.tsx`)
- **工具文件**： camelCase (如 `roleGrantNormalize.ts`)
- **类型文件**： camelCase (如 `cloud.ts`)
- **常量文件**： camelCase (如 `pagination.ts`)

### API 调用
使用 `services/` 下的 API 服务函数，统一使用 `requestManager` 进行请求管理（支持去重、缓存、重试）。

### 数据展示与刷新（强制）

本节统一约束**数据可能已变化**时，界面如何与对端状态对齐：须避免假刷新、陈旧缓存，以及「只读本机库却冒充已同步」。触发分两类——**用户显式刷新**与**写操作（增删改）成功后的重载**；两类均须满足对端语义，并在读路径上使用 **`skipCache: true`**、**`onRefresh(true)`**、**`force=true`**、**`clearCache`** 等与项目既有实现一致的约定，**不得**省略应发起的网络请求或等效同步。

#### 用户显式刷新

凡由用户**显式触发**的「刷新」行为（页面/区块工具栏刷新按钮、详情抽屉或侧栏的刷新、`ReloadOutlined` / `SyncOutlined` 等触发的重新加载），须同时满足：

1. **对端真实拉取（数据源）**  
   刷新必须导致**经后端访问对端权威数据源**（云厂商 / 集群 / 设备 / CSM 控制面 / 其它外部服务）的拉取或经后端实现的**等效强制同步**（例如先执行同步任务再读库），**不得**将「仅读取 Tower 本机数据库、且未触发任何对端同步」的接口作为该次刷新的**唯一**数据路径。  
   **例外**：界面明确标注为「仅本地 / 草稿 / 平台已保存副本」的视图，可使用只读库表；此类 Tab 或按钮**不得**单独冒充整页「同步刷新」，且不应在用户未进入该视图时作为全局刷新的附带请求。

2. **前端不喂陈旧内存缓存**  
   **禁止**依赖 `requestManager` GET 内存缓存命中或其它陈旧快照冒充最新状态；刷新路径上的 `apiRequest` GET 须 **`skipCache: true`**（已 `enableCache: true` 的接口同样如此）。

3. **禁止假刷新**  
   **禁止**将「仅重绘本地 `useState` / 表单占位、不发起请求」当作刷新。

#### 写操作成功后的列表与视图重载

凡含「列表 + 创建/编辑/删除」的页面，**须**使操作成功后的当前页列表与后端一致，**不**要求用户整页刷新才能看到结果；且与上节一致，重载须**真实拉取/同步**并**跳过陈旧缓存**（例如列表刷新前已触发或未省略后端的强制同步接口）。

1. **写操作成功后必须触发列表重载**  
   在 `onSuccess` 或提交成功分支中，在 `await` 写接口完成之后，调用与当前表格同源的加载函数，或使用父级传入的 `onRefresh` / `onRefresh(true)`。

2. **列表对应 GET 若使用 `enableCache: true`（或项目内对读接口开了缓存）**  
   于上述成功后的重载中须**强制新读**：`apiRequest(path, { skipCache: true })`，或对 `frontend/src/utils/requestManager.ts` 中 `clearCache` 所支持的精确 path 先 `clearCache` 再 GET。

**自测**：完成一条增/删/改后，当前页列表应已更新，无需 F5 / Ctrl+F5。

**公共组件对齐**：`PageContainer` 工具栏刷新应对 `onReload` / 列表 `load*` 传入强制刷新语义；避免 `onClick={reload}` 把 React 点击事件误当作 `force` 参数。

### 组件开发与加载态

- 公共逻辑提取到 `components/` 或 `hooks/`；API 调用走 `services/`
- 列表使用 **`antd` `Table` 的 `loading`**；非表格占位直接用 **`antd` `Skeleton`**

### React 状态管理注意事项

使用 Ant Design Form 时，对于复杂嵌套数据的动态更新：

**问题**： `Form.useWatch` 对嵌套路径的监听不可靠，`form.setFieldsValue` 更新后 UI 可能不刷新。

**解决方案**： 使用本地 `useState` 管理复杂数据，配合 `useEffect` 初始化和 `syncToForm` 函数同步：

```tsx
const [rules, setRules] = useState<Rule[]>([]);

// 初始化时从 form 读取
useEffect(() => {
  setRules(form.getFieldValue('rules') || []);
}, [form]);

// 添加规则 - 直接更新本地 state，UI 立即响应
const addRule = useCallback(() => {
  const updated = [...rules, newRule];
  setRules(updated);
  form.setFieldsValue({ rules: updated });
}, [rules, form]);
```

### 前端页面布局

全站页面壳层与容器选用以 **`docs/frontend-layout.md`** 为权威（Hub 可提交）；本节仅摘要。

| 层级 | 说明 |
|------|------|
| **`AdminLayout`** | 顶栏 + 侧栏 + 内容区 |
| **`PageContainer`** | 列表/管理页（IBR 列表、设置列表等） |

**常见组合**：IBR / 设置列表 → `PageContainer` + `AdminLayout`；向导/编辑页可用 `PageContainer` 或独立页面壳。

### API 开发原则

开发功能对接标准实体时，遵循以下原则：

1. **优先使用标准 API**： 标准 API 与协议说明见 **`AGENTS.md` · API 规范**；本地扩展规格可能在 **`deployment/docs/specs/`**（不入库）
2. **发现缺失先核对**： 如果发现缺少某个接口，先提出来核对：
   - 是否实际存在该接口，只是未总结到文档
   - 是否可以用其他接口替代
   - 确认后再决定是否需要新增
3. **避免重复造轮子**： 不要一上来就从零开始开发，优先复用已有的 API 和代码；细则见 **`docs/code-quality.md` · §4 不要重复造轮子**。

### 全局样式
通用 CSS 样式文件：`frontend/src/global-new.css`

### 列表表格（.std-table，**全站版式 A**）

全站**统一版式 A**：标准数据列表**首列左冻结、行操作列右冻结**，并**配横向滚动**。细则见 **`docs/frontend-layout.md` §5.1**；**样板页**为 **`frontend/src/pages/sdncc/ibr/routers/index.tsx`**（VR 列表）。

1. **Table 与 `scroll`**
   - 列表 `Table` 使用 `className="std-table"`，并 **`bordered={false}`**。
   - **列冻结要求**：**首列**须 **`fixed: 'left'`**（最左一列，一般为多选/名称/主标识等主入口列，含行多选时与现网大表一致，多选列在左则一并纳入左端冻结区）；有**行级操作**时，**操作列**须 **`fixed: 'right'`**。中间业务列不钉。
   - 因已含左/右 `fixed`，**必须**同表写 `scroll={{ x: true }}`（或等价的 `scroll.x: minWidth` 等），否则 Ant Design 下固定列易错位。
   - 新增、整改、复制**按上条**实现；曾无首列/操作列冻结的列表**应**补全并对齐全站，避免两套路长期并存。无行操作列的只读/极窄子表，经评审可例外，不在此默认内。

2. **列宽（与内容、样式分工）**
   - **列宽以内容 + `.std-table` 表级规则为主**：`columns` 里**原则上不**写 `width: <固定 px>` 作为常规手段；表体宽度由单元格内容与本节全局样式（如 `.std-table` 中 `min-width: max(100%, max-content)` 等）**随内容推宽/换行策略**一起决定，而不是在每一列上写死像素宽。
   - **单元格内**对超长文案做省略、加 `maxWidth` 等，属**格内**展示约束，**不等同于**在 `columns` 上写整列 `width`；可单独用于 Tooltip、多行等场景。
   - 仅当 Ant Design/固定列在个别浏览器下**确需**最小可测宽度、且经排查无法用内容与样式解决时，再**个案**加最小约束，**禁止**因习惯把大表每列都写成固定 `width` 列阵。

3. **列展示（`useTableColumnSettings` / `TableColumnSettingsButton`）**
   - 已设 `fixed` 的列**不允许**在「列展示」中关闭；行为由 `useTableColumnSettings` 将此类列**锁定为常显**、选项 **disabled**，全不选时**仅保留冻结列**。

4. **边框与单元格视觉（全局 CSS，业务勿覆盖）**
   - **仅横向行分隔**：`.std-table` 表头/表体单元格 `border-bottom: 1px solid #e5e6eb`；**无**竖线、**无**表格外框（故禁止 `bordered`）。
   - 表头**不加粗**；单元格默认 `padding: 12px 16px`、`font-size: 14px`；行悬停 `#f2f3f5`。
   - 勿在页面内对 `.std-table .ant-table-cell` 写 `border-bottom: none` 等覆盖（除非经评审的域内例外，且不得影响标准列表）。

5. **其它**
   - **勿**擅自给 **`Table`** 加 `size="small"`，除非产品明确要求；**分页**可用 `pagination.size: 'small'`。
   - 大表列展示：`useTableColumnSettings` + `TableColumnSettingsButton`（`fixed` 列锁定常显）。

```tsx
// std-table、无边框网格、冻结列、scroll.x
<Table
  className="std-table"
  bordered={false}
  columns={columns}
  scroll={{ x: true }}
/>
```

### 列表工具栏（与 `.std-table` 配套）

列表/页面工具栏以 **`PageContainer` 的 `toolbarLeft` / `toolbarRight`** 实现；细则见 **`docs/frontend-layout.md` §5.2**。

- **CSS 落点**：`frontend/src/global-new.css`（`.toolbar-search`、`.toolbar-filter`、`.toolbar-actions`、`.toolbar-reset-btn`、`.page-container-toolbar`）。
- **左侧**：搜索/筛选用上述 class；重置用 **`<button className="toolbar-reset-btn">`**。
- **右侧**：包 **`div.toolbar-actions`**；顺序建议 主按钮 → 列展示 → **`ReloadOutlined`** 刷新。

### 前端代码质量

#### Git Hooks
- 使用 Husky 进行 Git 钩子管理
- pre-commit 自动执行 lint-staged

#### Lint-staged 配置

```json
{
  "*.{ts,tsx}": ["eslint --fix"]
}
```

#### 浏览器兼容性
- 生产环境：`>0.2%, not dead, not op_mini all`
- 开发环境：`last 1 chrome version, last 1 firefox version, last 1 safari version`

### 代码质量自查（PR / 专项清理）

合入前对照 **`docs/code-quality.md`**（§1～§9 合入清单；§10～§12 可维护性/规范性可选评分，**不含功能测试**；五十条附录）。与本文件 **开发规范** 冲突时，以 **STRUCTURE 专章与本文件强制约定** 为准。

**合入前最小检查（可复制到 PR 描述）**：

1. 文件落位与页面布局是否符合 STRUCTURE / **`docs/frontend-layout.md`** / 本文件 **开发规范**？
2. 是否已 **先查再写**、复用已有 API/组件/域内 `lib`？
3. 列表/工具栏/写操作是否满足 **刷新与缓存**、**std-table**（§5.1）、**工具栏**（§5.2）？
4. 是否引入 ESLint/类型/构建错误？
5. 是否删除本次改动产生的死代码与重复逻辑？
6. 是否做过相关路径的手动冒烟？新增功能 E2E 是否已登记 **`tests/e2e-manifest.cjs`**（见 **`tests/E2E_COVERAGE.md`**）？

## 认证与权限

### 用户角色
- `super_admin`: 超级管理员 (全部权限)
- `admin`: 管理员
- `tenant`: 租户用户（无 SDNC 管理端 UI；登录后跳转 IBR 嵌入路径）

### 权限系统
采用 RBAC；SDNC 有效权限目录见 `backend/src/constants/effectivePermissions.ts`（`SDNCC` · IBR管理 + `SETTINGS`）。**无 License / feature 门控**；菜单与路由仅 RBAC 过滤。权限通过 `permissions` 数组传递，`*` 表示全部权限。

### Token 存储
前端 Token 存储使用 `utils/tokenStorage`，支持 localStorage 和 sessionStorage。

## 后台服务（SDNC 默认）

| 服务 | SDNC | 说明 |
|------|------|------|
| `VRCacheService` | 是 | 约 10s 后启动，定时从 CSMCTL 同步 VR 列表 |
| `AuditLogRetentionService` | 是 | 审计日志保留期清理 |
| `CloudSyncService` | 否 | 多云定时全量同步（Tower only） |
| Harbor / 回收站同步 | 否 | Tower only |

本地开发可设 `TOWER_SKIP_BACKGROUND_SYNC=1` 跳过全部后台同步。

## 注意事项

1. **数据库**： SQLite；生产环境建议 PostgreSQL/MySQL
2. **安全**： 修改默认 `JWT_SECRET`，生产环境收紧 CORS
3. **内存**： 前端 `--max-old-space-size=4096`
4. **代理**： 开发环境 `setupProxy.js` 代理 `/api`、`/api-proxy`（SDNC 无 `/ws/*`）
5. **CSMCTL**： IBR 写操作依赖 CSMCTL；本地推荐 `docker compose up -d --build`
6. **代码规范**： Husky + lint-staged
7. **运行目录**： 须在 `backend/` 下启动服务；`data.sqlite` 与 `data/` 均落在 `backend/` 包根下

## Cursor Cloud specific instructions

### npm scripts 与 Linux 兼容性

`backend/package.json` 和 `frontend/package.json` 中的 npm scripts 使用 Windows 风格 `set "VAR=value" &&`，**在 Linux 上不会设置环境变量**。启动服务时须直接传入环境变量：

```bash
# 后端（端口 5001）
cd backend
NODE_ENV=development PORT=5001 DB_SYNC=true LOGIN_ALLOW_PLAINT_PASSWORD=1 PRODUCT_FLAVOR=sdnc npx nodemon --exec "npx ts-node --transpile-only" src/index.ts

# 前端（端口 5000，SDNC）
cd frontend
HOST=0.0.0.0 PORT=5000 REACT_APP_PRODUCT_FLAVOR=sdnc REACT_APP_API_URL=http://127.0.0.1:5001 NODE_OPTIONS=--max-old-space-size=4096 BROWSER=none npx react-scripts start
```

### 服务启动顺序与依赖

**生产（容器，推荐）**：

```bash
docker compose up -d --build
# 访问 http://<主机>:5001
```

**源码开发**：

1. `docker compose up -d mongodb sdnc-csmctl`
2. `cd backend && npm run dev`（须在 `backend/` 目录；`DB_SYNC=true` 时自动建表；默认 `admin/admin123`）
3. `cd frontend && npm run start`（CRA 代理 `/api`、`/api-proxy` → `:5001`）

仅调试 UI、不涉及 IBR 写下发时，可不启 CSMCTL；`GET /health` 会反映 `dependencies.csmctl` 不可达。

### Lint / Test / Build 命令

| 服务 | Lint | Test | TypeScript 检查 |
|------|------|------|-----------------|
| 后端 | `cd backend && npx eslint "src/**/*.ts"` | `cd backend && npx jest` | `cd backend && npx tsc --noEmit` |
| 前端 | `cd frontend && npx eslint "src/**/*.{ts,tsx}"` | `cd frontend && CI=true NODE_OPTIONS=--max-old-space-size=4096 npx react-scripts test --watchAll=false` | 编译时由 CRA 内置检查 |

### 注意事项

- 前端编译首次较慢（约 1-2 分钟），后续热重载正常。
- Husky 在非 git 根目录运行 `npm install` 时会报 `.git can't be found`，可忽略。
- **CSMCTL 目录已改名**：仓库根为 `ibr-controller/`（`docker-compose.yml` 亦指向它）；`csm-controller/` 已不存在，文中残留链接按 `ibr-controller/` 理解。仅做登录 + 系统设置/用户 UI 冒烟时，MongoDB/CSMCTL 均可不启。
- **用户管理 UI 路由**为 `/admin/access/users`（不是 `/admin/settings/users`）；权威路由清单见 `frontend/src/routes/RouteSpec.ts`。
- 前端测试有一条**与环境无关的既有失败**：`src/components/pageRouteMeta/routeMeta.test.ts` 期望已移除的 `/admin/dashboard` 路由；其余 126 条通过，勿因此误判环境问题。
- `patch-package` 在 `frontend/postinstall` 中运行（当前仅 `react-dev-utils` 开发代理补丁；`npm install` 后自动应用）。