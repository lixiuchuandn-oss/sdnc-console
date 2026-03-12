import { Router, Response } from 'express';
import { AppDataSource } from '../../../config/database';
import {
  HarvesterGpuInventory,
} from '../../../entities/harvester/HarvesterGpuInventory';
import { HarvesterPciDeviceInventory } from '../../../entities/harvester/HarvesterPciDeviceInventory';
import {
  HarvesterUsbInventory,
} from '../../../entities/harvester/HarvesterUsbInventory';
import {
  syncHarvesterGpus,
  syncHarvesterPciDevices,
  syncHarvesterUsbResources,
} from '../../../services/clouds/harvester/inventory';
import { createHarvesterUsbDeviceClaim, deleteHarvesterPciDeviceClaim, deleteHarvesterUsbDeviceClaim, listHarvesterPciDeviceClaims, listHarvesterUsbDeviceClaims, listK8sNodesRaw } from '../../../services/clouds/harvester/client';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';

/**
 * ==============================================================================
 * 组件名称: Harvester 硬件外设管理 (Harvester Peripherals Management)
 * 文件路径: backend/src/routes/clouds/harvester/harvester.cache.peripherals.routes.ts
 * ==============================================================================
 * 
 * [功能描述]
 * 负责 Harvester 节点硬件外设资源 (GPU, USB) 的库存查询。
 * 主要用于虚拟机透传配置时的资源发现。
 * 
 * [核心逻辑]
 * 1. [库存同步]: 
 *    - 采用 "Cache-First" 策略，优先返回数据库缓存。
 *    - 当数据库为空或显式指定 force=true 时，触发远程同步 (syncHarvesterGpus/Usb)。
 * 2. [数据标准化]: 
 *    - USB 设备接口会对原始数据进行精简，提取 vendorId, productId 等关键信息。
 * 
 * ------------------------------------------------------------------------------
 * [API 接口说明]
 * ------------------------------------------------------------------------------
 * 1. GET /:id/resources/harvester/gpus
 *    - 获取集群内可用的 PCI/vGPU 设备列表。
 * 
 * 2. GET /:id/resources/harvester/usb-devices
 *    - 获取集群内可用的 USB 透传设备列表。
 * ==============================================================================
 */
export const registerHarvesterPeripheralsRoutes = (
  router: Router,
  checkAdminPermission: any,
) => {
  router.get(
    '/:id/resources/harvester/gpus',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterGpuInventory);
        const count = await repo.count({ where: { cloudId: id } });

        // [同步策略] 缓存优先 + 按需同步
        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterGpus(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync GPUs failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        }

        const items = await repo.find({ where: { cloudId: id } });
        const list = items.map((i) => i.rawData);

        let claims: any[] = [];
        try {
          claims = await listHarvesterPciDeviceClaims({ endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any);
        } catch {}
        const claimMap = new Map<string, any>();
        const claimByKey = new Map<string, any>();
        (Array.isArray(claims) ? claims : []).forEach((c: any) => {
          const cn = String(c?.metadata?.name || c?.name || '').trim();
          if (cn) claimMap.set(cn, c);
          const owners = Array.isArray(c?.metadata?.ownerReferences) ? c.metadata.ownerReferences : [];
          owners.forEach((o: any) => {
            const on = String(o?.name || '').trim();
            if (on) claimMap.set(on, c);
          });
          const pciDeviceName = String(c?.status?.pciDeviceName || c?.spec?.pciDeviceName || c?.spec?.pciDevice || c?.spec?.deviceName || '').trim();
          if (pciDeviceName) claimMap.set(pciDeviceName, c);
          const rn = String(c?.spec?.resourceName || c?.resourceName || '').trim();
          const node = String(c?.spec?.nodeName || c?.nodeName || '').trim();
          const addr = String(c?.spec?.pciAddress || c?.spec?.address || c?.pciAddress || c?.address || '').trim();
          if (rn && node && addr) claimByKey.set(`${node}|${rn}|${addr}`, c);
        });

        let nodes: any[] = [];
        try {
          nodes = await listK8sNodesRaw({ endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any);
        } catch {}
        const quotaByNodeResource = new Map<string, { capacity?: number; allocatable?: number }>();
        const parseNum = (v: any) => {
          if (v === undefined || v === null) return undefined;
          const s = String(v).trim();
          if (!s) return undefined;
          const n = Number(s);
          return Number.isFinite(n) ? n : undefined;
        };
        (Array.isArray(nodes) ? nodes : []).forEach((n: any) => {
          const node = String(n?.metadata?.name || n?.name || '').trim();
          if (!node) return;
          const cap = n?.status?.capacity || {};
          const allo = n?.status?.allocatable || {};
          Object.keys({ ...(cap || {}), ...(allo || {}) }).forEach((k) => {
            if (!k) return;
            const cnum = parseNum(cap?.[k]);
            const anum = parseNum(allo?.[k]);
            if (cnum === undefined && anum === undefined) return;
            quotaByNodeResource.set(`${node}|${k}`, { capacity: cnum, allocatable: anum });
          });
        });

        const findClaimForRow = (r: any) => {
          const raw = r?.raw || r;
          const rn = String(r?.resourceName || raw?.status?.resourceName || raw?.spec?.resourceName || '').trim();
          const node = String(r?.nodeName || r?.node || raw?.status?.nodeName || raw?.spec?.nodeName || '').trim();
          const addr = String(r?.pciAddress || r?.address || raw?.status?.pciAddress || raw?.status?.address || raw?.spec?.pciAddress || raw?.spec?.address || '').trim();
          const devName = String(raw?.metadata?.name || r?.name || '').trim();
          const claim = (devName && claimMap.has(devName))
            ? claimMap.get(devName)
            : (node && rn && addr && claimByKey.has(`${node}|${rn}|${addr}`))
              ? claimByKey.get(`${node}|${rn}|${addr}`)
              : null;
          return { claim, rn, node };
        };

        const usedByNodeResource = new Map<string, number>();
        (Array.isArray(list) ? list : []).forEach((r: any) => {
          const { claim, rn, node } = findClaimForRow(r);
          if (claim && rn && node) {
            const key = `${node}|${rn}`;
            usedByNodeResource.set(key, (usedByNodeResource.get(key) || 0) + 1);
          }
        });

        const enriched = (Array.isArray(list) ? list : []).map((r: any) => {
          const { claim, rn, node } = findClaimForRow(r);
          const claimed = !!claim;
          const claimedBy = claim?.spec?.userName || claim?.userName || '';
          const claimName = claim?.metadata?.name || claim?.name || '';
          const claimNamespace = claim?.metadata?.namespace || claim?.namespace || '';
          const ownerRefs = Array.isArray(claim?.metadata?.ownerReferences) ? claim.metadata.ownerReferences : [];
          const bindingTargets = ownerRefs
            .map((o: any) => ({
              apiVersion: o?.apiVersion,
              kind: o?.kind,
              name: o?.name,
              uid: o?.uid,
            }))
            .filter((x: any) => x?.kind && x?.name);
          const bindingTo = bindingTargets.length > 0
            ? bindingTargets.map((x: any) => `${x.kind}:${x.name}`).join(', ')
            : (claimName ? `PCIDeviceClaim:${claimName}` : (claimedBy ? `user:${claimedBy}` : ''));
          const claimRaw = claim ? {
            apiVersion: claim?.apiVersion,
            kind: claim?.kind,
            metadata: claim?.metadata,
            spec: claim?.spec,
            status: claim?.status,
          } : null;
          const quota = node && rn ? quotaByNodeResource.get(`${node}|${rn}`) : undefined;
          const allocatable = quota?.allocatable;
          const used = node && rn ? (usedByNodeResource.get(`${node}|${rn}`) || 0) : 0;
          const free = typeof allocatable === 'number' ? Math.max(allocatable - used, 0) : undefined;
          return {
            ...r,
            claimed,
            claimedBy,
            claimName,
            claimNamespace,
            bindingTo,
            bindingTargets,
            claimRaw,
            quota: quota ? { ...quota, used, free } : undefined,
          };
        });

        res.json({ message: '查询成功', data: { items: enriched } });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: '查询GPU资源失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/gpu-claims',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const items = await listHarvesterPciDeviceClaims({ endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any);
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询GPU Claim失败', error: error.message });
      }
    },
  );

  router.delete(
    '/:id/resources/harvester/gpu-claims/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await deleteHarvesterPciDeviceClaim(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          name,
        );
        res.json({ message: '更新成功', data });
      } catch (error: any) {
        res.status(500).json({ message: '删除GPU Claim失败', error: error.body || error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/usb-devices',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterUsbInventory);
        const count = await repo.count({ where: { cloudId: id } });

        // [同步策略] 缓存优先 + 按需同步
        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterUsbResources(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync USBs failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        }

        let claims: any[] = [];
        try {
          claims = await listHarvesterUsbDeviceClaims({ endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any);
        } catch {}
        const claimMap = new Map<string, any>();
        (Array.isArray(claims) ? claims : []).forEach((c: any) => {
          const cn = String(c?.metadata?.name || c?.name || '').trim();
          if (cn) claimMap.set(cn, c);
          const owners = Array.isArray(c?.metadata?.ownerReferences) ? c.metadata.ownerReferences : [];
          owners.forEach((o: any) => {
            const on = String(o?.name || '').trim();
            if (on) claimMap.set(on, c);
          });
        });

        const dbItems = await repo.find({ where: { cloudId: id } });
        const items = dbItems.map((i) => ({
          resourceName: i.resourceName,
          name: i.name,
          description: i.description,
          vendorId:
            i.vendorId ||
            (i.rawData as any)?.status?.vendorID ||
            (i.rawData as any)?.status?.vendorId ||
            (i.rawData as any)?.spec?.vendorID ||
            (i.rawData as any)?.spec?.vendorId,
          productId:
            i.productId ||
            (i.rawData as any)?.status?.productID ||
            (i.rawData as any)?.status?.productId ||
            (i.rawData as any)?.spec?.productID ||
            (i.rawData as any)?.spec?.productId,
          enabled: (() => {
            const raw = i.rawData as any;
            const devName = String(raw?.metadata?.name || i.name || '').trim();
            if (devName && claimMap.has(devName)) return true;
            if (claimMap.size === 0) {
              if (raw?.status?.enabled !== undefined) return !!raw.status.enabled;
              if (raw?.spec?.enabled !== undefined) return !!raw.spec.enabled;
            }
            return false;
          })(),
          claimedBy: (() => {
            const raw = i.rawData as any;
            const devName = String(raw?.metadata?.name || i.name || '').trim();
            const c = devName ? claimMap.get(devName) : null;
            return c?.spec?.userName || c?.userName || '';
          })(),
          nodeName: (i.rawData as any)?.status?.nodeName || (i.rawData as any)?.spec?.nodeName,
          pciAddress:
            (i.rawData as any)?.status?.pciAddress ||
            (i.rawData as any)?.status?.address ||
            (i.rawData as any)?.spec?.pciAddress ||
            (i.rawData as any)?.spec?.address,
          raw: i.rawData,
        }));

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: '查询USB资源失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/usb-devices/:name/claim',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const userName = String(req?.user?.username || req?.user?.fullName || req?.user?.name || req?.body?.userName || 'admin').trim();

        const data = await createHarvesterUsbDeviceClaim(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          name,
          userName,
        );
        try {
          await syncHarvesterUsbResources(cloud, insecure);
        } catch {}
        res.json({ message: '更新成功', data });
      } catch (error: any) {
        res.status(500).json({ message: '更新USB设备失败', error: error.body || error.message });
      }
    },
  );

  router.delete(
    '/:id/resources/harvester/usb-devices/:name/claim',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const data = await deleteHarvesterUsbDeviceClaim(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          name,
        );
        try {
          await syncHarvesterUsbResources(cloud, insecure);
        } catch {}
        res.json({ message: '更新成功', data });
      } catch (error: any) {
        res.status(500).json({ message: '更新USB设备失败', error: error.body || error.message });
      }
    },
  );


  router.get(
    '/:id/resources/harvester/pci-devices',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterPciDeviceInventory);
        const count = await repo.count({ where: { cloudId: id } });

        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterPciDevices(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync PCI devices failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        }

        const items = await repo.find({ where: { cloudId: id } });
        const list = items.map((i) => i.rawData);

        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        res.status(500).json({ message: '查询PCI设备失败', error: error.message });
      }
    },
  );
};
