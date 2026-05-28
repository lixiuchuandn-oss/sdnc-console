# 代码质量自查（PR / 专项清理）

> Hub 子文档 · 合入前与专项治理用检查清单（**`docs/pr-checklist.md`**，可提交）。  
> 入口与强制约定摘要见 **`AGENTS.md`**；落位见 **`frontend/src/STRUCTURE.md`**、**`backend/src/STRUCTURE.md`**。冲突时以 **STRUCTURE 专章与 AGENTS 强制约定** 为准。

**推荐阅读顺序（自查时）**：① 落位与依赖 → ② 命名 → ③ 文件内结构 → **④ 不要重复造轮子** → ⑤ 强制行为（刷新/API/表格）→ ⑥ TS 与注释 → ⑦ 性能 → ⑧ 安全 → ⑨ 构建与合入。

---

## 1. 落位、结构与依赖

- **不私自改目录拓扑**：新增/搬迁遵循 **`frontend/src/STRUCTURE.md`** / **`backend/src/STRUCTURE.md`**；禁止无业务理由的跨平台乱迁、散落「垃圾文件」。
- **业务域内角色**：Harvester 等大域使用 `sections/`、`drawers/`、`modals/`、`lib/`、`hooks/`；跨 **≥2 个业务域** 的复用再上浮 `shared/` 或 `src/components/`。
- **路由与文件夹**：对外 URL 以 **`RouteSpec` / `backend/src/index.ts` 挂载**为准；**不要求** URL 与 `pages/` 路径逐段同构（见 `STRUCTURE.md` §3）。
- **依赖方向**：`routes` → `services` → 云 SDK/实体；前端 `pages` 经 `services/` 调 API；避免循环依赖、反向引用、跨模块抄近路。
- **模块入口**：优先小写 **`index.ts` / `index.tsx`**；存量 **`Index.tsx`**（如 `settings/`）允许保留，新代码与**同级目录**习惯一致。
- **静态资源**：图片、字体、全局样式放在约定目录（如 `assets/`、`global-new.css`）；清理未引用静态文件与废弃依赖。

## 2. 命名（与仓库一致）

细则与**已登记例外**以 **`STRUCTURE.md` §4** 为准：

| 对象 | 约定 |
|------|------|
| **业务目录**（`pages/` 下通用） | 小写 **`kebab-case`** |
| **云厂商目录**（`clouds/` 下） | **`PascalCase`**（`Harvester/`、`Aliyun/`） |
| **React 组件文件** | **`PascalCase.tsx`** |
| **工具 / 纯逻辑 TS** | **`camelCase.ts`** |
| **变量、函数** | **camelCase**；**常量** 可用 **UPPER_SNAKE_CASE** |
| **布尔量** | 优先 **is / has / can / should** 前缀 |
| **事件** | Props 用 **onXxx**；组件内 **handleXxx** |
| **CSS** | 列表等以 **`global-new.css`**（**`.std-table`**）为准 |

禁止拼音、无意义单字母、自创缩写。

## 3. 文件内部结构

建议顺序：**第三方导入 → 项目内导入 → 类型 → 常量 → 状态 → 回调/方法 → JSX → 导出**。

- **类型**：共享类型放 `types/` 或域内 `lib/*Types.ts`。
- **逻辑分层**：过滤、列构建、提交编排放 **`lib/`**、**`hooks/`**；Section 负责组合。
- **工具分类**：全站 `utils/`、业务 `lib/`、请求 `services/`、缓存 `requestManager` —— 勿混在同一文件。

## 4. 不要重复造轮子（复用优先）

**原则**：新增能力前**先查再写**；已有等价实现则**扩展或调用**。

**动手前检索（建议顺序）**

1. **`services/`**、**`AGENTS.md` · API 规范**
2. **同业务域 `pages/.../<域>/lib/`、`hooks/`**（如 **`harvesterSectionRefresh.ts`**、`*TableColumns.tsx`）
3. **`src/components/`、`hooks/`、`utils/`**
4. **Harvester `shared/`** —— 仅 **≥2 域** 需要时再上浮
5. **后端** `routes` + `services/clouds/<厂商>/`；优先扩 `handlers/`

| 避免 | 应做 |
|------|------|
| 每 Section 自写工具栏刷新与 `onRefresh(true)` | 统一 refresh helper + 父级注入 `onRefresh` |
| 页面内拼 `/api/clouds/...` | **`services/`** 已有函数 |
| 封装「仅包 Skeleton」组件 | 直接用 **antd** `Table` `loading` / `Skeleton` |
| 单次使用抽「万能 utils」到 `src/utils` | 逻辑留在**本域 `lib/`** |

**PR 必答**：本改动是否检索过上述层级？复用了哪些模块？为何不能复用？

## 5. 本仓强制行为（合入必查）

| 主题 | 要点 |
|------|------|
| **数据刷新** | 对端拉取/同步；`skipCache: true` / `clearCache`；禁止假刷新；Cloudmap 见 **`Cloudmap/pool/README.md`** |
| **API** | 经 **`services/`** + **`requestManager`** |
| **列表表格** | **`std-table`**、首列/操作列 `fixed`、`scroll.x` |
| **加载态** | **`Table` `loading`** / **`Skeleton`** |
| **格式与 Lint** | Prettier + ESLint + lint-staged；本次改动零新增告警 |

## 6. 可维护性、TypeScript 与注释

- 消除死代码、注释掉的旧实现、未引用文件与重复拷贝逻辑。
- 巨型 Section 拆 `lib/*Columns.tsx`、`*SectionUtils.ts`。
- 减少无必要 `any`；对外 Props 与 API 响应应有明确类型。
- 注释只保留非显而易见业务说明。

## 7. 性能与资源

- 避免重复 GET；轮询须可停止；`useEffect` 清理定时器与订阅。
- 列表读缓存与强制刷新语义一致。
- React：稳定 `useCallback`/`useMemo` 依赖、合理 `key`。

## 8. 健壮性与安全

- 边界与空值、接口失败须有用户可感知提示。
- 不得吞掉本应展示给用户的错误。
- 密钥、Token 禁止进仓库。

## 9. 构建、依赖与合入标准

- 改动范围内 **`npm run build`** / **`tsc --noEmit`** 应通过。
- 列表增删改后按 **AGENTS · 数据展示与刷新 · 自测** 验证，无需 F5。

**合入前最小检查（可复制到 PR 描述）**：

1. 文件落位是否符合 STRUCTURE / AGENTS **开发规范**？
2. 是否 **先查再写**、复用已有 API/组件/域内 `lib`？
3. 列表/写操作是否满足 **刷新与缓存**、**std-table**？
4. 是否引入 ESLint/类型/构建错误？
5. 是否删除本次改动产生的死代码与重复逻辑？
6. 是否做过相关路径的手动冒烟（尤其 Harvester 云详情 Tab）？

---

## 附录：五十条清单 ↔ 上节约束（PR 勾选）

**全仓一次性满足 50 条**属长期专项，**非**单条 PR 硬性门槛。

| 大类 | 条号 | 要点 | 对应 |
|------|------|------|------|
| 一、基础代码 | 1 | ESLint/Prettier | **§5** |
| | 2 | 死代码、未引用文件 | **§6** |
| | 3–4 | 排版、编码 | Prettier / `.editorconfig` |
| | 5–7 | 去重、圈复杂度、单一职责 | **§4**、**§6** |
| 二、工程结构 | 8–15 | 目录、依赖、路由 | **§1**、**STRUCTURE §3** |
| 三、命名 | 16–24 | kebab / Pascal / camel | **§2** |
| 四、文件内部 | 25–28 | 导入、类型、分层 | **§3** |
| 五、质量可维护 | 29–34 | TS、注释、拆组件 | **§4**、**§6** |
| 六、性能 | 35–39 | 重复请求、渲染、泄漏 | **§7** |
| 七、健壮安全 | 40–43 | 边界、异常、密钥 | **§8** |
| 八、构建依赖 | 44–46 | 构建无报错 | **§9** |
| 九、业务上线 | 47–50 | 日志、无回归 | **§9** |

**命名差异**：条 16 在 Compute Tower 中**仅**约束 `pages/` 业务目录与通用工具文件；**React 组件**见 **STRUCTURE.md §4**。
