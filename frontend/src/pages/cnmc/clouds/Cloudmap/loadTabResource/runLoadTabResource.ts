import type { LoadTabResourceDeps } from './types';
import { tryLoadStorageTab } from './handlers/storageTabs';
import { tryLoadClusterTab } from './handlers/clusterTabs';
import { tryLoadKubeOvnVpcTab } from './handlers/kubeOvnVpcTabs';
import { tryLoadKubeOvnFlatTab } from './handlers/kubeOvnFlatTabs';
import { tryLoadContainerTab } from './handlers/containerTabs';

/**
 * 按 Tab key 按需拉取资源。具体 case 按领域拆至 `handlers/*Tabs.ts`。
 */
export async function runLoadTabResource(
  key: string,
  force: boolean,
  skipSync: boolean,
  deps: LoadTabResourceDeps,
): Promise<void> {
  if (await tryLoadStorageTab(key, force, skipSync, deps)) return;
  if (await tryLoadClusterTab(key, force, skipSync, deps)) return;
  if (await tryLoadKubeOvnVpcTab(key, force, skipSync, deps)) return;
  if (await tryLoadKubeOvnFlatTab(key, force, skipSync, deps)) return;
  if (await tryLoadContainerTab(key, force, skipSync, deps)) return;
}
