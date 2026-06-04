# feat(harvester): 镜像分片上传、virtualSize 与同步状态对齐 Harvester UI

**分支**: `feat/harvester-image-upload-sync` → `main`  
**提交**: `b2789ddd`  
**仓库**: https://github.com/lixiuchuandn-oss/Compute.Tower

---

## Summary

本 PR 仅包含 **Harvester 镜像** 相关改动（48 个文件，+6878 / -1044 行），涵盖本地 qcow2 分片上传、导入进度与 virtualSize 展示、同步到底座失败状态，以及与 Harvester UI 一致的就绪判定逻辑。

### 后端

- **分片上传任务**：`ImageUploadTask` 实体与 SQLite 表扩展；创建任务前 `checkImageUploadDiskSpace`（`statfs` 校验 Tower 暂存目录）；分片 PUT 支持断点续传（已收分片 index 跳过写入）。
- **上传基础设施**：`towerTempPaths` 统一暂存根目录；`imageUploadStorage`、`imageUploadRuntime`、`imageUploadGlobalConcurrency`（全局并发限制）；`sqliteWriteLock` 避免长时间写锁阻塞；可选流式直传 `harvesterImageStreamUpload`。
- **virtualSize**：新增 `qcow2VirtualSize` 解析 qcow2 头；`vmImageClusterApi.resolveVmImageVirtualSizeFromCluster` + `injectVmImageVirtualSize`；列表/enrich 跳过 0 值，未完成导入不写假数据。
- **导入完成判定**：`isHarvesterVmImageImportComplete` — `Imported=True` 或 `progress≥100` 且 `size>0`；不再仅凭 Steve `active` 标记「已就绪」。
- **同步与列表**：`storage-cache-images.handlers` 重构进度合成（`effectiveProgress`）；`CloudSyncService` / `inventory` 同步失败时保留失败态；审计日志对分片 body 脱敏。
- **单元测试**：`vmImageClusterApi.test.ts`、`qcow2VirtualSize.test.ts`、`imageUploadGlobalConcurrency.test.ts`。

### 前端

- **分片上传**：`chunkedImageUpload`（hash-wasm 校验）、`uploadTaskProgressThrottle`、上传任务抽屉 `ImageUploadTasksDrawer`。
- **镜像列表**：`vmImageStatus` / `imagesTableColumns` 对齐 Harvester 导入态与失败红色进度条；移除无效的 virtualSize 自动补全轮询。
- **操作流**：`imagesSectionActions` / `useImagesSectionActions` 续传、并行上传限制、同步 API 错误 toast；`ImageCreateModal` / `ImagesSection` 集成。
- **刷新**：`harvesterSectionRefresh`、`computePathLoads` 支持 `skipSync`；Cloudmap 计算 Tab 传入 `onImagesInventoryReload`。
- **API 封装**：`harvesterApi.getHarvesterImagesListItems`；换盘抽屉复用统一列表解析。
- **单元测试**：`chunkedImageUpload.test.ts`、`imagesSectionActions.test.ts`、`imagesSectionUtils.test.ts`、`harvesterSectionRefresh.test.ts`。

### 依赖

- 前端新增 `hash-wasm`（分片 MD5）、`@types/crypto-js`。

### 未纳入本 PR（工作区仍保留未提交改动）

- 登录/审计：`auth.ts`、`AuthContext.tsx`、`loginLockMessage.ts`
- 通用 dev 配置：`api.ts`、后端 `package.json`（`TOWER_SKIP_BACKGROUND_SYNC`）
- Harbor / 离线升级：`HarborProjectSyncService.ts`、`OfflineUpgradeService.ts`
- 打包产物：`dist-offline/`、`scripts/pack-offline-upgrade.ps1`

---

## Test plan

- [ ] 本地 qcow2 上传：列表在导入完成前不显示错误「已就绪」；完成后 virtualSize 与 Harvester UI 一致（非 `-`）
- [ ] 上传中断后重选同一文件：显示续传，已传分片不重复写入
- [ ] 同步到底座失败：列表状态「失败」+ 红色异常进度条
- [ ] 上传任务抽屉：多任务进度、取消/失败展示正常
- [ ] Tower 暂存目录空间不足：创建 upload-task 时返回明确错误
- [ ] 单元测试：
  ```bash
  cd backend && npm test -- vmImageClusterApi qcow2VirtualSize imageUploadGlobalConcurrency
  cd frontend && npm test -- chunkedImageUpload imagesSectionActions imagesSectionUtils harvesterSectionRefresh --watchAll=false
  ```

---

## 创建 Pull Request

本机未安装 GitHub CLI（`gh`）时，可在推送分支后于 GitHub 网页创建 PR，或将下方正文粘贴到 PR 描述框。

```bash
git push -u origin feat/harvester-image-upload-sync
```

**PR 标题**（与 commit 一致）：

```
feat(harvester): 镜像分片上传、virtualSize 与同步状态对齐 Harvester UI
```

**PR 正文**：复制上方 Summary + Test plan 章节即可。

安装 `gh` 后也可执行：

```bash
gh pr create --base main --head feat/harvester-image-upload-sync \
  --title "feat(harvester): 镜像分片上传、virtualSize 与同步状态对齐 Harvester UI" \
  --body-file .github/pull-requests/feat-harvester-image-upload-sync.md
```

（需去掉文件顶部的 `#` 标题行，或单独维护 body 片段。）
