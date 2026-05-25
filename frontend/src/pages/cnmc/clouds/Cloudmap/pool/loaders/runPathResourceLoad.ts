import type { PoolPathResourceDeps } from './poolDataDeps';
import { tryLoadStorageTab } from './pathResource/storagePathLoads';
import { tryLoadBackupTab } from './pathResource/backupsPathLoads';
import { tryLoadComputeTab } from './pathResource/computePathLoads';
import { tryLoadPaasDatabasesTab } from './pathResource/paasDatabasesPathLoads';
import { tryLoadClusterTab } from './pathResource/clusterPathLoads';
import { tryLoadKubeOvnVpcTab } from './pathResource/kubeOvnPathLoads';
import { tryLoadKubeOvnFlatTab } from './pathResource/flatNetworkPathLoads';
import { tryLoadContainerTab } from './pathResource/containersPathLoads';
import { tryLoadOniaasNetworkTab } from './pathResource/oniaasNetworkPathLoads';
import { tryLoadObjectStorageTab } from './pathResource/objectStoragePathLoads';

/**
 * 按 URL 内层段（与侧栏 `pathSeg` 一致）按需拉数。
 * 调度顺序与业务域实现文件一一对应：`pathResource/*PathLoads.ts`。
 */
export async function runPathResourceLoad(
  key: string,
  force: boolean,
  skipSync: boolean,
  deps: PoolPathResourceDeps,
): Promise<void> {
  /** 资源总览 · Ceph 存储总览：面板内自建拉取 */
  if (key === 'ceph_storage_overview') return;
  if (await tryLoadStorageTab(key, force, skipSync, deps)) return;
  if (await tryLoadBackupTab(key, force, skipSync, deps)) return;
  if (await tryLoadComputeTab(key, force, skipSync, deps)) return;
  if (await tryLoadPaasDatabasesTab(key, force, skipSync, deps)) return;
  if (await tryLoadClusterTab(key, force, skipSync, deps)) return;
  if (await tryLoadOniaasNetworkTab(key, force, skipSync, deps)) return;
  if (await tryLoadKubeOvnVpcTab(key, force, skipSync, deps)) return;
  if (await tryLoadKubeOvnFlatTab(key, force, skipSync, deps)) return;
  if (await tryLoadContainerTab(key, force, skipSync, deps)) return;
  if (await tryLoadObjectStorageTab(key, force, skipSync, deps)) return;
}
