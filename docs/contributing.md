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

## 4. PR 入门（给新同事）

当前 **未开启** GitHub 强制 Branch protection，但请尽量按下面流程提交，并在合并前确认 Actions 全绿。

### 4.1 一次性准备

```bash
git clone <仓库地址>
cd Compute.Tower   # 以实际目录名为准
```

### 4.2 每次改动的五步

**① 从最新 main 拉分支**

```bash
git checkout main
git pull origin main
git checkout -b feature/简短英文描述
# 示例：feature/fix-pod-list-cache
```

**② 改代码并提交**

```bash
git add <改动的文件>    # 或 git add .
git commit -m "fix: 用一句话说明做了什么"
```

**③ 推到远端**

```bash
git push -u origin feature/简短英文描述
```

**④ 在 GitHub 开 Pull Request**

- 浏览器会提示 **Compare & pull request**，或：仓库 → **Pull requests** → **New pull request**
- Base 选 **`main`**，Compare 选你的 **`feature/...`** 分支
- 标题写清「改了什么」；描述可粘贴 §3 清单并勾选

**⑤ 等 CI 绿了再 Merge**

在 PR 页的 **Checks** 里应看到（名称可能略有差异，以 Actions 为准）：

- Backend (tsc / lint / test / build)
- Format (prettier backend + docs)
- Frontend (tsc / eslint / test / build)
- Smoke (API health)

全部 ✓ 后点 **Merge pull request**。若某 job 红了，点进日志修代码，再 `git push` 同一分支，CI 会自动重跑。

### 4.3 常见问题

| 情况                         | 处理                                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| Format CI 红、只改了 `docs/` | 在 `backend` 目录执行 `npm run format` 后 commit + push                                                   |
| Frontend 显示 canceled       | 多为并发取消，在 Actions 里 **Re-run** 或空 push 触发重跑                                                 |
| 与 main 冲突                 | 本地 `git checkout main && git pull`，回到功能分支 `git merge main` 或 `git rebase main`，解决冲突后 push |
| 误提交到 main                | 不要 force push；新开功能分支 cherry-pick 或重做 PR                                                       |

### 4.4 提交信息（建议）

- `fix:` 修 bug
- `feat:` 新功能
- `docs:` 仅文档
- `refactor:` 重构、无行为变更

---

## 5. Branch protection（维护者，可选）

团队熟悉 PR 流程后，再在 GitHub 为 `main` 开启 **Classic branch protection**（见 **`docs/ci.md` §5**）。建议 Required checks：

- `Backend (tsc / lint / test / build)`
- `Format (prettier backend + docs)`
- `Frontend (tsc / eslint / test / build)`
- `Smoke (API health)`

私有仓库免费计划可能无法真正拦截合并，规则仍可先配置，升级组织后生效。
