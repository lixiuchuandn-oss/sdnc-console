# 权限定义中心

这是新的权限体系的核心模块，提供了统一的权限管理、检查和继承机制。

## 核心组件

### 1. PermissionRegistry（权限注册表）
管理所有权限定义，提供权限查询和路径解析功能。

```typescript
import { permissionRegistry } from './permissions';

// 从 API 路径解析权限
const permId = permissionRegistry.resolveFromApi('GET', '/api/clouds/123/resources/ecs');
// 返回: 'clouds.ecs'

// 获取权限定义
const def = permissionRegistry.get('clouds.ecs:read');
// 返回: PermissionDefinition 对象
```

### 2. InheritanceEngine（继承引擎）
处理权限继承关系，支持层级继承、动词继承和自定义继承。

```typescript
import { inheritanceEngine } from './permissions';

// 获取权限继承的父权限
const inherited = inheritanceEngine.getInheritedPermissions('clouds.ecs:read');
// 返回: ['clouds:read']

// 获取权限包含的子权限（反向继承）
const implied = inheritanceEngine.getImpliedPermissions(['clouds:read']);
// 返回: ['clouds.ecs:read', 'clouds.vpcs:read', ...]
```

### 3. PermissionChecker（权限检查器）
统一的权限检查逻辑，支持精确匹配、继承匹配和通配符匹配。

```typescript
import { permissionChecker } from './permissions';

const userPerms = ['clouds:read', 'clouds.ecs:write'];

// 检查单个权限
permissionChecker.check(userPerms, 'clouds.ecs:read');
// 返回: true（因为 clouds:read 包含 clouds.ecs:read）

// 检查任一权限
permissionChecker.checkAny(userPerms, ['clouds.vpcs:read', 'clouds.ecs:read']);
// 返回: true

// 检查所有权限
permissionChecker.checkAll(userPerms, ['clouds:read', 'clouds.ecs:write']);
// 返回: true
```

## 使用方式

### 在路由中使用中间件

```typescript
import { createApiPermissionMiddleware, requirePermission } from './permissions';

// 方式1：自动从 API 路径解析权限
router.get('/clouds/:id/resources/ecs', 
  createApiPermissionMiddleware(),
  async (req, res) => {
    // 处理请求
  }
);

// 方式2：明确指定权限
router.post('/clouds', 
  requirePermission('clouds:write'),
  async (req, res) => {
    // 处理请求
  }
);

// 方式3：自定义权限解析
router.put('/clouds/:id', 
  createPermissionMiddleware((req) => {
    const method = req.method;
    const isRead = method === 'GET' || method === 'HEAD';
    return isRead ? 'clouds:read' : 'clouds:write';
  }),
  async (req, res) => {
    // 处理请求
  }
);
```

### 在代码中直接检查权限

```typescript
import { checkPermission, hasAnyPermission } from './permissions';

// 在业务逻辑中检查权限
if (checkPermission(user.permissions, 'clouds.ecs:write')) {
  // 允许操作
} else {
  // 拒绝操作
}
```

## 权限定义格式

权限定义采用 `domain.feature:verb` 格式：

- `domain`: 功能域（如 `clouds`, `tenants`, `system`）
- `feature`: 具体功能（如 `ecs`, `vpcs`, `roles`）
- `verb`: 操作类型（`read`=读取, `write`=写入）

示例：
- `clouds.ecs:read` - 查看云主机
- `clouds.ecs:write` - 管理云主机
- `tenants:read` - 查看租户
- `system.roles:write` - 管理角色

## 权限继承规则

### 层级继承
- `clouds:read` 包含所有 `clouds.*:read` 权限
- `clouds.ecs:read` 包含所有 `clouds.ecs.*:read` 权限

### 动词继承
- `write` 权限自动包含 `read` 权限
- `admin` 权限自动包含 `read` 和 `write` 权限

### 自定义继承
可以在 `rules.ts` 中定义自定义继承规则。

## 迁移指南

### 从旧权限检查迁移

**旧代码（已废弃）：**
```typescript
import { checkPermission } from '../utils/permission';  // ❌ 已废弃

if (checkPermission(user.permissions, 'clouds.ecs:read')) {
  // ...
}
```

**新代码：**
```typescript
import { checkPermission } from '../permissions';  // ✅ 使用新权限体系

if (checkPermission(user.permissions, 'clouds.ecs:read')) {
  // ...
}
```

接口完全兼容，可以直接替换导入路径。新权限体系提供了相同的函数，但功能更强大（支持权限继承、更好的错误提示等）。

### 从旧中间件迁移

**旧代码（已废弃）：**
```typescript
import { checkAdminPermission } from '../routes/clouds';  // ❌ 已废弃

router.get('/clouds/:id/resources/ecs', checkAdminPermission, handler);
```

**新代码：**
```typescript
import { createApiPermissionMiddleware } from '../permissions';  // ✅ 使用新权限体系

router.get('/clouds/:id/resources/ecs', 
  createApiPermissionMiddleware(),
  handler
);
```

新权限体系提供了更强大的功能：
- 自动从 API 路径解析权限
- 支持权限继承
- 更好的错误提示
- 向后兼容（如果无法解析，会回退到旧的路径匹配逻辑）

## 文件结构

```
permissions/
├── types.ts          # 类型定义
├── definitions.ts    # 权限定义数据
├── rules.ts          # 继承规则配置
├── registry.ts       # 权限注册表
├── inheritance.ts    # 继承引擎
├── checker.ts        # 权限检查器
├── middleware.ts     # Express 中间件
├── index.ts          # 统一导出
└── README.md         # 本文档
```

## 扩展权限

### 添加新权限

1. 在 `definitions.ts` 中添加权限定义
2. 配置 API 路径模式（如果需要）
3. 配置继承关系（如果需要）

示例：
```typescript
{
  id: 'clouds.new-feature:read',
  name: '新功能查看',
  description: '查看新功能',
  platform: 'CNMC',
  group: '资源控制台',
  category: 'compute',
  verb: 'read',
  inherits: ['clouds:read'],
  apiPatterns: [
    { method: 'GET', pathPattern: '/api/clouds/*/resources/new-feature' }
  ]
}
```

### 添加继承规则

在 `rules.ts` 中添加新的继承规则：

```typescript
{
  type: 'custom',
  custom: {
    from: 'clouds.console:read',
    to: 'clouds.*:read'
  }
}
```

## 注意事项

1. **向后兼容**：新的权限体系与旧的权限字符串格式完全兼容
2. **性能**：权限检查结果会被缓存，提高性能
3. **安全性**：所有权限检查都经过统一验证，确保安全性
4. **可扩展性**：新增权限和规则无需修改核心逻辑
