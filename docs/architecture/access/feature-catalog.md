# 平台功能目录结构

本文基于前端导航与功能目录配置（`frontend/src/catalogs/navCatalog.ts` 中的 `ROUTE_CATALOG`）整理当前平台的功能目录结构，按“平台 → 分组 → 功能前缀”组织。

---

## CNMC - 多云管理

### 分组：资源控制台

 - `ops.dashboard`  
   - 名称：仪表盘  
   - 后端接口：
     - `GET /api/dashboard/stats`：获取云资源池数量、用户数量等总体统计，用于仪表盘总览卡片
     - `GET /api/dashboard/recent-activities`：获取最近云资源变更、用户登录等操作记录，用于活动时间线
     - `GET /api/dashboard/cloud-usage`：按中心云/边缘云汇总 CPU、内存、存储使用率，用于容量与健康度看板
- `clouds`  
  - 名称：资源池管理  
  - 后端接口：
    - `GET /api/clouds`：查询已接入的所有云资源池列表，用于资源池总览
    - `POST /api/clouds`：创建新的云资源池并保存接入信息，用于资源池接入向导
    - `PUT /api/clouds/:id`：修改云资源池名称、标签、接入配置等，用于编辑已有资源池
    - `DELETE /api/clouds/:id`：删除云资源池配置记录，用于下线不再使用的资源池
    - `POST /api/clouds/test-connection`：在创建时测试云账号连通性，用于表单上的“测试连接”
    - `POST /api/clouds/:id/test`：对已有资源池重测连通性，用于排查连接异常
- `clouds.instances`  
 - 名称：云主机  
  - 后端接口：
    - `GET /api/clouds/resources/ecs-all`：按统一视图列出所有云主机，用于多云汇总清单
    - `GET /api/clouds/:id/resources/ecs`：按单个资源池列出云主机，并支持详情、启停等操作
    - `GET /api/clouds/:id/resources/ecs/:instanceId/vnc-url`：获取厂商远程控制台地址（阿里云/华为云），用于 WebVNC 打开实例控制台
    - `GET /api/clouds/:id/resources/harvester/vms/:namespace/:name/vnc-url`：获取 Harvester 实例的 VNC 地址，用于通过 WebSocket 代理连接控制台
    - `POST /api/clouds/:id/resources/ecs/:instanceId/start`：启动实例（阿里云/华为云/Harvester），用于生命周期管理
    - `POST /api/clouds/:id/resources/ecs/:instanceId/stop`：停止实例（支持强制停止；阿里云/华为云/Harvester），用于生命周期管理
    - `POST /api/clouds/:id/resources/ecs/:instanceId/reboot`：重启实例（支持强制重启；阿里云/华为云/Harvester），用于生命周期管理
    - `DELETE /api/clouds/:id/resources/ecs/:instanceId`：删除实例（阿里云/Harvester），用于释放不再使用的计算资源
    - `GET /api/clouds/:id/resources/ecs/:instanceId/metrics`：获取实例监控指标（CPU、内存等；阿里云/华为云），用于性能与健康度分析
    - `GET /api/clouds/:id/resources/ecs/:instanceId/history-events`：查询阿里云实例历史事件，用于变更与故障定位
    - `GET /api/clouds/:id/resources/ecs/:instanceId/audit-logs`：查询华为云实例审计要素，用于审计追踪
    - `GET /api/clouds/:id/resources/ecs/:instanceId/audit-traces`：查询华为云 CTS 审计轨迹，用于操作合规与溯源
    - `GET /api/clouds/:id/resources/ecs/stream`：实例清单实时事件流（SSE），用于页面实时刷新与状态变更订阅
- `clouds.vpcs`  
 - 名称：VPC  
  - 后端接口：
    - `GET /api/clouds/:id/resources/vpcs`：查询指定云资源池下的 VPC 列表，用于 VPC 清单
    - `POST /api/clouds/:id/resources/vpcs`：在指定资源池创建 VPC，用于多云 VPC 统一开通入口
    - `PATCH /api/clouds/:id/resources/vpcs/:vpcId`：修改 VPC 名称、网段等属性，用于配置调整
    - `DELETE /api/clouds/:id/resources/vpcs/:vpcId`：删除 VPC，用于回收不再使用的网络
    - `GET /api/clouds/:id/resources/vpcs/:vpcId`：查询 VPC 详情（华为云），用于精确查看配置信息与联动操作
- `clouds.route-tables`  
  - 名称：路由表  
  - 后端接口：
    - `GET /api/clouds/:id/resources/route-tables`：查询云上的路由表列表，用于路由表清单与详情
    - `POST /api/clouds/:id/resources/route-tables`：创建路由表，用于新建自定义路由表
    - `DELETE /api/clouds/:id/resources/route-tables/:routeTableId`：删除路由表，用于清理不再使用的路由表
- `clouds.eips`  
  - 名称：弹性公网IP  
  - 后端接口：
    - `GET /api/clouds/:id/resources/eips`：查询指定资源池下的 EIP 列表，用于公网 IP 管理
- `clouds.disks`  
  - 名称：云盘  
  - 后端接口：
    - `GET /api/clouds/:id/resources/disks`：查询云盘列表及容量信息，用于云盘清单与容量分析
- `clouds.security-groups`  
  - 名称：安全组  
  - 后端接口：
    - `GET /api/clouds/:id/resources/security-groups`：查询安全组列表及规则摘要，用于安全组清单
    - 规则增删改接口：按云厂商适配 Ingress/Egress 规则操作，用于安全策略下发
- `clouds.load-balancers`  
  - 名称：负载均衡  
  - 后端接口：
    - `GET /api/clouds/:id/resources/loadbalancers`：查询负载均衡实例列表，用于多云负载均衡可视化管理
- `clouds.images`  
  - 名称：镜像  
  - 后端接口：规划中（当前阶段以云主机视角加载镜像信息，不单独暴露列表接口）
- `clouds.vswitches`  
  - 名称：交换机  
  - 后端接口：
    - `GET /api/clouds/:id/resources/vswitches`：查询 VSwitch/子网列表，用于子网拓扑与 IP 规划
- `clouds.enis`  
  - 名称：弹性网卡  
  - 后端接口：
    - `GET /api/clouds/:id/resources/enis`：查询 ENI 列表及绑定关系，用于排查多网卡接入流量
- `clouds.network-acls`  
  - 名称：网络ACL  
  - 后端接口：
    - `GET /api/clouds/:id/resources/network-acls`：查询网络 ACL 及规则，用于子网级访问控制审计
- `clouds.snapshots`  
  - 名称：快照  
  - 后端接口：
    - `GET /api/clouds/:id/resources/snapshots`：查询快照列表，用于备份与回滚策略梳理
- `clouds.route-entries`  
  - 名称：路由条目  
  - 后端接口：
    - `GET /api/clouds/:id/resources/route-entries`：查询路由表中的路由条目，用于路由可视化与排障
    - `POST /api/clouds/:id/resources/route-entries`：新增路由条目，用于下发多云路由策略
    - `PATCH /api/clouds/:id/resources/route-entries`：修改现有路由条目，用于变更下一跳等参数
    - `DELETE /api/clouds/:id/resources/route-entries`：删除路由条目，用于清理不再需要的路由
- `clouds.nat-gateways`  
  - 名称：NAT网关  
  - 后端接口：
    - `GET /api/clouds/:id/resources/nat-gateways`：查询 NAT 网关及绑定公网 IP，用于南北向出入口管理

### 分组：租户管理

- `tenants`  
  - 名称：租户管理  
  - 后端接口：`GET /api/tenants`，`POST /api/tenants`，`GET/PUT/DELETE /api/tenants/:id`，`GET /api/tenants/:id/organizations` 等
- `tenants.leased-lines`  
  - 名称：租户专线管理  
  - 后端接口：`GET /api/leased-lines`，`POST /api/leased-lines`，`POST /api/leased-lines/batch`，`PATCH /api/leased-lines/:id`，`DELETE /api/leased-lines/:id`
- `tenants.users`  
  - 名称：子用户管理  
  - 后端接口：`GET /api/users/tenant-users`，`GET /api/tenants/:tenantId/organizations/:orgId/users`，`POST /api/tenants/:tenantId/organizations/:orgId/users`，`DELETE /api/tenants/:tenantId/organizations/:orgId/users/:userId`

### 分组：权限管控

- `access`  
  - 名称：权限管控  
  - 后端接口：规划中（本阶段主要依赖现有用户、系统与权限检查逻辑）
- `access.policies`  
  - 名称：策略管理  
  - 后端接口：规划中（按 PRD 设计将提供策略 CRUD 与绑定接口）
- `access.roles`  
  - 名称：角色管理  
  - 后端接口：规划中（按 PRD 设计将提供角色 CRUD 与授权接口）
- `access.users`  
  - 名称：用户管理  
  - 后端接口：`GET /api/users`（列表），`POST /api/users`（创建系统用户），`PUT /api/users/:id/status`（状态变更），`GET /api/users/me`（个人信息）
- `access.actions`  
  - 名称：权限原子  
  - 后端接口：规划中（后续将提供权限原子扫描结果查询接口）

---

## SDNCC - SDN 管理

### 分组：跨地域互联

- `networks.vr-config`  
  - 名称：VR实例管理  
  - 后端接口：`GET /api/vr-config/pagelist`（控制器 VR 列表），`POST /api/vr-config/upsert`（保存/更新 VR 配置），`POST /api/vr-config/set-role`（设置 VR 角色），`GET /api/vr-config/roles`（查询 VR 角色），`GET /api/vr-config/:uuid`（获取 VR 配置）；版本管理：`GET /api/vr-config/version/version/list`，`GET /api/vr-config/version/version/get/:id`，`POST /api/vr-config/version/version/save`；前端缓存：`POST /api/vr-cache/upsert`，`GET /api/vr-cache/pagelist`
- `networks.cen.attachments`  
  - 名称：CEN连接  
  - 后端接口：`GET /api/cens/:id/attachments`，`POST /api/cens/:id/attachments`，`DELETE /api/cens/:id/attachments/:attId`
 - `networks.srv6`  
147→  - 名称：SRv6隧道管理  
148→  - 后端接口：`GET /api/networks/srv6`，`POST /api/networks/srv6`，`GET /api/networks/srv6/:id`，`DELETE /api/networks/srv6/:id`
149→- `networks.ipsec`  
150→  - 名称：IPsecVPN管理  
151→  - 后端接口：`GET /api/networks/ipsec`，`GET /api/networks/ipsec/device`，`POST /api/networks/ipsec`，`DELETE /api/networks/ipsec/:id`
- `networks.route-tables`  
  - 名称：路由表  
  - 后端接口：见安全域与 VR 相关接口（如 `/api/security-domains`、`/api/vr-config`），后续视具体设计补充独立路由表管理接口
- `networks.vswitches`  
  - 名称：交换机  
  - 后端接口：与 VR/VPC 相关接口复用（当前未单独暴露 `/api/networks/vswitches`）
158→- `networks.acl`  
159→  - 名称：网络ACL  
160→  - 后端接口：`GET /api/networks/acl`，`POST /api/networks/acl`，`DELETE /api/networks/acl/:id`
161→- `networks.nat`  
162→  - 名称：NAT管理  
163→  - 后端接口：`GET /api/networks/nat`，`POST /api/networks/nat`，`DELETE /api/networks/nat/:id`

### 分组：安全管理面

- `networks.cen`  
  - 名称：级联通道管理  
  - 后端接口：`GET /api/cens`，`POST /api/cens`，`PATCH /api/cens/:id`，`DELETE /api/cens/:id`
- `networks.security-domain`  
  - 名称：安全域管理  
  - 后端接口：`GET /api/security-domains`，`POST /api/security-domains`，`GET /api/security-domains/:id`，`PATCH /api/security-domains/:id`，`DELETE /api/security-domains/:id`
- `security.services`  
  - 名称：应用管理  
  - 后端接口：`GET /api/services`，`POST /api/services`，`PATCH /api/services/:id`，`DELETE /api/services/:id`

### 分组：流量编排

- `security.traffic.security-zones`
  - 名称：安全区域管理
  - 后端接口：`GET /api/security/traffic/security-zones`，`POST /api/security/traffic/security-zones`，`PATCH /api/security/traffic/security-zones/:id`，`DELETE /api/security/traffic/security-zones/:id`
- `security.traffic.protected-objects`
  - 名称：引流对象管理  
  - 后端接口：`GET /api/security/traffic/protection-objects`，`POST /api/security/traffic/protection-objects`，`PATCH /api/security/traffic/protection-objects/:id`，`DELETE /api/security/traffic/protection-objects/:id`
- `security.traffic.service-chains`  
  - 名称：服务链编排  
  - 后端接口：`GET /api/security/traffic/service-chains`，`POST /api/security/traffic/service-chains`，`PATCH /api/security/traffic/service-chains/:id`，`DELETE /api/security/traffic/service-chains/:id`
- `security.traffic.policies`  
  - 名称：引流策略管理  
  - 后端接口：规划中（后续将补充 `/api/security/traffic` 下的策略编排接口）

---

## CNSOC - AI SOC 中心

当前在统一功能目录（`ROUTE_CATALOG`）中尚未定义具体前缀项，后续 SOC 相关功能接入时，可按相同规则补充前缀、名称、分组与平台信息。

