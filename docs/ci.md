# CI 与合入门禁

> **Workflow 定义**：`.github/workflows/ci.yml`  
> **建议顺序**：先把 `main` 上 CI 稳定全绿 → 再开 GitHub Branch protection（见 §3）。

---

## 1. 触发条件

| 事件                    | 何时跑                         |
| ----------------------- | ------------------------------ |
| `pull_request` → `main` | 开 PR、向 PR 推新 commit       |
| `push` → `main`         | 直接 push 或 PR merge 后       |
| `workflow_dispatch`     | Actions 页手动「Run workflow」 |

PR 与 push 使用**同一套 job**；差别在于 Branch protection 只会在 **合并 PR 前**拦截，不会阻止已完成的直推（见 §3）。

---

## 2. Job 与步骤

### Backend — `Backend (tsc / lint / test / build)`

1. `npm ci`
2. `npx tsc --noEmit`
3. `npm run lint`（`--max-warnings=0`）
4. `npx jest --ci`
5. `npx tsc`（生产构建）

### Format — `Format (prettier backend + docs)`

1. `npm ci`（`backend/`，含 `prettier` devDependency）
2. `npm run format:check`（`backend/src/**/*.ts` 与 `docs/**/*.md`；**不含** `frontend/`）

### Frontend — `Frontend (tsc / eslint / test / build)`

1. `npm ci`
2. `npx tsc --noEmit`
3. `npx eslint "src/**/*.{ts,tsx}" --max-warnings=0`
4. `npx react-scripts test --watchAll=false`（`CI=true`）
5. `npx react-scripts build`（`CI=true`，编译 warning 视为失败）

环境：`Node 20`；前端 `NODE_OPTIONS=--max-old-space-size=4096`。

---

## 3. 本地复现（合并前建议跑）

```bash
# 后端
cd backend
npm ci
npx tsc --noEmit
npm run lint
npm run format:check
npx jest --ci
npx tsc

# 前端
cd frontend
npm ci
npx tsc --noEmit
npx eslint "src/**/*.{ts,tsx}" --max-warnings=0
CI=true NODE_OPTIONS=--max-old-space-size=4096 npx react-scripts test --watchAll=false
CI=true NODE_OPTIONS=--max-old-space-size=4096 npx react-scripts build
```

只改一侧时，跑对应一侧即可；动到共享类型或路由时建议两侧都跑。

---

## 4. 已知差异与后续收紧

| 项                  | 现状                                             | 后续                                                                         |
| ------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------- |
| 后端 ESLint warning | **`--max-warnings=0`**（与 `npm run lint` 一致） | 保持为零                                                                     |
| Prettier            | CI 校验 **`backend/src`** + **`docs/`**          | `frontend/` 仍靠 lint-staged；全仓前端格式化见 `quality-improvement-plan.md` |
| E2E / 冒烟          | 无                                               | 关键路径另线补充                                                             |

**在 `main` CI 全绿且团队习惯走 PR 之前，不要先开严格的 Required checks**，否则容易全员合不进去。

---

## 5. 开启 Branch protection（CI 稳定后再做）

路径：**GitHub 仓库 → Settings → Branches → Add rule（`main`）**

建议勾选：

1. **Require a pull request before merging** — 禁止（或极限制）直推 `main`
2. **Require status checks to pass before merging**
3. Required checks 添加（名称与 Actions job 一致）：
   - `Backend (tsc / lint / test / build)`
   - `Format (prettier backend + docs)`
   - `Frontend (tsc / eslint / test / build)`
4. **Do not allow bypassing the above settings** — 或仅保留 1 个 break-glass 账号
5. （可选）**Require branches to be up to date before merging** — PR 与最新 `main` 不一致时要求更新后再跑 CI

配置完成后：

- **PR 合并**：CI 不绿 → 无法 merge ✅
- **直推 main**：被拒绝或必须先 PR ✅

---

## 6. 小改合入习惯

- 短分支 + 小 PR + 等 CI 绿 + merge（描述一行即可）
- 本地至少跑「§3 里你改动涉及的那一侧」
- 避免直推 `main`；紧急 hotfix 例外须事后说明
