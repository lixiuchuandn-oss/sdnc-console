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

### 6.5 待整改按钮全量清单（核对用）

> **用途**：实施与验收时逐项勾选。**待整改**含义：须为该入口单独绑定 `read` / `write`（及租户场景下的 `clouds.console:write` 等），禁止仅用「`hasEcsRead || hasEcsWrite || hasConsoleRead`（hasAnyPermission）」控制整组操作菜单，导致只读用户仍可见写操作。  
> **范围**：`frontend/src/pages/Clouds/Harvester` 及文档 §4.2 所列组件；若界面文案与代码不一致，以代码为准。  
> **图例**：✅ 已按 write/read 区分 · ⚠️ 待整改 · 📌 只读入口用 read

#### 6.5.1 云主机 — `sections/VmSection.tsx`

| # | 入口位置 | 按钮/菜单文案（或 key） | 建议权限 | 状态 |
|---|----------|-------------------------|----------|------|
| 1 | 工具栏 | 创建实例 | `clouds.ecs:write` 或 `clouds:write` | ✅ 已实现点击校验 |
| 2 | 工具栏 Dropdown | 批量停止 | `clouds.ecs:write` 或 `clouds:write` | ⚠️ 待加 write 禁用/拦截 |
| 3 | 工具栏 Dropdown | 批量重启 | 同上 | ⚠️ |
| 4 | 工具栏 Dropdown | 批量删除 | 同上 | ⚠️ |
| 5 | 工具栏 | 刷新 | `clouds.ecs:read` 或继承 read | 📌 建议明确 read |
| 6 | 工具栏 | 列设置 | UI 偏好，可与 read 同级或不限 | 📌 可选 |
| 7 | 表格行 `ResourceActionsDropdown` | 打开详情 / 详情抽屉（vm_detail 等） | `clouds.ecs:read` 等 | 📌 逐项 `disabled` 绑定 read |
| 8 | 同上 | Web VNC / 控制台类 | `clouds.console:read` 打开；若后端按 write 校验则叠加 write | ⚠️ 与 §5.2.1 租户规则对齐 |
| 9 | 同上 | 运维信息 / 原始 YAML（只读查看） | `clouds.ecs:read` | 📌 |
| 10 | 同上 | 重新配置 | `clouds.ecs:write` | ⚠️ |
| 11 | 同上 | 启动 | `clouds.ecs:write` | ⚠️ |
| 12 | 同上 | 停止 / 强制停止 | `clouds.ecs:write` | ⚠️ |
| 13 | 同上 | 重启 | `clouds.ecs:write` | ⚠️ |
| 14 | 同上 | 软重启（若有） | `clouds.ecs:write` | ⚠️ |
| 15 | 同上 | 暂停 | `clouds.ecs:write` | ⚠️ |
| 16 | 同上 | 恢复（取消暂停） | `clouds.ecs:write` | ⚠️ |
| 17 | 同上 | 热迁移 | `clouds.ecs:write` | ⚠️ |
| 18 | 同上 | 中止迁移 | `clouds.ecs:write` | ⚠️ |
| 19 | 同上 | 设为重要实例 / 取消重要标记 | `clouds.ecs:write` | ⚠️ |
| 20 | 同上 | 备份 | `clouds.ecs:write`（及快照/备份 API 映射） | ⚠️ |
| 21 | 同上 | 快照 | `clouds.snapshots:write` 或 `clouds.ecs:write`（与 registry 一致） | ⚠️ |
| 22 | 同上 | 克隆 | `clouds.ecs:write` | ⚠️ |
| 23 | 同上 | 另存为模板 / 保存为模板 | `clouds.ecs:write` | ⚠️ |
| 24 | 同上 | 删除 | `clouds.ecs:write` | ⚠️ |
| 25 | 同上 | 磁盘扩容指南（仅说明 Modal） | `clouds.ecs:read` | 📌 |
| 26 | 同上 | 从虚拟机分离数据卷 / 删卷相关 | `clouds.ecs:write` 或 `clouds.disks:write`（与 API 一致） | ⚠️ |
| 27 | 行操作按钮容器 | `buttonProps.disabled` 仅用 `hasAnyPermission` | 应拆为：无 read 且无 write 时禁用整钮；菜单内分项 | ⚠️ 核心问题见 §2.2.2 |

#### 6.5.2 云主机详情抽屉 — `components/HarvesterVmDetailDrawer.tsx`

| # | 入口位置 | 按钮/菜单文案 | 建议权限 | 状态 |
|---|----------|---------------|----------|------|
| 1 | 标题区 | 刷新 | read | 📌 |
| 2 | 工具栏 | 打开终端 | `clouds.console:write` 或按后端实际校验 | ⚠️ |
| 3 | 工具栏 | 开机 | `clouds.ecs:write` | ⚠️ |
| 4 | 工具栏 | 关机 | `clouds.ecs:write` | ⚠️ |
| 5 | 工具栏 | 重启 | `clouds.ecs:write` | ⚠️ |
| 6 | 工具栏 | 暂停 | `clouds.ecs:write` | ⚠️ |
| 7 | 工具栏 | 恢复 | `clouds.ecs:write` | ⚠️ |
| 8 | 工具栏 Dropdown「更多」 | 备份 | `clouds.ecs:write` | ⚠️ |
| 9 | 同上 | 快照 | `clouds.snapshots:write` 或 `clouds.ecs:write` | ⚠️ |
| 10 | 同上 | 克隆 | `clouds.ecs:write` | ⚠️ |
| 11 | 同上 | 保存为模板 | `clouds.ecs:write` | ⚠️ |
| 12 | 同上 | 资源变配 | `clouds.ecs:write` | ⚠️ |
| 13 | 同上 | 热迁移 / 中止迁移 | `clouds.ecs:write` | ⚠️ |
| 14 | 同上 | 弹出 CD-ROM | `clouds.ecs:write` | ⚠️ |
| 15 | 同上 | 强制停止 | `clouds.ecs:write` | ⚠️ |
| 16 | 同上 | 删除 | `clouds.ecs:write` | ⚠️ |
| 17 | Tab 内（备份/快照/磁盘等） | 恢复、删除备份、创建定时策略等写操作 | 按 §4.2 `clouds.ecs` / `clouds.schedules` / `clouds.snapshots` | ⚠️ 需逐 Tab 核对 |

#### 6.5.3 文档 §4.2 所列其他 Section（行操作/工具栏/弹窗内按钮）

以下文件内：**凡创建、编辑、删除、挂载、卸载、启停、上传、恢复、启用/停用策略**等均为 **write**；**仅查看、打开只读详情/运维信息**为 **read**。请为每个 `Button` / `Dropdown` / `ResourceActionsDropdown` 项补齐与下表一致的权限变量。

| 文件（相对 `frontend/src/pages/Clouds/Harvester`） | Read 权限 | Write 权限 | 待整改说明 |
|---------------------------------------------------|-----------|------------|------------|
| `sections/VolumesSection.tsx` | `clouds.disks:read` | `clouds.disks:write` | 创建卷、挂载/卸载、删除、扩容提交等全部写入口 |
| `sections/ImagesSection.tsx` | `clouds.images:read` | `clouds.images:write` | 上传、删除、编辑等 |
| `sections/NamespacesTab.tsx` 或命名空间 Tab 实现路径 | `clouds.namespaces:read` | `clouds.namespaces:write` | 创建/编辑/删除命名空间 |
| `kube-ovn/VpcsSection.tsx` | `clouds.vpcs:read` | `clouds.vpcs:write` | VPC 创建/编辑/删除及行操作 |
| `kube-ovn/SubnetsSection.tsx`（若存在） | `clouds.vpcs:read` | `clouds.vpcs:write` | 子网 CRUD |
| `sections/SshKeysSection.tsx` | `clouds.sshkeys:read` | `clouds.sshkeys:write` | 创建/删除密钥 |
| `sections/SnapshotsSection.tsx` | `clouds.snapshots:read` | `clouds.snapshots:write` | 创建/恢复/删除快照 |
| 备份列表 `sections/*Backup*` 或等价 | `clouds.ecs:read` | `clouds.ecs:write` | 恢复/删除备份 |
| `sections/ScheduleVmBackupsSection.tsx` | `clouds.schedules:read` | `clouds.schedules:write` | 策略修改、启用/停用、删除；运维信息只读项用 read |
| `pages/.../CloudConsole.tsx`（若独立页） | `clouds.console:read` | `clouds.console:write` | 控制台交互 |

#### 6.5.4 扩展与集群级模块（同样禁止「仅有 read 却展示写按钮」）

| 文件/模块 | 典型写操作入口 | 建议权限（与 `registry` 对齐） | 状态 |
|-----------|----------------|-------------------------------|------|
| `sections/TemplatesSection.tsx` | 创建/删除/从模板部署等 | `clouds.ecs:write` 或独立 templates 权限（若有） | ⚠️ |
| `sections/RecycleBinSection.tsx` | 恢复、彻底删除 | `clouds.ecs:write` 或资源级 write | ⚠️ |
| `sections/VmCreateTasksSection.tsx` | 取消、重试等 | `clouds.ecs:write` | ⚠️ |
| `sections/IPPoolsSection.tsx` | 创建地址池、删除 | `clouds.ippools:write`（已有创建示例时需统一行操作） | ⚠️ |
| `sections/UsbDevicesSection.tsx` | 设为直通 / 设为非直通 | write（集群或 USB 资源写权限） | ⚠️ |
| 同上 | 查看 MetaData | read | 📌 |
| `sections/GpusSection.tsx` | 绑定/解绑等写操作 | 与后端路由权限一致 | ⚠️ |
| `sections/ServicesSection.tsx`、`Ingresses`、`LoadBalancers` 等 | 创建/编辑/删除 | 按 `registry` 推断的 `clouds.*` | ⚠️ |
| `sections/CloudInitsSection.tsx` | 创建/删除 CloudInit | 按实际 API 映射 | ⚠️ |
| `sections/NodesSection.tsx` | 维护模式、驱逐等写操作 | 按实际 API 映射 | ⚠️ |
| `sections/MigrationsSection.tsx` | 中止等写操作 | `clouds.ecs:write` 等 | ⚠️ |
| `kube-ovn/EipSection.tsx`、`FipSection.tsx`、`SnatSection.tsx`、`DnatSection.tsx` | 创建/绑定/删除规则 | `clouds.vpcs:write` 或 OVN 专用权限 | ⚠️ |
| `CloudDetailHarvester.tsx` | Tab 可见性与内部按钮一致 | 避免无 write 仍可进入仅写 Tab | ⚠️ 可选增强 |

#### 6.5.5 Cloudmap 入口页（若与 Harvester 分离）

| 文件 | 说明 |
|------|------|
| `frontend/src/pages/Clouds/Cloudmap/CloudDetailCloudmap.tsx` | 若内嵌或跳转至上述 Section，权限应与 Harvester 详情页一致；单独存在的创建/管理按钮按 `clouds` / `clouds.ecs` 等补齐。 |

#### 6.5.6 验收勾选原则

1. 只读角色：所有标 ⚠️ write 的按钮应禁用或隐藏；点击 read 项正常。  
2. 读写角色：read/write 项均可达（租户另验 `clouds.console:write`）。  
3. 每完成一个文件，将上表对应行「状态」改为 ✅ 并在 PR 中注明。

### 6.6 当前整改进度（2026-03-20）

> 本节用于记录本轮“Cloudmap 资源池详情页按钮级权限控制”实际落地情况。  
> 口径统一为：**无 write 时禁用写按钮/行操作入口（不展开）**；**Tooltip 不展示“当前账号没有...”文案**；**异常点击保留 `message.error` 兜底**。

#### 6.6.1 已完成（✅）

- ✅ `sections/VmSection.tsx`：创建、批量、行操作入口、删除等写动作按 `clouds.ecs:write`/`clouds:write` 控制。
- ✅ `components/HarvesterVmDetailDrawer.tsx`：工具栏与更多菜单写动作按 write 控制；异常点击保留错误提示。
- ✅ `components/HarvesterVmBackupTab.tsx`：恢复/删除/创建类动作按 write 控制。
- ✅ `sections/RecycleBinSection.tsx`：恢复、彻底删除、任务配置等按 write 控制。
- ✅ `sections/VolumesSection.tsx`：创建、批量删除、编辑、挂载/卸载、导出、快照、克隆、删除按 `clouds.disks:write` 控制。
- ✅ `sections/ImagesSection.tsx`：创建、批量删除、删除按 `clouds.images:write` 控制。
- ✅ `sections/ScheduleVmBackupsSection.tsx`：创建、编辑、启停、删除按 `clouds.schedules:write` 控制。
- ✅ `sections/BackupsSection.tsx`：创建、恢复、删除按 `clouds.ecs:write` 控制。
- ✅ `sections/SnapshotsSection.tsx`：恢复、删除、批量删除按 `clouds.snapshots:write` 控制。
- ✅ `sections/SshKeysSection.tsx`：创建、删除、批量删除按 `clouds.sshkeys:write` 控制。
- ✅ `sections/CloudInitsSection.tsx`：写操作入口按 `clouds.cloudinits:write` 控制（删除功能当前为占位）。
- ✅ `sections/TemplatesSection.tsx`：模板建机、删除、批量删除按 `clouds.templates:write` 控制。
- ✅ `sections/NamespacesTab.tsx`：新增/编辑按 `clouds.namespaces:write` 控制（当前无删除功能）。
- ✅ `sections/NadsSection.tsx`：创建网络、批量删除、行删除菜单入口按 `clouds.nads:write` 控制。
- ✅ `kube-ovn/VpcsSection.tsx`：创建/编辑/删除 VPC、新增/编辑/删除子网按 `clouds.vpcs:write` 控制。
- ✅ `kube-ovn/SubnetsSection.tsx`：新建/编辑/删除子网按 `clouds.vpcs:write` 控制。
- ✅ `kube-ovn/EipSection.tsx`：创建/删除按 `clouds.vpcs:write` 控制。
- ✅ `kube-ovn/FipSection.tsx`：创建/删除按 `clouds.vpcs:write` 控制。
- ✅ `kube-ovn/SnatSection.tsx`：创建/删除按 `clouds.vpcs:write` 控制。
- ✅ `kube-ovn/DnatSection.tsx`：创建/删除按 `clouds.vpcs:write` 控制。

#### 6.6.2 本轮同步修正（✅）

- ✅ `pages/Clouds/Cloudmap/CloudDetailCloudmap.tsx` 权限 key 对齐：`clouds.volumes:read` -> `clouds.disks:read`；`clouds.backups:read` -> `clouds.ecs:read`。
- ✅ `NamespacesTab` 需求口径修正：当前页面仅有创建/编辑，不包含删除命名空间操作。

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
