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
import { listKubevirtVMsRaw } from '../../../services/clouds/harvester/vm';
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

        // [修复] 查询所有VM，检查GPU资源的实际使用情况，并记录挂载到的VM信息
        // Map<"节点名|资源名称" 或 "资源名称", { vmName: string, vmNamespace: string, vmDisplayName: string }>
        // 使用 "节点名|资源名称" 作为key，避免不同节点同名GPU资源冲突
        let vmsUsingGpuResources = new Map<string, { vmName: string; vmNamespace: string; vmDisplayName: string }>();
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
            
            // 获取VM的节点信息（优先从nodeSelector获取，其次从status获取）
            const nodeSelector = vm?.spec?.template?.spec?.nodeSelector || {};
            const vmNodeName = String(nodeSelector['kubernetes.io/hostname'] || vm?.status?.nodeName || '').trim();
            
            // 检查 vGPU (gpus)
            // vGPU通常不需要节点信息，但如果能获取到节点，也加上以提高准确性
            const gpus = Array.isArray(domain?.devices?.gpus) ? domain.devices.gpus : [];
            gpus.forEach((gpu: any) => {
              const rn = String(gpu?.deviceName || '').trim();
              if (rn) {
                // vGPU可能不需要节点信息，但如果VM有固定节点，也加上节点信息
                const key = vmNodeName ? `${vmNodeName}|${rn}` : rn;
                vmsUsingGpuResources.set(key, { vmName, vmNamespace, vmDisplayName });
                // 同时设置不带节点的key（兼容性，如果无法确定节点时也能匹配）
                if (vmNodeName) {
                  vmsUsingGpuResources.set(rn, { vmName, vmNamespace, vmDisplayName });
                }
              }
            });
            
            // 检查直通GPU (hostDevices)
            // 直通GPU必须知道节点，因为不同节点的同名GPU是不同的物理设备
            const hostDevices = Array.isArray(domain?.devices?.hostDevices) ? domain.devices.hostDevices : [];
            hostDevices.forEach((hd: any) => {
              const rn = String(hd?.deviceName || '').trim();
              if (!rn) return;
              // 判断是否为GPU设备（非USB）
              const dn = String(hd?.deviceName || '').toLowerCase();
              const n = String(hd?.name || '').toLowerCase();
              const isUsb = n.startsWith('usb') || dn.includes('usb');
              if (!isUsb && (n.startsWith('gpu') || dn.startsWith('nvidia.com/'))) {
                // 直通GPU必须使用 "节点名|资源名称" 作为key
                if (vmNodeName) {
                  const key = `${vmNodeName}|${rn}`;
                  vmsUsingGpuResources.set(key, { vmName, vmNamespace, vmDisplayName });
                } else {
                  // 如果无法确定节点，回退到只用资源名称（可能不准确，但总比没有好）
                  vmsUsingGpuResources.set(rn, { vmName, vmNamespace, vmDisplayName });
                }
              }
            });
          });
        } catch (e: any) {
          console.warn('[GPU资源查询] 查询VM列表失败，跳过VM使用检查', e.message);
        }

        // [修复] 统计实际被VM使用的GPU数量（按节点和资源名称）
        // 对于直通GPU，即使没有Claim，只要被VM使用就应该计入used
        const usedByNodeResource = new Map<string, number>();
        // 1. 优先统计VM实际使用的GPU数量（最准确）
        vmsUsingGpuResources.forEach((vmInfo, key) => {
          // key可能是 "节点名|资源名称" 或 "资源名称"
          if (key.includes('|')) {
            // 格式：节点名|资源名称
            usedByNodeResource.set(key, (usedByNodeResource.get(key) || 0) + 1);
          }
        });
        // 2. 统计Claim绑定的GPU数量（只统计已绑定到VM的Claim）
        // [重要] 只有Claim已经绑定到VM（通过ownerReferences）或者VM实际使用了GPU，才算作"已使用"
        // 如果Claim只是"预留"状态但没有绑定到VM，GPU仍然可以分配给VM使用
        const claimedGpusByNodeResource = new Map<string, Set<string>>();
        (Array.isArray(list) ? list : []).forEach((r: any) => {
          const { claim, rn, node } = findClaimForRow(r);
          if (claim && rn && node) {
            const key = `${node}|${rn}`;
            // 如果已经有VM使用统计，不再重复计算Claim（VM使用已经包含了）
            if (!vmsUsingGpuResources.has(key)) {
              // 检查Claim是否已经绑定到VM（通过ownerReferences）
              const ownerRefs = Array.isArray(claim?.metadata?.ownerReferences) ? claim.metadata.ownerReferences : [];
              const hasVmOwner = ownerRefs.some((o: any) => {
                const kind = String(o?.kind || '').toLowerCase();
                return kind === 'virtualmachine' || kind === 'vm';
              });
              
              // 只有Claim已经绑定到VM，或者Claim明确表示GPU已被占用，才计入used
              // 如果Claim只是"预留"状态，不应该计入used（GPU仍然可用）
              if (hasVmOwner) {
                // 使用PCI地址或设备名作为唯一标识，避免同一个GPU被重复计算
                const addr = String(r?.pciAddress || r?.address || r?.raw?.status?.pciAddress || r?.raw?.status?.address || r?.raw?.spec?.pciAddress || r?.raw?.spec?.address || '').trim();
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
        // 将Claim统计的结果合并到usedByNodeResource
        claimedGpusByNodeResource.forEach((gpuSet, key) => {
          const count = gpuSet.size;
          usedByNodeResource.set(key, (usedByNodeResource.get(key) || 0) + count);
        });

        const enriched = (Array.isArray(list) ? list : []).map((r: any) => {
          const { claim, rn, node } = findClaimForRow(r);
          // [修复] 不仅检查Claim，还检查VM的实际使用情况
          // 优先使用 "节点名|资源名称" 作为key查找，如果找不到再尝试只用资源名称
          let vmInfo = undefined;
          if (rn && node) {
            const keyWithNode = `${node}|${rn}`;
            vmInfo = vmsUsingGpuResources.get(keyWithNode);
          }
          if (!vmInfo && rn) {
            vmInfo = vmsUsingGpuResources.get(rn);
          }
          const claimedByVm = !!vmInfo;
          // [修复] claimed字段：只有真正被VM使用的，或者Claim已绑定到VM的，才算作claimed
          // 如果Claim只是"预留"状态（没有ownerReferences），不应该标记为claimed
          let claimedByClaim = false;
          if (claim) {
            const ownerRefs = Array.isArray(claim?.metadata?.ownerReferences) ? claim.metadata.ownerReferences : [];
            const hasVmOwner = ownerRefs.some((o: any) => {
              const kind = String(o?.kind || '').toLowerCase();
              return kind === 'virtualmachine' || kind === 'vm';
            });
            // 只有Claim已绑定到VM，才算作claimed
            claimedByClaim = hasVmOwner;
          }
          const claimed = claimedByClaim || claimedByVm;
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
          // [增强] 优先显示VM信息，如果没有VM则显示Claim信息
          const bindingTo = vmInfo
            ? `VM:${vmInfo.vmDisplayName} (${vmInfo.vmNamespace}/${vmInfo.vmName})`
            : (bindingTargets.length > 0
              ? bindingTargets.map((x: any) => `${x.kind}:${x.name}`).join(', ')
              : (claimName ? `PCIDeviceClaim:${claimName}` : (claimedBy ? `user:${claimedBy}` : '')));
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
            // [新增] 添加VM信息字段，供前端使用
            vmInfo: vmInfo ? {
              vmName: vmInfo.vmName,
              vmNamespace: vmInfo.vmNamespace,
              vmDisplayName: vmInfo.vmDisplayName,
            } : undefined,
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

        // [修复] 查询所有VM，检查USB资源的实际使用情况，并记录挂载到的VM信息
        // Map<"资源名称或设备名称", { vmName: string, vmNamespace: string, vmDisplayName: string }>
        // 注意：VM中存储的deviceName可能是resourceName，也可能是metadata.name（设备名称）
        let vmsUsingUsbResources = new Map<string, { vmName: string; vmNamespace: string; vmDisplayName: string }>();
        // [修复] 建立resourceName到name的映射，以便后续匹配
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
            const hostDevices = Array.isArray(domain?.devices?.hostDevices) ? domain.devices.hostDevices : [];
            hostDevices.forEach((hd: any) => {
              const deviceNameInVm = String(hd?.deviceName || '').trim();
              if (!deviceNameInVm) return;
              // 判断是否为USB设备
              const dn = String(hd?.deviceName || '').toLowerCase();
              const n = String(hd?.name || '').toLowerCase();
              if (n.startsWith('usb') || dn.includes('usb')) {
                // [修复] VM中存储的deviceName可能是resourceName，也可能是metadata.name（设备名称）
                // 同时可能带有 kubevirt.io/ 前缀，需要处理前缀不一致的情况
                const vmInfo = { vmName, vmNamespace, vmDisplayName };
                // 存储原始值
                vmsUsingUsbResources.set(deviceNameInVm, vmInfo);
                // 处理 kubevirt.io/ 前缀：去掉前缀后的值
                const withoutPrefix = deviceNameInVm.replace(/^kubevirt\.io\//i, '');
                if (withoutPrefix !== deviceNameInVm) {
                  vmsUsingUsbResources.set(withoutPrefix, vmInfo);
                }
                // 如果deviceNameInVm是resourceName，也存储对应的name
                const mappedName = usbResourceNameToName.get(deviceNameInVm);
                if (mappedName && mappedName !== deviceNameInVm) {
                  vmsUsingUsbResources.set(mappedName, vmInfo);
                }
                // 如果deviceNameInVm是name，也存储对应的resourceName
                const mappedResourceName = usbNameToResourceName.get(deviceNameInVm);
                if (mappedResourceName && mappedResourceName !== deviceNameInVm) {
                  vmsUsingUsbResources.set(mappedResourceName, vmInfo);
                }
                // 处理带前缀的映射
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
          // [修复] 不仅检查Claim，还检查VM的实际使用情况
          const rn = String(i.resourceName || '').trim();
          // [修复] VM中存储的deviceName可能是resourceName，也可能是metadata.name（设备名称）
          // 同时可能带有 kubevirt.io/ 前缀，需要处理前缀不一致的情况
          let vmInfo = rn ? vmsUsingUsbResources.get(rn) : undefined;
          // 尝试带 kubevirt.io/ 前缀的版本
          if (!vmInfo && rn) {
            vmInfo = vmsUsingUsbResources.get(`kubevirt.io/${rn}`);
          }
          // 尝试去掉前缀的版本
          if (!vmInfo && rn) {
            const withoutPrefix = rn.replace(/^kubevirt\.io\//i, '');
            if (withoutPrefix !== rn) {
              vmInfo = vmsUsingUsbResources.get(withoutPrefix);
            }
          }
          // 尝试使用name（metadata.name）
          if (!vmInfo && devName) {
            vmInfo = vmsUsingUsbResources.get(devName);
          }
          // 尝试带前缀的name
          if (!vmInfo && devName) {
            vmInfo = vmsUsingUsbResources.get(`kubevirt.io/${devName}`);
          }
          const claimedByVm = !!vmInfo;
          // [修复] claimed字段：只有真正被VM使用的，或者Claim已绑定到VM的，才算作claimed
          // 如果Claim只是"预留"状态（没有ownerReferences指向VM），不应该标记为claimed
          let claimedByClaim = false;
          if (claim) {
            const ownerRefs = Array.isArray(claim?.metadata?.ownerReferences) ? claim.metadata.ownerReferences : [];
            const hasVmOwner = ownerRefs.some((o: any) => {
              const kind = String(o?.kind || '').toLowerCase();
              return kind === 'virtualmachine' || kind === 'vm';
            });
            // 只有Claim已绑定到VM，才算作claimed
            claimedByClaim = hasVmOwner;
          }
          const claimed = claimedByClaim || claimedByVm;
          const ownerRefs = Array.isArray(claim?.metadata?.ownerReferences) ? claim?.metadata?.ownerReferences : [];
          const bindingTargets = ownerRefs
            .map((o: any) => ({
              apiVersion: o?.apiVersion,
              kind: o?.kind,
              name: o?.name,
              uid: o?.uid,
            }))
            .filter((x: any) => x?.kind && x?.name);
          // [增强] 优先显示VM信息，如果没有VM则显示Claim信息
          const bindingTo = vmInfo
            ? `VM:${vmInfo.vmDisplayName} (${vmInfo.vmNamespace}/${vmInfo.vmName})`
            : (bindingTargets.length > 0
              ? bindingTargets.map((x: any) => `${x.kind}:${x.name}`).join(', ')
              : (claim?.metadata?.name ? `USBDeviceClaim:${claim.metadata.name}` : (claim?.spec?.userName ? `user:${claim.spec.userName}` : '')));
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
            // [新增] 添加VM信息字段，供前端使用
            vmInfo: vmInfo ? {
              vmName: vmInfo.vmName,
              vmNamespace: vmInfo.vmNamespace,
              vmDisplayName: vmInfo.vmDisplayName,
            } : undefined,
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
