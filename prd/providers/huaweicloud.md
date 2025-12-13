# 华为云适配说明（基于能力驱动框架）

## 关系与原则
- 本文是多云“资源适配层”中的华为云 Provider 适配指南，遵循统一能力 Schema、命名规范、适配器契约与注册中心策略。
- 前端只消费能力对象（`capabilities`），不在页面写死厂商分支。

## 能力映射（当前实现）
- 计算：
  - `compute.instanceType=true`、`compute.zone=true`
- 网络：
  - `network.vpc=true`、`network.subnet=true`
  - `network.routeTable=true`
  - `network.eip=false`、`network.eni=false`（当前实现未接入这些接口）
- 存储：
  - `storage.snapshot=true`
  - `storage.disk=false`（当前实现未接入云盘列表接口）

## 数据与接口适配
- 后端路由能力返回示例（含 `capabilities`）：
  - VPC：`backend/src/routes/clouds.ts:403`
  - ECS（列表能力）：`backend/src/routes/clouds.ts:639`
  - 子网：`backend/src/routes/clouds.ts:1028`
  - 路由表：`backend/src/routes/clouds.ts:1512`
  - 快照：`backend/src/routes/clouds.ts:1691`
- 数据来源适配：
  - `huaweiListVpcs`、`huaweiListSubnets`、`huaweiListRouteTables`、`huaweiListSnapshots` 封装 API 调用；需要 `projectId`。

## 前端消费与展示
- `frontend/src/pages/Clouds/CloudDetail.tsx` 合并 `json.capabilities` 到 `caps`，并据此启用/禁用按钮与列。
- 因 `network.eni=false`、`network.eip=false`，ENI/EIP 创建/删除按钮在界面禁用。

## 注意事项
- 项目维度：需要配置 `projectId` 以访问 VPC/子网/快照等资源。
- 分页与集合字段兼容：不同接口返回的集合字段名不一致，需统一解析。

## 测试与验证
- 能力对象断言：各接口返回包含 `capabilities`，键值符合预期。
- 前端联动：按钮禁用与列显示符合能力映射（如路由表、子网等可用）。