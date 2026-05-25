import { HarvesterTestParams } from './types';
import { getHarvesterVM, patchHarvesterVM } from './vm';

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

function isNotFound(err: any): boolean {
  const status = Number(err?.status ?? 0);
  const msg = String(err?.message || '').toLowerCase();
  return status === 404 || msg.includes('not found');
}

/**
 * 恢复/克隆后 VM 可能延迟创建；轮询并写入 tower.io/alias。
 */
export async function applyVmTowerAliasWhenReady(
  conn: HarvesterTestParams,
  namespace: string,
  vmName: string,
  alias: string,
  maxWaitMs = 120_000,
): Promise<boolean> {
  const trimmed = String(alias || '').trim();
  if (!trimmed || !namespace || !vmName) return true;

  const intervalMs = 3_000;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    try {
      const vm = await getHarvesterVM(conn, namespace, vmName);
      if (vm) {
        const current = String(vm?.metadata?.annotations?.['tower.io/alias'] || '').trim();
        if (current === trimmed) return true;

        const patchBody = buildAliasJsonPatch(vm, trimmed);
        if (patchBody.length === 0) return true;

        await patchHarvesterVM(
          conn,
          namespace,
          vmName,
          patchBody,
          'application/json-patch+json',
        );
        return true;
      }
    } catch (e: any) {
      if (isNotFound(e)) {
        await sleep(intervalMs);
        continue;
      }
      throw e;
    }
    await sleep(intervalMs);
  }

  return false;
}
