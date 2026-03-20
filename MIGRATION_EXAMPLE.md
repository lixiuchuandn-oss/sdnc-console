# 迁移后的架构示例

## 📁 文件结构

```
backend/src/routes/clouds/harvester/
├── handlers/
│   ├── logging-clusterflows.handlers.ts    # ClusterFlow 相关操作
│   ├── logging-clusteroutputs.handlers.ts   # ClusterOutput 相关操作
│   ├── logging-flows.handlers.ts            # Flow (命名空间级别) 相关操作
│   ├── logging-outputs.handlers.ts          # Output (命名空间级别) 相关操作
│   ├── monitoring-overview.handlers.ts      # 监控概览相关操作
│   ├── monitoring-alerts.handlers.ts        # 告警相关操作
│   └── monitoring-rules.handlers.ts         # 告警规则相关操作
├── harvester.service.routes.provider.ts      # 服务路由注册（新）
├── harvester.cache.routes.ts                # 资源路由注册（现有）
└── harvester.direct.routes.ts               # 直连路由注册（现有）
```

## 🔄 迁移前后对比

### ❌ 迁移前（logging.routes.ts）

```typescript
// 问题1: 代码重复
async function getCloudAndConn(id: string, res: Response) {
  const repo = AppDataSource.getRepository(Cloud);
  const cloud = await repo.findOne({ where: { id } });
  // ... 重复的逻辑
}

// 问题2: 重复的权限检查
async function getTenantAccess(req: any, cloudId: string) {
  // ... 与 harvester.direct.helpers.ts 中 checkTenantAccess 几乎相同的逻辑
}

// 问题3: 直接在路由中实现业务逻辑
export function registerLoggingRoutes(router: Router, _checkAdminPermission: any) {
  router.get('/:id/logging/clusterflows', async (req: any, res: Response) => {
    const conn = await getCloudAndConn(req.params.id, res);
    if (!conn) return;
    // ... 业务逻辑混在路由中
  });
}
```

### ✅ 迁移后

#### 1. Handlers 文件（handlers/logging-clusterflows.handlers.ts）

```typescript
import { Request, Response } from 'express';
import { checkTenantAccess, fetchCloudOr404, ensureProvider } from '../harvester.direct.helpers';
import { getJsonOnce, requestJson } from '../../../../services/clouds/harvester/utils';

/**
 * GET /:id/logging/clusterflows - 获取 ClusterFlow 列表
 */
export async function harvesterClusterFlowListHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    
    // ✅ 复用统一的权限检查
    const { allowed } = await checkTenantAccess(req as any, id);
    if (!allowed) return res.status(403).json({ message: '无权访问' });

    // ✅ cloud 对象已由 provider-router 中间件注入到 req.cloud
    const cloud = (req as any).cloud;
    
    // ✅ 复用统一的 provider 校验
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap')) return;
    
    // 业务逻辑
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const url = `${origin}/v1/harvester/logging.banzaicloud.io.clusterflows?...`;
    const data = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
    res.json(data);
  } catch (e: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: e?.message || '请求失败' });
  }
}
```

#### 2. 路由注册文件（harvester.service.routes.provider.ts）

```typescript
import { Router, RequestHandler } from 'express';
import { createProviderRouter } from '../middleware/provider-router';
import {
  harvesterClusterFlowListHandler,
  harvesterClusterFlowDetailHandler,
  harvesterClusterFlowCreateHandler,
  harvesterClusterFlowUpdateHandler,
  harvesterClusterFlowDeleteHandler,
} from './handlers/logging-clusterflows.handlers';

export function registerHarvesterServiceRoutesProvider(
  router: Router,
  checkAdminPermission: RequestHandler
) {
  // ✅ 使用策略模式：为不同 provider 映射相同的 handler
  const clusterFlowListHandlers = {
    harvester: harvesterClusterFlowListHandler,
    cloudmap: harvesterClusterFlowListHandler,
    'cloudmap.private': harvesterClusterFlowListHandler,
    'cloudmap.edge': harvesterClusterFlowListHandler,
  };

  // ✅ 使用 provider-router 中间件自动分发
  router.get(
    '/:id/logging/clusterflows',
    checkAdminPermission,
    createProviderRouter(clusterFlowListHandlers)  // 自动根据 cloud.provider 选择 handler
  );

  // ... 其他路由
}
```

#### 3. 主路由注册（clouds.ts）

```typescript
// ✅ 迁移前
import {
  registerHarvesterDirectRoutes,
  registerHarvesterRoutes,
  registerMonitoringRoutes,  // ❌ 独立注册
  registerLoggingRoutes,      // ❌ 独立注册
} from './clouds/harvester';

registerHarvesterDirectRoutes(router, checkAdminPermission);
registerHarvesterRoutes(router, checkAdminPermission);
registerMonitoringRoutes(router, checkAdminPermission);  // ❌
registerLoggingRoutes(router, checkAdminPermission);      // ❌

// ✅ 迁移后
import {
  registerHarvesterDirectRoutes,
  registerHarvesterRoutes,
  registerHarvesterServiceRoutesProvider,  // ✅ 统一的服务路由注册
} from './clouds/harvester';

registerHarvesterDirectRoutes(router, checkAdminPermission);
registerHarvesterRoutes(router, checkAdminPermission);
registerHarvesterServiceRoutesProvider(router, checkAdminPermission);  // ✅
```

## 🎯 迁移后的优势

### 1. **代码复用**
- ✅ 复用 `harvester.direct.helpers.ts` 中的 `checkTenantAccess`、`fetchCloudOr404`、`ensureProvider`
- ✅ 消除重复的 `getCloudAndConn`、`getTenantAccess` 函数

### 2. **架构统一**
- ✅ 使用 `provider-router` 中间件，与其他路由保持一致
- ✅ Handlers 文件结构清晰，易于维护

### 3. **职责分离**
- ✅ **Handlers**: 纯业务逻辑，不关心路由细节
- ✅ **Routes Provider**: 只负责路由注册和 handler 映射
- ✅ **Middleware**: 统一处理 provider 识别和 cloud 对象注入

### 4. **易于扩展**
- ✅ 添加新的 provider 只需在 handlers 映射中添加一行
- ✅ 添加新的日志/监控功能只需创建新的 handler 文件

## 📊 代码量对比

| 项目 | 迁移前 | 迁移后 | 减少 |
|------|--------|--------|------|
| 重复的 helper 函数 | ~150 行 | 0 行 | -150 行 |
| 路由注册代码 | ~200 行 | ~100 行 | -100 行 |
| 业务逻辑代码 | ~800 行 | ~800 行 | 0 行（但更清晰） |
| **总计** | **~1150 行** | **~900 行** | **-250 行** |

## 🔍 关键改进点

1. **自动注入 cloud 对象**
   - `provider-router` 中间件自动从数据库获取 Cloud 对象并注入到 `req.cloud`
   - Handlers 无需重复查询数据库

2. **统一的错误处理**
   - 所有 handlers 使用相同的错误处理模式
   - 统一的权限检查流程

3. **类型安全**
   - Handlers 使用标准的 Express `Request` 和 `Response` 类型
   - `req.cloud` 通过类型断言访问（已在中间件中验证）

4. **易于测试**
   - Handlers 是纯函数，易于单元测试
   - 可以 mock `req.cloud` 对象进行测试
