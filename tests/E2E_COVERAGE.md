# Cloudmap E2E 覆盖一览

> **新人 / 后来者怎么找到本文？**
> 1. 仓库根目录 **`AGENTS.md`** → 架构文档分工表 → 本文件
> 2. **`tests/README.md`** 首节「E2E 覆盖一眼看」
> 3. `tests/` 下执行 **`npm run e2e:status`**（终端也会提示本路径）
> 4. 只读 Tab 冒烟见 **`smoke/README.md`**；功能 E2E 登记在 **`e2e-manifest.cjs`**
> 5. 用户手册章节覆盖（非自动化）见 **`docs/cloudmap/user-manual/COVERAGE.md`**

**一眼看状态**：在 `tests/` 目录执行：

```bash
npm run e2e:status
```

数据源自 `e2e-manifest.cjs`（与本文同步维护）。

## 图例

| 标记 | 含义 |
|------|------|
| ✅ 功能 E2E | 有 API 或浏览器**写路径**用例（创建/改/删等），用例结束会清理 `tower-e2e-*` 测试资源 |
| ◐ 部分 | 只有 API 或只有浏览器，或仅覆盖子流程 |
| 🔍 仅冒烟 | 只有 `smoke/*` Tab 遍历（只读、无红屏） |
| ⏸️ 暂缓 | 硬件依赖、DRS、VM/网络高危删除等，刻意后置 |
| ❌ 未覆盖 | 冒烟也没有功能 E2E |

## 已完成功能 E2E（✅）

| 域 | 手册 | API 脚本 | 浏览器脚本 | 备注 |
|----|------|----------|------------|------|
| 登录 | ch02 | `auth/admin-login.api.test.cjs` | `auth/admin-login.browser.test.cjs` | |
| 故障域 | ch03 §6.1 | `harvester/failure-domains/api-crud.api.test.cjs` | `browser-crud` + `browser-assign-filter` | |
| 部署集 | ch03 §6.1 | `harvester/deployment-sets/api-crud.api.test.cjs` | `browser-crud` + `browser-lifecycle` | lifecycle 含 UI 删 |
| 安全组 | ch03 §14 | `harvester/security-groups/api-crud.api.test.cjs` | `browser-crud` + `browser-lifecycle` | 成员规则待补 |
| 镜像 | ch03 §7.7 | `harvester/images/api-*.api.test.cjs`（多套件） | 上传/同步/列表/URL 导入 | `npm run test:images:api` |
| **VLAN** | ch03 §6.2 | `harvester/vlans/api-crud.api.test.cjs` | `harvester/vlans/browser-crud.browser.test.cjs` | 引用存量 PN |
| **公共子网** | ch03 §6.2 | `harvester/public-subnets/api-crud.api.test.cjs` | `harvester/public-subnets/browser-crud.browser.test.cjs` | 创建+改名；无 UI 删 |

## 部分覆盖（◐）

| 域 | 已有 | 缺口 |
|----|------|------|
| **CSM 租户** | `sdncc/csm/api-tenants.api.test.cjs` + `browser-tenants` | 租户 v2 需 `csmRepairPasswordEncrypted` 才 200 |
| 边缘云测连 | API + `smoke/pool-edge-wizard` | 无完整创建池浏览器流程 |
| 创建资源池 | `cnmc/cloudmap/pool-create.api.test.cjs` | 无浏览器 E2E |

## 仅冒烟（🔍）

对应 `npm run test:smoke` 分项，详见 `smoke/README.md`：

- 集群全 Tab（`test:smoke:cluster`）— 含 DRS/交换机/物理网络等**只打开页面**
- 云主机侧栏（`test:smoke:vm`）
- 网络 / VPC Tab（`test:smoke:network`）
- 块存储（`test:smoke:storage`）
- 备份（`test:smoke:backups`）
- 资源总览（`test:smoke:overview`）
- 容器（`test:smoke:containers`）
- 监控（`test:smoke:monitoring`）
- 云数据库 / VNE / 日志（`test:smoke:misc`）
- 系统设置 / 租户（`test:smoke:admin`）
- 登录与池列表（`test:smoke:pool`）
- VM 详情抽屉（`test:smoke:vm-detail`）

## 暂缓（⏸️）

| 域 | 原因 |
|----|------|
| 交换机 | 依赖机房硬件 |
| 物理网络新建 | 同上；网卡占用过滤已修，E2E 待环境就绪 |
| DRS 规则 | 策略/高危，统一后置 |
| VM 删除 / 破坏性电源操作 | 高危后置 |

## 建议下一批（❌ → ✅）

1. **扁平子网**（不依赖新交换机）
2. **VM 快速创建**（只读镜像/网络已有基础）
3. **安全组成员**（需扁平网 + VM 环境）
4. 卷挂载 / 备份任务（中等复杂度）

## 维护约定

1. 新增 `*.api.test.cjs` 或功能 `*.browser.test.cjs` 时，在 `e2e-manifest.cjs` 登记一条。
2. 跑 `npm run e2e:status` 确认无「清单未登记」或「文件缺失」警告。
3. 用户手册覆盖见 `docs/cloudmap/user-manual/COVERAGE.md`（文档 vs 截图）；**本文件只管自动化 E2E**。
