# Harvester 资源池管理问题修复报告

## 1. 虚拟机创建问题

### 1.1 SSH 公钥注入失败
- **问题描述**: 创建虚拟机时选择 SSH 公钥，但创建后无法使用私钥登录。
- **原因分析**: Harvester 的 Webhook 在某些场景下未能正确处理 `ssh_authorized_keys` 字段，导致 CloudInit 配置未生效。
- **修复方案**: 在后端服务中增加了显式的公钥注入逻辑。
- **代码变更**: [backend/src/services/clouds/harvester/vm.ts](file:///d%3A/ComputeTower/Compute.Tower/backend/src/services/clouds/harvester/vm.ts)
  - 在 `createHarvesterVM` 方法中，手动获取公钥内容并追加到 `userData` 的 `ssh_authorized_keys` 字段中。

### 1.2 ISO 镜像无法选择 CD-ROM 模式
- **问题描述**: 创建虚拟机选择 ISO 来源时，无法正确识别或设置为 CD-ROM 启动模式，导致安装程序无法加载。
- **原因分析**: 前端向导在选择 ISO 时，未自动设置磁盘总线类型 (Bus) 为 `sata`（KubeVirt 对光驱的默认支持类型）。
- **修复方案**: 优化了磁盘配置向导的逻辑。
- **代码变更**: [frontend/src/pages/Clouds/Harvester/modals/VmCreateWizard/StepDisks.tsx](file:///d%3A/ComputeTower/Compute.Tower/frontend/src/pages/Clouds/Harvester/modals/VmCreateWizard/StepDisks.tsx)
  - 当检测到 ISO 镜像时，强制将 `bus` 设置为 `sata` 并标记为 CD-ROM 设备。

---

## 2. 虚拟机变配 (Reconfigure) 问题

### 2.1 变更操作系统/网卡不生效 & 系统盘扩容 404
- **问题描述**: 
  1. 在变配页面更换系统镜像或修改网卡后，重启虚拟机未生效。
  2. 尝试扩容系统盘时提示 404 错误。
- **原因分析**: 原实现使用的是 `PATCH` (Merge Patch) 方法，无法处理复杂的对象替换（如 PVC 替换、网卡列表重置）。后端在处理 Patch 请求时无法正确映射新旧资源。
- **修复方案**: 将变配逻辑升级为 `updateHarvesterVmSpec` (PUT)，发送完整的 Spec 配置。
- **代码变更**: [frontend/src/pages/Clouds/Harvester/modals/VmReconfigure/useVmReconfigure.ts](file:///d%3A/ComputeTower/Compute.Tower/frontend/src/pages/Clouds/Harvester/modals/VmReconfigure/useVmReconfigure.ts)
  - `change_os` (更换系统)、`change_primary_nic` (修改主网卡)、`change_secondary_nic` (修改辅网卡) 等操作现在使用全量更新接口。

### 2.2 变配按钮状态检查
- **问题描述**: 虚拟机在 `Starting`、`Migrating` 等中间状态下仍允许点击“资源变配”，导致操作报错或状态异常。
- **修复方案**: 在详情页增加了严格的状态检查。
- **代码变更**: [frontend/src/pages/Clouds/Harvester/components/HarvesterVmDetailDrawer.tsx](file:///d%3A/ComputeTower/Compute.Tower/frontend/src/pages/Clouds/Harvester/components/HarvesterVmDetailDrawer.tsx)
  - “资源变配”按钮现在仅在 **Running (运行中)** 或 **Stopped (已停止)** 状态下可用，其他状态禁用并显示提示。

---

## 3. 运维操作问题

### 3.1 缺少冷迁移操作
- **问题描述**: 关机状态下的虚拟机无法进行迁移操作（弹窗卡顿或无法打开）。
- **原因分析**: 迁移弹窗尝试获取 VMI (VirtualMachineInstance) 信息，但关机状态下 VMI 不存在。
- **修复方案**: 优化迁移弹窗逻辑，兼容关机状态。
- **代码变更**: [frontend/src/pages/Clouds/Harvester/modals/HarvesterMigrateModal.tsx](file:///d%3A/ComputeTower/Compute.Tower/frontend/src/pages/Clouds/Harvester/modals/HarvesterMigrateModal.tsx)
  - 当检测到虚拟机未运行时，跳过 VMI 检查，允许用户选择目标节点进行冷迁移调度。

### 3.2 挂载卷报错 422 (实际成功)
- **问题描述**: 给虚拟机挂载数据盘时，界面提示 HTTP 422 错误，但实际后台挂载成功。
- **原因分析**: Harvester API 在某些并发或重试场景下，如果卷已挂载会返回 422 错误。
- **修复方案**: 后端增加错误过滤逻辑。
- **代码变更**: [backend/src/services/clouds/harvester/lifecycle.ts](file:///d%3A/ComputeTower/Compute.Tower/backend/src/services/clouds/harvester/lifecycle.ts)
  - 捕获 422 错误，若错误信息包含 "already attached" 或 "exist"，则视为操作成功。

### 3.3 备份/快照选择目标显示别名
- **问题描述**: 创建备份/快照时，目标虚拟机下拉框仅显示 UUID 或 Name，无法通过别名识别。
- **修复方案**: 优化下拉框展示逻辑。
- **代码变更**: [frontend/src/pages/Clouds/Harvester/modals/VmBackupCreateModal.tsx](file:///d%3A/ComputeTower/Compute.Tower/frontend/src/pages/Clouds/Harvester/modals/VmBackupCreateModal.tsx)
  - 选项格式调整为 `别名 (Name)`，方便用户识别。

---

## 4. 待确认事项

以下问题建议进一步观察或提供详细日志：
1. **新增资源池报错**: 需确认具体的报错信息（HTTP 状态码及 Response Body），可能是网络连通性或认证问题。
2. **热扩容开关报错**: 需确认是在前端校验阶段报错还是后端 API 返回错误。
