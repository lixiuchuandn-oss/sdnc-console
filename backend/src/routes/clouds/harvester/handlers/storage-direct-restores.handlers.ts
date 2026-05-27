/**
 * ==============================================================================
 * 模块名称: Harvester Restores Handlers (恢复相关)
 * 文件路径: src/routes/clouds/harvester/handlers/restores.handlers.ts
 * ==============================================================================
 * 功能描述:
 * - Longhorn / Harvester 原生：VirtualMachineRestore
 * - Ceph 存储：CephVmRestore（hms.rivercloud.com/v1）
 * ==============================================================================
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { HarvesterBackupInventory } from '../../../../entities/harvester/HarvesterBackupInventory';
import {
  createHarvesterVirtualMachineRestore,
  createHarvesterCephVmRestore,
  buildHarvesterCephVmRestoreBody,
  findCephVmBackupByName,
  isCephVmBackupResource,
  resolveCephBackupSourceVm,
  shouldFallbackToCephVmRestore,
} from '../../../../services/clouds/harvester/client';
import { applyVmTowerAliasWhenReady } from '../../../../services/clouds/harvester/vmAlias';
import { fetchCloudOr404, ensureProvider } from '../harvester.cache.helpers';

function backupResourceType(record: HarvesterBackupInventory | null, body: any): 'backup' | 'snapshot' {
  const t = String(record?.type || record?.rawData?.spec?.type || body?.spec?.type || 'backup');
  return t === 'snapshot' ? 'snapshot' : 'backup';
}

/**
 * POST /:id/resources/harvester/virtualmachinerestores/:namespace - 恢复 VM (从备份或快照)
 */
export async function harvesterRestoreCreateHandler(req: Request, res: Response) {
  try {
    const { id, namespace } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const conn = { endpoint: cloud.endpoint, token: cloud.secretKey, insecure } as any;

    const backupName = String(req.body?.spec?.virtualMachineBackupName || '').trim();
    const backupNs = String(req.body?.spec?.virtualMachineBackupNamespace || namespace).trim();

    const repo = AppDataSource.getRepository(HarvesterBackupInventory);
    let backupRecord: HarvesterBackupInventory | null = null;
    if (backupName) {
      backupRecord = await repo.findOne({
        where: { cloudId: id, namespace: backupNs, name: backupName },
      });
    }

    let useCeph =
      isCephVmBackupResource(backupRecord?.rawData) ||
      String(req.body?.metadata?.annotations?.['tower.io/backupBackend'] || '') === 'ceph';

    let result: any;
    let restoreBackend: 'ceph' | 'longhorn' = 'longhorn';

    const runCephRestore = async () => {
      if (!backupName) {
        throw new Error('缺少备份名称（spec.virtualMachineBackupName）');
      }
      let sourceVm = resolveCephBackupSourceVm(backupRecord);
      if (!sourceVm) {
        const cephRaw = await findCephVmBackupByName(conn, backupNs, backupName);
        sourceVm = resolveCephBackupSourceVm(null, cephRaw);
      }
      if (!sourceVm) {
        throw new Error(`无法解析统一存储备份 ${backupNs}/${backupName} 的源虚拟机（sourceVm）`);
      }
      const cephBody = buildHarvesterCephVmRestoreBody(req.body, {
        sourceVm,
        backupName,
        backupNamespace: backupNs,
        resourceType: backupResourceType(backupRecord, req.body),
      });
      return createHarvesterCephVmRestore(conn, namespace, cephBody);
    };

    if (useCeph) {
      result = await runCephRestore();
      restoreBackend = 'ceph';
    } else {
      try {
        result = await createHarvesterVirtualMachineRestore(conn, namespace, req.body);
      } catch (e: any) {
        if (shouldFallbackToCephVmRestore(e) && backupName) {
          console.log(
            `[Restore-Create] 备份 ${backupNs}/${backupName} 非 VirtualMachineBackup，改走 CephVmRestore`,
          );
          useCeph = true;
          result = await runCephRestore();
          restoreBackend = 'ceph';
        } else {
          throw e;
        }
      }
    }

    const ann = (req.body?.metadata?.annotations || {}) as Record<string, string>;
    const restoreMode = String(ann['tower.io/restoreMode'] || '');
    const displayName = String(ann['tower.io/restoreTargetDisplayName'] || '').trim();
    const restoreTarget = String(ann['tower.io/restoreTarget'] || '').trim();
    if (restoreMode === 'new' && displayName && restoreTarget.includes('/')) {
      const slash = restoreTarget.indexOf('/');
      const targetNs = restoreTarget.slice(0, slash);
      const targetVm = restoreTarget.slice(slash + 1);
      if (targetNs && targetVm) {
        void applyVmTowerAliasWhenReady(conn, targetNs, targetVm, displayName).catch((err) => {
          console.warn(
            `[Restore-Create] 恢复后写入 VM 显示名称失败 ${targetNs}/${targetVm}:`,
            err?.message || err,
          );
        });
      }
    }

    res.json({
      message: '创建恢复任务成功',
      data: result,
      backend: restoreBackend,
    });
  } catch (error: any) {
    const detail =
      typeof error?.body === 'string'
        ? error.body
        : error?.body != null
          ? JSON.stringify(error.body)
          : error?.message || String(error);
    res.status(500).json({ message: '创建恢复任务失败', error: detail });
  }
}
