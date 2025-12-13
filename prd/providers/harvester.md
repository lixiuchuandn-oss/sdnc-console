# Harvester 适配说明（基于能力驱动框架）

## 关系与原则
- 本文是多云“资源适配层”中的 Harvester Provider 适配指南，遵循统一能力 Schema、命名规范、适配器契约与注册中心策略。
- 前端只消费能力对象（`capabilities`），不在页面写死厂商分支。

## 能力映射
- 计算：
  - `compute.instanceType=false`、`compute.zone=false`
  - `compute.lifecycle.start|stop|reboot|delete=true`（管理员）
- 网络：
  - `network.vpc=true`（Kube-OVN）
  - `network.subnet=true`（Kube-OVN 子网）
  - `network.fusion=true`（融合展示 VPC/Subnet/NAD）
  - `provider.harvester.multus=true`（Multus/NAD）
- 存储：
  - `storage.disk=false`、`storage.snapshot=false`（按当前实现）

## 数据与操作适配
- 列表数据统一：`InstanceId` 标准化为 `namespace/name`；状态与 IP 字段按统一模型输出。
- 生命周期操作（统一 ECS 入口）：
  - `POST /api/clouds/:id/resources/ecs/:instanceId/start|stop|reboot`
  - `DELETE /api/clouds/:id/resources/ecs/:instanceId`
- Harvester 动作 API：
  - `POST /v1/harvester/kubevirt.io.virtualmachines/{namespace}/{name}?action=start|stop|restart`
  - `DELETE /v1/harvester/kubevirt.io.virtualmachines/{namespace}/{name}`
- 命名空间解析：优先 `InstanceId`，必要时回查列表补全。
- TLS 与认证：`Authorization: Bearer`；自签支持 `rejectUnauthorized: false`。
- 权限控制：写操作统一走管理员权限中间件。

## 前端消费与展示
- 差异列：命名空间、所属主机、网络（融合）、镜像、vCPU/内存分配、已用 CPU/内存。
- 能力驱动：按钮禁用/列展示完全依赖能力对象。
- 网络融合：统一展示 Kube-OVN（VPC/Subnet/IP）与 Multus/NAD 名称。

## 错误与状态处理
- 操作返回可能是非 JSON 文本，前端统一消息提示。
- 状态兼容 `printableStatus/phase/state` → 统一 `Status`；IP 兼容 `vmIp/interfaces[0].ipAddress`。

## 验证与测试建议
- 管理员角色在资源池详情页与聚合页，对 Harvester VM 执行生命周期操作，确认提示与列表刷新。
- 后端健康 `GET /health`；自签环境开启 `ignoreTls`。

## 后续
- 详情抽屉：镜像、卷、网络接口、事件。
- 操作增强：挂载/卸载卷、镜像切换、Cloud-Init 注入。
- 租户只读：GET 路由基于资源授权控制。