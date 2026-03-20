# Cache 路由清理分析

## ✅ 清理完成

### 路由冲突分析

#### 注册顺序
- Direct 路由先注册（`clouds.ts` 第266行）
- Cache 路由后注册（`clouds.ts` 第267行）
- **Express 路由匹配规则：先注册的路由优先匹配**

---

## ✅ 已删除的冲突路由（Cache 路由中）

### Volume 相关操作（5个冲突路由已删除）

| 操作 | Cache 路由路径 | Direct 路由路径 | 状态 |
|------|---------------|----------------|------|
| **创建** | `POST /:id/resources/harvester/volumes` | `POST /:id/resources/harvester/volumes` | ✅ 已删除 |
| **更新** | `PUT /:id/resources/harvester/volumes/:namespace/:pvcName` | `PUT /:id/resources/harvester/volumes/:namespace/:name` | ✅ 已删除 |
| **克隆** | `POST /:id/resources/harvester/volumes/:namespace/:pvcName/clone` | `POST /:id/resources/harvester/volumes/:namespace/:name/clone` | ✅ 已删除 |
| **导出镜像** | `POST /:id/resources/harvester/volumes/:namespace/:pvcName/export-image` | `POST /:id/resources/harvester/volumes/:namespace/:name/export-image` | ✅ 已删除 |
| **创建快照** | `POST /:id/resources/harvester/volumes/:namespace/:pvcName/snapshots` | `POST /:id/resources/harvester/volumes/:namespace/:name/snapshots` | ✅ 已删除 |

**注意**：Volume 删除路径不同，不冲突，已保留
- Cache: `DELETE /:id/resources/harvester/volumes/:namespace/:name` ✅ 保留
- Direct: `DELETE /:id/resources/harvester/volumes/:name`

---

## 需要保留的 Cache 路由写操作

### 1. VPC 相关（只在 Cache 路由中）
- ✅ `POST /:id/resources/vpcs` - 创建 VPC
- ✅ `DELETE /:id/resources/vpcs/:name` - 删除 VPC
- ✅ `PUT /:id/resources/vpcs/:name` - 更新 VPC

### 2. Backup 相关（只在 Cache 路由中）
- ✅ `POST /:id/resources/harvester/virtualmachinebackups/:namespace` - 创建备份
- ✅ `DELETE /:id/resources/harvester/backups/:namespace/:name` - 删除备份

### 3. Schedule Backup 相关（只在 Cache 路由中）
- ✅ `POST /:id/resources/harvester/schedulevmbackups` - 创建计划备份
- ✅ `PATCH /:id/resources/harvester/schedulevmbackups/:namespace/:name` - 更新计划备份
- ✅ `PUT /:id/resources/harvester/schedulevmbackups/:namespace/:name` - 更新计划备份
- ✅ `DELETE /:id/resources/harvester/schedulevmbackups/:namespace/:name` - 删除计划备份

### 4. Restore 相关（只在 Cache 路由中）
- ✅ `POST /:id/resources/harvester/virtualmachinerestores/:namespace` - 创建恢复

### 5. NADs 相关（Direct 路由中只有查询）
- ✅ `POST /:id/resources/harvester/nads` - 创建 NAD
- ✅ `DELETE /:id/resources/harvester/nads/:namespace/:name` - 删除 NAD

### 6. Images 相关（Direct 路由中没有）
- ✅ `POST /:id/resources/harvester/images` - 创建镜像
- ✅ `PUT /:id/resources/harvester/images/:namespace/:name` - 更新镜像
- ✅ `DELETE /:id/resources/harvester/images/:namespace/:name` - 删除镜像

### 7. Namespaces 相关（Direct 路由中没有）
- ✅ `POST /:id/resources/harvester/namespaces` - 创建命名空间
- ✅ `PATCH /:id/resources/harvester/namespaces/:name` - 更新命名空间
- ✅ `DELETE /:id/resources/harvester/namespaces/:name` - 删除命名空间

### 8. SSH Keys 相关（Direct 路由中没有）
- ✅ `POST /:id/resources/harvester/sshkeys` - 创建 SSH 密钥
- ✅ `DELETE /:id/resources/harvester/sshkeys/:namespace/:name` - 删除 SSH 密钥

### 9. GPU Claims 相关（Direct 路由中没有）
- ✅ `DELETE /:id/resources/harvester/gpu-claims/:name` - 删除 GPU 声明

### 10. USB Devices 相关（Direct 路由中没有）
- ✅ `POST /:id/resources/harvester/usb-devices/:name/claim` - 声明 USB 设备
- ✅ `DELETE /:id/resources/harvester/usb-devices/:name/claim` - 删除 USB 设备声明

### 11. Snapshots 相关（Direct 路由中只有 restore）
- ✅ `DELETE /:id/resources/harvester/snapshots/:namespace/:name` - 删除快照

### 12. VM Volume 操作（路径不同，不冲突）
- ✅ `POST /:id/resources/harvester/vms/:instanceId/add-volume` - 挂载卷（使用 Instance ID）
- ✅ `POST /:id/resources/harvester/vms/:namespace/:name/add-volume` - 挂载卷（使用 Namespace/Name）
- ✅ `POST /:id/resources/harvester/vms/:instanceId/remove-volume` - 卸载卷

**注意**：Direct 路由中使用的是 `/resources/ecs/:instanceId/add-volume`，路径不同，不冲突。

### 13. Volume 删除（路径不同，不冲突）
- ✅ `DELETE /:id/resources/harvester/volumes/:namespace/:name` - 删除 Volume（Cache 路由）
- ✅ `DELETE /:id/resources/harvester/longhorn/volumes/:namespace/:name` - 删除 Longhorn Volume

**注意**：Direct 路由中使用的是 `DELETE /:id/resources/harvester/volumes/:name`（没有 namespace），路径不同，不冲突。

---

## 总结

### 需要删除的冲突路由（5个）
1. `POST /:id/resources/harvester/volumes` - Volume 创建
2. `PUT /:id/resources/harvester/volumes/:namespace/:pvcName` - Volume 更新
3. `POST /:id/resources/harvester/volumes/:namespace/:pvcName/clone` - Volume 克隆
4. `POST /:id/resources/harvester/volumes/:namespace/:pvcName/export-image` - Volume 导出镜像
5. `POST /:id/resources/harvester/volumes/:namespace/:pvcName/snapshots` - Volume 创建快照

### 需要保留的 Cache 路由写操作（约 30+ 个）
- VPC、Backup、Schedule Backup、Restore、NADs、Images、Namespaces、SSH Keys、GPU Claims、USB Devices、Snapshots、VM Volume 操作等
