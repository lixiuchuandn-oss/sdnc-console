/**
 * Harvester Peripherals Handlers
 *
 * 从 harvester.cache.peripherals.routes.ts 中提取的 Peripherals 相关业务逻辑
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { HarvesterGpuInventory } from '../../../../entities/harvester/HarvesterGpuInventory';
import { HarvesterPciDeviceInventory } from '../../../../entities/harvester/HarvesterPciDeviceInventory';
import { HarvesterUsbInventory } from '../../../../entities/harvester/HarvesterUsbInventory';
import {
  syncHarvesterGpus,
  syncHarvesterPciDevices,
  syncHarvesterUsbResources,
} from '../../../../services/clouds/harvester/inventory';
import {
  createHarvesterUsbDeviceClaim,
  deleteHarvesterPciDeviceClaim,
  deleteHarvesterUsbDeviceClaim,
  listHarvesterPciDeviceClaims,
  listHarvesterUsbDeviceClaims,
  listK8sNodesRaw,
  buildHarvesterPciDeviceClaimIndex,
  findHarvesterPciClaimForPciRow,
  harvesterPciDeviceClaimPassthroughEnabled,
} from '../../../../services/clouds/harvester/client';
import { listKubevirtVMsRaw } from '../../../../services/clouds/harvester/vm';
import {
  buildPciDeviceVmUsageMapFromVms,
  collectAllocatedPciDeviceCrNamesFromVms,
} from '../../../../services/clouds/harvester/pciVmAllocation';

/**
 * GET /:id/resources/harvester/gpus - 获取 GPU 资源列表
 */
export async function harvesterGpuListHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id } = req.params;
    const { force } = req.query;
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
    const _list = items.map((i) => i.rawData);

    let claims: any[] = [];
    try {
      claims = await listHarvesterPciDeviceClaims({
        endpoint: cloud.endpoint,
        token: cloud.secretKey || '',
        insecure,
      } as any);
    } catch {}
    const { claimMap, claimByKey } = buildHarvesterPciDeviceClaimIndex(claims);

    let nodes: any[] = [];
    try {
      nodes = await listK8sNodesRaw({
        endpoint: cloud.endpoint,
        token: cloud.secretKey || '',
        insecure,
      } as any);
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
      const rn = String(
        r?.resourceName || raw?.status?.resourceName || raw?.spec?.resourceName || '',
      ).trim();
      const node = String(
        r?.nodeName || r?.node || raw?.status?.nodeName || raw?.spec?.nodeName || '',
      ).trim();
      const claim = findHarvesterPciClaimForPciRow(r, claimMap, claimByKey);
      return { claim, rn, node };
    };

    // [修复] 查询所有VM，检查GPU资源的实际使用情况，并记录挂载到的VM信息
    const vmsUsingGpuResources = new Map<
      string,
      { vmName: string; vmNamespace: string; vmDisplayName: string }
    >();
    try {
      const allVms = await listKubevirtVMsRaw({
        endpoint: cloud.endpoint,
        token: cloud.secretKey || '',
        insecure,
      });
      (Array.isArray(allVms) ? allVms : []).forEach((vm: any) => {
        const domain = vm?.spec?.template?.spec?.domain || vm?.spec?.domain;
        if (!domain) return;

        const vmName = String(vm?.metadata?.name || '').trim();
        const vmNamespace = String(vm?.metadata?.namespace || '').trim();
        const vmDisplayName = vm?.metadata?.annotations?.['tower.io/alias'] || vmName;

        if (!vmName || !vmNamespace) return;

        // 获取VM的节点信息
        const nodeSelector = vm?.spec?.template?.spec?.nodeSelector || {};
        const vmNodeName = String(
          nodeSelector['kubernetes.io/hostname'] || vm?.status?.nodeName || '',
        ).trim();

        // 检查 vGPU (gpus)
        const gpus = Array.isArray(domain?.devices?.gpus) ? domain.devices.gpus : [];
        gpus.forEach((gpu: any) => {
          const rn = String(gpu?.deviceName || '').trim();
          if (rn) {
            const key = vmNodeName ? `${vmNodeName}|${rn}` : rn;
            vmsUsingGpuResources.set(key, { vmName, vmNamespace, vmDisplayName });
            if (vmNodeName) {
              vmsUsingGpuResources.set(rn, { vmName, vmNamespace, vmDisplayName });
            }
          }
        });

        // 检查直通GPU (hostDevices)
        const hostDevices = Array.isArray(domain?.devices?.hostDevices)
          ? domain.devices.hostDevices
          : [];
        hostDevices.forEach((hd: any) => {
          const rn = String(hd?.deviceName || '').trim();
          if (!rn) return;
          const dn = String(hd?.deviceName || '').toLowerCase();
          const n = String(hd?.name || '').toLowerCase();
          const isUsb = n.startsWith('usb') || dn.includes('usb');
          if (!isUsb && (n.startsWith('gpu') || dn.startsWith('nvidia.com/'))) {
            if (vmNodeName) {
              const key = `${vmNodeName}|${rn}`;
              vmsUsingGpuResources.set(key, { vmName, vmNamespace, vmDisplayName });
            } else {
              vmsUsingGpuResources.set(rn, { vmName, vmNamespace, vmDisplayName });
            }
          }
        });
      });
    } catch (e: any) {
      console.warn('[GPU资源查询] 查询VM列表失败，跳过VM使用检查', e.message);
    }

    // [修复] 统计实际被VM使用的GPU数量
    const usedByNodeResource = new Map<string, number>();
    vmsUsingGpuResources.forEach((vmInfo, key) => {
      if (key.includes('|')) {
        usedByNodeResource.set(key, (usedByNodeResource.get(key) || 0) + 1);
      }
    });

    const claimedGpusByNodeResource = new Map<string, Set<string>>();
    (Array.isArray(items) ? items.map((i) => i.rawData) : []).forEach((r: any) => {
      const { claim, rn, node } = findClaimForRow(r);
      if (claim && rn && node) {
        const key = `${node}|${rn}`;
        if (!vmsUsingGpuResources.has(key)) {
          const ownerRefs = Array.isArray(claim?.metadata?.ownerReferences)
            ? claim.metadata.ownerReferences
            : [];
          const hasVmOwner = ownerRefs.some((o: any) => {
            const kind = String(o?.kind || '').toLowerCase();
            return kind === 'virtualmachine' || kind === 'vm';
          });

          if (hasVmOwner) {
            const addr = String(
              r?.pciAddress ||
                r?.address ||
                r?.raw?.status?.pciAddress ||
                r?.raw?.status?.address ||
                r?.raw?.spec?.pciAddress ||
                r?.raw?.spec?.address ||
                '',
            ).trim();
            const devName = String(r?.raw?.metadata?.name || r?.name || '').trim();
            const uniqueId = addr || devName || `${key}-${Math.random()}`;
            if (!claimedGpusByNodeResource.has(key)) {
              claimedGpusByNodeResource.set(key, new Set());
            }
            claimedGpusByNodeResource.get(key)!.add(uniqueId);
          }
        }
      }
    });

    claimedGpusByNodeResource.forEach((gpuSet, key) => {
      const count = gpuSet.size;
      usedByNodeResource.set(key, (usedByNodeResource.get(key) || 0) + count);
    });

    let enriched = (Array.isArray(items) ? items.map((i) => i.rawData) : []).map((r: any) => {
      const { claim, rn, node } = findClaimForRow(r);
      let vmInfo = undefined;
      if (rn && node) {
        const keyWithNode = `${node}|${rn}`;
        vmInfo = vmsUsingGpuResources.get(keyWithNode);
      }
      if (!vmInfo && rn) {
        vmInfo = vmsUsingGpuResources.get(rn);
      }
      const claimedByVm = !!vmInfo;

      let claimedByClaim = false;
      if (claim) {
        const ownerRefs = Array.isArray(claim?.metadata?.ownerReferences)
          ? claim.metadata.ownerReferences
          : [];
        const hasVmOwner = ownerRefs.some((o: any) => {
          const kind = String(o?.kind || '').toLowerCase();
          return kind === 'virtualmachine' || kind === 'vm';
        });
        claimedByClaim = hasVmOwner;
      }
      const claimed = claimedByClaim || claimedByVm;
      const claimedBy = claim?.spec?.userName || claim?.userName || '';
      const claimName = claim?.metadata?.name || claim?.name || '';
      const claimNamespace = claim?.metadata?.namespace || claim?.namespace || '';
      const ownerRefs = Array.isArray(claim?.metadata?.ownerReferences)
        ? claim.metadata.ownerReferences
        : [];
      const bindingTargets = ownerRefs
        .map((o: any) => ({
          apiVersion: o?.apiVersion,
          kind: o?.kind,
          name: o?.name,
          uid: o?.uid,
        }))
        .filter((x: any) => x?.kind && x?.name);
      const bindingTo = vmInfo
        ? `VM:${vmInfo.vmDisplayName} (${vmInfo.vmNamespace}/${vmInfo.vmName})`
        : bindingTargets.length > 0
          ? bindingTargets.map((x: any) => `${x.kind}:${x.name}`).join(', ')
          : claimName
            ? `PCIDeviceClaim:${claimName}`
            : claimedBy
              ? `user:${claimedBy}`
              : '';
      const claimRaw = claim
        ? {
            apiVersion: claim?.apiVersion,
            kind: claim?.kind,
            metadata: claim?.metadata,
            spec: claim?.spec,
            status: claim?.status,
          }
        : null;
      const quota = node && rn ? quotaByNodeResource.get(`${node}|${rn}`) : undefined;
      const allocatable = quota?.allocatable;
      const used = node && rn ? usedByNodeResource.get(`${node}|${rn}`) || 0 : 0;
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
        vmInfo: vmInfo
          ? {
              vmName: vmInfo.vmName,
              vmNamespace: vmInfo.vmNamespace,
              vmDisplayName: vmInfo.vmDisplayName,
            }
          : undefined,
        quota: quota ? { ...quota, used, free } : undefined,
      };
    });

    const normalizeGpuPciClass = (row: any) => {
      const raw = row?.raw || row;
      return String(row?.classId ?? raw?.status?.classId ?? raw?.spec?.classId ?? '')
        .toLowerCase()
        .replace(/^0x/, '');
    };
    enriched = enriched.filter((row: any) => {
      const t = String(row?.type || '').toLowerCase();
      if (t === 'vgpu' || t === 'sriov') return true;
      const cid = normalizeGpuPciClass(row);
      if (!cid.startsWith('03')) return false;
      const claim = findHarvesterPciClaimForPciRow(row, claimMap, claimByKey);
      return harvesterPciDeviceClaimPassthroughEnabled(claim);
    });

    res.json({ message: '查询成功', data: { items: enriched } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询GPU资源失败', error: error.message });
  }
}

/**
 * GET /:id/resources/harvester/gpu-claims - 获取 GPU Claims 列表
 */
export async function harvesterGpuClaimListHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id: _id } = req.params;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const items = await listHarvesterPciDeviceClaims({
      endpoint: cloud.endpoint,
      token: cloud.secretKey || '',
      insecure,
    } as any);
    res.json({ message: '查询成功', data: { items } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询GPU Claim失败', error: error.message });
  }
}

/**
 * DELETE /:id/resources/harvester/gpu-claims/:name - 删除 GPU Claim
 */
export async function harvesterGpuClaimDeleteHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id: _id, name } = req.params;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const data = await deleteHarvesterPciDeviceClaim(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      name,
    );
    res.json({ message: '更新成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '删除GPU Claim失败', error: error.body || error.message });
  }
}

/**
 * GET /:id/resources/harvester/usb-devices - 获取 USB 设备列表
 */
export async function harvesterUsbDeviceListHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id } = req.params;
    const { force } = req.query;
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
      claims = await listHarvesterUsbDeviceClaims({
        endpoint: cloud.endpoint,
        token: cloud.secretKey || '',
        insecure,
      } as any);
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

    // [修复] 查询所有VM，检查USB资源的实际使用情况
    const vmsUsingUsbResources = new Map<
      string,
      { vmName: string; vmNamespace: string; vmDisplayName: string }
    >();
    const usbResourceNameToName = new Map<string, string>();
    const usbNameToResourceName = new Map<string, string>();
    const dbItemsForMapping = await repo.find({ where: { cloudId: id } });
    dbItemsForMapping.forEach((i) => {
      const rn = String(i.resourceName || '').trim();
      const devName = String((i.rawData as any)?.metadata?.name || i.name || '').trim();
      if (rn && devName) {
        usbResourceNameToName.set(rn, devName);
        usbNameToResourceName.set(devName, rn);
      }
    });

    try {
      const allVms = await listKubevirtVMsRaw({
        endpoint: cloud.endpoint,
        token: cloud.secretKey || '',
        insecure,
      });
      (Array.isArray(allVms) ? allVms : []).forEach((vm: any) => {
        const domain = vm?.spec?.template?.spec?.domain || vm?.spec?.domain;
        if (!domain) return;

        const vmName = String(vm?.metadata?.name || '').trim();
        const vmNamespace = String(vm?.metadata?.namespace || '').trim();
        const vmDisplayName = vm?.metadata?.annotations?.['tower.io/alias'] || vmName;

        if (!vmName || !vmNamespace) return;

        // 检查USB设备 (hostDevices中的USB)
        const hostDevices = Array.isArray(domain?.devices?.hostDevices)
          ? domain.devices.hostDevices
          : [];
        hostDevices.forEach((hd: any) => {
          const deviceNameInVm = String(hd?.deviceName || '').trim();
          if (!deviceNameInVm) return;
          const dn = String(hd?.deviceName || '').toLowerCase();
          const n = String(hd?.name || '').toLowerCase();
          if (n.startsWith('usb') || dn.includes('usb')) {
            const vmInfo = { vmName, vmNamespace, vmDisplayName };
            vmsUsingUsbResources.set(deviceNameInVm, vmInfo);
            const withoutPrefix = deviceNameInVm.replace(/^kubevirt\.io\//i, '');
            if (withoutPrefix !== deviceNameInVm) {
              vmsUsingUsbResources.set(withoutPrefix, vmInfo);
            }
            const mappedName = usbResourceNameToName.get(deviceNameInVm);
            if (mappedName && mappedName !== deviceNameInVm) {
              vmsUsingUsbResources.set(mappedName, vmInfo);
            }
            const mappedResourceName = usbNameToResourceName.get(deviceNameInVm);
            if (mappedResourceName && mappedResourceName !== deviceNameInVm) {
              vmsUsingUsbResources.set(mappedResourceName, vmInfo);
            }
            if (withoutPrefix !== deviceNameInVm) {
              const mappedNameForPrefix = usbResourceNameToName.get(withoutPrefix);
              if (mappedNameForPrefix && mappedNameForPrefix !== withoutPrefix) {
                vmsUsingUsbResources.set(mappedNameForPrefix, vmInfo);
              }
              const mappedResourceNameForPrefix = usbNameToResourceName.get(withoutPrefix);
              if (mappedResourceNameForPrefix && mappedResourceNameForPrefix !== withoutPrefix) {
                vmsUsingUsbResources.set(mappedResourceNameForPrefix, vmInfo);
              }
            }
          }
        });
      });
    } catch (e: any) {
      console.warn('[USB资源查询] 查询VM列表失败，跳过VM使用检查', e.message);
    }

    const dbItems = await repo.find({ where: { cloudId: id } });
    const items = dbItems.map((i) => {
      const raw = i.rawData as any;
      const devName = String(raw?.metadata?.name || i.name || '').trim();
      const claim = devName ? claimMap.get(devName) : null;
      const rn = String(i.resourceName || '').trim();
      let vmInfo = rn ? vmsUsingUsbResources.get(rn) : undefined;
      if (!vmInfo && rn) {
        vmInfo = vmsUsingUsbResources.get(`kubevirt.io/${rn}`);
      }
      if (!vmInfo && rn) {
        const withoutPrefix = rn.replace(/^kubevirt\.io\//i, '');
        if (withoutPrefix !== rn) {
          vmInfo = vmsUsingUsbResources.get(withoutPrefix);
        }
      }
      if (!vmInfo && devName) {
        vmInfo = vmsUsingUsbResources.get(devName);
      }
      if (!vmInfo && devName) {
        vmInfo = vmsUsingUsbResources.get(`kubevirt.io/${devName}`);
      }
      const claimedByVm = !!vmInfo;

      let claimedByClaim = false;
      if (claim) {
        const ownerRefs = Array.isArray(claim?.metadata?.ownerReferences)
          ? claim.metadata.ownerReferences
          : [];
        const hasVmOwner = ownerRefs.some((o: any) => {
          const kind = String(o?.kind || '').toLowerCase();
          return kind === 'virtualmachine' || kind === 'vm';
        });
        claimedByClaim = hasVmOwner;
      }
      const claimed = claimedByClaim || claimedByVm;
      const ownerRefs = Array.isArray(claim?.metadata?.ownerReferences)
        ? claim?.metadata?.ownerReferences
        : [];
      const bindingTargets = ownerRefs
        .map((o: any) => ({
          apiVersion: o?.apiVersion,
          kind: o?.kind,
          name: o?.name,
          uid: o?.uid,
        }))
        .filter((x: any) => x?.kind && x?.name);
      const bindingTo = vmInfo
        ? `VM:${vmInfo.vmDisplayName} (${vmInfo.vmNamespace}/${vmInfo.vmName})`
        : bindingTargets.length > 0
          ? bindingTargets.map((x: any) => `${x.kind}:${x.name}`).join(', ')
          : claim?.metadata?.name
            ? `USBDeviceClaim:${claim.metadata.name}`
            : claim?.spec?.userName
              ? `user:${claim.spec.userName}`
              : '';
      return {
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
          if (devName && claimMap.has(devName)) return true;
          if (claimMap.size === 0) {
            if (raw?.status?.enabled !== undefined) return !!raw.status.enabled;
            if (raw?.spec?.enabled !== undefined) return !!raw.spec.enabled;
          }
          return false;
        })(),
        claimed,
        claimedBy: claim?.spec?.userName || claim?.userName || '',
        claimName: claim?.metadata?.name || claim?.name || '',
        claimNamespace: claim?.metadata?.namespace || claim?.namespace || '',
        bindingTargets,
        bindingTo,
        vmInfo: vmInfo
          ? {
              vmName: vmInfo.vmName,
              vmNamespace: vmInfo.vmNamespace,
              vmDisplayName: vmInfo.vmDisplayName,
            }
          : undefined,
        nodeName: (i.rawData as any)?.status?.nodeName || (i.rawData as any)?.spec?.nodeName,
        pciAddress:
          (i.rawData as any)?.status?.pciAddress ||
          (i.rawData as any)?.status?.address ||
          (i.rawData as any)?.spec?.pciAddress ||
          (i.rawData as any)?.spec?.address,
        raw: i.rawData,
      };
    });

    res.json({ message: '查询成功', data: { items } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询USB资源失败', error: error.message });
  }
}

/**
 * POST /:id/resources/harvester/usb-devices/:name/claim - 创建 USB 设备 Claim
 */
export async function harvesterUsbDeviceClaimCreateHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id: _id, name } = req.params;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const reqAny = req as any;
    const userName = String(
      reqAny?.user?.username ||
        reqAny?.user?.fullName ||
        reqAny?.user?.name ||
        reqAny?.body?.userName ||
        'admin',
    ).trim();

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
    if (res.headersSent) return;
    res.status(500).json({ message: '更新USB设备失败', error: error.body || error.message });
  }
}

/**
 * DELETE /:id/resources/harvester/usb-devices/:name/claim - 删除 USB 设备 Claim
 */
export async function harvesterUsbDeviceClaimDeleteHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id: _id, name } = req.params;
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
    if (res.headersSent) return;
    res.status(500).json({ message: '更新USB设备失败', error: error.body || error.message });
  }
}

/**
 * GET /:id/resources/harvester/pci-devices - 获取 PCI 设备列表
 */
export async function harvesterPciDeviceListHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id } = req.params;
    const { force } = req.query;
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

    let claims: any[] = [];
    try {
      claims = await listHarvesterPciDeviceClaims({
        endpoint: cloud.endpoint,
        token: cloud.secretKey || '',
        insecure,
      } as any);
    } catch {
      /* 无 Claim 列表权限或集群无该 API 时仍返回 PCI 列表，由 _tower.passthroughEnabled 为 false 标识 */
    }
    const { claimMap, claimByKey } = buildHarvesterPciDeviceClaimIndex(claims);

    let busyPciCrNames = new Set<string>();
    let vms: any[] = [];
    let pciVmUsage = new Map<
      string,
      { vmName: string; vmNamespace: string; vmDisplayName: string }
    >();
    try {
      vms = await listKubevirtVMsRaw({
        endpoint: cloud.endpoint,
        token: cloud.secretKey || '',
        insecure,
      } as any);
      busyPciCrNames = collectAllocatedPciDeviceCrNamesFromVms(vms);
      pciVmUsage = buildPciDeviceVmUsageMapFromVms(vms);
    } catch (e: any) {
      console.warn(
        '[harvesterPciDeviceListHandler] list VMs for pci allocation scan failed:',
        e?.message || e,
      );
    }

    const list = items.map((i) => {
      const raw = i.rawData;
      const claim = findHarvesterPciClaimForPciRow(raw, claimMap, claimByKey);
      const passthroughEnabled = harvesterPciDeviceClaimPassthroughEnabled(claim);
      const cr = String(raw?.metadata?.name ?? i.name ?? '').trim();
      const pciAllocated = !!(cr && busyPciCrNames.has(cr));
      const vmInfo = cr ? pciVmUsage.get(cr) : undefined;
      /** 仅 guest hostDevices 真实挂载算「绑定」；PCIDeviceClaim（直通已启用）不算绑定到 VM/容器 */
      const claimedByVm = pciAllocated && !!vmInfo;
      const claimed = claimedByVm;
      const claimedBy = claim?.spec?.userName || claim?.userName || '';
      const claimName = claim?.metadata?.name || claim?.name || '';
      const claimNamespace = claim?.metadata?.namespace || claim?.namespace || '';
      const bindingTo = vmInfo
        ? `VM:${vmInfo.vmDisplayName} (${vmInfo.vmNamespace}/${vmInfo.vmName})`
        : '';
      return {
        ...raw,
        claimed,
        claimedBy,
        claimName,
        claimNamespace,
        bindingTo,
        bindingTargets: [],
        vmInfo: vmInfo
          ? {
              vmName: vmInfo.vmName,
              vmNamespace: vmInfo.vmNamespace,
              vmDisplayName: vmInfo.vmDisplayName,
            }
          : undefined,
        _tower: {
          passthroughEnabled,
          pciDeviceClaimName: claim?.metadata?.name || claim?.name || null,
          pciAllocated,
        },
      };
    });

    res.json({ message: '查询成功', data: { items: list } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询PCI设备失败', error: error.message });
  }
}
