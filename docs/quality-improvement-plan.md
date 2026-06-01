# 质量改进执行清单

> 与 **`docs/ci.md`**、**`docs/code-quality.md`** 配套。本文记录分阶段技术债清理顺序与验收标准。

---

## 阶段总览

| 阶段   | 目标                                  | 状态                                                                                  |
| ------ | ------------------------------------- | ------------------------------------------------------------------------------------- |
| **P0** | 后端 ESLint warning → 0               | 已完成（`cursor/backend-eslint-cleanup-c3e5`）                                        |
| **P1** | CI 后端 lint 改为 `--max-warnings=0`  | 已完成（`backend/package.json`、`docs/ci.md`）                                        |
| **P2** | 巨型文件按主题拆分                    | **进行中**：至 `gateway`；主文件约 1.6k 行；后续 CRUD 代理 / Registry 等              |
| **P3** | 前端 bundle 分析与 code splitting     | **部分完成**：Cloudmap 池 `lazyPoolPanels`；监控/大盘等页 `LazyReactECharts` 按需加载 |
| **P4** | Prettier `--check`、关键路径 E2E/冒烟 | **部分完成**：Prettier CI；**`Smoke (API health)`** workflow（`GET /health`）         |

### Prettier 范围说明

- **已纳入 CI**：`backend/src/**/*.ts`、`docs/**/*.md`（`npm run format:check`）
- **仍仅 lint-staged**：`frontend/src`（全仓 `prettier --write` 会破坏部分 `eslint-disable-next-line react-hooks/exhaustive-deps` 的行对齐，须单独 PR 处理）

---

## P0：后端 ESLint 清零

### 范围

- 规则：`@typescript-eslint/no-unused-vars`、`prefer-const`、`no-useless-escape`、`no-dupe-else-if`、`no-useless-catch`、`prefer-as-const`
- 基线（`main`）：约 **230 warning / 0 error**
- 目标：**0 warning**

### 执行步骤

1. `npx eslint "src/**/*.ts" --fix`（`prefer-const` 等可自动修复项）
2. 正则中 `[^\/]` → `[^/]`（`no-useless-escape`）
3. 机械处理未使用 import/参数：`backend/scripts/fix-eslint-warnings.mjs`（基于 ESLint JSON）
4. 手工收尾：死分支、无用 try/catch、未使用 origin 计算块
5. 验收：

```bash
cd backend
npx eslint "src/**/*.ts" --max-warnings=0
npx tsc --noEmit
npx jest --ci
npx tsc
```

### 合入后

- 更新 `backend/package.json` 的 `lint` 脚本为：`eslint "src/**/*.ts" --max-warnings=0`
- 更新 `.github/workflows/ci.yml` 与 `docs/ci.md` §4「后端 ESLint warning」一行

---

## P2：巨型文件拆分（建议顺序）

按「改动频率 × 行数」优先，每次只拆一个主题，保证 PR 可审。

| 优先级 | 文件（约行数）                                                      | 建议拆法                                                                      |
| ------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1      | `routes/clouds/harvester/harvester.cache.container.routes.ts` (~5k) | **已拆**：`shared`～`gateway`；主文件约 1.6k 行；后续 CRUD 代理 / Registry 等 |
| 2      | `routes/clouds/aliyun/routes.ts` (~4.5k)                            | 按产品（ECS/VPC/RDS…）拆 `aliyun/*.routes.ts`                                 |
| 3      | `services/clouds/harvester/vm_update.ts` (~2.3k)                    | 按操作（patch/disks/network）拆 `vm_update/*.ts`                              |
| 4      | `frontend/.../WorkloadForm.tsx` (~7.5k)                             | 表单子组件 + `hooks/useWorkloadForm*.ts`                                      |
| 5      | `frontend/.../JobsSection.tsx` (~2.1k)                              | 列定义 `lib/*Columns.tsx`、工具栏/刷新 `lib/`                                 |

### 单 PR 检查项

- [ ] 无行为变更（或变更在 PR 描述中明确）
- [ ] 相关单测仍绿
- [ ] 无新增 `eslint` / `tsc` 问题
- [ ] 对外路由与 API 路径不变

---

## P3：前端包体积

1. `npx source-map-explorer 'build/static/js/*.js'`（需先 `react-scripts build`）
2. 对 >500KB 的 chunk 做路由级 `React.lazy`
3. 复核 `echarts`、`@ant-design/charts` 是否可按页动态 import

---

## P4：CI 增强

| 项       | 命令                                                   | 说明                                      |
| -------- | ------------------------------------------------------ | ----------------------------------------- |
| Prettier | `npx prettier --check "src/**/*.{ts,tsx,json,md,css}"` | 与 lint-staged 对齐                       |
| 冒烟     | 登录 + Cloudmap 单 Tab + VM 列表                       | 可用 Playwright 或内部脚本，另开 workflow |

---

## 合入前最小检查（复制到 PR）

1. `cd backend && npx eslint "src/**/*.ts" --max-warnings=0 && npx tsc --noEmit && npx jest --ci`
2. `cd frontend && npx eslint "src/**/*.{ts,tsx}" --max-warnings=0 && npx tsc --noEmit`
3. 本次 diff 无意外删除业务逻辑（尤其 Harvester / 权限）
4. 若改 `lint` 脚本或 CI workflow，已同步 **`docs/ci.md`**
