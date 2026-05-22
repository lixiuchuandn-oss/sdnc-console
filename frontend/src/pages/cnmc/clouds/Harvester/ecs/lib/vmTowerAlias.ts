/**
 * 等待新建/恢复后的 VM 在集群中出现，并写入 tower.io/alias（与云主机列表 SafeRead.name 一致）。
 */
import { fetchHarvesterVmDetail, patchHarvesterVm } from '../../../../../../services/harvesterApi';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function buildAliasJsonPatch(vm: any, alias: string): object[] {
  const trimmed = String(alias || '').trim();
  const hasAnnotations = !!vm?.metadata?.annotations;
  const hasPrev = !!vm?.metadata?.annotations?.['tower.io/alias'];
  const aliasPath = '/metadata/annotations/tower.io~1alias';

  if (!trimmed) {
    if (!hasPrev) return [];
    return [{ op: 'remove', path: aliasPath }];
  }

  if (!hasAnnotations) {
    return [{ op: 'add', path: '/metadata/annotations', value: { 'tower.io/alias': trimmed } }];
  }
  if (hasPrev) {
    return [{ op: 'replace', path: aliasPath, value: trimmed }];
  }
  return [{ op: 'add', path: aliasPath, value: trimmed }];
}

function isVmNotFoundError(e: any): boolean {
  const status = Number(e?.status ?? 0);
  const msg = String(e?.message || '').toLowerCase();
  return status === 404 || msg.includes('not found') || msg.includes('404');
}

/**
 * 轮询直至 VM 可 PATCH，写入显示名称别名。
 * @returns 是否已成功写入
 */
export async function applyVmTowerAliasWhenReady(
  cloudId: string,
  namespace: string,
  vmName: string,
  alias: string,
  options?: { maxWaitMs?: number; intervalMs?: number },
): Promise<boolean> {
  const trimmed = String(alias || '').trim();
  if (!trimmed || !namespace || !vmName) return true;

  const maxWaitMs = options?.maxWaitMs ?? 120_000;
  const intervalMs = options?.intervalMs ?? 3_000;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    try {
      const vm = await fetchHarvesterVmDetail(cloudId, namespace, vmName);
      if (vm) {
        const current = String(vm?.metadata?.annotations?.['tower.io/alias'] || '').trim();
        if (current === trimmed) return true;

        const patchBody = buildAliasJsonPatch(vm, trimmed);
        if (patchBody.length === 0) return true;

        await patchHarvesterVm(
          cloudId,
          namespace,
          vmName,
          patchBody,
          'application/json-patch+json',
        );
        return true;
      }
    } catch (e: any) {
      if (isVmNotFoundError(e)) {
        await sleep(intervalMs);
        continue;
      }
      throw e;
    }
    await sleep(intervalMs);
  }

  return false;
}
