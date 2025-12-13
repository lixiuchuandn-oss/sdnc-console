# VR 实例管理 PRD

## 专家模式（原编辑 VR 配置）

### 功能1：查询现有配置
- 通过 API 文档的“VR 配置查询”端点获取当前配置。

### 功能2：VR 配置模板
- 为每个 VR 实例默认创建一个配置模板；初始内容取自“VR 配置编辑”请求样例（仅保留标识符与结构）。
- 请求样例中的每个标识符独立文本框显示，可设定是否启用；未启用的标识符在 JSON 拼接预览中折叠并隐藏。

## 标准模式 配置要点






## CE 配置要点
### 外网配置（CE → PE）
- 交互：选择外网口网卡；填写 IPv4/IPv6（IPv6 必填）；设定 BGP `asn/router_id`。
- JSON 拼接示例：
```
"interfaces_GigabitEthernet": [
  { "name": "GigabitEthernet 0/3/0", "ipv4_static": "", "ipv6_static": "", "status": "up" }
],
"bgp": [
  { "asn": 100, "router_id": "200.1.1.2", "bgp_ebgp_requires_policy": "disable" }
]
```

### 内网配置（CE → 本地）
- 交互：选择内网口网卡；填写 IPv4/IPv6（IPv6 必填）。
- JSON 拼接示例：
```
"interfaces_GigabitEthernet": [
  { "name": "GigabitEthernet 0/3/0", "ipv4_static": "", "ipv6_static": "", "status": "up" }
]
```

## PE 配置要点
### 公网配置（PE → PE）
- 交互：设定 SRv6 `locator/prefix`；选择公网口网卡；可选配置静态路由；设定 BGP 基础参数与待发布网段。
- JSON 拼接示例：
```
"segment_routing_srv6": { "locator": "pe2", "prefix": "2408:3333:1002::1" },
"interfaces_GigabitEthernet": [
  { "name": "GigabitEthernet 0/3/0", "ipv4_static": "", "ipv6_static": "", "status": "up" }
],
"ipv4_route": [
  { "destination": "0.0.0.0/24", "dev": "GigabitEthernet 0/9/1", "priority": 100 }
],
"bgp": [
  { "asn": 100, "router_id": "200.1.1.2", "bgp_ebgp_requires_policy": "disable", "timer_bgp_KA": 2, "timer_bgp_HA": 8, "bgp_fast_convergence": "enable", "segment_routing_srv6": { "locator": "pe2" } }
]
```

### 内网配置（PE → CE）
- 交互：支持多组“内网口 + VRF + BGP”；每组选定网卡与 IPv4/IPv6（IPv6 必填），并在接口中绑定 `vrf`；同步维护 `vrf` 列表与对应 BGP 地址族。
- JSON 拼接示例：
```
"interfaces_GigabitEthernet": [
  { "name": "GigabitEthernet 0/3/0", "ipv4_static": "", "ipv6_static": "", "vrf": 9999, "status": "up" },
  { "name": "GigabitEthernet 0/3/1", "ipv4_static": "", "ipv6_static": "", "vrf": 9989, "status": "up" }
],
"vrf": [9999, 9989],
"bgp": [
  { "asn": 100, "vrf": 9999, "router_id": "130.1.1.1", "bgp_ebgp_requires_policy": "disable", "address_family": [ { "address_family": "ipv4", "modifiler": "unicast", "export_route": "enable", "import_route": "enable", "auto_assign_sid": "enable" } ] },
  { "asn": 200, "vrf": 9989, "router_id": "130.1.1.2", "bgp_ebgp_requires_policy": "disable", "address_family": [ { "address_family": "ipv4", "modifiler": "unicast", "export_route": "enable", "import_route": "enable", "auto_assign_sid": "enable" } ] }
]
```

## 交叉参考
- API：VR 实例注册、配置查询与编辑（`docs/api/vr.md`）。
- SRv6：隧道创建与更新逻辑（`docs/prd/interconnect/srv6-tunnel.md`）。
- 历史来源（已合并）：
  - `PRD/3. 跨地域互联/1. VR实例管理/vr-CE.md`
  - `PRD/3. 跨地域互联/1. VR实例管理/vr-PE公网口.md`
  - `PRD/3. 跨地域互联/1. VR实例管理/vr-PE内网口.md`

-## 参考
- API 通信规约与认证：`docs/api/communication.md`
- 相关接口：VR 实例注册、VR 配置查询、VR 配置编辑（见上述 API 文档）
- 设计综述：`docs/design/capability-driven-ui.md`
- Provider：`docs/providers/aliyun.md`、`docs/providers/huaweicloud.md`、`docs/providers/tencentcloud.md`
## 背景与目标
- 管理 VR 实例的角色、配置与下发，支撑跨地域互联与信息域绑定；提供专家模式与向导两种编辑体验；具备版本留存与回溯。

## 功能概览
- VR 列表与选择：分页获取 VR 实例；在相关向导页中支持搜索与下拉选择。
- 角色设置向导：按 PE/CE 场景分步配置公网/内网/BGP/SRv6 参数，支持多组内网配置。
- 专家模式：按标识符拆分的模板编辑、启用/禁用配置点、合并预览与下发。
- 版本管理：每个角色最多保留 5 个配置版本；支持查看与回滚。
- 关联使用：信息域向导绑定现有 VR 或自动部署；IPSec 列表支持选择 VR 作为端点。

## 页面与导航
- VR 专家模式：步骤导航（查询现有配置/配置模板/合并预览与下发），页面标题与左侧步骤联动。
- VR 角色设置向导：步骤导航（选择角色/角色参数配置/预览与保存），同“向导页面规范”。
- 信息域向导中的 VR 绑定：在“设定信息域”步骤按模式展示 VR 选择或自动部署。

## 角色设置向导（PE/CE）
- 第一步：选择角色（PE/CE/标准/SASE）。
- 第二步：
  - PE 公网配置：SRv6 `locator/prefix`、公网口接口与静态路由、BGP 基础参数与发布网段；预览 JSON。
  - PE 内网配置：支持多组“内网口+VRF+BGP”，接口绑定 `vrf`，同步维护 `vrf[]` 与 BGP 地址族；预览 JSON。
  - CE 配置：外网口 IPv4/IPv6（IPv6 必填）、BGP `asn/router_id`；本地内网口 IPv4/IPv6；预览 JSON。
- 第三步：预览与保存/下发；可选择保存为新版本并限制版本数为 5。

## 专家模式（模板分段）
- 分段编辑：`vrf/acl/ipsec/nat_address_group/interfaces_* /subinterfaces_* /ipv4_route/ipv6_route/segment_routing_srv6/bgp/vrrp` 等键按段编辑。
- 启用/禁用：每段可单独启用；未启用段不参与合并预览与下发。
- 查询现有配置：通过签名后的远端查询接口回显；支持清理与重试。

## 数据与接口
- 远端 VR 控制器（通过代理签名）：
  - `GET /V2/ctcontrol/VR1/pagelist`：分页获取 VR 实例列表。
  - `GET /V2/ctcontrol/VR2/VRConfig?uuid=<uuid>`：按 `uuid` 查询现有 VR 配置。
- 平台后端（本地持久化与管理）：
  - `POST /api/vr-config/upsert`：保存/更新 VR 配置（按 `uuid`）。
  - `GET /api/vr-config/:uuid`：获取 VR 配置（平台持久化数据）。
  - `POST /api/vr-config/set-role`：设置 VR 角色（`PE/CE/标准/SASE`）。
  - `GET /api/vr-config/roles?uuids=<...>`：批量获取角色映射。
  - `GET /api/vr-config/version/list?uuid=&role=`：列出最近 5 个版本。
  - `POST /api/vr-config/version/save`：保存新版本（超过 5 删除最旧）。
  - `GET /api/vr-config/version/get/:id`：获取指定版本配置。
  - `GET /api/vr-cache/pagelist?page_size=&page_num=`：读取缓存的 VR 列表。
- 实现参考：
  - 前端专家模式页面：`frontend/src/pages/Networks/VR/EditVRConfig.tsx`:888
  - 前端角色设置向导：`frontend/src/pages/Networks/VR/RoleWizard.tsx`:7
  - 信息域向导 VR 绑定：`frontend/src/pages/Networks/InfoDomain/Wizard.tsx`:357
  - 后端配置接口：`backend/src/routes/vrConfig.ts`:1、44、86
  - 后端版本接口：`backend/src/routes/vrConfigVersion.ts`:7、24、45
  - 后端 VR 列表缓存：`backend/src/routes/vrCache.ts`:65、94

## 验收与测试
- 列表与绑定：在信息域向导中能加载到 VR 列表，下拉搜索可用，选择后确认页回显 `uuid` 前缀与名称。
- 角色设置：PE/CE 向导按步骤填写后能生成预览 JSON；保存成功并在版本列表中出现；超过 5 自动裁剪。
- 专家模式：能查询远端配置并回显；每段启用状态正确；合并预览与下发不包含未启用段。
- 版本回溯：能查看版本详情并回滚到指定版本；版本列表按时间倒序。

## 约束与错误码
- 认证：远端接口使用签名生成的 `Authorization/tonce`；平台接口使用 `Bearer` 令牌。
- 失败处理：远端签名或查询失败显示错误提示；平台保存失败返回错误并不影响已保存版本。
- 版本上限：每角色最多 5 个版本，保存新版本时自动删除最旧。

## 参考
- API 通信规约与认证：`docs/api/communication.md`
- 相关接口：VR 实例注册、VR 配置查询、VR 配置编辑（见上述 API 文档）
- 设计综述：`docs/design/capability-driven-ui.md`
- Provider：`docs/providers/aliyun.md`、`docs/providers/huaweicloud.md`、`docs/providers/tencentcloud.md`