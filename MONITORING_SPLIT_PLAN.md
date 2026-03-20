# Monitoring Routes 拆分方案（优化版）

## 📊 当前状态
- **文件大小**: 1747 行
- **路由数量**: 28 个
- **复杂度**: 包含大量业务逻辑（钉钉集成、Alertmanager 配置等）

## 🎯 优化后的拆分方案

### 方案对比

#### ❌ 原方案问题
1. **文件过多**: 7个 handlers 文件，有些文件太小（30-50行）
2. **文件过大**: `monitoring-alertmanager.handlers.ts` 预估 800 行，仍然太大
3. **拆分过细**: metrics、configmaps、utils 单独成文件，维护成本高

#### ✅ 优化方案（5个文件）

### 1. **monitoring-overview.handlers.ts** - 监控概览（8个路由，~250行）
合并：概览 + 指标 + 工具
- `GET /:id/monitoring/storage-nodes` - 存储节点
- `GET /:id/monitoring/node-resources` - 节点资源
- `GET /:id/monitoring/node-metrics` - 节点指标
- `GET /:id/monitoring/virtualmachines` - 虚拟机
- `GET /:id/monitoring/virtualmachineinstances` - 虚拟机实例
- `GET /:id/monitoring/blockdevices` - 块设备
- `GET /:id/monitoring/metric-range` - Prometheus 查询范围
- `GET /:id/monitoring/allowed-namespaces` - 获取允许的命名空间

**理由**: 都是查询类操作，逻辑简单，合并后文件大小合理

### 2. **monitoring-rules.handlers.ts** - 告警规则（4个路由，~300行）
- `GET /:id/monitoring/alerts-rules` - 站内实时告警列表
- `GET /:id/monitoring/prometheusrules` - Prometheus 规则列表
- `GET /:id/monitoring/prometheusrules-groups` - 告警分组
- `GET /:id/monitoring/prometheusrules/vm-custom-rules` - VM 自定义规则

**理由**: 告警规则相关，逻辑相对独立

### 3. **monitoring-alerts-policies.handlers.ts** - 告警策略（5个路由，~400行）
拆分 Alertmanager 的策略部分
- `GET /:id/monitoring/alertmanagerconfigs` - 策略列表
- `GET /:id/monitoring/alertmanagerconfigs/policy-receivers` - 策略引用查询
- `GET /:id/monitoring/alertmanagerconfigs/:namespace/:name` - 策略详情
- `POST /:id/monitoring/alertmanagerconfigs` - 创建策略
- `PUT /:id/monitoring/alertmanagerconfigs/:namespace/:name` - 更新策略
- `DELETE /:id/monitoring/alertmanagerconfigs/:namespace/:name` - 删除策略

**理由**: 策略管理逻辑相对独立，不包含钉钉集成

### 4. **monitoring-alerts-receivers.handlers.ts** - 通知对象（5个路由，~400行）
拆分 Alertmanager 的接收器部分（包含钉钉集成）
- `GET /:id/monitoring/alertmanagerconfigs/receivers` - 通知对象列表
- `GET /:id/monitoring/alertmanagerconfigs/receivers/check` - 校验通知对象
- `POST /:id/monitoring/alertmanagerconfigs/receivers/:namespace/:name` - 创建/更新通知对象
- `DELETE /:id/monitoring/alertmanagerconfigs/receivers/:namespace/:name` - 删除通知对象

**理由**: 接收器管理包含复杂的钉钉集成逻辑，独立成文件便于维护

### 5. **monitoring-secrets.handlers.ts** - Secrets & ConfigMaps（6个路由，~250行）
合并：Secrets + ConfigMaps
- `GET /:id/monitoring/secrets` - Secrets 列表
- `GET /:id/monitoring/secrets/:namespace/:name` - Secrets 详情
- `POST /:id/monitoring/secrets` - 创建 Secret
- `PUT /:id/monitoring/secrets/:namespace/:name` - 更新 Secret
- `DELETE /:id/monitoring/secrets/:namespace/:name` - 删除 Secret
- `GET /:id/monitoring/configmaps/:namespace/:name` - 查询 ConfigMap

**理由**: Secrets 和 ConfigMaps 都是 K8s 资源管理，逻辑相似，合并后文件大小合理

## 📁 共享辅助函数

需要提取到 `monitoring-helpers.ts` 的公共函数：
- `normalizeOrigin` - 规范化 endpoint
- `getCloudConnOnly` / `getCloudAndConn` - 获取云连接（可复用 harvester.direct.helpers）
- `getTenantAccess` / `requireTenantAccess` - 租户权限检查（可复用）
- `isUnreachableError` - 错误判断
- `isWebsiteReceiverInMonitoringNs` - 接收器判断
- `isValidReceiverConfigName` - 接收器名称校验
- `isPolicyAlertmanagerConfig` - 策略判断
- `normalizePolicySpec` - 策略规范化
- `collectReceiverNamesFromRoute` - 收集接收器名称
- `inferReceiverType` - 推断接收器类型
- `extractAlertNamesFromSpec` - 提取告警名称
- `buildDingtalkTargetUrl` - 构建钉钉 URL
- `buildNextYamlFromExisting` - 构建 YAML
- `syncDingtalkWebhookConfig` - 同步钉钉配置
- `syncPoliciesReceiverSpecsAfterReceiverConfigUpdate` - 同步策略
- `restartDingtalkWebhookDeployment` - 重启部署
- `processEmailReceivers` - 处理邮件接收器
- `processDingtalkReceivers` - 处理钉钉接收器

## 📝 优化后的文件结构

```
backend/src/routes/clouds/harvester/
├── handlers/
│   ├── monitoring-overview.handlers.ts      (~250 行) ✅ 合理
│   ├── monitoring-rules.handlers.ts         (~300 行) ✅ 合理
│   ├── monitoring-alerts-policies.handlers.ts (~400 行) ✅ 合理
│   ├── monitoring-alerts-receivers.handlers.ts (~400 行) ✅ 合理（含钉钉逻辑）
│   ├── monitoring-secrets.handlers.ts       (~250 行) ✅ 合理
│   └── monitoring-helpers.ts                (~400 行) 共享辅助函数
└── harvester.service.routes.provider.ts      (更新路由注册)
```

## ✅ 优化后的优势

1. **文件数量合理**: 5个 handlers 文件 + 1个 helpers = 6个文件（vs 原方案 8个）
2. **文件大小均衡**: 每个文件 250-400 行，都在合理范围内
3. **职责清晰**: 
   - overview: 查询类操作
   - rules: 告警规则
   - alerts-policies: 策略管理
   - alerts-receivers: 通知对象（含钉钉）
   - secrets: 密钥和配置管理
4. **易于维护**: 相关功能合并，减少文件跳转
5. **代码复用**: 共享辅助函数提取到 helpers，优先复用 `harvester.direct.helpers.ts`

## 📊 对比参考

参考现有 handlers 文件大小：
- `logging.handlers.ts`: 792 行，24 个 handlers ✅
- `volumes.handlers.ts`: 835 行，12 个 handlers ✅
- `ecs-crud.handlers.ts`: 783 行，6 个 handlers ✅

**结论**: 优化后的方案（250-400行/文件）更符合现有代码风格
