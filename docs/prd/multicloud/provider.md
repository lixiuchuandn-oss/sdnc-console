# 多云 Provider 需求设计与命名规范

## Provider 需求设计概览

### 定义

- Provider 用于描述“某一云厂商或资源池类型”的接入实现，是多云能力层与各厂商 API 之间的适配层。
- 业务和权限只面向统一的资源类型前缀（如 `clouds.instances`、`clouds.vpcs`），不直接关心具体 Provider；Provider 负责把不同厂商的数据与能力映射到统一模型。

### 目标

- 提供统一的资源视图：在云资源控制台等页面中，以“云主机/VPC/EIP/磁盘/ENI”等统一概念展示多云资源。
- 封装差异：将各厂商在 API、数据结构、能力上的差异封装在 Provider 内部，上层通过统一字段与 `capabilities` 访问。
- 降低耦合：新增或调整某个 Provider 时，不影响统一的功能目录、权限原子与大多数前端页面。

### 能力范围

- 至少覆盖以下资源类型（按需扩展）：
  - 计算：云主机实例（instances）。
  - 网络：VPC/虚拟网络、子网/交换机、弹性网卡、EIP、公网网关、路由表与路由条目、网络 ACL。
  - 存储：云盘与快照。
- 能力对象 `capabilities` 用于声明 Provider 在某类资源上的支持情况，例如：
  - `compute.instanceType`、`compute.zone`
  - `network.vpc`、`network.subnet`、`network.eni`、`network.eip`、`network.routeTable`
  - `storage.disk`、`storage.snapshot`

### 生命周期与职责

- 注册与标识：
  - 在创建云资源池记录时，由前端向导选择 Provider 卡片，其 `id` 写入 `Cloud.config.provider`。
  - Provider 标识在资源池生命周期内保持不变，用于后续路由与能力分发。
- 连接与健康检查：
  - 提供连接测试接口（如 `/test`），校验认证信息、区域配置等。
  - 在资源池详情页展示 Provider 的状态与错误信息。
- 资源查询与聚合：
  - 为统一资源模型提供列表与详情查询接口（例如云主机、VPC 等），并返回统一字段 + `capabilities`。
  - 支持后台库存表或聚合接口（如 `/resources/ecs-all`）构建多云汇总视图。
- 操作与变更：
  - 对支持写操作的 Provider，提供启动/停止/重启/删除等操作接口，并以统一错误语义反馈给上层。

### 与权限和功能目录的关系

- Provider 不直接参与权限判定，权限通过统一的权限原子完成，例如：
  - `clouds.instances:read`：查看云主机列表和详情。
  - `clouds.instances:write`：创建、修改、删除云主机。
- Provider 只负责：
  - 在被授权的前提下，按统一接口契约提供数据与操作能力。
  - 确保不同 Provider 的行为在同一前缀下语义一致（例如 `:read` 不做变更，`:write` 为变更型操作）。

---

## 命名原则
- 全小写英文，不使用空格；多词用连字符连接
- 家族/系列用统一前缀分组：如 cloudmap-*
- 采用官方英文品牌合并写法：aliyun、huaweicloud、tencentcloud、aws、azure、google
- 避免中文或拼音；如需本地化仅在展示层处理，不影响 provider 标识
- 安全资源池统一使用 cloudmap-security（废弃 csm）

## 已接入（后端有实现）
- 公有云
  - aliyun
  - huaweicloud
私有云
  - cloudmap.private
- 边缘计算
  - cloudmap.edge
- 虚拟化
  - harvester
- 安全资源池
  - cloudmap.csm

说明：
- cloudmap.private / cloudmap.edge 走 Harvester 风格资源查询
- cloudmap.csm 走 CSM 专用安全路由与数据模型

## 展示/规划中（仅前端映射，后端未完全集成或暂未正式开放）
- aws, azure, google, ucloud, tencentcloud
- tianyi, yidong
- vmware, openstack, dstack, zstack, feitiancloud, rancher, kvm
- s3, ceph
- sky, builtinprivate
- parallel_file_storage

备注：
- 此类 provider 目前主要用于 UI 显示或占位，需按需补齐后端能力

## 安全资源池说明
- 规范标识：cloudmap-security
- 历史别名：csm（已废弃，需全面移除）
- 写入时机：创建资源池时由前端选择卡片，其 id 作为 config.provider 持久化

## 重命名建议（统一规范）
- parallel_file_storage → storage-pfs（更符合类别-品牌语义）
- builtinprivate → private-builtin（前缀表达类别，更一致）
- 家族归类：统一使用 cloudmap-*（private/edge/security 等）
- 仅展示项建议逐步统一为官方英文：如 tianyi → ctyun（待确认）、yidong → ecloud 或 cmcloud（待确认）

## 整改清单（待执行）
- 移除所有代码中的 `csm` 判断与映射，统一为 `cloudmap-security`
- 统一 Dashboard/Console/CloudDetail 等前端组件的 provider 分支
- 后端查询与库存 API（clouds.ts 等）去除 `csm` 分支，仅保留 `cloudmap-security`
- 规范化展示/规划中 provider 的映射清单，避免与“已接入”混淆
- 评审并确认 parallel_file_storage 等命名是否重命名为类别前缀（storage-*）

## 约束与约定
- provider 在创建时确定并保存；不建议后续变更
- 安全相关路由仅接受 `cloudmap-security`，任何变体不予通过
- 新增 provider 时需同时：
  - 定义后端连接测试与资源查询路由
  - 前端展示映射与向导表单
  - 文档补充规范条目

---

## 各 Provider 详细说明

本节对当前已接入的主要 Provider 按统一结构进行说明：关系与原则、能力映射、数据与接口适配、前端消费方式、注意事项与测试建议。

### 阿里云（aliyun）

- 关系与原则：
  - 作为公有云 Provider 接入多云资源适配层，遵循统一能力 Schema、命名规范与适配契约。
  - 前端只消费能力对象 `capabilities`，不写死“阿里云专属分支”，统一视为支持云主机/VPC/EIP 等能力的一个 Provider。
- 能力映射（当前实现）：
  - 计算：
    - `compute.instanceType=true`：支持展示实例规格。
    - `compute.zone=true`：支持展示可用区。
  - 网络：
    - `network.vpc=true`：支持 VPC 列表与详情。
    - `network.subnet=true`：支持子网/交换机。
    - `network.eni=true`：支持弹性网卡。
    - `network.eip=true`：支持弹性公网 IP。
    - `network.routeTable=true`：支持路由表。
  - 存储：
    - `storage.disk=true`：支持云盘。
    - `storage.snapshot=true`：支持快照。
- 数据与接口适配：
  - 主要列表能力通过 `backend/src/routes/clouds.ts` 中的能力接口返回，包含 `capabilities`：
    - VPC：约 `clouds.ts:403`。
    - ECS 实例：约 `clouds.ts:639`。
    - 子网：约 `clouds.ts:1028`。
    - ENI：约 `clouds.ts:1182`。
    - EIP：约 `clouds.ts:1463`。
    - 路由表：约 `clouds.ts:1512`。
    - 云盘：约 `clouds.ts:1619`。
    - 快照：约 `clouds.ts:1644`。
  - 数据来源依托 OpenAPI 封装：
    - `callAliyunVpc`、`callAliyunEcs` 等统一封装分页聚合与字段解析。
- 前端消费方式：
  - 云资源控制台及资源池详情页在加载各资源列表时，合并后端返回的 `json.capabilities` 至本地 `caps`。
  - 各列表的列与按钮启用/禁用根据 `caps` 中对应能力键判断，例如 VPC/子网/ENI/EIP/路由表/云盘/快照等。
- 注意事项与验证：
  - 集合字段名在阿里云返回中可能为 `EipAddresses.EipAddress`、`NetworkInterfaces.NetworkInterface` 等，适配层需统一为数组输出。
  - 认证与区域依赖 `accessKeyId` / `accessKeySecret` 与 `regionId`，创建资源池时需校验。
  - 测试建议：
    - 断言所有能力接口返回包含 `capabilities`，键值符合预期。
    - 前端根据能力正确控制列展示与按钮可用性（禁用未支持的操作）。

### 华为云（huaweicloud）

- 关系与原则：
  - 作为公有云 Provider 接入多云资源适配层，与阿里云共用统一能力 Schema 与适配契约。
  - 前端同样仅消费 `capabilities`，按“资源类型能力”而非厂商分支渲染。
- 能力映射（当前实现）：
  - 计算：
    - `compute.instanceType=true`。
    - `compute.zone=true`。
  - 网络：
    - `network.vpc=true`、`network.subnet=true`。
    - `network.routeTable=true`。
    - `network.eip=false`、`network.eni=false`（当前未接入 EIP/ENI）。
  - 存储：
    - `storage.snapshot=true`。
    - `storage.disk=false`（当前未接入云盘列表）。
- 数据与接口适配：
  - 能力接口同样集中于 `backend/src/routes/clouds.ts`：
    - VPC：约 `clouds.ts:403`。
    - ECS 实例：约 `clouds.ts:639`。
    - 子网：约 `clouds.ts:1028`。
    - 路由表：约 `clouds.ts:1512`。
    - 快照：约 `clouds.ts:1691`。
  - 数据来源封装函数：
    - `huaweiListVpcs`、`huaweiListSubnets`、`huaweiListRouteTables`、`huaweiListSnapshots` 等。
  - 需要在资源池配置中提供 `projectId` 以访问 VPC/子网/快照等。
- 前端消费方式：
  - 云资源控制台合并 `json.capabilities` 后，根据 `network.eni=false`、`network.eip=false` 禁用 ENI/EIP 相关操作与列。
  - 路由表、子网、快照等能力为 `true` 时，展示相应标签页与操作。
- 注意事项与验证：
  - 不同接口的集合字段名不一致，适配层需在返回前统一为标准数组结构。
  - 测试建议：
    - 校验能力字段正确反映当前接入状态（尤其是未接入能力标记为 `false`）。
    - 确认前端按钮禁用、列展示与能力映射完全对齐。

- ### 腾讯云（tencentcloud）

- 当前状态：
  - 已接入基础 SDK 与部分适配逻辑，但在统一云资源控制台的聚合接口（例如 `/resources/ecs-all`）中暂未启用 `tencentcloud`，处于“可接入但默认关闭”的状态。
  - 云资源池仍可通过向导创建 Tencentcloud 类型，后续可按需恢复或扩展能力。
- 关系与原则：
  - 作为公有云 Provider，目标是提供与阿里云/华为云类似的 VPC 与 ECS 能力，但当前以最小集为主，尚未完全开放。
  - 前端同样通过 `capabilities` 判断可用能力，未接入能力统一视为禁用。
- 能力映射（当前实现）：
  - 计算：
    - `compute.instanceType=true`、`compute.zone=true`。
  - 网络：
    - `network.vpc=true`。
    - `network.subnet=false`（未接入子网列表）。
    - `network.eni=false`、`network.eip=false`、`network.routeTable=false`（未接入相关接口）。
  - 存储：
    - `storage.disk=false`、`storage.snapshot=false`（未接入相关接口）。
- 数据与接口适配：
  - 能力接口参考 `backend/src/routes/clouds.ts`：
    - VPC：约 `clouds.ts:403`。
    - ECS 实例：约 `clouds.ts:639`。
  - 数据来源封装函数：
    - `tencentListVpcs`，基于 `secretId` / `secretKey` 与 `region` 调用腾讯云 API。
- 前端消费方式：
  - 通过 `caps` 判断仅启用 VPC 相关视图与列，其它网络/存储能力为 `false` 时界面统一禁用。
- 注意事项与验证：
  - 需确认密钥权限与地域配置与资源一致，否则列表返回空或出错。
  - 扩展计划：
    - 按需逐步接入子网、EIP、ENI、路由表、云盘、快照接口，并在能力对象中打开对应键值。
  - 测试建议：
    - 确认 VPC 列表与 ECS 列表可用。
    - 确认其余未实现能力在前端表现为禁用状态，而非异常报错。

### Harvester（harvester）

- 关系与原则：
  - 作为虚拟化 Provider，代表基于 Harvester 的私有云/边缘环境。
  - 遵循统一能力模型，但其网络与生命周期操作与公有云略有差异。
- 能力映射：
  - 计算：
    - `compute.instanceType=false`、`compute.zone=false`（实例规格与可用区使用自有模型）。
    - `compute.lifecycle.start|stop|reboot|delete=true`（管理员可执行生命周期操作）。
  - 网络：
    - `network.vpc=true`（基于 Kube-OVN 虚拟网络）。
    - `network.subnet=true`（Kube-OVN 子网）。
    - `network.fusion=true`（支持融合展示 VPC/Subnet/NAD）。
    - `provider.harvester.multus=true`（支持 Multus / NAD）。
  - 存储：
    - `storage.disk=false`、`storage.snapshot=false`（按当前实现）。
- 数据与操作适配：
  - 统一 ECS 入口：
    - `POST /api/clouds/:id/resources/ecs/:instanceId/start|stop|reboot`。
    - `DELETE /api/clouds/:id/resources/ecs/:instanceId`。
  - Harvester 动作 API：
    - `POST /v1/harvester/kubevirt.io.virtualmachines/{namespace}/{name}?action=start|stop|restart`。
    - `DELETE /v1/harvester/kubevirt.io.virtualmachines/{namespace}/{name}`。
  - 标准化字段：
    - `InstanceId` 统一为 `namespace/name`。
    - 状态、IP 等按统一模型输出，兼容 `printableStatus/phase/state` 与多种 IP 字段。
  - 认证与 TLS：
    - 使用 `Authorization: Bearer` 令牌。
    - 自签证书场景允许 `rejectUnauthorized: false` 或等效配置。
- 前端消费方式：
  - 列表中展示 Harvester 特有列：命名空间、宿主机、融合网络信息、vCPU/内存分配、已用 CPU/内存等。
  - 所有差异列与按钮可用性基于能力对象控制，例如仅当 `compute.lifecycle.*` 为 `true` 时展示启动/停止按钮。
  - 网络视图支持融合展示 Kube-OVN 与 Multus/NAD。
- 注意事项与验证：
  - 操作返回可能为非 JSON 文本，前端需统一以消息提示处理。
  - 测试建议：
    - 管理员从资源池详情页和聚合页，对 Harvester VM 执行生命周期操作，确认状态刷新与提示文案正确。
    - 在自签环境下验证健康检查与 TLS 配置。

### Cloudmap Private / Edge（cloudmap.private, cloudmap.edge）

- 关系与原则：
  - 代表 Cloudmap 私有云与 Cloudmap 边缘云资源池。
  - 在资源查询风格上与 Harvester 类似，走统一的“Harvester 风格资源查询”，但在 Provider 标识与展示层区分 private 与 edge。
- 能力与适配：
  - 使用与 Harvester 相近的能力组合，重点在虚拟机、网络与多租户命名空间的管理。
  - 具体能力键与路由实现参考 Harvester Provider，差异主要在底层后端集群类型与展示文案。
- 前端消费方式：
  - 在云资源控制台中，以 Provider 名称区分“Cloudmap 私有云”与“Cloudmap 边缘云”，其资源列表与操作能力由 `capabilities` 决定。

### Cloudmap 安全资源池（cloudmap.csm / cloudmap-security）

- 关系与原则：
  - 表示 Cloudmap 安全资源池 Provider，用于对接 CSM 安全平台。
  - 历史别名为 `csm`，当前规范标识为 `cloudmap-security`，两者需完成统一与迁移。
- 能力与适配：
  - 走 CSM 专用安全路由与数据模型，主要提供安全服务、引流点、服务链等安全侧资源视图。
  - 与云主机/VPC 等通用资源的能力区分开，避免混淆。
- 命名与整改要求：
  - 创建资源池时采用 `cloudmap-security` 作为 Provider 标识写入 `config.provider`。
  - 后续代码中逐步移除 `csm` 判断，仅保留 `cloudmap-security`。
