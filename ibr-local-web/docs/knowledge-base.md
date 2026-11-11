# PaaS VR 开发知识库

本文档汇总 VR 一体机环境、部署脚本、设备 agent 参考代码与 Web 控制台之间的关系，供日常开发与联调查阅。  
更精简的环境清单见 [`scripts/test.md`](../scripts/test.md)；Cursor Agent 约定见 [`AGENTS.md`](../AGENTS.md)。

---

## 1. 仓库目录结构

`paas-vr-console` 是 **VR 实例管理控制台**（npm workspaces monorepo）。  
**自动部署的只有 `web/` + `server/`**。

`products/`（csmctl、vrctl-agent、ipoe）为**本地开发目录**，已在根目录 `.gitignore` 中忽略，**不上传 GitHub**；各开发者自行放入对应源码。`docs/reference/` 为架构文档（可提交）。

```
paas-vr-console/
├── web/                      # ① Paas Console 前端
├── server/                   # ① Paas Console API
├── products/                 # ②③④ 本地产品源码（.gitignore，不进 GitHub）
│   ├── csmctl/               # ③ csmctl（Java）
│   ├── vrctl-agent/          # ② vrctl-agent（真源）
│   ├── ipoe/                 # ④ ipoe 原子
│   └── sync-agent.ps1        # agent → ipoe 打包目录同步
├── scripts/                  # 跨产品联调、部署
├── docs/
│   ├── knowledge-base.md
│   └── reference/            # 架构文档、图片（无产品源码）
│       └── architecture.md
├── AGENTS.md
└── package.json
```

### 1.1 四份源码对照

| # | 产品 | 本仓路径 | 部署位置 |
|---|------|----------|----------|
| 1 | **Paas Console** | `web/`、`server/` | IBR `/opt/paas-vr-v2/` |
| 2 | **vrctl-agent** | `products/vrctl-agent/` | `/rhos/etc/agent/` |
| 3 | **csmctl** | `products/csmctl/` | 云侧 Controller |
| 4 | **ipoe** | `products/ipoe/`（本地） | IBR `/rhos/`、`vbras` |

> **Git**：`products/` 整目录在 `.gitignore` 中；GitHub 仓库只含 Paas Console + 文档 + 联调脚本。本地按上表自行放置 csmctl / agent / ipoe 源码。

### 1.2 目录与职责

| 路径 | 是否 `deploy:remote` | 说明 |
|------|----------------------|------|
| `web/`、`server/` | **是** | 控制台产品代码 |
| `products/csmctl/` | **否** | csmctl 源码 |
| `products/vrctl-agent/` | **否** | agent 真源；改后运行 `products/sync-agent.ps1` |
| `products/ipoe/` | **否** | ipoe 完整源码 |
| `scripts/` | — | 部署与联调工具 |
| `docs/reference/` | — | 架构说明、PNG 图 |

控制台 **不负责** 替代 `vrctl-agent`；两者在同一台 VR 上并存，各管一条配置/控制链路（见下文「双配置体系」）。

### 1.3 两套「发布」边界

| 对象 | 仓库路径 | 维护方式 | 设备路径 / 服务 |
|------|----------|----------|-----------------|
| **Paas-VRv2 控制台** | `web/`、`server/` | `npm run deploy:remote` | `/opt/paas-vr-v2/`、`paas-vr-v2.service` |
| **vrctl-agent** | `products/vrctl-agent/` | 人工或随 ipoe 包 | `/rhos/etc/agent/`、`vrctl-agent.service` |
| **ipoe** | `products/ipoe/` | ipoe 安装包 | `/rhos/`、`vbras` |
| **csmctl** | `products/csmctl/` | 云侧部署 | `csmcontroller.service` |

改 agent 后：运行 `products/sync-agent.ps1`，再拷贝到设备或重打 ipoe 包；**不要**指望 `deploy:remote` 会带上 agent。

---

## 2. 运行架构（必须同机）

```
┌─────────────────────────────────────────────────────────────┐
│  VR 一体机（如 120.26.76.215）                                │
│                                                             │
│  ┌──────────────────┐    cli.sock     ┌─────────────────┐  │
│  │ paas-vr-v2       │ ──────────────► │ vbras / CSM     │  │
│  │ (Web + API)      │                 │ /rhos/bin/clish │  │
│  │ /opt/paas-vr-v2  │                 └─────────────────┘  │
│  └────────┬─────────┘                          ▲           │
│           │ 读写 vrconf                         │ Lua 下发  │
│           ▼                                     │           │
│  /usr/local/src/vrconf/              ┌──────────┴─────────┐ │
│  (vrcontrol / registervr / nic_roles)│ vrctl-agent        │ │
│                                      │ monitoring.agent   │ │
│                                      │ /rhos/etc/agent/   │ │
│                                      └──────────┬─────────┘ │
│                                                 │ HTTPS     │
└─────────────────────────────────────────────────┼───────────┘
                                                  ▼
                                         SDWAN / 云平台控制器
                                         (vrcontrol.manageip)
```

**要点：Web 控制台与 vbras 必须部署在同一台机器上。**  
分离部署会导致无法访问本机 `cli.sock`、`/usr/local/src/vrconf/`，大量页面/API 会失败。

---

## 3. 双配置体系

开发时容易混淆的两条链路：

| 维度 | Web 控制台（Paas-VRv2） | vrctl-agent（设备 `/rhos/etc/agent/`） |
|------|-------------------------|----------------------------------------|
| 仓库代码 | `server/`、`web/` | `products/vrctl-agent/`（**不随 deploy 发布**） |
| 设备路径 | `/opt/paas-vr-v2/` | `/rhos/etc/agent/` |
| 发布方式 | `npm run deploy:remote` | **人工** 更新脚本 |
| 主要配置目录 | `/usr/local/src/vrconf/` | `/rhos/etc/agent/`（含 `download/`） |
| 配置来源 | 用户在控制台表单/抽屉编辑 | 云平台下发 + 注册认证 |
| 生效方式 | API 读写字段或整文件；部分经 vbras 快照 | Lua 脚本 diff 后执行 `clish` 命令 |
| systemd 服务 | `paas-vr-v2.service` | `vrctl-agent.service` |

### 3.1 `/usr/local/src/vrconf/`（控制台侧）

| 文件 | 用途 | 控制台入口示例 |
|------|------|----------------|
| `vrcontrol.conf` | Tower / SDWAN / AI SOC 等 JSON 配置 | 设备 → 配置服务；`GET/POST /api/sys/vrcontrol` |
| `registervr.conf` | VR 身份（uuid、name、pool 等） | 接入与身份；与 agent 注册的交叉见 [`docs/ibr-identity-registration.md`](../../docs/ibr-identity-registration.md) |
| `nic_roles.conf` | 网卡角色与 IP 快照 | 设备 → 主网卡；`GET/POST /api/nic_roles_conf` |

`vrcontrol.conf` 常见字段：

- `compute_tower_base` / `tower_base` — Compute.Tower 地址
- `manageip` — SDWAN 控制器地址
- `ai_soc_base` — AI SOC 地址

### 3.2 `/rhos/etc/agent/`（agent 侧，设备现网）

| 路径 | 用途 |
|------|------|
| `download/` | 云平台下发的配置包（路由、IPsec、BGP 等 JSON） |
| `conf/` | agent 本地工作配置 |
| `auth_*`、`.regis*`、`regi*` | 认证与注册状态 |
| `vr_conf` | agent / monitoring 轮询间隔（JSON） |
| `clean` | 清理脚本（见第 5 节） |

下发配置经 `tools/lua/transfer.lua` 及各模块（`ipsec.lua`、`ipv4_routes.lua`、`acl.lua` 等）转为 CSM 命令。

---

## 4. 统一测试环境

| 项 | 值 |
|----|-----|
| 主机 | 阿里云 ECS `120.26.76.215` |
| Web 访问 | http://120.26.76.215:3000/ |
| 健康检查 | http://120.26.76.215:3000/api/public/health |
| 控制台部署目录 | `/opt/paas-vr-v2/` |
| 控制台服务 | `systemctl status paas-vr-v2.service` |
| agent 服务 | `systemctl status vrctl-agent.service` |
| SSH | `ssh root@120.26.76.215`（账号见 `scripts/deploy.config`，勿提交 Git） |

---

## 5. `products/vrctl-agent/`（不随 Console 部署）

仓库路径 **`products/vrctl-agent/`** 为 agent **源码真源**（设备 **`/rhos/etc/agent/`**）。  
ipoe 打包副本在 `products/ipoe/control-plane/etc/agent/`，用 **`products/sync-agent.ps1`** 同步。

### 5.1 核心文件

| 文件 | 作用 |
|------|------|
| `vrctl-agent.service` | systemd：`ExecStart=vrctl.init`，`ExecStopPost=vrctl.shutdown` |
| `vrctl.init` | 启动：复制 vrconf 模板；拉起 `vrctl.agent` 与三个 `monitoring.agent`（collect / send / download） |
| `vrctl.shutdown` | 停止：kill 各 agent 进程，调用 `clean` |
| `vrctl.agent` | 主代理：注册、认证、checksum、向控制器拉配置 |
| `monitoring.agent` | 监控：采集 / 上报 / 下载 NetJSON |
| `vr_conf` | 轮询间隔配置（agent.interval、monitoring.download_interval 等） |
| `vrctl.cli` | 命令行修改 `vr_conf` 中的间隔 |
| `clean` | 清理 agent 本地状态（见下） |

### 5.2 `clean` 脚本

```bash
/rhos/etc/agent/clean           # 默认：清 auth、注册信息、conf/
/rhos/etc/agent/clean all-clean # 深度清理（危险）
```

| 模式 | 行为 |
|------|------|
| **默认** | 删除 `auth_*`、`.regis*`、`regi*`、`conf/` |
| **`all-clean`** | 额外：停 `vrctl-agent`；删 `download/`、checksum；**清空** `startup-config` 并执行 `onekey_restart_ipoe`（网际路由重启） |

`vrctl.shutdown` 在正常 shutdown 时调用的是 **默认模式**，不是 `all-clean`。

**警告：** 测试机上勿随意执行 `all-clean`，会清掉云平台下发配置并重启 IPOE。

### 5.3 `tools/` 子目录

| 内容 | 说明 |
|------|------|
| `registervr.conf.temp` | 首次启动复制到 `/usr/local/src/vrconf/registervr.conf` |
| `vrcontrol.conf.temp` | 首次启动复制到 `/usr/local/src/vrconf/vrcontrol.conf` |
| `lua/*.lua` | 下发 JSON → clish 命令 |
| `transfer.lua` | 配置 diff/合并总入口 |

---

## 6. 部署与脚本（`scripts/`）

### 6.1 配置文件

| 文件 | 是否进 Git | 说明 |
|------|------------|------|
| `deploy.config.example` | 是 | 模板，不含真实密码 |
| `deploy.config` | **否**（gitignore） | 本地/CI 实际配置 |

必填项：`DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_REMOTE_DIR`、SSH 密码或密钥（二选一）。

常用可选项：

- `DEPLOY_APPLY_DEV_BYPASS=true` — 测试环境跳过 SSO，写入 `server/.env`
- `DEPLOY_SYSTEMD=true` — 注册 `paas-vr-v2.service`
- `DEPLOY_HTTP_PORT=3000`
- `DEPLOY_NODE_VERSION=22.17.0`

### 6.2 脚本一览

| 脚本 | npm 命令 | 作用 |
|------|----------|------|
| `deploy-remote.mjs` | `npm run deploy:remote` | 构建 → 打包 → SSH 上传 → 远端安装 → systemd → 开放端口 |
| `deploy.ps1` | `powershell -File scripts/deploy.ps1` | Windows 入口：检查 `deploy.config` 后调用上述命令 |
| `dev-remote-web.mjs` | `npm run dev:remote:web` | 本地只跑 web，`/api` 代理到 `deploy.config` 中的主机 |
| `install-cursor-cli-remote.mjs` | `npm run install:cursor-cli:remote` | 在远端安装 Cursor CLI |
| `probe-nic-snapshot.mjs` | （手动 `node scripts/...`） | SSH 探测 `nic_roles.conf`、cli.sock、接口地址 |
| `probe-ipsec-config.mjs` | （手动） | SSH 探测 IPsec 下发包与 `ipsec_clish_config.sh` |

### 6.3 部署流程摘要（仅 `web/` + `server/`）

**不包含 `docs/reference/`。** 部署包内容：`server/dist`、`server/package.json`、`server/node_modules`、`web/dist`。

1. 本地 `npm run build`（web + server tsc）
2. staging 安装 server 生产依赖并打 tar 包
3. SFTP 上传到 `/opt/paas-vr-v2/`
4. 远端解压、`npm install --omit=dev`
5. 可选：确保 Node 版本、写入 `SSO_DEV_BYPASS`、安装/重启 `paas-vr-v2.service`
6. 设置 `LISTEN_HOST=0.0.0.0`、放行 3000 端口

---

## 7. 本地开发模式

| 模式 | 命令 | 适用场景 |
|------|------|----------|
| 全栈本地 | `npm run dev` | Windows 可走 mock；无真实 vbras 时部分 API 报错属正常 |
| 仅前端 + 远端 API | `npm run dev:remote:web` | 改 UI，联调 120.26.76.215 上的 API |
| 构建校验 | `npm run build` | 唯一类型检查手段（无 ESLint / 自动化测试套件） |

### 7.1 本地 `server/.env`

参考 `server/.env.example`。最简单可用组合：

```env
NODE_ENV=development
SSO_DEV_BYPASS=true
```

否则前端可能停在「暂无法验证登录」。

### 7.2 无设备时的预期现象

路由、ACL、NAT、IPsec、VBRAS 等 API 会调用 `/rhos/bin/vtish` 或 `cli.sock`。  
本地无设备时：页面能打开，但 toast 报错（如 `Executable not found`）或空数据 — **不代表代码坏了**。

---

## 8. 控制台与代码对照（常用）

| 功能 | 前端页面 | 后端/API | 设备依赖 |
|------|----------|----------|----------|
| 配置服务 | `/device/service` | `/api/sys/tower`、`/sdwan`、`/aisoc/base`、`/sys/vrcontrol` | `vrcontrol.conf` |
| 主网卡 | `/device/config/set-ip` | `/api/status`、`/nic_roles_conf` | vbras + `nic_roles.conf` |
| IPsec 隧道 | `/forwarding/ipsec` | `server/src/services/forwarding/ipsec.ts` | CSM JSON → clish → **strongSwan**；ESP 在 vbras |
| 状态总览 | 仪表板 | `statusRoute.ts` | vbras 遥测 + OS 兜底 |

路径解析逻辑集中在 `server/src/vrwizard.ts` 的 `getPaths()`。

---

## 9. 基于 Lua 参考脚本的可扩展功能

云平台下发经 `transfer.lua` 编排，JSON 字段与 Lua 模块一一对应（见 `products/vrctl-agent/tools/lua/cli.lua`）。  
控制台 **不必复刻 agent 下发链路**，但可借同一 JSON 形状与 clish 命令语义，扩展 **本地运维 UI** 或 **结构化展示**。

### 9.1 Lua 模块能力总览

| Lua 模块 | 下发 JSON 键（典型） | 主要 clish 能力 |
|----------|----------------------|-----------------|
| `vrf.lua` | `vrf` | 创建/删除 VRF |
| `interfaces.lua` | `interfaces_*` / `subinterfaces_*` | 物理口/子接口、VLAN、IPv4/IPv6 地址、绑 VRF、绑 ACL、接口级 VRRP |
| `ipv4_routes.lua` | `ipv4_route` / `ipv4_routes` | 静态路由（目的、下一跳、VRF、优先级） |
| `ipv6_routes.lua` | `ipv6_route` / `ipv6_routes` | IPv6 静态路由 |
| `ip_prefix_list.lua` | `ip_prefix_list` | 前缀列表（路由策略） |
| `route_map.lua` | `route_map` | Route-map（match prefix、metric 等） |
| `segment-routing.lua` | `segment_routing_srv6` | SRv6 locator / prefix |
| `bgp.lua` | `bgp` | BGP 实例、邻居、地址族、RD/RT、network、与 SRv6/route-map 联动 |
| `vrrp.lua` | `vrrp` | VRRP 组、track gateway、实例 ID |
| `ipsec.lua` | `ipsec` | 隧道全生命周期（IKE/ESP/TS/commit/initiate/terminate） |
| `acl.lua` | `acl` | ACL 及规则（与 interfaces 清 ACL 联动） |

测试样例 JSON：`products/vrctl-agent/tools/lua/01test.json`（VRF/接口/路由/BGP/SRv6）、`02test.json`（VRRP）。

### 9.2 控制台现状 vs Lua 能力

| 能力域 | 控制台现状 | Lua/agent 已覆盖 | 缺口 |
|--------|------------|------------------|------|
| IPv4 路由 | ✅ 查/增/删（含 `vrf_id`） | ✅ | IPv6 路由页；与云下发 diff |
| ACL | ✅ 较完整 CRUD + 接口绑定 | ✅ | 与云下发 ACL 对照视图 |
| NAT | ✅ 静/S/D NAT | —（非 transfer 模块） | — |
| IPsec | ⚠️ SA 查看、connect/disconnect、守卫 | ✅ **完整创建/删除** | **隧道配置 CRUD**（P0） |
| 云配置 | ⚠️ 原始 JSON 展示 | ✅ 结构化多模块 | **按模块 Tab 解析**（P0） |
| VRF | ⚠️ 路由/NAT 带 `vrf_id` | ✅ VRF 增删 | **VRF 管理页** |
| 接口/VLAN | ⚠️ 网卡初始化、主 IP | ✅ 多类型口、子接口、多 IP、绑 ACL/VRF | **子接口/VLAN 管理** |
| BGP | ❌ | ✅ 完整（含 VPNv4/v6、RD/RT、SRv6） | **BGP 整页（先只读）** |
| VRRP | ❌ | ✅ 组 + 接口级参数 | **VRRP 页** |
| Route-map / Prefix-list | ❌ | ✅ | 只读或随 BGP 联动 |
| SRv6 | ❌ | ✅ + `netjson-monitoring --collect-srv6` | SRv6 状态/配置页 |
| Agent 运维 | ❌ | `monitoring.agent` 采集 | 注册状态、download 目录、checksum |

### 9.3 建议新增功能（按优先级）

**P0 — 与现有页面衔接、投入产出高**

1. **IPsec 隧道配置（创建/编辑/删除）**  
   - 参考 `ipsec.lua` 字段与 `/rhos/bin/ipsec_clish_config.sh`  
   - 控制台走 CSM/clish（与现有 `connect/disconnect` 一致），JSON 形状对齐云下发 `ipsec[]`  
   - UI：在「IPsec 隧道」加 Tab「隧道配置」+ 向导表单  

2. **云配置结构化展示**  
   - 解析 `/rhos/etc/agent/download/*.bak`，按 `vrf`、`bgp`、`ipsec`、`ipv4_routes` 等分 Tab  
   - 可选：与 `do show running-config` 或 netjson 采集结果 diff，标「仅平台 / 仅本地」  

**P1 — SD-WAN 常见运维**

3. **BGP 管理（第一阶段只读）**  
   - `show bgp summary` / 邻居状态 + 读云配置里的 `bgp[]`  
   - 第二阶段再考虑邻居增删（复用 `bgp.lua` 命令序列，工作量大）  

4. **VRF 列表与详情**  
   - VRF 名/ID 列表；关联路由、接口、NAT 条目过滤  

5. **IPv6 路由表**  
   - 对称于现有 IPv4 `RoutesPage`，复用 `ipv6_routes.lua` 语义  

**P2 — 高可用与接口进阶**

6. **VRRP**  
   - 组、track gateway、虚 IP；只读起步，编辑对齐 `vrrp.lua` + `interfaces` 内 VRRP 段  

7. **子接口 / VLAN**  
   - `subinterfaces_GigabitEthernet` 形态：VLAN ID、独立 IPv4/IPv6  

8. **路由策略（prefix-list / route-map）**  
   - 只读列表，为 BGP 页提供上下文  

**P3 — 进阶 / 观测**

9. **SRv6**  
   - locator、prefix；结合 `netjson-monitoring --collect-srv6`  

10. **Agent / 下发状态**  
    - 注册是否完成、最近 download 包、checksum、与 `vrctl.cli --show-conf` 间隔  

11. **监控大屏增强**  
    - 复用 `netjson-monitoring` 的 interfaces / routes / ipsec / gateway 采集，补仪表板 widget  

### 9.4 实现路径说明

| 方式 | 适用 | 说明 |
|------|------|------|
| **A. clish / CSM 直调** | 路由、ACL、NAT、IPsec | 与现 `server/src/services/forwarding/*` 一致，**推荐** |
| **B. 读云配置 .bak** | 云配置页、BGP/IPsec 只读 | `getForwardingAgentConfig()` 已有基础 |
| **C. 调 Lua transfer** | 一般不推荐 | 控制台不应替代 agent 下发；本地手工改配用 A 即可 |
| **D. netjson 采集** | 状态/dashboard | 读 agent `conf/` 下采集结果或封装 shell 调用 |

**注意：** 控制台本地改配与云平台下发可能冲突；UI 上应区分「平台托管项」与「本地运维项」，必要时提示 checksum / 重新下发风险。

---

## 10. 安全与运维约定

1. **勿提交** `scripts/deploy.config`、真实 SSH 密码、`server/.env`。
2. **`deploy.config.example`** 只留占位符，不写真实凭据。
3. 测试机已开 `SSO_DEV_BYPASS` 时，勿当作生产安全模型。
4. 设备上执行 `clean all-clean` 或清空 `download/` 前，确认影响范围。
5. 控制台改 `vrcontrol.conf` 不会自动替 agent 清 checksum；与云平台下发冲突时需人工排查。

---

## 11. 相关文档索引

| 文档 | 内容 |
|------|------|
| [`AGENTS.md`](../AGENTS.md) | Cursor Agent 项目约定 |
| [`scripts/test.md`](../scripts/test.md) | 测试环境速查表 |
| [`scripts/deploy.config.example`](../scripts/deploy.config.example) | 部署配置模板 |
| [`products/README.md`](../products/README.md) | 四份产品源码索引 |
| [`docs/reference/architecture.md`](reference/architecture.md) | 上下游整体架构 |
| [`products/vrctl-agent/`](../../products/vrctl-agent/) | vrctl-agent 源码 |
| 本文档 | 架构、双配置、部署脚本知识库 |

---

## 12. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-06-11 | 初版：汇总 agent、scripts、vrconf、同机架构与开发模式 |
| 2026-06-11 | 明确 agent 参考代码不随 deploy 发布，设备侧由人工维护 |
| 2026-06-11 | `products/` 纳入 `.gitignore`，平台源码仅本地、不上 GitHub |
| 2026-06-11 | 新增 §9：基于 Lua 参考脚本的可扩展功能路线图 |
