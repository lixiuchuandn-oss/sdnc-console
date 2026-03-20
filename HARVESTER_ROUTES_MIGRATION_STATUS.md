# Harvester 路由迁移状态报告

## 📊 总体状态

### ✅ 已完全迁移到 Provider-Router 机制

1. **`harvester.cache.routes.provider.ts`** ✅
   - 已迁移路由：VPC、Subnet、NAD、Volume、Image、StorageClass、Snapshot、ClusterNetwork、Service、Ingress、Namespace、Cluster、Meta（SSH Key、CloudInit、Template）、Peripherals（GPU、USB、PCI）
   - 状态：**完全迁移，新路由已生效**

2. **`harvester.direct.routes.provider.ts`** ✅
   - 已迁移路由：VM CRUD、生命周期操作（start/stop/reboot/pause/unpause/delete/restore/forceDelete）、VM 操作（VNC、Stream、Volume、Migration、硬件资源）
   - 状态：**完全迁移，新路由已生效**

3. **`harvester.service.routes.provider.ts`** ✅
   - 已迁移路由：Logging（24个路由）、Monitoring（28个路由）
   - 状态：**完全迁移，新路由已生效**

---

## ⚠️ 标记为"已迁移"但仍在被调用的旧文件

这些文件的路由**已经迁移到 provider-router**，但旧的注册函数仍在 `registerHarvesterRoutes` 中被调用（为了向后兼容）。**旧路由代码已标记为"已迁移"但未注释**。

### Cache Routes（缓存路由）

1. **`harvester.cache.cluster.routes.ts`** ⚠️
   - 状态：路由已迁移到 `harvester.cache.routes.provider.ts`
   - 旧函数：`registerHarvesterClusterRoutes` 仍在被调用
   - 建议：注释掉旧路由代码，保留函数签名但直接 return

2. **`harvester.cache.network.routes.ts`** ⚠️
   - 状态：路由已迁移到 `harvester.cache.routes.provider.ts`
   - 旧函数：`registerHarvesterNetworkRoutes` 仍在被调用
   - 建议：注释掉旧路由代码

3. **`harvester.cache.meta.routes.ts`** ⚠️
   - 状态：路由已迁移到 `harvester.cache.routes.provider.ts`
   - 旧函数：`registerHarvesterMetaRoutes` 仍在被调用
   - 建议：注释掉旧路由代码

4. **`harvester.cache.namespace.routes.ts`** ⚠️
   - 状态：路由已迁移到 `harvester.cache.routes.provider.ts`
   - 旧函数：`registerHarvesterNamespaceRoutes` 仍在被调用
   - 建议：注释掉旧路由代码

5. **`harvester.cache.peripherals.routes.ts`** ⚠️
   - 状态：路由已迁移到 `harvester.cache.routes.provider.ts`
   - 旧函数：`registerHarvesterPeripheralsRoutes` 仍在被调用
   - 建议：注释掉旧路由代码

---

## ❌ 未迁移的文件

### Cache Routes（缓存路由）

1. **`harvester.cache.storage.routes.ts`** ❌
   - 状态：**未迁移**
   - 路由数量：大量 Volume 相关路由
   - 旧函数：`registerHarvesterStorageRoutes` 仍在被调用
   - 建议：迁移到 `harvester.cache.routes.provider.ts`（部分 Volume 路由已迁移，但此文件可能包含更多）

2. **`harvester.cache.vm.routes.ts`** ❌
   - 状态：**未迁移**
   - 路由数量：大量 VM 相关路由（模板、创建等）
   - 旧函数：`registerHarvesterVmRoutes` 仍在被调用
   - 建议：迁移到 `harvester.cache.routes.provider.ts` 或创建新的 handlers

3. **`harvester.cache.routes.ts`** ❌
   - 状态：**部分迁移**
   - 包含路由：
     - `GET /:id/resources/harvester/migrations` - 迁移记录查询
     - `GET /:id/resources/harvester/proxy` - 通用 API 代理
   - 旧函数：`registerHarvesterRoutes` 仍在被调用
   - 建议：这些路由可能需要保留在旧文件中（特殊用途）

### Direct Routes（直连路由）

4. **`harvester.direct.storage.routes.ts`** ❌
   - 状态：**未迁移**
   - 路由数量：大量存储直连操作（快照恢复、卷克隆、镜像导出等）
   - 旧函数：`registerHarvesterDirectStorageRoutes` 仍在被调用
   - 建议：迁移到 `harvester.direct.routes.provider.ts` 或创建新的 handlers

5. **`harvester.direct.vm.routes.ts`** ❌
   - 状态：**部分迁移**（VM CRUD 和生命周期已迁移）
   - 路由数量：可能包含其他 VM 相关路由
   - 旧函数：`registerHarvesterDirectVmRoutes` 仍在被调用
   - 建议：检查是否有未迁移的路由

6. **`harvester.direct.network.routes.ts`** ❌
   - 状态：**未迁移**
   - 路由数量：大量网络直连操作
   - 旧函数：`registerHarvesterDirectNetworkRoutes` 仍在被调用
   - 建议：迁移到 `harvester.direct.routes.provider.ts` 或创建新的 handlers

---

## 📝 当前注册流程

### `backend/src/routes/clouds.ts`

```typescript
// 第 266-272 行
registerHarvesterDirectRoutes(router, checkAdminPermission);  // 包含新旧路由
registerHarvesterRoutes(router, checkAdminPermission);         // 包含新旧路由
// ... 其他云厂商路由 ...
registerHarvesterServiceRoutesProvider(router, checkAdminPermission);  // ✅ 新路由
```

### `harvester.cache.routes.ts` (registerHarvesterRoutes)

```typescript
// 第 170 行：新路由优先注册
registerHarvesterCacheRoutesProvider(router, checkAdminPermission);

// 第 173-179 行：旧路由仍在注册（向后兼容）
registerHarvesterVmRoutes(router, checkAdminPermission);
registerHarvesterStorageRoutes(router, checkAdminPermission);
registerHarvesterNetworkRoutes(router, checkAdminPermission);
registerHarvesterClusterRoutes(router, checkAdminPermission);
registerHarvesterNamespaceRoutes(router, checkAdminPermission);
registerHarvesterPeripheralsRoutes(router, checkAdminPermission);
registerHarvesterMetaRoutes(router, checkAdminPermission);
```

### `harvester.direct.routes.ts` (registerHarvesterDirectRoutes)

```typescript
// 第 37 行：新路由优先注册
registerHarvesterDirectRoutesProvider(router, checkAdminPermission);

// 第 40-42 行：旧路由仍在注册（向后兼容）
registerHarvesterDirectStorageRoutes(router, checkAdminPermission);
registerHarvesterDirectVmRoutes(router, checkAdminPermission);
registerHarvesterDirectNetworkRoutes(router, checkAdminPermission);
```

---

## 🎯 建议的清理步骤

### 阶段 1：清理已迁移的旧路由代码（安全）

1. 注释掉以下文件中的路由代码（保留函数签名）：
   - `harvester.cache.cluster.routes.ts`
   - `harvester.cache.network.routes.ts`
   - `harvester.cache.meta.routes.ts`
   - `harvester.cache.namespace.routes.ts`
   - `harvester.cache.peripherals.routes.ts`

2. 从 `harvester.cache.routes.ts` 中移除这些函数的调用（因为路由已在 provider 中注册）

### 阶段 2：迁移剩余大文件（需要评估）

1. **`harvester.cache.storage.routes.ts`** - 评估是否所有路由都已迁移
2. **`harvester.cache.vm.routes.ts`** - 评估是否所有路由都已迁移
3. **`harvester.direct.storage.routes.ts`** - 需要迁移
4. **`harvester.direct.network.routes.ts`** - 需要迁移
5. **`harvester.direct.vm.routes.ts`** - 检查是否有遗漏的路由

### 阶段 3：完全清理（最终）

1. 从 `harvester.cache.routes.ts` 和 `harvester.direct.routes.ts` 中移除所有旧路由注册
2. 删除或归档旧路由文件
3. 更新 `backend/src/routes/clouds.ts` 只调用 provider 函数

---

## ⚠️ 注意事项

1. **路由冲突**：新路由优先注册，避免与旧路由冲突
2. **向后兼容**：旧路由代码保留是为了确保平滑过渡
3. **测试验证**：清理旧路由前，必须验证所有功能正常
4. **特殊路由**：`harvester.cache.routes.ts` 中的 `migrations` 和 `proxy` 路由可能需要保留

---

## 📈 迁移进度

- ✅ **已迁移**：~60% 的路由
- ⚠️ **标记已迁移但未清理**：~20% 的路由
- ❌ **未迁移**：~20% 的路由（主要是 Storage 和 Network 的复杂操作）
