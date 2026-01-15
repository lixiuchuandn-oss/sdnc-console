# 多云 Provider 命名规范与清单

## 命名原则
- 全小写英文，不使用空格；多词用连字符连接
- 家族/系列用统一前缀分组：如 cloudmap-*
- 采用官方英文品牌合并写法：aliyun、huaweicloud、tencentcloud、aws、azure、google
- 避免中文或拼音；如需本地化仅在展示层处理，不影响 provider 标识
- 安全资源池统一使用 cloudmap-security（废弃 csm）

## 已接入（后端有实现）
- 公有云
  - aliyun
  - huaweicloud
私有云
  - cloudmap.private
- 边缘计算
  - cloudmap.edge
- 虚拟化
  - harvester
- 安全资源池
  - cloudmap.csm

说明：
- cloudmap.private / cloudmap.edge 走 Harvester 风格资源查询
- cloudmap.csm 走 CSM 专用安全路由与数据模型

## 展示/规划中（仅前端映射，后端未完全集成）
- aws, azure, google, ucloud
- tianyi, yidong
- vmware, openstack, dstack, zstack, feitiancloud, rancher, kvm
- s3, ceph
- sky, builtinprivate
- parallel_file_storage

备注：
- 此类 provider 目前主要用于 UI 显示或占位，需按需补齐后端能力

## 安全资源池说明
- 规范标识：cloudmap-security
- 历史别名：csm（已废弃，需全面移除）
- 写入时机：创建资源池时由前端选择卡片，其 id 作为 config.provider 持久化

## 重命名建议（统一规范）
- parallel_file_storage → storage-pfs（更符合类别-品牌语义）
- builtinprivate → private-builtin（前缀表达类别，更一致）
- 家族归类：统一使用 cloudmap-*（private/edge/security 等）
- 仅展示项建议逐步统一为官方英文：如 tianyi → ctyun（待确认）、yidong → ecloud 或 cmcloud（待确认）

## 整改清单（待执行）
- 移除所有代码中的 `csm` 判断与映射，统一为 `cloudmap-security`
- 统一 Dashboard/Console/CloudDetail 等前端组件的 provider 分支
- 后端查询与库存 API（clouds.ts 等）去除 `csm` 分支，仅保留 `cloudmap-security`
- 规范化展示/规划中 provider 的映射清单，避免与“已接入”混淆
- 评审并确认 parallel_file_storage 等命名是否重命名为类别前缀（storage-*）

## 约束与约定
- provider 在创建时确定并保存；不建议后续变更
- 安全相关路由仅接受 `cloudmap-security`，任何变体不予通过
- 新增 provider 时需同时：
  - 定义后端连接测试与资源查询路由
  - 前端展示映射与向导表单
  - 文档补充规范条目