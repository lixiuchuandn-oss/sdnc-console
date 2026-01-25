# 租户 - 组织 - 资源 模型 PRD

## 1 背景与目标

在现有设计中，安全域、安全资源池（CSM）、级联通道、Harvester 等资源已经具备基本的生命周期与拓扑能力，但缺少“租户内组织维度”的统一抽象，导致：

- 安全域看起来像是“全局资源”，无法直接感知其归属的租户组织
- VPC / VR / SRv6 / IPsecVPN 等网络资源虽然在各云侧已经挂靠到账号或项目，但在控制面展示时，这一归属关系不够统一
- Harvester 场景中，Namespace 实际上已经承担了“租户组织”的角色，但在整体域模型中没有被抽象到同一层级

本 PRD 目标：

- 抽象统一的“租户 - 组织 - 资源”模型
- 明确安全域与网络资源在租户组织下的归属与约束
- 为后续权限模型（RBAC）、资源视图、拓扑、计费等能力提供统一的上层语义

## 2 核心概念

### 2.1 租户（Tenant）

- 描述：平台上的逻辑隔离单元，对应一个业务方、客户或内部系统
- 来源：IAM / 统一身份系统同步，或在平台中创建
- 关键属性：
  - tenantId：唯一标识
  - name：租户名称
  - type：企业租户 / 项目租户 / Lab 等分类（可选）
  - owner：租户负责人（用户或用户组）

### 2.2 组织（Org）

- 描述：租户内部的资源组织单元，可以对应实际组织结构（部门 / 项目组 / 环境），或对应基础设施侧的项目命名空间
- 组织与租户关系：
  - 一个租户包含多个组织
  - 每个组织只属于一个租户
- 典型映射：
  - 公有云：Org ≈ 该租户下的项目 / Resource Group / Folder
  - Harvester：Org ≈ Namespace
- 关键属性：
  - orgId：唯一标识
  - tenantId：所属租户
  - name：组织名称（如：安全事业部-生产-SAAS）
  - code：组织编码（如：sec-prod-saas）
  - kind：逻辑类型（部门 / 项目 / 环境 / 命名空间）

### 2.3 资源（Resource）

本 PRD 范围内关注三类资源：

1. 网络基础资源
   - VPC、VR、子网、路由表、SRv6 隧道、IPsecVPN 等
   - 特点：在云侧/网络侧已经绑定到账号或项目，但需要在控制面统一落到 Org 维度
2. 计算与运行环境
   - Harvester Namespace、VM、容器集群等
   - 特点：Namespace 本身即为组织，Namespace 下的 VM / Pod 隶属于该 Org
3. 安全资源
   - 安全域（Security Domain）
   - 安全服务（Security Service / 网元组）
   - 服务链（Service Chain）、引流策略等

## 3 领域建模

### 3.1 关系总览

- 租户（Tenant） 1 - N 组织（Org）
- 组织（Org） 1 - N 资源（Resource）
- 安全域（SecurityDomain）是组织级资源：
  - 每个安全域必须绑定到且仅绑定到一个 Org
  - 安全域下关联的 VPC / VR / Harvester Namespace，应当与安全域所属 Org 一致

### 3.2 安全域与组织

新增字段：

- SecurityDomain.tenantId：所属租户
- SecurityDomain.orgId：所属组织（必填）

约束：

- 创建安全域时必须显式选择 Org（通过“租户 → 组织”级联选择器）
- 安全域只能在所属 Org 内引用资源（VPC / VR / Namespace 等）

### 3.3 VPC / VR / 网络资源与组织

统一抽象：

- CloudNetworkResource
  - id：云侧资源 ID（VPC ID / VR UUID / SRv6 Tunnel ID 等）
  - provider：云厂商（阿里云 / 华为云 / Harvester / On-Prem）
  - region：地域
  - tenantId：所属租户（云账号绑定到平台租户后的映射）
  - orgId：所属组织

赋值规则示例：

- 前置条件：
  - 云资源池（Cloud）是平台级全局资源，本身不直接挂 tenantId；其“属于哪个租户”由 ResourcePoolAssignment(organizationId, cloudId) 决定
  - 某个租户在逻辑上“拥有”的资源池集合 = 分配给该租户名下任一组织的所有 Cloud；同一个 Cloud 可以被多个租户的组织引用，实现多租共享
- 公有云账号 / Token 资源池：
  - 接入时只需配置账号 / Token / endpoint 等信息，接入后进入“可分配资源池列表”，默认不归属任何租户
  - 通过“租户-组织管理”将 Cloud 分配给一个或多个组织后，该 Cloud 才会出现在相应租户 / 组织下的资源池列表中
- Cloudmap 私有云 / Cloudmap 融合边缘云 / Harvester 集群：
  - 接入方式与公有云一致，同样作为平台级资源池，通过 ResourcePoolAssignment 分配给组织
  - Harvester 中的 Namespace 仍然映射为 Org，Namespace 下的 VM / 网络等资源在逻辑上归属于对应的组织

### 3.4 Harvester Namespace 与组织

- Namespace 本身即为 Org 的一种实现形态：
  - org.kind = "namespace"
  - org.externalRef = { provider: "Harvester", namespace: "xxx" }
- 资源归属：
  - Namespace 下创建的 VPC / 网卡 / VM 自动归属于该 Org
  - 在安全域中选择 Harvester 相关资源时，只展示同 Org 下的 Namespace / VM

## 4 关键场景与交互

### 4.1 创建安全域

入口：安全域管理 → 新建安全域

- Step 1：选择租户
  - 若当前登录上下文已有租户，则默认带出并不可更改
- Step 2：选择组织
  - 通过“组织树 / Namespace 列表”选择 Org
- Step 3：填写安全域基本信息
  - 名称、类型（生产 / 测试 / DMZ）、描述等
- Step 4：关联资源
  - 仅展示当前 Org 下的 VPC / VR / Namespace / 应用实例

### 4.2 将 VPC 绑定到安全域

场景：在安全域详情页中，关联一个 VPC 作为保护对象。

约束：

- 只允许选择：
  - tenantId 与安全域相同
  - orgId 与安全域相同
- 若用户通过接口/导入绕过 UI 传入其他 Org 的 VPC，后端需拒绝并返回错误：
  - 错误示例：“VPC 不属于该安全域所在组织，无法绑定”

### 4.3 Harvester 场景下的安全域

- 创建安全域时选择 Org = Harvester Namespace
- 关联资源时：
  - 默认展示该 Namespace 下的 VM / 网络
  - 不跨 Namespace 混用资源

### 4.4 级联通道与组织

级联通道（CEN）作为跨 Org / 跨区域资源，其自身可以只绑定 tenantId，不强绑定 orgId，但其附加的安全域必须各自满足：

- 安全域.tenantId = CEN.tenantId
- 各安全域的 orgId 可不同（跨组织连接），但在 UI 上需清晰展示“所属组织”

## 5 数据模型与接口影响

### 5.1 安全域实体

- 新增字段：
  - tenantId：string
  - orgId：string
- 接口影响：
  - 创建/更新安全域 API 必须校验 orgId 不为空
  - 列表查询支持按 tenantId / orgId 过滤

### 5.2 通用资源标识

为后续统一查询与过滤准备，建议为 VPC / VR / Namespace / 安全服务等实体补充：

- tenantId：所属租户
- orgId：所属组织

所有“通过安全域关联资源”的操作都通过 tenantId + orgId 做一致性校验。

## 6 权限与视图

### 6.1 权限（高层约束）

- 用户的可见范围由“租户 + 组织”组合决定：
  - 某用户可被授权为：租户 A 下 Org X 的安全管理员
  - 该用户仅能管理 Org X 下的安全域、级联通道附加关系、策略等

### 6.2 视图层展示

- 安全域列表：
  - 新增列：所属组织（Org 名称），支持按组织过滤
- 安全域详情：
  - 概览区展示：租户 / 组织
  - 资源拓扑中节点悬停时显示“所属组织”

## 7 非目标

本 PRD 不解决以下内容（后续可扩展）：

- 复杂的跨租户资源共享模型
- 细粒度的多级组织继承与配额管理
- 计费与成本分摊逻辑
