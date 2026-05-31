# 代码质量（PR / 专项清理）

> **全仓唯一 Hub 文档**（`docs/code-quality.md`）：**§1～§9** 为合入前必查清单；**§10～§12** 为可维护性/规范性**可选评分**（0～10，**不含功能测试**）。  
> 入口与强制约定摘要见 **`AGENTS.md`**；落位见 **`frontend/src/STRUCTURE.md`**、**`backend/src/STRUCTURE.md`**；布局见 **`docs/frontend-layout.md`**。冲突时以 **STRUCTURE 专章与 AGENTS 强制约定** 为准。

**推荐阅读顺序（自查时）**：① 落位 → ② 命名 → ③ 文件结构 → **④ 复用** → ⑤ 强制行为 → ⑥ 可维护性 → ⑦ 性能 → ⑧ 安全 → ⑨ 构建合入 →（可选）**⑩ 评分**。

---

## 1. 落位、结构与依赖

- **不私自改目录拓扑**：新增/搬迁遵循 **`frontend/src/STRUCTURE.md`** / **`backend/src/STRUCTURE.md`**；禁止无业务理由的跨平台乱迁、散落「垃圾文件」。
- **页面布局**：列表/详情/池内 Tab 容器选用见 **`docs/frontend-layout.md`**（`PageContainer` / `PageDetailContainer` / `PageDetailSection`、上下文侧栏、URL `?tab=`）。
- **业务域内角色**：Harvester 等大域使用 `sections/`、`drawers/`、`modals/`、`lib/`、`hooks/`；跨 **≥2 个业务域** 的复用再上浮 `shared/` 或 `src/components/`。
- **路由与文件夹**：对外 URL 以 **`RouteSpec` / `backend/src/index.ts` 挂载**为准；**不要求** URL 与 `pages/` 路径逐段同构（见 `STRUCTURE.md` §3）。
- **依赖方向**：`routes` → `services` → 云 SDK/实体；前端 `pages` 经 `services/` 调 API；避免循环依赖、反向引用、跨模块抄近路。
- **模块入口**：优先小写 **`index.ts` / `index.tsx`**；存量 **`Index.tsx`**（如 `settings/`）允许保留，新代码与**同级目录**习惯一致。
- **静态资源**：图片、字体、全局样式放在约定目录（如 `assets/`、`global-new.css`）；清理未引用静态文件与废弃依赖。

## 2. 命名（与仓库一致）

细则与**已登记例外**以 **`STRUCTURE.md` §4** 为准：

| 对象                            | 约定                                                  |
| ------------------------------- | ----------------------------------------------------- |
| **业务目录**（`pages/` 下通用） | 小写 **`kebab-case`**                                 |
| **云厂商目录**（`clouds/` 下）  | **`PascalCase`**（`Harvester/`、`Aliyun/`）           |
| **React 组件文件**              | **`PascalCase.tsx`**                                  |
| **工具 / 纯逻辑 TS**            | **`camelCase.ts`**                                    |
| **变量、函数**                  | **camelCase**；**常量** 可用 **UPPER_SNAKE_CASE**     |
| **布尔量**                      | 优先 **is / has / can / should** 前缀                 |
| **事件**                        | Props 用 **onXxx**；组件内 **handleXxx**              |
| **CSS**                         | 列表等以 **`global-new.css`**（**`.std-table`**）为准 |

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

| 避免                                          | 应做                                           |
| --------------------------------------------- | ---------------------------------------------- |
| 每 Section 自写工具栏刷新与 `onRefresh(true)` | 统一 refresh helper + 父级注入 `onRefresh`     |
| 页面内拼 `/api/clouds/...`                    | **`services/`** 已有函数                       |
| 封装「仅包 Skeleton」组件                     | 直接用 **antd** `Table` `loading` / `Skeleton` |
| 单次使用抽「万能 utils」到 `src/utils`        | 逻辑留在**本域 `lib/`**                        |

**PR 必答**：本改动是否检索过上述层级？复用了哪些模块？为何不能复用？

## 5. 本仓强制行为（合入必查）

| 主题            | 要点                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| **数据刷新**    | 对端拉取/同步；`skipCache: true` / `clearCache`；禁止假刷新；Cloudmap 见 **`Cloudmap/pool/README.md`**               |
| **API**         | 经 **`services/`** + **`requestManager`**                                                                            |
| **列表表格**    | **`std-table`**、`bordered={false}`、首列/操作列 `fixed`、`scroll.x`（**§5.1**，样板 **VmSection**）                 |
| **列表工具栏**  | `toolbarLeft`/`toolbarRight` 或 `SharedToolbar` 标准动作；`toolbar-search` / `toolbar-actions`、图标刷新（**§5.2**） |
| **加载态**      | **`Table` `loading`** / **`Skeleton`**                                                                               |
| **格式与 Lint** | Prettier + ESLint + lint-staged；本次改动零新增告警                                                                  |

## 6. 可维护性、TypeScript 与注释

- 消除死代码、注释掉的旧实现、未引用文件与重复拷贝逻辑。
- 巨型 Section 拆 `lib/*Columns.tsx`、`*SectionUtils.ts`、**`hooks/`**（体量目标见 **§10.2**）。
- 减少无必要 `any`；对外 Props 与 API 响应应有明确类型。
- 注释只保留非显而易见业务说明。
- 需量化自评时见 **§10～§12**（**不替代**功能测试验收）。

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
3. 列表/工具栏/写操作是否满足 **刷新与缓存**、**§5.1 表格**、**§5.2 工具栏**？
4. 是否引入 ESLint/类型/构建错误？
5. 是否删除本次改动产生的死代码与重复逻辑？
6. 是否做过相关路径的手动冒烟（尤其 Harvester 云详情 Tab）？

---

## 10. 评分范围（仅代码可维护性 + 规范性）

| 纳入                                           | 不纳入（测试 / 验收另线） |
| ---------------------------------------------- | ------------------------- |
| 目录落位、命名、分层、文件体量                 | 业务需求是否实现完整      |
| 复用 `services/`、域内 `lib`/`hooks`、公共组件 | 功能用例是否通过          |
| 刷新、缓存、`std-table`、工具栏约定            | 压测、渗透、等保          |
| 纯函数/状态机单测（逻辑层）                    | UI 视觉、产品文案终审     |
| 前后端重复规则是否标注同步                     | 生产告警、用户反馈        |

**§1～§9 全部满足**方可合入；§10～§12 分数用于团队内改进对比，**不能**代替测试结论。

---

## 11. 记分方式（满分 10，可选）

两维度各 **0～5**，相加为总分。**先满足 §1～§5 硬性门槛，再打分。**

### 11.1 可维护性（0～5）

| 分档     | 标准                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------ |
| **0～1** | Section/路由 **>800 行** 堆状态+请求+UI；难单测；大量复制粘贴                                    |
| **2～3** | 能跑但难改；逻辑仍在 Section；重复代码；改动牵连面大                                             |
| **4**    | 逻辑在 `lib/`/`hooks/`/`services/`；Section 以组合为主；关键纯函数有单测；单文件大体 **<600 行** |
| **5**    | 职责清晰；复杂状态有专用 hook；FE/BE 双份规则有**同步注释**；可按 STRUCTURE/README 局部修改      |

**常见扣分**：死代码、无清理轮询、`any` 泛滥、同一校验双份且无说明。

### 11.2 规范性（0～5）

| 分档     | 标准                                                                     |
| -------- | ------------------------------------------------------------------------ |
| **0～1** | 落位乱、页面拼 API、无 `std-table`/刷新语义、违 AGENTS                   |
| **2～3** | 大体合目录；刷新/工具栏/池 `onRefresh` 未接齐；表格缺 `fixed`+`scroll.x` |
| **4**    | 符合 STRUCTURE + **§5**；API 走 `services/`；容器选用正确                |
| **5**    | 与 **§12** 域内样板一致；lint/tsc 无新增问题                             |

**硬性门槛（未满足则规范性最高 3 分，且不应合入）**：违反 **§1～§5**；ESLint/TS/构建失败；新列表未按 **`frontend-layout.md` §5.1/§5.2**（评审例外须注明）。

### 11.3 总分含义（团队内自用）

| 总分         | 含义                           |
| ------------ | ------------------------------ |
| **<6**       | 建议先重构或缩小 PR            |
| **6～7.5**   | 可合入（清单已过），登记技术债 |
| **7.5～8.5** | 日常迭代达标                   |
| **8.5～9.5** | 可作域内样板                   |
| **10**       | 极少满分                       |

分数**仅用于本仓库前后对比**，不与 Sonar/他项目对标。

---

## 12. 全仓样板对照（按改动域查表）

| 平台 / 域                 | 典型源码根                            | 列表 + 工具栏样板              | 池层 / 刷新样板                       |
| ------------------------- | ------------------------------------- | ------------------------------ | ------------------------------------- |
| **CNMC · Harvester 计算** | `Harvester/ecs/`                      | `ecs/sections/VmSection.tsx`   | `Cloudmap/pool/README.md` · `compute` |
| **CNMC · Harvester 集群** | `Harvester/cluster/`                  | 域内 `sections/*Section.tsx`   | 同上 · `cluster`                      |
| **CNMC · Harvester 存储** | `Harvester/ceph/`                     | `CephPoolSection.tsx`          | `ceph/README.md` · `cephRefresh.ts`   |
| **CNMC · Harvester 网络** | `Harvester/kube-ovn/`、`nad/`         | 域内 Section + `lib/`          | `kubeOvnRefresh.ts` 等                |
| **CNMC · Cloudmap 池**    | `Cloudmap/pool/`                      | `panels/*` → Section           | **`Cloudmap/pool/README.md`**         |
| **CNMC · 多云详情**       | `Aliyun/`、`Hw/`、`Harvester/`…       | `PageDetailSection` + sections | 厂商页 `onRefresh`                    |
| **CNMC · MAAS**           | `pages/cnmc/clouds/maas/`             | `*Section.tsx` + `lib/`        | `maasPoolSidebar`                     |
| **TENANTS**               | `pages/tenants/`                      | `PageContainer` / 详情容器     | `RouteSpec`                           |
| **SDNCC**                 | `pages/sdncc/`                        | 列表 + `services/`             | —                                     |
| **CNSOC**                 | `pages/cnsoc/`                        | 同上                           | —                                     |
| **SETTINGS**              | `pages/settings/`                     | 同上                           | —                                     |
| **后端 · 多云**           | `routes/clouds/` → `services/clouds/` | —                              | 薄路由；`handlers/`                   |
| **后端 · 租户 / 系统**    | `routes/tenants/`、`routes/system.ts` | —                              | 见 `backend/src/STRUCTURE.md`         |

**Harvester 池内 Section 刷新**：`createHarvesterToolbarRefresh` / `runHarvesterSectionRefresh`（`Harvester/shared/lib/harvesterSectionRefresh.ts`）；**禁止**裸调 `onRefresh(true)`。

**后端 API**：`routes` 薄 → `services` → SDK；Harvester 复杂主题优先 `handlers/`。

### 12.1 PR 自评模板（可选）

```markdown
### 代码可维护性（自评，非测试结论）

- 可维护性：\_/5 —
- 规范性：\_/5 —
- 对照：code-quality §\_、样板 \_\_\_
```

### 12.2 单测与评分

- **加分**：`lib/`、`services/` 内纯函数、解析器、校验（变更时建议补例）。
- **不替代**：Section 冒烟、E2E、真实集群（测试负责）。
- **后端**：`backend/src/**/*.test.ts`，`npm test`（`backend/jest.config.js`）。

---

## 附录：五十条清单 ↔ 上节约束（PR 勾选）

**全仓一次性满足 50 条**属长期专项，**非**单条 PR 硬性门槛。

| 大类           | 条号  | 要点                     | 对应                       |
| -------------- | ----- | ------------------------ | -------------------------- |
| 一、基础代码   | 1     | ESLint/Prettier          | **§5**                     |
|                | 2     | 死代码、未引用文件       | **§6**                     |
|                | 3–4   | 排版、编码               | Prettier / `.editorconfig` |
|                | 5–7   | 去重、圈复杂度、单一职责 | **§4**、**§6**             |
| 二、工程结构   | 8–15  | 目录、依赖、路由         | **§1**、**STRUCTURE §3**   |
| 三、命名       | 16–24 | kebab / Pascal / camel   | **§2**                     |
| 四、文件内部   | 25–28 | 导入、类型、分层         | **§3**                     |
| 五、质量可维护 | 29–34 | TS、注释、拆组件         | **§4**、**§6**             |
| 六、性能       | 35–39 | 重复请求、渲染、泄漏     | **§7**                     |
| 七、健壮安全   | 40–43 | 边界、异常、密钥         | **§8**                     |
| 八、构建依赖   | 44–46 | 构建无报错               | **§9**                     |
| 九、业务上线   | 47–50 | 日志、无回归             | **§9**                     |

**命名差异**：条 16 在 Compute Tower 中**仅**约束 `pages/` 业务目录与通用工具文件；**React 组件**见 **STRUCTURE.md §4**。
