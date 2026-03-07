# 请求管理器使用说明

## 功能概述

请求管理器（`requestManager`）为 API 请求提供了以下功能：

1. **请求去重** - 相同请求只发送一次，避免重复请求
2. **请求缓存** - GET 请求自动缓存，减少服务器压力
3. **请求重试** - 失败自动重试，提高请求成功率

## 使用方式

### 基本使用

所有通过 `apiRequest`、`apiPost`、`apiPatch`、`apiDelete` 的请求都会自动启用这些功能：

```typescript
import { apiRequest, apiPost } from '../services/api';

// GET 请求：自动启用缓存和去重
const data = await apiRequest('/api/clouds');

// 跳过缓存强制刷新
const freshData = await apiRequest('/api/clouds', { skipCache: true });

// POST 请求：自动启用去重和重试（不缓存）
const result = await apiPost('/api/clouds', { name: 'test' });
```

### 配置选项

如果需要自定义配置，可以直接使用 `requestManager`：

```typescript
import { requestManager } from '../utils/requestManager';
import { API_BASE_URL, getAuthHeaders } from '../services/api';

const data = await requestManager(
  {
    method: 'GET',
    endpoint: '/api/clouds',
    headers: getAuthHeaders(),
    options: {
      enableDeduplication: true,  // 启用去重（默认：true）
      enableCache: true,          // 启用缓存（默认：GET 为 true，其他为 false）
      cacheTTL: 5 * 60 * 1000,   // 缓存时间 5 分钟（默认：5 分钟）
      enableRetry: true,          // 启用重试（默认：true）
      retryCount: 2,              // 最大重试次数（默认：2）
      retryDelay: 1000,           // 重试延迟基数（默认：1000ms，指数退避）
      skipCache: false,           // 跳过缓存（默认：false）
    },
  },
  API_BASE_URL
);
```

## 功能详解

### 1. 请求去重

**工作原理**：
- 相同请求（相同 method、endpoint、body）同时发起时，只发送一次
- 其他请求会等待第一个请求完成，共享结果

**适用场景**：
- 页面快速切换导致重复请求
- 多个组件同时请求相同数据
- 用户快速点击按钮

**示例**：
```typescript
// 同时发起 3 个相同请求，实际只发送 1 次
Promise.all([
  apiRequest('/api/clouds'),
  apiRequest('/api/clouds'),
  apiRequest('/api/clouds'),
]);
```

### 2. 请求缓存

**工作原理**：
- 仅 GET 请求会被缓存
- 缓存时间默认 5 分钟
- 相同请求在缓存有效期内直接返回缓存结果

**适用场景**：
- 列表数据（云资源、用户列表等）
- 配置信息（系统设置、权限信息等）
- 不经常变化的数据

**跳过缓存**：
```typescript
// 强制刷新，跳过缓存
const data = await apiRequest('/api/clouds', { skipCache: true });
```

### 3. 请求重试

**工作原理**：
- 网络错误或 5xx 服务器错误会自动重试
- 默认最多重试 2 次
- 使用指数退避策略（延迟时间递增）

**重试策略**：
- 第 1 次重试：延迟 1 秒
- 第 2 次重试：延迟 2 秒
- 4xx 错误不重试（客户端错误）

**适用场景**：
- 网络不稳定
- 服务器临时故障
- 高并发导致的临时错误

## 工具函数

### 清除缓存

```typescript
import { clearCache, clearAllCache } from '../utils/requestManager';

// 清除特定请求的缓存
clearCache('/api/clouds', 'GET');

// 清除所有缓存
clearAllCache();
```

### 获取缓存统计（调试用）

```typescript
import { getCacheStats } from '../utils/requestManager';

const stats = getCacheStats();
console.log('缓存统计:', stats);
// {
//   cacheSize: 10,
//   pendingSize: 2,
//   cacheKeys: [...],
//   pendingKeys: [...]
// }
```

## 注意事项

1. **缓存一致性**：修改数据后，相关 GET 请求的缓存不会自动失效，需要手动清除或使用 `skipCache`
2. **内存管理**：缓存和待处理请求会定期清理，避免内存泄漏
3. **POST/PATCH/DELETE**：这些请求默认不缓存，但会启用去重和重试
4. **Token 变化**：如果 token 变化，缓存不会自动失效，建议在登录/登出时清除缓存

## 性能影响

- **减少请求数**：去重和缓存可减少 30-50% 的重复请求
- **提升响应速度**：缓存命中时响应时间接近 0ms
- **提高成功率**：重试机制可提高网络不稳定场景下的成功率

## 最佳实践

1. **列表数据**：使用默认缓存，定期刷新时使用 `skipCache: true`
2. **实时数据**：使用 `skipCache: true` 或禁用缓存
3. **关键操作**：POST/PATCH/DELETE 保持默认配置（去重+重试）
4. **错误处理**：结合 `handleApiError` 统一处理错误
