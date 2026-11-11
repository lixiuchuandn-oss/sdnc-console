# 文档 Hub（`AGENTS.md` 子文档）

> **`AGENTS.md`** 为入口；本目录为可提交的技术说明（非对外写作/白皮书）。

| 文档 | 说明 |
| ---- | ---- |
| [cleanup-note.md](./cleanup-note.md) | **全局清理执行 Note**（无用代码/ESLint；进行中） |
| [ci.md](./ci.md) | CI 与本地复现 |
| [code-quality.md](./code-quality.md) | 代码质量合入清单 |
| [frontend-layout.md](./frontend-layout.md) | 前端布局、`.std-table`、工具栏 |
| [internetwork-routing-domain.md](./internetwork-routing-domain.md) | 网际路由域、SDN 导航 IA |
| [vr-sase-downstream-notice.md](./vr-sase-downstream-notice.md) | VR / SASE 下游对接 |
| [srv6-baseline-recompute.md](./srv6-baseline-recompute.md) | SRv6 baseline / recompute |
| [srv6-config-ledger-and-drift.md](./srv6-config-ledger-and-drift.md) | **SRv6 账本 / 叠加 / 漂移**（弹窗 vs 黄标、语义比较、对账修复边界） |
| [srv6-hub-pe-spec.md](./srv6-hub-pe-spec.md) | SRv6 Hub PE 约束 |
| [srv6-release-notes.md](./srv6-release-notes.md) | SRv6 发版说明 |
| [srv6-testcases.md](./srv6-testcases.md) | SRv6 冒烟清单 |
| [sdnc-tower-integration-api.md](./sdnc-tower-integration-api.md) | Tower ↔ SDNC 联部署（可选；独立 SDNC 可忽略） |
| [sdnc-stack-integration.md](./sdnc-stack-integration.md) | **SDNC 全栈整合**（Tower + CSMCTL + Mongo，交付与数据边界） |
| [ibr-vr-config-deploy.md](./ibr-vr-config-deploy.md) | **IBR VR 配置下发**（分域 merge、漂移、NAT/ACL；初始化通道边界） |
| [bgp-rr-design.md](./bgp-rr-design.md) | **BGP Route Reflector（RR）** 产品定义、与 SRv6 共存与 config_json 合并（设计；功能未实现）；RR 域导入模板见 [`templates/rr-domain-import-template.csv`](./templates/rr-domain-import-template.csv) |
| [ibr-stack-components.md](./ibr-stack-components.md) | **IBR 全栈组件**（SDNC / CSMCTL / agent / 设备 Console 对照与联调） |
| [ibr-identity-registration.md](./ibr-identity-registration.md) | **IBR 设备身份**（Paas 接入与身份 vs vrctl-agent 注册、uuid 主键、仍可手改文件） |

**同仓组件**：[`../csm-controller/README.md`](../csm-controller/README.md) — CSMCTL 构建、API 与 Tower 联调。

源码旁：`frontend/src/STRUCTURE.md`、`backend/src/STRUCTURE.md`。
