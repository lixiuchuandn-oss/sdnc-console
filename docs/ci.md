# CI 与合入门禁

> **Workflow 定义**：`.github/workflows/ci.yml`、`.github/workflows/smoke.yml`

---

## 1. 触发条件

| 事件                    | 何时跑                         |
| ----------------------- | ------------------------------ |
| `pull_request` → `main` | 开 PR、向 PR 推新 commit       |
| `workflow_dispatch`     | Actions 页手动「Run workflow」 |

---

## 2. Job 与步骤

### Backend — `Backend (tsc / lint / test / build)`

1. `npm ci`
2. `npx tsc --noEmit`
3. `npm run lint`（`--max-warnings=0`）
4. `npx jest --ci`
5. `npx tsc`（生产构建）

### Smoke — `Smoke (API health + auth)`

定义：`.github/workflows/smoke.yml`（health + 登录 + `admin-default-home`）

### Frontend — `Frontend (tsc / eslint / test / build)`

1. `npm ci`
2. `npx tsc --noEmit`
3. `npx eslint "src/**/*.{ts,tsx}" --max-warnings=0`
4. `npx react-scripts test --watchAll=false`（`CI=true`）
5. `npx react-scripts build`（`CI=true`）

环境：`Node 20`；前端 `NODE_OPTIONS=--max-old-space-size=4096`。

### Tests — `Tests (auth Playwright spec list)`

1. `cd tests && npm ci`
2. `npx playwright test auth/ --list`（仅校验用例可加载）

---

## 3. 本地复现

```bash
# 后端
cd backend
npm ci
npx tsc --noEmit
npm run lint
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

---

## 4. 说明

- 仓库**不**在 CI 中校验 Markdown / Prettier 文档格式（个人维护，无协作写作门禁）。
- pre-commit：前端 `lint-staged` 仅 `eslint --fix`；后端暂存 `.ts` 时跑 `tsc --noEmit`。
