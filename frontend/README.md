# 前端（`frontend/`）

本目录为前端工程根（与 `frontend/src` 源码配合使用）。

**目录划分、命名、放置规则与反模式**：**唯一权威见 [`src/STRUCTURE.md`](src/STRUCTURE.md)**（勿在其它 Markdown 再写一套约束）。

**Harvester 云详情子树**（域 / `shared` / `sections`·`modals` 等）：`deployment/docs/specs/修改纪要_Harvester前端目录结构_域优先与shared.md`。

常用命令见 **`src/STRUCTURE.md` §13**；速查：

```bash
cd frontend
npm install
npm run start
npm run build
npx tsc --noEmit
```
