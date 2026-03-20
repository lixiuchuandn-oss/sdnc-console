# 路由兼容性分析

## 问题说明

前端代码中存在**路径混用**的情况：
- **统一抽象层路径** (`/resources/ecs`): 用于跨云平台的统一操作
- **Harvester 原生路径** (`/resources/harvester/vms`): 用于 Harvester 特定的操作

## 前端调用的路径清单

### 1. VM 创建
- ✅ `POST /resources/harvester/vms` - **已修复**（添加了兼容路由）

### 2. VM 生命周期操作（混用）
- ✅ `POST /resources/ecs/:instanceId/start` - 启动（统一路径）
- ✅ `POST /resources/ecs/:instanceId/stop` - 停止（统一路径）
- ✅ `POST /resources/ecs/:instanceId/reboot` - 重启（统一路径）
- ✅ `POST /resources/ecs/:instanceId/pause` - 暂停（统一路径）
- ✅ `POST /resources/ecs/:instanceId/unpause` - 恢复（统一路径）
- ✅ `POST /resources/ecs/:instanceId/restore` - 恢复（统一路径）
- ✅ `DELETE /resources/ecs/:instanceId/force` - 强制删除（统一路径）
- ❓ `POST /resources/harvester/vms/:namespace/:name/start` - 启动（Harvester 路径，**需要检查**）
- ❓ `POST /resources/harvester/vms/:namespace/:name/stop` - 停止（Harvester 路径，**需要检查**）

### 3. VM 更新操作
- ✅ `PUT /resources/ecs/:instanceId` - 更新（统一路径）
- ✅ `PATCH /resources/harvester/vms/:namespace/:name` - PATCH 更新（Harvester 路径）
- ✅ `POST /resources/harvester/vms/:namespace/:name/update-spec` - 更新 Spec（Harvester 路径）

### 4. VM 查询操作
- ✅ `GET /resources/ecs` - 列表查询（统一路径）
- ✅ `GET /resources/ecs/:namespace/:name/aggregated` - 聚合详情（统一路径）
- ✅ `GET /resources/harvester/vms/:namespace/:name` - 详情查询（Harvester 路径，在 Cache 路由中）

### 5. VM 其他操作
- ✅ `GET /resources/ecs/:instanceId/vnc-url` - VNC URL（统一路径）
- ✅ `POST /resources/ecs/:instanceId/migrate` - 迁移（统一路径）
- ✅ `POST /resources/ecs/:instanceId/abort-migration` - 取消迁移（统一路径）
- ❓ `POST /resources/harvester/vms/:namespace/:name/save-as-template` - 保存为模板（**需要检查**）
- ❓ `POST /resources/harvester/vms/:namespace/:name/action` - 通用操作（**需要检查**）

### 6. VM Volume 操作（混用）
- ✅ `POST /resources/ecs/:instanceId/add-volume` - 挂载卷（统一路径）
- ✅ `POST /resources/ecs/:instanceId/remove-volume` - 卸载卷（统一路径）
- ✅ `POST /resources/harvester/vms/:instanceId/add-volume` - 挂载卷（Harvester 路径，在 Cache 路由中）
- ✅ `POST /resources/harvester/vms/:namespace/:name/add-volume` - 挂载卷（Harvester 路径，在 Cache 路由中）
- ✅ `POST /resources/harvester/vms/:instanceId/remove-volume` - 卸载卷（Harvester 路径，在 Cache 路由中）

## ✅ 已添加的兼容路由

### 1. `POST /resources/harvester/vms` - VM 创建
- **前端调用**: `createHarvesterVm` 函数
- **状态**: ✅ **已添加** - 使用 `harvesterEcsCreateHandler`

### 2. `POST /resources/harvester/vms/:namespace/:name/start` - VM 启动
- **前端调用**: `startHarvesterVm` 函数
- **状态**: ✅ **已添加** - 使用适配器 `harvesterVmStartByNamespaceHandler`

### 3. `POST /resources/harvester/vms/:namespace/:name/stop` - VM 停止
- **前端调用**: `stopHarvesterVm` 函数
- **状态**: ✅ **已添加** - 使用适配器 `harvesterVmStopByNamespaceHandler`

### 4. `POST /resources/harvester/vms/:namespace/:name/save-as-template` - 保存为模板
- **前端调用**: `saveHarvesterVmAsTemplate` 函数
- **状态**: ✅ **已添加** - 使用 `harvesterEcsSaveAsTemplateHandler`

### 5. `POST /resources/harvester/vms/:namespace/:name/action` - VM 操作
- **前端调用**: `harvesterVmAction` 函数
- **状态**: ✅ **已添加** - 使用 `harvesterVmActionHandler`

## 建议

### 方案 1: 添加兼容路由（推荐）
为所有前端调用的路径添加兼容路由，使用相同的 handler。

### 方案 2: 统一前端路径
将前端代码统一改为使用 `/resources/ecs` 路径（工作量较大）。

### 方案 3: 保持现状
只修复缺失的路由，其他保持现状。

## 当前状态

- ✅ `POST /resources/harvester/vms` - **已修复**
- ❓ 其他路径需要逐一检查
