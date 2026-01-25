# 多云应用管理与Web层授权策略 PRD

## 背景
- 企业在阿里云与华为云上拥有大量虚拟机，内部按“安全域”组织网络与资产，通过 VR 互联形成统一的安全管理面。
- 当前应用管理需重构以支持多云，围绕“服务目录/应用”为核心对象，并在 Web 层实施 RBAC 与 ABAC 动态授权。
- 网络 ACL 的实际下发对象是安全域中的 VR 实例而非云 VPC，需要纠正控制面设计。

## 目标
- 建立“应用管理（服务目录）”能力，支持跨安全域聚合 VM/容器实例为业务单元。
- 修复创建向导中“所属安全域”下拉和应用名称提交问题，完善应用详情展示。
- 将网络 ACL 的管控目标明确到 VR 实例，形成与安全域的清晰绑定。
- 在 Web 层落地 RBAC+ABAC 访问控制，支持动态条件与义务。
- 统一前后端 API 规范与实体模型，提升一致性与可维护性。

## 范围
- 前端页面：安全域管理、应用管理列表与创建向导、ACL 操作入口、详情弹窗。
- 后端接口：服务目录、安全域查询与变更、网络 ACL 下发到 VR。
- 授权模型：Web 层 RBAC 与 ABAC，暂不扩展至网络/OS 层。
- 不在范围：EDR/设备态集成、OS 层权限执行、跨云账单与成本分析。

## 用户与角色
- 管理员：全局配置安全域、VR、ACL、应用的创建与治理。
- 安全运营：对应用进行策略配置与变更审核，发起 ACL 操作。
- 租户用户：查看自身应用、执行受控操作，受 RBAC/ABAC 约束。

## 核心概念
- 安全域：IDC/VPC/办公网络等私有网络单元，绑定 VR 实例进行互联。
- 应用/服务目录：由多台 VM/容器实例组成的业务单元，支持策略管理。
- VR 实例：承载跨域互联能力的网络设备，ACL 的下发目标。
- RBAC：基于角色的静态授权，用于页面与操作的基础准入。
- ABAC：基于属性的动态授权，用于时间/IP/风险等条件控制与义务（如 MFA）。

## 功能需求
### 安全域管理
- 列表、创建/编辑/删除，展示 VR 绑定信息（`vrUuid`/`vrInstanceIds` 等）。
- 查询接口标准化，前端下拉加载安全域选项。

### 应用管理
- 列表与检索：名称、所属安全域、实例数、状态、策略类型、版本。
- 详情：基础信息、实例集合、策略摘要、操作日志入口。
- 创建向导：支持“所属安全域”下拉可选、跨步缓存表单、名称正确提交；选择目标实例、配置策略。

### 网络 ACL
- 从应用列表进入 ACL 操作入口，解析当前应用安全域对应的 VR ID，向 VR 下发 ACL。
- 错误反馈：安全域缺少 VR ID 时明确提示且阻止操作。

### Web 层授权
- RBAC：路由守卫基于 `requiredActions`，判定登录用户的角色是否允许。
- ABAC：在关键页面/操作执行前评估动态条件（时间窗口、来源 IP、风险态等），必要时触发义务（如二次验证）。

## 非功能性要求
- 一致性：统一前后端字段与数据结构，避免隐式 `any` 等类型问题。
- 可用性：创建向导跨步不丢值；下拉加载可靠；错误信息清晰。
- 性能：列表分页与筛选响应在 300ms 内；批量实例选择流畅。
- 安全：不暴露密钥；权限校验在前后端双重实施；审计可追踪关键操作。

## 数据模型
### 安全域实体（后端）
- 关键字段：`id`, `name`, `type`, `category`, `subType`, `cloudId`, `vpcId`, `provider`, `region`, `cidr`, `vrUuid`, `vrInstanceIds`, `vrPublicIp`, `status`, `tags` 等。
- 参考：`backend/src/entities/SecurityDomain.ts:57` 起包含 VR 相关字段。

### 服务目录（应用）实体（后端路由保存）
- 字段：`id`, `name`, `domainId`, `domainName`, `type`, `instanceCount`, `status`, `strategies`, `instances(json)`, `description`, `owner`, `version`。
- 参考：`backend/src/routes/services.ts:router.post('/')` 保存逻辑包括上述字段。

### 关系实体（增强选用）
- `ServiceInstanceRelation`：应用与实例的关联，用于数据一致性与查询优化（`backend/src/entities/ServiceInstanceRelation.ts`）。

## 前端页面与交互
### 安全域页
- 列表、创建编辑对话框、VR 关联视图，支持下拉选择与搜索。
- 参考：`frontend/src/pages/SecMgrPlane/SecurityDomain/index.tsx:1`。

### 应用管理页
- 列表展示；“详情”弹窗；“网络 ACL”入口；创建向导入口。
- 参考：`frontend/src/pages/SecMgrPlane/Applications/index.tsx:119` 列展示与行操作；`openAcl` 使用安全域的 VR ID（`frontend/src/pages/SecMgrPlane/Applications/index.tsx:164`）。
- 策略弹窗：选择 IBAC/RBAC/ABAC，并提供“前往策略中心”快捷入口（`frontend/src/pages/SecMgrPlane/Applications/index.tsx:278`）。

### 创建向导（AppWizard）
- 步骤：基础信息（名称、所属安全域）→ 实例选择 → 策略设置 → 确认提交。
- 行为：跨步缓存表单值；提交时合并缓存与当前值；注入 `domainName`；校验必填。
- 下拉：调用统一安全域查询 API，防止“所属安全域”不可选问题。

### 路由与守卫
- 路由规范：见 `frontend/src/routes/RouteSpec.ts:762` 中 `admin.sec-mgr-plane.apps` 与 `frontend/src/routes/RouteSpec.ts:691` 中 `admin.sec-mgr-plane.security-domain`。
- 守卫：基于 `requiredActions` 与 RBAC/ABAC 组合判定（`frontend/src/components/AdminRoute.tsx:1`）。

## 后端接口
### 安全域
- `GET /security-domains`：列表查询，支持筛选。
- `POST /security-domains`：创建；`PUT /security-domains/:id`：更新；`DELETE /security-domains/:id`：删除。

### 服务目录（应用）
- `GET /services`：列表；`POST /services`：创建；`GET /services/:id`：详情；`PUT /services/:id`：更新；`DELETE /services/:id`：删除。
- 创建时保留 `description/owner/version/strategies/instances` 等字段。

### 网络 ACL（VR）
- `POST /acl/vr/:vrId/rules`：下发规则到 VR。
- `GET /acl/vr/:vrId/rules`：查看已下发规则；`DELETE /acl/vr/:vrId/rules/:ruleId`：删除规则。
- 参考：`backend/src/routes/acl.ts:1` 引用 `ACLRule` 与 `VRConfig`，并调用 `vrController`。

## 授权设计
### RBAC
- 路由级别：页面访问与读写操作以 `requiredActions` 定义。
- 用户拥有的角色映射到允许/拒绝列表；前端守卫与后端中间件双重校验。

### ABAC
- 条件属性：时间窗口（办公时段）、来源 IP（公司网段）、设备态/风险等级（后续可接 EDR）。
- 评估模型：前端在页面/操作入口处进行快速评估；后端在敏感操作进行强制评估。
- 义务：触发短信/OTP 二次验证或安全确认对话框。
- 范围：仅作用于 Web 层，不触达网络/OS 层。

## 推荐入口设计
- 全局策略中心：`/admin/access/policies`（左侧导航“访问控制”→“授权策略”），集中管理策略。
  - 路由：`frontend/src/routes/RouteSpec.ts:318`。
  - 页面：`frontend/src/pages/Access/Policies/index.tsx:257`。
- 应用页策略入口：在应用列表行操作中提供“策略”，用于在应用上下文分配 IBAC/RBAC/ABAC，并含快捷跳转到策略中心。
- 网络 ACL 入口：应用行操作与“跨地域互联→网络ACL”页面保留入口，下发目标为 VR 实例。

## 关键用户流程
### 创建应用
- 打开向导 → 基础信息填写（名称、安全域下拉）→ 选择实例 → 配策略 → 确认 → 成功提示与列表刷新。

### 下发 ACL
- 在应用列表点击“网络 ACL” → 解析安全域的 `vrUuid/vrInstanceIds` → 打开 ACL 规则配置 → 提交 → 反馈结果。

### 权限校验
- 访问应用页：先 RBAC 判定 → 再 ABAC 快速评估；拒绝时显示原因与义务入口。

## 验收标准
- “所属安全域”下拉可用，能加载与选择安全域；加载失败时有明确错误消息。
- 创建应用时，名称与所有字段正确保存，确认页展示完整信息。
- 应用列表的“详情”弹窗显示完整基础信息与策略摘要。
- “网络 ACL”入口以 VR ID 为目标，缺失 VR ID 时阻止并提示。
- 未授权用户无法访问页面或执行写操作；ABAC 条件不满足时显示义务提示。
- API 的请求/响应字段与实体一致，无隐式类型错误，前端无未定义变量。

## 里程碑
- M1：统一安全域查询与下拉修复，创建向导表单缓存与正确提交。
- M2：服务目录后端保存与应用列表展示、详情弹窗。
- M3：VR ACL 以 VR 为目标的下发通路与前端入口。
- M4：Web 层 RBAC+ABAC 守卫落地与策略面板。
- M5：联调测试、错误处理与审计打点补齐。

## 风险与对策
- 安全域缺失 VR 数据导致 ACL 操作失败：在页面入口进行前置校验与提示。
- 多云实例标识不一致：统一实例 ID 与云标识映射策略，前端适配不同云返回结构。
- ABAC 策略复杂度上升：先以时间/IP 为主的 MVP，设备态/风险逐步引入。

## 度量指标
- 创建向导成功率 ≥ 98%；平均创建时长 ≤ 2 分钟。
- 列表与详情页面加载 ≤ 300ms；ACL 下发操作成功率 ≥ 95%。
- 未授权访问拦截率 100%，误拦截率 < 1%。

## 代码对应关系（引用以便定位）
- 路由定义与页面守卫：`frontend/src/routes/RouteSpec.ts:762`（应用管理）、`frontend/src/components/AdminRoute.tsx:1`。
- 应用管理页与详情/ACL入口：`frontend/src/pages/SecMgrPlane/Applications/index.tsx:119` 列、`frontend/src/pages/SecMgrPlane/Applications/index.tsx:164` ACL。
- 安全域页与 VR 绑定：`frontend/src/pages/SecMgrPlane/SecurityDomain/index.tsx:1`；后端实体 `backend/src/entities/SecurityDomain.ts:57`。
- VR/ACL接口：`backend/src/routes/acl.ts:1`。
- 服务目录创建保存逻辑：`backend/src/routes/services.ts`（创建路由内赋值与保存）。
- 前端安全域查询封装：`frontend/src/services/securityDomainApi.ts`。

---
本文档为当前版本的产品需求说明（PRD），用于指导前后端实现与联调测试。后续若需扩展 ABAC 条件（设备态/风险分）、或跨层授权到网络/OS，将在迭代 PRD 中补充。
