# SRv6 隧道管理 PRD

## 列表与操作菜单
- 操作：查看拓扑、更新 SRv6 配置（进入更新页面并回显隧道数据）、健康巡检、删除隧道。

## 创建向导
- 页面布局：`步骤条 | 步骤内容 | 配置 JSON 预览`。
- 步骤：
  1. 选择模式：标准模式 / 高可用模式（待设计）。
  2. 选择 PE：选择对端 PE。
  3. 选择 CE：选择对端 CE。
 - 入口：在“SRv6 隧道管理”列表点击“创建 SRv6 隧道”，进入拓扑界面与向导页。

## 伪代码说明（PE+CE 互联）
- 交互：
  - 选择 CE-A（关联 PE-A 内网口）；选择 CE-B（关联 PE-B 内网口）。
- JSON 拼接：
  - 在 PE 的 `interfaces` 下插入 IPv6 路由信息：`vrf/destination/via`；`via` 为对端公网 IP。
  - 在 PE 的 `bgp.asn.neighbor` 中插入 CE 公网 IP 与 CE bgp asn；生成 `route_distinguisher`（互不相同）与统一的 `route_target`。
  - 在 CE 的 `bgp.neighbor` 中插入 PE 内网口 IP 与 asn；同步 `route_distinguisher/route_target`。
 - 细节：PE 的第一个 `asn` 用于公网自治域互联；客户侧 CE 互联使用后续 `asn` 结构体；按所选内网口定位 VRF 对应的 `bgp.asn` 组。

### 拼接示例（PE-A 与 CE-A）
```
"ipv6_route": [
  { "vrf": 9999, "destination": "2408:4444:1002::/64", "via": "500::1" }
],
"bgp": [
  { "asn": 900, "vrf": 9999, "router_id": "130.1.1.1", "bgp_ebgp_requires_policy": "disable",
    "neighbor": [
      { "remote_ip": "130.1.1.9", "remote_as": 400 },
      { "route_distinguisher": "200:11", "route_target": "200:200" }
    ]
  }
]
```

### CE 侧插入示例（CE-A）
```
"bgp": [
  { "bgp_ebgp_requires_policy": "disable",
    "neighbor_disable_connected_check": [ "130.1.1.2" ],
    "neighbor": [
      { "remote_ip": "130.1.1.2", "remote_as": 100 },
      { "route_distinguisher": "200:11", "route_target": "200:200" }
    ]
  }
]
```

## 伪代码说明（PE+PE 互联）
- 交互：选择 PE-A 与 PE-B。
- JSON 拼接：
  - 在第一个 `asn`（公网自治域）中，插入 `neighbor_disable_connected_check` 与 `neighbor`（对端公网 IP、对端 asn）。
  - 地址族：`ipv6`（unicast，激活对端公网 IP，network 关联互联 IPv6 网段）；`ipv4`（vpn，激活对端公网 IP）。
 - 细节：若第一个 `asn` 已有既有互通配置，不要覆盖；只追加与新对端的互连参数。

### 拼接示例（PE-A 与 PE-B）
```
"neighbor_disable_connected_check": [ "500::1" ],
"neighbor": [ { "remote_ip": "500::1", "remote_as": 100 } ],
"address_family": [
  { "address_family": "ipv6", "modifiler": "unicast",
    "activate_address_family": [ "500::1" ],
    "network": [ "500::0/64" ]
  },
  { "address_family": "ipv4", "modifiler": "vpn",
    "activate_address_family": [ "500::1" ]
  }
]
```

## 背景与目标
- 通过 SRv6 段路由在多 VR/PE 节点之间建立隧道，支持标准和高可用模式；提供可视化创建与更新流程，并与 VR 实例管理互相联动。

## 功能概览
- 隧道列表：显示名称、端点、状态、模式、创建时间；支持删除与健康巡检。
- 创建/更新向导：分步选择端点与模式，实时生成并预览配置 JSON；支持更新已存在隧道的参数。
- 与 VR 管理联动：在 VR 角色设置与专家模式中，SRv6 `locator/prefix` 作为 PE 公网配置的一部分进行维护。
- 与 IPSec 关联：IPSec 页面支持“SRv6 叠加”类型的记录显示与管理。

## 页面与导航
- 创建/更新向导：步骤导航与标题联动，右侧展示配置 JSON 预览；与“向导页面规范”一致。
- 列表页：支持刷新与筛选；操作区包含更新/巡检/删除。

## 数据与接口
- 远端控制器（规划）：SRv6 隧道的创建/更新接口与状态查询（待集成）。
- 平台前端关联：
  - VR 管理（PE 公网配置）：`segment_routing_srv6.locator/prefix` 与 BGP/路由同屏维护，参考 `frontend/src/pages/Networks/VR/RoleWizard.tsx`:7。
  - IPSec 列表：包含 `type === 'srv6'` 记录的展示，参考 `frontend/src/pages/Networks/IPSec/index.tsx`:84。
- 平台后端：当前未提供 SRv6 专用路由；与 VR 配置后端分离设计，后续按接口落地。

## 验收与测试
- 向导：按步骤选择端点与模式，预览生成的 JSON 结构与关键字段（PE/CE BGP 邻居、`route_distinguisher/route_target`、IPv6 路由等）。
- 更新：对已有隧道的更新不覆盖既有互通配置，仅追加与新对端的互连参数。
- 健康巡检：触发后能显示最近一次巡检结果与时间（占位，待接口实现）。

## 约束与错误处理
- 互通策略：第一个 `asn` 保留公网自治域互联；CE 互联使用后续 `asn` 结构体。
- 覆盖策略：在追加场景下不覆盖已有邻居与地址族配置；仅增量合并。
- 校验：选择端点与 VRF、邻居时需进行基本校验（IPv6 必填、`route_distinguisher` 唯一）。

## 参考
- 组件设计（向导页面）：`docs/guides/wizard.md`
- VR 实例管理：`docs/prd/interconnect/vr-instance.md`
 - 历史来源（已合并）：
   - `PRD/3. 跨地域互联/2. SRv6隧道管理/SRv6隧道创建向导RPD.txt`
   - `PRD/3. 跨地域互联/2. SRv6隧道管理/SRv6隧道管理PRD.txt`
   - `PRD/3. 跨地域互联/2. SRv6隧道管理/srv6-PE+CE 伪代码.md`
   - `PRD/3. 跨地域互联/2. SRv6隧道管理/srv6-PE+PE  伪代码.md`