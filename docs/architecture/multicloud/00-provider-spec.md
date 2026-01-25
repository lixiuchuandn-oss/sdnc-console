# 多云 Provider 需求设计与命名规范

> **文档定位**：解决多云接入的 **“身份与标准” (The "Who")** 问题。
>
> 本文档是多云接入的“户口本”与“宪法”，旨在解决 **静态** 的定义问题：
> *   **统一命名空间**：强制规定厂商唯一标识（如 `aliyun`），决定数据库字段和代码常量的稳定性。
> *   **生命周期定义**：明确 Provider 从注册到服务的标准流程。
> *   **职责边界**：明确 Provider 仅作为适配层，不承载业务逻辑（如权限控制）。

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

## 展示/规划中（仅前端映射，后端未完全集成）
- aws, azure, google, ucloud
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
