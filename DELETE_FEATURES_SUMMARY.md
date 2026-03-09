# 平台删除功能清单

本文档汇总了 ComputeTower 平台中所有删除相关的功能。

## 一、资源管理类删除功能

### 1.1 云资源池（Cloud Resources）
- **功能描述**: 删除云资源池
- **API端点**: `DELETE /api/clouds/:id`
- **权限要求**: `checkAdminPermission`（管理员权限）
- **安全检查**: 
  - 检查是否有资源池分配（UserSpace）
  - 如果已分配给组织，禁止删除
- **前端位置**: `frontend/src/pages/Clouds/index.tsx`
- **批量删除**: 支持批量删除多个资源池

### 1.2 虚拟机（VM/ECS）
- **功能描述**: 删除虚拟机实例
- **API端点**: `DELETE /api/clouds/:id/resources/ecs/:instanceId`
- **权限要求**: `checkAdminPermission`
- **参数选项**:
  - `deleteImage`: 是否同时删除关联镜像（默认 false）
  - `deleteVolumes`: 是否同时删除挂载的数据卷（默认 false）
- **后端实现**: `backend/src/routes/clouds/harvester/harvester.cache.vm.routes.ts`
- **前端位置**: `frontend/src/pages/Clouds/Harvester/sections/VmSection.tsx`
- **批量删除**: 支持批量删除多台虚拟机
- **回收站**: 支持从回收站彻底删除（`RecycleBinSection.tsx`）

### 1.3 存储资源

#### 1.3.1 数据卷（Volumes）
- **功能描述**: 删除数据卷/PVC
- **API端点**: `DELETE /api/clouds/:id/resources/harvester/storage/volumes/:namespace/:name`
- **后端实现**: `backend/src/routes/clouds/harvester/harvester.cache.storage.routes.ts`
- **权限检查**: 租户只能删除自己命名空间下的卷

#### 1.3.2 Longhorn 卷
- **功能描述**: 删除底层 Longhorn 卷（用于 PVC 删除失败后的清理）
- **API端点**: `DELETE /api/clouds/:id/resources/harvester/longhorn/volumes/:namespace/:name`
- **后端实现**: `backend/src/routes/clouds/harvester/harvester.cache.storage.routes.ts`

#### 1.3.3 快照（Snapshots）
- **功能描述**: 删除快照
- **API端点**: `DELETE /api/clouds/:id/resources/harvester/storage/snapshots/:namespace/:name`
- **前端位置**: `frontend/src/pages/Clouds/Harvester/sections/SnapshotsSection.tsx`
- **批量删除**: 支持批量删除多个快照

#### 1.3.4 镜像（Images）
- **功能描述**: 删除镜像
- **API端点**: `DELETE /api/clouds/:id/resources/harvester/images/:namespace/:name`
- **前端位置**: `frontend/src/pages/Clouds/Harvester/sections/ImagesSection.tsx`
- **批量删除**: 支持批量删除多个镜像

### 1.4 网络资源

#### 1.4.1 Service（负载均衡）
- **功能描述**: 删除 Service/LoadBalancer
- **API端点**: `DELETE /api/clouds/:id/resources/harvester/services/:namespace/:name`
- **后端实现**: `backend/src/routes/clouds/harvester/harvester.direct.network.routes.ts`
- **权限检查**: 检查租户访问权限

#### 1.4.2 网络附件定义（NAD）
- **功能描述**: 删除网络附件定义
- **API端点**: `DELETE /api/clouds/:id/resources/harvester/nads/:namespace/:name`
- **后端实现**: `backend/src/routes/clouds/harvester/harvester.direct.network.routes.ts`

#### 1.4.3 IP 池（IP Pools）
- **功能描述**: 删除 IP 池
- **API端点**: `DELETE /api/clouds/:id/resources/harvester/ippools/:namespace/:name`
- **后端实现**: `backend/src/routes/clouds/harvester/harvester.direct.network.routes.ts`

### 1.5 命名空间（Namespaces）
- **功能描述**: 删除命名空间
- **API端点**: `DELETE /api/clouds/:id/resources/harvester/namespaces/:name`
- **后端实现**: `backend/src/routes/clouds/harvester/harvester.cache.namespace.routes.ts`

### 1.6 定时备份策略
- **功能描述**: 删除定时备份策略
- **API端点**: `DELETE /api/clouds/:id/resources/harvester/schedule-vm-backups/:namespace/:id`
- **前端位置**: `frontend/src/pages/Clouds/Harvester/sections/ScheduleVmBackupsSection.tsx`

### 1.7 监控资源

#### 1.7.1 Secrets（监控密钥）
- **功能描述**: 删除监控相关的 Secrets
- **API端点**: `DELETE /api/clouds/:id/monitoring/secrets/:namespace/:name`
- **后端实现**: `backend/src/routes/clouds/harvester/monitoring.routes.ts`

#### 1.7.2 AlertmanagerConfig Receivers
- **功能描述**: 删除 AlertmanagerConfig 接收器
- **API端点**: `DELETE /api/clouds/:id/monitoring/alertmanagerconfigs/receivers/:namespace/:name`
- **后端实现**: `backend/src/routes/clouds/harvester/monitoring.routes.ts`

#### 1.7.3 AlertmanagerConfig
- **功能描述**: 删除 AlertmanagerConfig
- **API端点**: `DELETE /api/clouds/:id/monitoring/alertmanagerconfigs/:namespace/:name`
- **后端实现**: `backend/src/routes/clouds/harvester/monitoring.routes.ts`

## 二、租户管理类删除功能

### 2.1 租户（Tenants）
- **功能描述**: 删除租户（级联删除租户下所有组织、资源池分配与租户用户）
- **API端点**: `DELETE /api/tenants/:id`
- **后端实现**: `backend/src/routes/tenants/index.ts`
- **安全检查**:
  - 检查资源池绑定（UserSpace）
  - 检查资源池分配（ResourcePoolAssignment）
  - 检查 VPC 网络
  - 检查虚拟路由器配置
  - 检查安全域
  - 检查服务链
  - 检查安全区
  - 检查防护对象
  - 如果存在资源绑定，禁止删除
- **前端位置**: `frontend/src/pages/Tenants/index.tsx`
- **批量删除**: 支持批量删除多个租户

### 2.2 组织（Organizations）
- **功能描述**: 删除组织
- **API端点**: `DELETE /api/tenants/organizations/:orgId`
- **后端实现**: `backend/src/routes/tenants/index.ts`
- **安全检查**: 检查组织下是否有资源绑定

### 2.3 租户用户（Tenant Users）
- **功能描述**: 删除租户用户
- **API端点**: `DELETE /api/tenants/:tenantId/organizations/:orgId/users/:userId`
- **后端实现**: `backend/src/routes/tenants/index.ts`

### 2.4 资源池分配（Resource Pool Assignments）
- **功能描述**: 删除资源池分配
- **API端点**: `DELETE /api/tenants/organizations/:orgId/resource-pools/:poolId`
- **后端实现**: `backend/src/routes/tenants/index.ts`

## 三、权限管理类删除功能

### 3.1 系统用户（System Users）
- **功能描述**: 删除系统用户
- **API端点**: `DELETE /api/sysuser/:id`
- **后端实现**: `backend/src/routes/sysuser/index.ts`
- **权限要求**: 仅超级管理员
- **安全检查**:
  - 不能删除当前登录的账户
  - 内置用户（admin）不允许删除
  - 不能删除最后一个超级管理员

### 3.2 RBAC 角色（Roles）
- **功能描述**: 删除 RBAC 角色
- **API端点**: `DELETE /api/system/rbac/roles/:id`
- **后端实现**: `backend/src/routes/system.ts`
- **权限要求**: 超级管理员或拥有 `system.roles:write` 权限
- **安全检查**:
  - 检查是否有用户关联（RoleAssignment）
  - 检查是否仍有租户用户的 role 字段指向该角色
- **前端位置**: `frontend/src/pages/Access/Roles.tsx`

### 3.3 角色分配（Role Assignments）
- **功能描述**: 删除角色分配
- **API端点**: `DELETE /api/system/rbac/assignments/:id`
- **后端实现**: `backend/src/routes/system.ts`

## 四、SDN 网络管理类删除功能

### 4.1 云企业网（CEN）
- **功能描述**: 删除云企业网/互联通道
- **API端点**: `DELETE /api/cens/:id`
- **后端实现**: `backend/src/routes/sdn/cens.ts`
- **参数选项**:
  - `force`: 是否强制删除（默认 false）
- **安全检查**:
  - 如果未设置 force，检查是否有关联的安全域（CenAttachment）
  - 如果 force=true，会先删除所有关联的安全域绑定，再删除 CEN
- **操作日志**: 记录删除操作到审计日志

### 4.2 安全域（Security Domains）
- **功能描述**: 删除安全域
- **API端点**: `DELETE /api/security-domains/:id`
- **后端实现**: `backend/src/routes/sdn/securityDomains.ts`
- **安全检查**: 检查是否有关联资源（VPC、VR、SRv6 隧道、NAT 规则、ACL 规则、服务目录、服务链等）

### 4.3 ACL 规则（ACL Rules）
- **功能描述**: 删除 ACL 规则
- **API端点**: `DELETE /api/acl/:id`
- **后端实现**: `backend/src/routes/sdn/acl.ts`
- **权限要求**: `security.acl:write`
- **同步操作**: 删除后同步到 VR Config

### 4.4 ACL 组（ACL Groups）
- **功能描述**: 删除 ACL 组
- **API端点**: `DELETE /api/acl-groups/:id`
- **后端实现**: `backend/src/routes/sdn/aclGroups.ts`
- **权限要求**: `security.acl-groups:write`
- **级联删除**: 删除组时会级联删除绑定关系
- **同步操作**: 删除后同步所有关联的 VR Config

### 4.5 虚拟路由器配置（VR Config）
- **功能描述**: 删除虚拟路由器配置
- **API端点**: `DELETE /api/vr-config/:uuid`
- **后端实现**: `backend/src/routes/sdn/vrConfig.ts`
- **权限要求**: `networks.vr-config:write`
- **前端位置**: `frontend/src/pages/Tenants/OrgManage.tsx`

### 4.6 IPsec VPN
- **功能描述**: 删除 IPsec VPN
- **API端点**: `DELETE /api/ipsec/:id`
- **后端实现**: `backend/src/routes/sdn/ipsec.ts`
- **前端位置**: `frontend/src/pages/InterConnect/IPsecVPN/index.tsx`
- **批量删除**: 支持批量删除多个 IPsec VPN

### 4.7 SRv6 隧道
- **功能描述**: 删除 SRv6 隧道
- **API端点**: `DELETE /api/srv6/:id`
- **后端实现**: `backend/src/routes/sdn/srv6.ts`

### 4.8 NAT 规则
- **功能描述**: 删除 NAT 规则
- **API端点**: `DELETE /api/nat/:id`
- **后端实现**: `backend/src/routes/sdn/nat.ts`

### 4.9 服务目录（Service Catalog）
- **功能描述**: 删除服务目录
- **API端点**: `DELETE /api/services/:id`
- **后端实现**: `backend/src/routes/sdn/services.ts`
- **权限要求**: `security.services:write`

### 4.10 服务链（Service Chains）
- **功能描述**: 删除服务链
- **API端点**: `DELETE /api/service-chains/:id`
- **前端位置**: `frontend/src/pages/Security/TrafficOrchestration/ServiceChains/index.tsx`
- **批量删除**: 支持批量删除多个服务链
- **关联删除**: 删除时会关联删除 CSM 服务链

### 4.11 流量编排规则
- **功能描述**: 删除流量编排规则
- **API端点**: `DELETE /api/traffic-orchestration/:id`
- **后端实现**: `backend/src/routes/sdn/trafficOrchestration.ts`

## 五、通用删除功能特性

### 5.1 API 删除请求封装
- **位置**: `frontend/src/services/api.ts`
- **函数**: `apiDelete`
- **特性**:
  - 禁用去重（确保每次删除都能真正执行）
  - 不缓存
  - 支持重试
  - 支持请求体（某些 DELETE 请求需要 body，如删除安全组规则）

### 5.2 删除确认对话框
- **通用模式**: 使用 `Modal.confirm` 进行删除确认
- **常见字段**:
  - `title`: 确认删除标题
  - `content`: 删除说明
  - `okText`: 确认按钮文字（通常为"删除"）
  - `okType`: 按钮类型（通常为 'danger'）
  - `cancelText`: 取消按钮文字

### 5.3 批量删除模式
- **实现方式**: 使用 `Promise.all` 或 `Promise.allSettled` 并发执行
- **错误处理**: 统计成功/失败数量，分别提示用户
- **支持的功能**:
  - 批量删除云资源池
  - 批量删除虚拟机
  - 批量删除快照
  - 批量删除镜像
  - 批量删除租户
  - 批量删除 IPsec VPN
  - 批量删除服务链

### 5.4 删除安全检查
- **资源依赖检查**: 删除前检查是否有关联资源
- **权限检查**: 验证用户是否有删除权限
- **级联删除**: 某些删除操作支持级联删除关联资源
- **强制删除**: 部分功能支持强制删除（force 参数）

### 5.5 删除操作日志
- **审计日志**: 重要删除操作会记录到审计日志
- **操作记录**: 记录删除操作的用户、时间、资源信息

## 六、删除功能权限映射

根据权限原子设计文档，删除操作通常映射到 `write` 权限：

- `clouds.instances:write` - 删除虚拟机
- `clouds.storage:write` - 删除存储资源
- `clouds.networks:write` - 删除网络资源
- `tenants:write` - 删除租户
- `tenants.organizations:write` - 删除组织
- `tenants.users:write` - 删除租户用户
- `system.roles:write` - 删除角色
- `security.acl:write` - 删除 ACL 规则
- `security.acl-groups:write` - 删除 ACL 组
- `networks.vr-config:write` - 删除 VR 配置
- `security.services:write` - 删除服务目录

## 七、注意事项

1. **删除不可逆**: 大部分删除操作不可恢复，需要谨慎操作
2. **资源依赖**: 删除前会检查资源依赖，存在依赖时禁止删除
3. **权限控制**: 所有删除操作都有权限检查，确保安全性
4. **批量操作**: 批量删除时注意错误处理，部分成功的情况需要明确提示
5. **级联删除**: 某些删除操作会级联删除关联资源，需要明确告知用户
6. **强制删除**: 使用强制删除功能时需要特别谨慎，可能破坏数据一致性
