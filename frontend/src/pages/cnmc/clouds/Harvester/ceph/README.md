# Harvester · ceph（Rook Ceph / 对象存储 / RBD Mirror）

> 源码根：`frontend/src/pages/cnmc/clouds/Harvester/ceph/`  
> Cloudmap 入口分散在 **`cluster/storage_pools`**、**`object_storage/*`**、**`storage/rbd_mirror`**、**`resource_hub/ceph_storage_overview`**（总览仍面板内探测，见下文例外）。

## 目录角色

| 目录 | 职责 |
|------|------|
| `sections/` | 存储池、对象网关/COSI、RGW 用户/S3 桶、RBD Mirror 列表 |
| `sections/block/` | RBD Mirror 视图 + bundle hook |
| `modals/` | BlockPool / Rook 池表单 |
| `lib/` | bundle 归一化、表格行映射；**`cephSectionRefresh.ts`** re-export shared 刷新 helper |

## 列表刷新约定（Cloudmap 池）

| 层 | 落点 |
|----|------|
| 池 · `onRefresh` | `loaders/cephRefresh.ts` → **`createCephTabOnRefresh(tab)`** |
| 池 · 拉数 | `pathResource/clusterPathLoads`（`storage_pools` 标记）、`objectStoragePathLoads`（对象存储 Tab 标记）；**列表数据仍 Section 自拉 Steve/Rook/Dashboard** |
| 池 · 装配 | `panels/cluster` · `panels/object_storage` · `panels/storage/CloudmapStorageCephRbdMirror` |
| Section | **`mergeCephSectionOnRefresh(localLoad, onRefresh)`** + **`createHarvesterToolbarRefresh` / `runHarvesterSectionRefresh`** |

### `loadTabResource` key

| 侧栏 / 导航 | key | Section |
|-------------|-----|---------|
| 集群 · 存储池 | `storage_pools` | `CephPoolSection` |
| 对象存储 · S3 桶 | `rgw_s3_buckets` | `RgwS3BucketsSection` |
| 对象存储 · RGW 用户 | `rgw_users` | `RgwObjectStoreUsersSection` |
| 对象存储 · 对象网关 | `object_gateways` | `CephObjectStorageSection`（storesOnly） |
| 对象存储 · COSI | `cosi` | `CephObjectStorageSection`（cosiOnly） |
| 云存储 · RBD Mirror | `rbd_mirror` | `CephBlockRbdMirrorPane` |

## 有意例外

- **`ceph_storage_overview`**（资源总览）：`CloudmapStorageDashboardByBackend` 探测 Ceph/Longhorn 后渲染 `CephStorageSection`，**不**走路径 `loadTabResource`（`runPathResourceLoad` 早退）。
- **`CephStorageSection`**：Dashboard 总览页，非标准列表 Tab，维持面板内自管。

## 列表表格

主列表须 **`className="std-table"`**、**`scroll={{ x: true }}`**、首列/操作列 `fixed`（见 **`AGENTS.md` · 列表表格**）。
