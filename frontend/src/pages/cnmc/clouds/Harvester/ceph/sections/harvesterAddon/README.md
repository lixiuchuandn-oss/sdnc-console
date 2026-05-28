# 统一存储配置（`harvester_addon`）

Cloudmap **集群 → 存储服务 → 存储配置** 向导 UI。

## 目录

| 文件 | 职责 |
|------|------|
| `CephHarvesterAddonSection.tsx` | Section 壳：Steps / Tabs / 提交入口 |
| `NodeDiskAssignmentEditor.tsx` | 节点与数据盘 Form.List 编排 |
| `NodeDiskNodeCard.tsx` | 单节点卡片（Select + `BlockDeviceCardGrid`） |
| `BlockDeviceCardGrid.tsx` | 可选盘卡片网格 |
| `hooks/useHarvesterAddonSection.ts` | 向导步进、提交 |
| `hooks/useHarvesterAddonSectionData.ts` | Addon 状态、节点/BlockDevice 拉取与轮询 |
| `lib/cephHarvesterAddon*.ts` | 配置/表单/校验；`cephHarvesterBlockDevices.ts` 为 BlockDevice 解析 |

## 刷新与布局（`docs/code-quality.md` · 评审登记例外）

- **数据**：`useHarvesterAddonSectionData` → `fetchCephHarvesterAddon` / `fetchBlockDevices` / `fetchNodeResources`，`force` 时 `cache: no-store`。
- **刷新**：区块内「刷新磁盘」；**无** `PageDetailSection` 顶栏 Reload（池层 `loadTabResource` 仅门控）。
- **表格**：本 Tab 为**向导 + 卡片选盘**，不适用全站 `std-table` 列表样板（见 `ceph/README.md`）。

## 单测

- `lib/cephHarvesterAddon.test.ts` — 表单与运行态扩容校验
- `lib/cephHarvesterBlockDevices.test.ts` — BlockDevice 过滤与元数据盘选项
