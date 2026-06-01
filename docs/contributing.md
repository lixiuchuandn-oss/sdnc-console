# 贡献与合入前检查

> 与 **`docs/ci.md`**、**`docs/code-quality.md`** 配套。合入 `main` 前请按改动范围执行对应检查。

---

## 1. 改了哪些路径，就跑哪些检查

| 改动范围                | 本地命令（在仓库根目录执行）                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`backend/src/**`\*\*  | `cd backend && npm ci && npm run format && npm run lint && npx tsc --noEmit && npx jest --ci`                                                        |
| **`docs/**/\*.md`\*\*   | `cd backend && npm run format:check`（Prettier 配置在 `backend/.prettierrc`）                                                                        |
| **`frontend/src/**`\*\* | `cd frontend && npm ci && npx eslint "src/**/*.{ts,tsx}" --max-warnings=0 && npx tsc --noEmit`                                                       |
| 前端逻辑/构建           | 上表 ESLint、tsc 通过后，再加：`CI=true NODE_OPTIONS=--max-old-space-size=4096 npx react-scripts test --watchAll=false` 与 `npx react-scripts build` |

只改文档时，**至少**执行 `cd backend && npm run format:check`，避免 **Format (prettier backend + docs)** CI 失败。

---

## 2. 格式化（Prettier）

- **已纳入 CI**：`backend/src/**/*.ts`、`docs/**/*.md`
- **写入格式化**：`cd backend && npm run format`
- **仅检查**：`cd backend && npm run format:check`

`frontend/src` 仍靠 **lint-staged**（`frontend/package.json`），全仓 `prettier --write` 前端会破坏部分 `eslint-disable-next-line react-hooks/exhaustive-deps` 行位，见 **`quality-improvement-plan.md`**。

---

## 3. 合入前最小清单（可复制到 PR）

```text
- [ ] 文件落位符合 frontend/src/STRUCTURE.md、backend/src/STRUCTURE.md
- [ ] 已跑本节「改动范围」对应命令且通过
- [ ] 若改 docs/ 或 backend/src/：已执行 npm run format（backend 目录）
- [ ] 列表刷新/写操作符合 AGENTS.md 数据刷新约定（如适用）
```

---

## 4. Branch protection（维护者）

`main` 建议勾选 Required checks（名称与 Actions job 一致）：

- `Backend (tsc / lint / test / build)`
- `Format (prettier backend + docs)`
- `Frontend (tsc / eslint / test / build)`
- （可选）`Smoke (API health)`

详见 **`docs/ci.md` §5**。
