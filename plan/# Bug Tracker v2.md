# Bug Tracker v2.8 (Code Review Verified)

## 📊 统计概览 (Summary)
| 总计 (Total) | 已修复 (Fixed) | 待修复 (Pending) |
| :---: | :---: | :---: |
| 35 | 18 | 17 |

---

## ✅ 已修复/无法复现问题 (Fixed / Not Reproducible)

### 资源控制台 (Resource Console)
- [x] **Bug 4**: 虚拟卷 - 挂载时无法选择云主机 (已修复: 列表查询逻辑已优化)
- [x] **Bug 5**: 虚拟卷 - 导出镜像报错 (已修复: 后端 `/export-image` 路由已存在)
- [x] **Bug 6**: 虚拟卷 - 创建快照存储类无法选择 (已修复: 后端 `/snapshots` 路由已存在，存储类查询接口正常)
- [x] **Bug 8**: 云主机 - 弹出 CD-ROM 失败 (已修复: 参数校验逻辑修正)
- [x] **Bug 13**: 云主机 - 创建实例命名空间不匹配 (已修复: 命名空间校验逻辑修正)

### 租户侧 (Tenant Portal)
- [x] **Bug 18**: 云主机 - “创建者”列展示 (已修复)
- [x] **Bug 19**: 云主机 - 列名本地化 (已修复)
- [x] **Bug 21**: 云主机 - 暂停/恢复权限 (已修复: 权限点已更新)
- [x] **Bug 22**: 云主机 - 按钮动态状态 (已修复)
- [x] **Bug 26**: 资源隔离 - 子组织越权可见 (已修复)
- [x] **Bug 27**: 创建虚拟机 - 网络选择报错 (已修复)
- [x] **Bug 30**: 云主机 - WebVNC 按钮缺失 (已修复)

### 租户管理 (Tenant Management)
- [x] **Bug 20**: 详情 - 默认镜像空间置灰 (已修复)
- [x] **Bug 24**: 编辑 - 状态筛选移除 (已修复)
- [x] **Bug 25**: 列表 - 用户数量统计 (已修复)
- [x] **Bug 29**: 详情 - 用户角色回显 (已修复)
- [x] **Bug 31**: 角色管理 - 权限过滤 (已修复)
- [x] **Bug 32**: 角色管理 - 关联删除校验 (已修复)

---

## 🕒 待修复问题 (Pending) - 代码审查确认

### 🔴 高优先级 (High Priority) - 功能缺失或逻辑错误

#### 云主机 - 计算资源配置
- [ ] **Bug 9**: CPU 高级配置完全失效 **(Code Verified: 缺失)**
  - **原因**: 前端 Payload 构建逻辑 (`VmWizardUtils.ts`) 完全忽略了 `dedicatedCPUPlacement` (绑定) 和 `isolateEmulatorThread` (隔离) 字段。
  - **现象**: 勾选绑定/隔离后，生成的 VM Manifest 中缺少对应字段。
- [ ] **Bug 9a**: CPU 拓扑计算错误 **(Code Verified: 逻辑错误)**
  - **原因**: 前端逻辑未正确处理 `Sockets * Cores * Threads` 与 Total CPU 的关系，可能导致 Harvester 校验失败。
- [ ] **Bug 9c/10**: CPU/内存 QoS (Limit/Request) 失效 **(Code Verified: 逻辑覆盖)**
  - **原因**: 启用热扩容逻辑 (`hotExpandEnabled`) 后，`limits.cpu` 和 `limits.memory` 被强制设置为最大值 (4x)，用户在高级配置中设置的 QoS Limit 被直接忽略覆盖。
- [ ] **Bug 11**: GPU 直通未过滤已使用设备 **(Code Verified: 缺失)**
  - **原因**: `fetchHarvesterGpuResources` 仅列出 Inventory 中的所有 GPU，未检查这些 GPU 是否已被其他运行中的 VM 占用 (需遍历 VM HostDevices)。

#### 云主机 - 基础功能
- [ ] **Bug 3**: 虚机名称不支持中文/特殊字符 **(Code Verified: 缺失)**
  - **原因**: Harvester (K8s) `metadata.name` 严格限制格式 (DNS-1123)。目前代码直接将用户输入作为 `name`，未实现“输入中文 -> 自动转 UUID/Pinyin -> 存 Alias Label”的映射逻辑。
- [ ] **Bug 26 (2.7-26)**: 资源变配 (CPU/Mem) 报错 **(Code Verified: 路由缺失)**
  - **原因**: 前端调用 `/update-spec` 接口，但后端 `clouds.harvester.ts` 中未定义该路由，导致 404/Cannot POST。

#### 虚拟卷 (Volumes)
- [ ] **Bug 7 (2.7-6)**: 编辑卷容量失败 **(Code Verified: 路由缺失)**
  - **原因**: 后端缺失处理 Volume PUT/PATCH 的路由，导致无法修改 PVC 容量。

### 🟠 中优先级 (Medium Priority) - 体验优化与次要功能

- [ ] **Bug 16 (2.7-23)**: 挂载已有卷仅显示 ID **(Code Verified: 优化)**
  - **建议**: 下拉框需关联 PVC Inventory 显示 `metadata.name` 或 Alias。
- [ ] **2.7-19**: 缺少虚拟机迁移操作 **(Code Verified: 缺失)**
  - **原因**: 后端未实现 `/migrate` (VMIM) 相关接口。
- [ ] **2.7-20**: 缺少 SSH 密钥创建功能 **(Code Verified: 缺失)**
  - **原因**: 后端未实现 SSH Key (Keypair) 的 CRUD 接口。
- [ ] **2.7-22**: 缺少模板管理功能 **(Code Verified: 缺失)**
  - **原因**: 缺少 Template/TemplateVersion 的相关操作接口。
- [ ] **2.7-14**: 命名空间标签未生效 **(Code Verified: 需检查)**
  - **原因**: 需确认 `createHarvesterNamespace` 是否正确传递 labels 字段。

### 🟡 低优先级 (Low Priority)
- [ ] **Bug 1**: 热扩容调度逻辑优化
  - **状态**: 建议暂缓，依赖 Harvester 调度器行为。
- [ ] **Bug 2**: 资源不足时的详细状态展示
  - **建议**: 前端需解析 `VM.status.conditions` 中的 `PodScheduled` 失败原因并展示。