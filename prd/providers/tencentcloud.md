# 腾讯云适配说明（基于能力驱动框架）

## 关系与原则
- 本文是多云“资源适配层”中的腾讯云 Provider 适配指南，遵循统一能力 Schema、命名规范、适配器契约与注册中心策略。
- 前端只消费能力对象（`capabilities`），不在页面写死厂商分支。

## 能力映射（当前实现）
- 计算：
  - `compute.instanceType=true`、`compute.zone=true`
- 网络：
  - `network.vpc=true`
  - `network.subnet=false`（当前实现未接入子网列表接口）
  - `network.eni=false`、`network.eip=false`、`network.routeTable=false`（当前实现未接入这些接口）
- 存储：
  - `storage.disk=false`、`storage.snapshot=false`（当前实现未接入相关接口）

## 数据与接口适配
- 后端路由能力返回示例（含 `capabilities`）：
  - VPC：`backend/src/routes/clouds.ts:403`
  - ECS（列表能力）：`backend/src/routes/clouds.ts:639`
- 数据来源适配：
  - `tencentListVpcs` 封装 VPC 查询；需要 `secretId`/`secretKey` 与 `region`。

## 前端消费与展示
- `frontend/src/pages/Clouds/CloudDetail.tsx` 合并 `json.capabilities` 到 `caps`，并据此启用/禁用按钮与列。
- 因多项网络能力为 `false`，相关创建/删除按钮在界面禁用。

## 注意事项
- 权限与认证：使用腾讯云密钥认证；区域需与资源一致。
- 扩展空间：可逐步接入子网、EIP、ENI、路由表、云盘、快照接口并在注册中心开启能力。

## 测试与验证
- 能力对象断言：各接口返回包含 `capabilities` 且键值符合预期。
- 前端联动：按钮禁用与列显示符合能力映射（VPC 列表可用，其它按禁用处理）。