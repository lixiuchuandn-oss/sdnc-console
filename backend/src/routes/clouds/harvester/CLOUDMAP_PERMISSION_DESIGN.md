# Cloudmap 资源池权限控制设计文档

## 1. 文档概述

### 1.1 目的
本文档旨在设计并实现 Cloudmap（Harvester）资源池的细粒度权限控制体系，确保每个操作按钮能够根据用户的只读（read）和读写（write）权限进行正确的显示和功能控制。

### 1.2 适用范围
- **平台**: Cloudmap（基于 Harvester/Kubernetes）
- **资源类型**: 云主机、VPC、子网、云盘、镜像、命名空间、SSH密钥、快照、备份等
- **权限粒度**: 资源级别的读写权限控制

### 1.3 设计原则
1. **最小权限原则**: 默认只授予必要的权限
2. **权限继承**: write 权限自动包含 read 权限
3. **前后端一致**: 前端按钮控制与后端 API 权限检查保持一致
4. **用户体验**: 权限不足时提供清晰的错误提示

---

## 2. 当前状态分析

### 2.1 后端权限控制（✅ 已实现）

#### 2.1.1 权限中间件
- **位置**: `backend/src/routes/clouds.ts`
- **实现**: `createApiPermissionMiddleware`
- **功能**: 
  - 根据 HTTP 方法自动识别读写权限
    - `GET/HEAD` → `{resource}:read`
    - `POST/PUT/DELETE` → `{resource}:write`
  - 从 API 路径自动解析权限标识

#### 2.1.2 权限解析机制
- **位置**: `backend/src/permissions/registry.ts`
- **功能**: 根据 API 路径模式自动推断权限
- **示例映射**:
  ```
  GET  /api/clouds/:id/resources/ecs              → clouds.ecs:read
  POST /api/clouds/:id/resources/ecs              → clouds.ecs:write
  GET  /api/clouds/:id/resources/harvester/volumes → clouds.disks:read
  POST /api/clouds/:id/resources/harvester/volumes → clouds.disks:write
  ```

#### 2.1.3 资源类型权限映射
| 资源类型 | API 路径模式 | 权限标识 |
|---------|------------|---------|
| 云主机 | `/resources/ecs` 或 `/resources/harvester/vms` | `clouds.ecs` |
| VPC | `/resources/vpcs` | `clouds.vpcs` |
| 子网 | `/resources/subnets` | `clouds.vpcs` (继承) |
| 云盘 | `/resources/harvester/volumes` | `clouds.disks` |
| 镜像 | `/resources/harvester/images` | `clouds.images` |
| 命名空间 | `/resources/harvester/namespaces` | `clouds.namespaces` |
| SSH密钥 | `/resources/harvester/sshkeys` | `clouds.sshkeys` |
| 快照 | `/resources/harvester/snapshots` | `clouds.snapshots` |
| 备份 | `/resources/harvester/virtualmachinebackups` | `clouds.ecs` |
| 定时备份 | `/resources/harvester/schedulevmbackups` | `clouds.schedules` |
| 控制台访问 | `/resources/ecs/*/vnc-url` 或 `/console` | `clouds.console` |

#### 2.1.4 额外权限检查
- **位置**: Handler 内部
- **场景**: 租户用户的写操作
- **检查**: 额外验证 `clouds.console:write` 权限
- **示例**: `handlers/ecs-direct-operations.handlers.ts` 第 375-380 行

### 2.2 前端权限控制（⚠️ 部分实现）

#### 2.2.1 已实现的权限控制
- ✅ **创建按钮**: 明确检查 `clouds.ecs:write` 权限
  - 位置: `VmSection.tsx` 第 1774-1779 行
  - 实现: 点击时检查权限，无权限时显示错误提示

#### 2.2.2 待完善的权限控制
- ⚠️ **操作按钮**: 只检查 `hasAnyPermission`（只要有 read 权限就显示）
  - 位置: `VmSection.tsx` 第 1567 行
  - 问题: 启动、停止、删除等写操作按钮未区分读写权限
  - 影响: 只读用户可以看到写操作按钮，但执行时会失败

#### 2.2.3 权限检查工具
- **位置**: `frontend/src/utils/accessMapping.ts`
- **函数**: `hasPermissionForAction(perms, action)`
- **功能**: 检查用户权限列表中是否包含指定权限
- **继承规则**: 
  - `write` 权限自动包含 `read` 权限
  - `clouds.console:read` 包含所有 `clouds.*:read` 权限（除 `clouds.dashboard`）

---

## 3. 权限设计规范

### 3.1 权限标识规范

#### 3.1.1 命名格式
```
{domain}.{resource}:{verb}
```

- **domain**: 功能域（固定为 `clouds`）
- **resource**: 资源类型（如 `ecs`, `vpcs`, `disks`）
- **verb**: 操作类型（`read` 或 `write`）

#### 3.1.2 权限列表
```typescript
// 资源控制台权限
'clouds.dashboard:read'      // 资源总览 - 查看
'clouds.dashboard:write'     // 资源总览 - 编辑
'clouds:read'                // 资源池列表 - 查看
'clouds:write'               // 资源池管理 - 创建/编辑/删除
'clouds.ecs:read'            // 云主机列表 - 查看
'clouds.ecs:write'           // 云主机管理 - 创建/启动/停止/删除
'clouds.vpcs:read'           // VPC 列表 - 查看
'clouds.vpcs:write'          // VPC 管理 - 创建/编辑/删除
'clouds.disks:read'          // 云盘列表 - 查看
'clouds.disks:write'         // 云盘管理 - 创建/挂载/卸载/删除
'clouds.images:read'         // 镜像列表 - 查看
'clouds.images:write'        // 镜像管理 - 上传/删除
'clouds.namespaces:read'     // 命名空间列表 - 查看
'clouds.namespaces:write'    // 命名空间管理 - 创建/编辑/删除
'clouds.sshkeys:read'        // SSH密钥列表 - 查看
'clouds.sshkeys:write'       // SSH密钥管理 - 创建/删除
'clouds.snapshots:read'      // 快照列表 - 查看
'clouds.snapshots:write'      // 快照管理 - 创建/恢复/删除
'clouds.schedules:read'       // 定时任务列表 - 查看
'clouds.schedules:write'     // 定时任务管理 - 创建/编辑/删除
'clouds.console:read'         // 控制台访问 - 查看
'clouds.console:write'        // 控制台操作 - 执行命令
```

### 3.2 操作类型与权限映射

#### 3.2.1 只读操作（read）
需要 `{resource}:read` 权限的操作：
- 查看资源列表
- 查看资源详情
- 查看资源配置
- 查看资源状态
- 查看资源日志

#### 3.2.2 读写操作（write）
需要 `{resource}:write` 权限的操作：
- **创建资源**: 创建虚拟机、VPC、云盘等
- **修改资源**: 编辑配置、扩容、修改标签等
- **生命周期管理**: 启动、停止、重启、暂停、恢复
- **删除资源**: 删除虚拟机、VPC、云盘等
- **数据操作**: 创建快照、恢复快照、克隆、迁移
- **控制台操作**: VNC 访问、SSH 连接、执行命令

### 3.3 权限继承规则

#### 3.3.1 层级继承
```
clouds:write
  └─ clouds.ecs:write
      └─ clouds.ecs:read
```

- `clouds:write` 包含所有 `clouds.*:write` 权限
- `clouds.ecs:write` 包含 `clouds.ecs:read` 权限

#### 3.3.2 控制台权限继承
```
clouds.console:read
  └─ clouds.*:read (除 clouds.dashboard:read)
```

- `clouds.console:read` 包含所有资源类型的只读权限
- 用于支持"资源控制台只读"角色

---

## 4. 前端权限控制方案

### 4.1 按钮权限控制策略

#### 4.1.1 创建按钮
```typescript
// 需要 write 权限
const hasWrite = hasPermissionForAction(perms, 'clouds.ecs:write') || 
                 hasPermissionForAction(perms, 'clouds:write');

<Button 
  disabled={!hasWrite}
  onClick={() => {
    if (!hasWrite) {
      message.error('当前账号没有创建权限（需要 clouds.ecs:write 权限）');
      return;
    }
    // 执行创建操作
  }}
>
  创建实例
</Button>
```

#### 4.1.2 查看/详情按钮
```typescript
// 需要 read 权限
const hasRead = hasPermissionForAction(perms, 'clouds.ecs:read') || 
                hasPermissionForAction(perms, 'clouds:read') ||
                hasPermissionForAction(perms, 'clouds.console:read');

<Button 
  disabled={!hasRead}
  onClick={() => {
    if (!hasRead) {
      message.error('当前账号没有查看权限（需要 clouds.ecs:read 权限）');
      return;
    }
    // 执行查看操作
  }}
>
  查看详情
</Button>
```

#### 4.1.3 写操作按钮（启动、停止、删除等）
```typescript
// 需要 write 权限
const hasWrite = hasPermissionForAction(perms, 'clouds.ecs:write') || 
                 hasPermissionForAction(perms, 'clouds:write');

const actionItems = [
  // 只读操作 - 需要 read 权限
  {
    key: 'detail',
    label: '查看详情',
    disabled: !hasRead,
    onClick: () => handleShowDetail()
  },
  
  // 写操作 - 需要 write 权限
  {
    key: 'start',
    label: '启动',
    disabled: !hasWrite || isRunning,
    onClick: () => handleStart()
  },
  {
    key: 'stop',
    label: '停止',
    disabled: !hasWrite || isStopped,
    onClick: () => handleStop()
  },
  {
    key: 'delete',
    label: '删除',
    danger: true,
    disabled: !hasWrite || isImportant,
    onClick: () => handleDelete()
  }
];

// 如果没有任何权限，禁用整个操作菜单
<ResourceActionsDropdown 
  items={actionItems}
  buttonProps={{ 
    disabled: !hasRead && !hasWrite 
  }} 
/>
```

### 4.2 资源类型权限映射表

| 资源类型 | 组件文件 | Read 权限 | Write 权限 |
|---------|---------|----------|-----------|
| 云主机 | `VmSection.tsx` | `clouds.ecs:read` | `clouds.ecs:write` |
| VPC | `VpcsSection.tsx` | `clouds.vpcs:read` | `clouds.vpcs:write` |
| 子网 | `SubnetsSection.tsx` | `clouds.vpcs:read` | `clouds.vpcs:write` |
| 云盘 | `VolumesSection.tsx` | `clouds.disks:read` | `clouds.disks:write` |
| 镜像 | `ImagesSection.tsx` | `clouds.images:read` | `clouds.images:write` |
| 命名空间 | `NamespacesTab.tsx` | `clouds.namespaces:read` | `clouds.namespaces:write` |
| SSH密钥 | `SshKeysSection.tsx` | `clouds.sshkeys:read` | `clouds.sshkeys:write` |
| 快照 | `SnapshotsSection.tsx` | `clouds.snapshots:read` | `clouds.snapshots:write` |
| 备份 | `BackupsSection.tsx` | `clouds.ecs:read` | `clouds.ecs:write` |
| 定时备份 | `ScheduleBackupsSection.tsx` | `clouds.schedules:read` | `clouds.schedules:write` |
| 控制台 | `CloudConsole.tsx` | `clouds.console:read` | `clouds.console:write` |

### 4.3 批量操作权限控制

```typescript
// 批量操作需要 write 权限
const hasWrite = hasPermissionForAction(perms, 'clouds.ecs:write') || 
                 hasPermissionForAction(perms, 'clouds:write');

<Dropdown
  menu={{
    items: [
      {
        key: 'batchStop',
        label: '批量停止',
        disabled: !hasWrite || selectedKeys.length === 0,
        onClick: () => {
          if (!hasWrite) {
            message.error('当前账号没有批量操作权限（需要 clouds.ecs:write 权限）');
            return;
          }
          handleBatchStop();
        }
      },
      {
        key: 'batchDelete',
        label: '批量删除',
        danger: true,
        disabled: !hasWrite || selectedKeys.length === 0,
        onClick: () => {
          if (!hasWrite) {
            message.error('当前账号没有批量删除权限（需要 clouds.ecs:write 权限）');
            return;
          }
          handleBatchDelete();
        }
      }
    ]
  }}
>
  <Button icon={<EllipsisOutlined />} disabled={!hasWrite}></Button>
</Dropdown>
```

---

## 5. 后端权限控制方案

### 5.1 路由权限中间件

#### 5.1.1 统一权限检查
```typescript
// backend/src/routes/clouds.ts
const checkAdminPermission = createApiPermissionMiddleware({
  allowSuperAdmin: true,
});

// 所有路由都使用此中间件
router.get('/:id/resources/ecs', checkAdminPermission, handler);
router.post('/:id/resources/ecs', checkAdminPermission, handler);
router.delete('/:id/resources/ecs/:instanceId', checkAdminPermission, handler);
```

#### 5.1.2 权限解析逻辑
```typescript
// backend/src/permissions/registry.ts
resolveFromApi(method: string, path: string): string | null {
  // 1. 精确匹配 API 路径模式
  // 2. 模式匹配（支持通配符）
  // 3. 从定义中查找
  // 4. 基于路径模式自动推断（回退机制）
  
  // 示例：
  // GET  /api/clouds/:id/resources/ecs → clouds.ecs:read
  // POST /api/clouds/:id/resources/ecs → clouds.ecs:write
}
```

### 5.2 Handler 内部权限检查

#### 5.2.1 租户用户额外检查
```typescript
// handlers/ecs-direct-operations.handlers.ts
export const harvesterVmStartHandler = async (req: any, res: Response) => {
  // 1. 检查租户访问权限
  const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
  if (!allowed) {
    return res.status(403).json({ message: 'Access denied to this resource pool' });
  }
  
  // 2. 租户用户需要额外检查 clouds.console:write 权限
  if (isTenant) {
    const p = (req.user as any)?.permissions || [];
    if (!p.includes('clouds.console:write')) {
      return res.status(403).json({
        message: 'Permission denied: Requires clouds.console:write',
      });
    }
  }
  
  // 3. 执行操作
  // ...
};
```

### 5.3 权限错误响应

#### 5.3.1 标准错误格式
```typescript
// 权限不足
{
  "message": "Permission denied: Requires clouds.ecs:write",
  "code": "PERMISSION_DENIED",
  "required": "clouds.ecs:write"
}

// 资源访问受限（租户）
{
  "message": "Access denied to this resource pool",
  "code": "ACCESS_DENIED"
}
```

---

## 6. 实施计划

### 6.1 阶段一：前端权限控制完善（优先级：高）

#### 6.1.1 云主机操作按钮
- **文件**: `frontend/src/pages/Clouds/Harvester/sections/VmSection.tsx`
- **任务**:
  1. 为每个操作按钮添加权限检查
  2. 区分只读和读写操作
  3. 无权限时禁用按钮并显示提示
- **预计工作量**: 2-3 天

#### 6.1.2 其他资源类型操作按钮
- **文件**: 
  - `VolumesSection.tsx`
  - `ImagesSection.tsx`
  - `NamespacesTab.tsx`
  - `VpcsSection.tsx`
  - 等
- **任务**: 为每个资源类型的操作按钮添加权限检查
- **预计工作量**: 3-4 天

### 6.2 阶段二：权限工具函数优化（优先级：中）

#### 6.2.1 创建权限检查 Hook
```typescript
// frontend/src/hooks/useResourcePermission.ts
export const useResourcePermission = (resourceType: string) => {
  const { user } = useAuth();
  const perms = (user?.permissions ?? []) as string[];
  
  const hasRead = useMemo(() => {
    return hasPermissionForAction(perms, `${resourceType}:read`) ||
           hasPermissionForAction(perms, 'clouds:read') ||
           hasPermissionForAction(perms, 'clouds.console:read');
  }, [perms, resourceType]);
  
  const hasWrite = useMemo(() => {
    return hasPermissionForAction(perms, `${resourceType}:write`) ||
           hasPermissionForAction(perms, 'clouds:write');
  }, [perms, resourceType]);
  
  return { hasRead, hasWrite };
};
```

#### 6.2.2 使用示例
```typescript
// 在组件中使用
const { hasRead, hasWrite } = useResourcePermission('clouds.ecs');

<Button disabled={!hasWrite} onClick={handleCreate}>
  创建实例
</Button>
```

### 6.3 阶段三：测试与验证（优先级：高）

#### 6.3.1 权限测试场景
1. **只读用户测试**:
   - 只能查看资源列表和详情
   - 不能看到创建、编辑、删除按钮
   - 尝试访问写操作 API 应返回 403

2. **读写用户测试**:
   - 可以查看和操作所有资源
   - 所有按钮正常显示和可用

3. **租户用户测试**:
   - 只能访问分配的命名空间
   - 需要 `clouds.console:write` 权限才能执行写操作

#### 6.3.2 测试用例
```typescript
// 测试用例示例
describe('Cloudmap Permission Control', () => {
  it('只读用户不能看到创建按钮', () => {
    // 设置只读权限
    // 验证创建按钮被禁用或隐藏
  });
  
  it('只读用户不能执行写操作', () => {
    // 设置只读权限
    // 尝试执行写操作
    // 验证返回 403 错误
  });
  
  it('读写用户可以看到所有按钮', () => {
    // 设置读写权限
    // 验证所有按钮正常显示
  });
});
```

### 6.4 阶段四：文档与培训（优先级：低）

#### 6.4.1 用户文档
- 编写权限配置指南
- 说明各权限的作用范围
- 提供权限配置示例

#### 6.4.2 开发文档
- 更新前端开发规范
- 说明如何为新资源类型添加权限控制
- 提供权限检查最佳实践

---

## 7. 权限配置示例

### 7.1 只读角色配置
```json
{
  "name": "资源控制台只读",
  "permissions": [
    "clouds.console:read",
    "clouds.ecs:read",
    "clouds.vpcs:read",
    "clouds.disks:read",
    "clouds.images:read",
    "clouds.namespaces:read"
  ]
}
```

### 7.2 读写角色配置
```json
{
  "name": "资源控制台管理员",
  "permissions": [
    "clouds.console:read",
    "clouds.console:write",
    "clouds.ecs:read",
    "clouds.ecs:write",
    "clouds.vpcs:read",
    "clouds.vpcs:write",
    "clouds.disks:read",
    "clouds.disks:write",
    "clouds.images:read",
    "clouds.images:write"
  ]
}
```

### 7.3 租户用户配置
```json
{
  "name": "租户用户",
  "permissions": [
    "clouds.console:read",
    "clouds.console:write",
    "clouds.ecs:read",
    "clouds.ecs:write"
  ],
  "userSpace": {
    "cloudId": "xxx",
    "namespace": "tenant-1,tenant-2"
  }
}
```

---

## 8. 注意事项

### 8.1 权限继承
- `clouds:write` 包含所有 `clouds.*:write` 权限
- `clouds.ecs:write` 包含 `clouds.ecs:read` 权限
- 配置角色时注意避免权限冗余

### 8.2 控制台权限
- `clouds.console:read` 包含所有资源类型的只读权限
- `clouds.console:write` 用于控制台内的写操作
- 租户用户执行写操作需要同时具备 `clouds.console:write` 权限

### 8.3 前后端一致性
- 前端按钮控制必须与后端 API 权限检查保持一致
- 前端可以提前拦截无权限操作，提升用户体验
- 后端必须进行权限检查，防止绕过前端限制

### 8.4 错误提示
- 权限不足时提供清晰的错误信息
- 说明需要什么权限
- 提供权限申请指引

---

## 9. 附录

### 9.1 相关文件清单

#### 后端文件
- `backend/src/routes/clouds.ts` - 路由权限中间件
- `backend/src/permissions/registry.ts` - 权限解析
- `backend/src/permissions/middleware.ts` - 权限中间件
- `backend/src/routes/clouds/harvester/handlers/*.ts` - 各资源类型的 Handler

#### 前端文件
- `frontend/src/utils/accessMapping.ts` - 权限检查工具
- `frontend/src/pages/Clouds/Harvester/sections/*.tsx` - 各资源类型的组件
- `frontend/src/pages/Clouds/Cloudmap/CloudDetailCloudmap.tsx` - Cloudmap 详情页

### 9.2 权限标识完整列表
参考: `backend/src/constants/permissions.ts`

### 9.3 API 路径与权限映射
参考: `backend/src/permissions/registry.ts` 的 `inferPermissionFromPath` 方法

---

## 10. 版本历史

| 版本 | 日期 | 作者 | 说明 |
|-----|------|------|------|
| 1.0 | 2024-XX-XX | AI Assistant | 初始版本 |

---

**文档状态**: 设计阶段  
**最后更新**: 2024-XX-XX
