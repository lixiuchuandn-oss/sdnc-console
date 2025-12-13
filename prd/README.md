# 设计与产品文档总索引

## 导航概览
- 设计：`docs/design/`（综述：`docs/design/capability-driven-ui.md`）
- 产品需求（PRD）：`docs/prd/`（索引：`docs/prd/README.md`）
- Provider 适配说明：`docs/providers/`（`aliyun.md`、`huaweicloud.md`、`tencentcloud.md`、`harvester.md`）
- API：`docs/api/`（索引：`docs/api/README.md`）
- 设计指南：`docs/guides/`（索引：`docs/guides/README.md`）

## 快速入口
- 能力驱动综述：`docs/design/capability-driven-ui.md`
- PRD 索引：`docs/prd/README.md`
- API 索引：`docs/api/README.md`
- 通信规约与认证：`docs/api/communication.md`
- 向导页面规范：`docs/guides/wizard.md`

## 阅读顺序（建议）
- 设计综述 → 目标功能 PRD → Provider 适配

## 命名与约定
- 能力键采用“领域.能力”形式：如 `compute.instanceType`、`network.vpc`、`storage.snapshot`。
- 文档路径遵循：`设计/design`、`产品/prd`、`适配/providers` 三层分工，互相交叉链接。

## 交叉链接规范
- PRD 引用设计与 Provider：在各 PRD 文件末尾“参考”中包含综述与适配链接。
- 设计引用 PRD：在综述中给出 PRD 入口，便于从架构跳转到具体功能。

## 版本策略（参考）
- 能力对象遵循 SemVer；新增能力键默认不破坏旧页面；详见 `docs/design/capability-driven-ui.md`。