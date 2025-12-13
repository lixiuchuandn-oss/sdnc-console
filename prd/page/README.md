# 产品需求文档（PRD）索引

## 目录结构
- 概览：`docs/prd/overview/dashboard.md`
- 云资源管理：
  - 云资源控制台：`docs/prd/cloud/cloud-console.md`
- 跨地域互联：
  - VR实例管理：`docs/prd/interconnect/vr-instance.md`
  - SRv6隧道管理：`docs/prd/interconnect/srv6-tunnel.md`
- 安全与网络域：
  - 信息域管理：`docs/prd/security/info-domain.md`
- 公共内容：
  - API 文档索引：`docs/api/README.md`
  - 通信规约与认证：`docs/api/communication.md`
  - 设计指南（向导页面）：`docs/guides/wizard.md`

## 说明
- 本目录将原 `PRD/` 下散落的文档重组为可导航的 Markdown，便于统一查阅与演进。
- 原始来源文件保留在 `PRD/` 中，必要时可作为数据溯源参考。

## 与设计/Provider 的关系
- 设计（`docs/design/`）：总体架构与“能力驱动”框架，定义跨云的能力键与前后端契约。
- Provider（`docs/providers/`）：各云厂商的适配说明与能力映射差异。
- PRD（本目录）：具体产品与页面的需求、交互与验收标准。

## 建议阅读顺序
- 1) 设计综述：`docs/design/capability-driven-ui.md`
- 2) 目标功能的 PRD（如 ECS/VR/SRv6）：本目录对应条目
- 3) 对应 Provider 适配：`docs/providers/*`