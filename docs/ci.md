# CI 与合入门禁

> **Workflow 定义**：`.github/workflows/ci.yml`  
> **建议顺序**：先把 `main` 上 CI 稳定全绿 → 再开 GitHub Branch protection（见 §3）。

---

## 1. 触发条件

| 事件                    | 何时跑                         |
| ----------------------- | ------------------------------ |
| `pull_request` → `main` | 开 PR、向 PR 推新 commit       |
| `workflow_dispatch`     | Actions 页手动「Run workflow」 |

**不**在 `push` → `main`（含 PR merge 后）上重复跑同一套 job，避免合入前后各查一遍。合入门禁依赖 PR 上的 Required checks（见 §5）；若有人直推 `main`，须靠 Branch protection 拒绝或事后在 Actions 手动 `workflow_dispatch` 补跑。

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

### Smoke — `Smoke (API health + auth)`

1. `npm ci` → `npx tsc`
2. 启动 `node dist/index.js`（`PORT=5099`、`DB_SYNC=true`、`LOGIN_ALLOW_PLAINT_PASSWORD=1`）
3. 轮询 `GET http://127.0.0.1:5099/health` 直至 200
4. `POST /api/auth/login`（种子账户 `admin` / `admin123`），断言响应含 `token`
5. `GET /api/auth/admin-default-home`（`Authorization: Bearer <token>`）直至 200

定义：`.github/workflows/smoke.yml`

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

| 项                  | 现状                                                          | 后续                                                                         |
| ------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 后端 ESLint warning | **`--max-warnings=0`**（与 `npm run lint` 一致）              | 保持为零                                                                     |
| Prettier            | CI 校验 **`backend/src`** + **`docs/`**                       | `frontend/` 仍靠 lint-staged；全仓前端格式化见 `quality-improvement-plan.md` |
| E2E / 冒烟          | **`Smoke (API health + auth)`**（health + 登录 + 受保护 API） | UI 级 Playwright（Cloudmap Tab 等）另线补充                                  |
| `npm ci` 网络抖动   | 仓库根 `.npmrc` 提高 fetch 重试；CI 用 `.github/scripts/npm-ci.sh` 最多 3 次 | 若仍 `ECONNRESET`，在 Actions 里重跑 workflow                                 |

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
   - （推荐）`Smoke (API health + auth)`
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
