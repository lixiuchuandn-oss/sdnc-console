import { Router, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Cloud } from '../entities/Cloud';
import { HarvesterNamespace } from '../entities/harvester/HarvesterNamespace';
import { HarvesterNamespaceInventory } from '../entities/harvester/HarvesterNamespaceInventory';
import {
  listHarvesterVMsStandard,
  listHarvesterAvailableVolumesStandard,
  listHarvesterNodesStandard,
  listHarvesterSystemPodsStandard,
  listHarvesterGpuResources,
  listHarvesterUsbResources,
  listHarvesterStorageClassesStandard,
  harvesterHealthCheck,
  getHarvesterCapabilities,
  getHarvesterVM,
  createHarvesterVM,
  listKubeOvnVpcs,
  listKubeOvnSubnets,
  buildHarvesterVMManifest,
  harvesterStartVM,
  harvesterStopVM,
  harvesterRebootVM,
  harvesterSoftRebootVM,
  harvesterPauseVM,
  harvesterUnpauseVM,
  harvesterDeleteVM,
  harvesterAddVolumeToVM,
  harvesterRemoveVolumeFromVM,
  harvesterAddVolumeToVMDirect,
  deleteHarvesterLonghornVolume,
  createHarvesterPVCVolume,
  exportImageFromPVC,
  createVolumeSnapshot,
  updatePVCSpec,
  clonePVC,
  updateHarvesterVMSpec,
  getHarvesterVmVncUrl,
  listKubevirtVMsRaw,
  listKubevirtVMIsRaw,
} from '../services/clouds/harvester/client';
import {
  syncHarvesterVolumes,
  syncHarvesterNads,
  syncKubeOvnVpcs,
  syncKubeOvnSubnets,
  syncHarvesterImages,
  syncKubevirtVms,
  syncKubevirtVmis,
  syncHarvesterGpus,
  syncHarvesterNamespaces,
} from '../services/clouds/harvester/syncInventory';
import { KubevirtVolumeInventory } from '../entities/kubevirt/KubevirtVolumeInventory';
import { KubevirtNadInventory } from '../entities/kubevirt/KubevirtNadInventory';
import { KubeOvnVpcInventory } from '../entities/kubeovn/KubeOvnVpcInventory';
import { KubeOvnSubnetInventory } from '../entities/kubeovn/KubeOvnSubnetInventory';
import { HarvesterImageInventory } from '../entities/harvester/HarvesterImageInventory';
import { HarvesterGpuInventory } from '../entities/harvester/HarvesterGpuInventory';
import { KubevirtVmInventory } from '../entities/kubevirt/KubevirtVmInventory';
import { KubevirtVmiInventory } from '../entities/kubevirt/KubevirtVmiInventory';
import { requestJson, getJsonOnce } from '../services/clouds/harvester/utils';

/**
 * ==================================================================================
 * Harvester Cloud Resource Routes
 * ==================================================================================
 * 该文件集中管理 Harvester 云平台的所有资源路由，包括：
 * - 基础网络资源：VPC (Kube-OVN), Subnet, Namespace, NAD (Network Attachment Definitions)
 * - 计算资源：ECS (VM/VMI), Node, System Pods, GPU/USB
 * - 存储资源：Volumes (PVC), Images, StorageClasses, Snapshots
 * 
 * 核心设计模式 (Design Patterns)：
 * 
 * 1. **Inventory Cache First (优先读库策略)**:
 *    绝大多数列表查询 (GET) 优先从本地 Inventory 表读取数据，以提高响应速度并减少对 Harvester API 的压力。
 *    涉及实体：
 *    - KubevirtVmInventory / KubevirtVmiInventory (ECS)
 *    - KubevirtVolumeInventory (Volumes)
 *    - HarvesterImageInventory (Images)
 *    - KubeOvnVpcInventory (VPCs)
 *    - KubeOvnSubnetInventory (Subnets)
 *    - KubevirtNadInventory (NADs)
 * 
 * 2. **Sync Fallback Pattern (同步降级策略)**:
 *    当本地库为空 (count === 0) 或用户强制刷新 (force=true) 时，尝试调用 Sync 函数同步最新数据。
 *    - 如果 Sync 成功：读取最新的 DB 数据返回。
 *    - 如果 Sync 失败：
 *      - 若 DB 中有旧数据，则降级返回旧数据 (Stale Data)，并记录警告日志 (console.warn)。
 *      - 若 DB 中无数据，则抛出异常，告知用户获取失败。
 *    这确保了在 Harvester API 短暂不可用或网络波动时，用户仍能看到历史缓存数据。
 * 
 * 3. **Frontend Response Formatting (前端响应适配)**:
 *    为了适配当前前端组件的数据结构要求，部分接口 (如 /ecs, /volumes) 会将 Inventory 中的 Raw Data (K8s Manifest)
 *    转换为前端期望的扁平化结构。例如：
 *    - ECS: 提取 name, status, ip (合并 VM 和 VMI 状态), nodeName 等。
 *    - Volume: 提取 attachedTo (解析 virt-launcher pod 名称), capacity, state 等。
 *    这确保了后端架构升级 (引入 Inventory) 对前端是透明的。
 * 
 * 4. **Direct API for Actions (操作类直连)**:
 *    对于创建、删除、更新、启停等操作 (POST/DELETE/PUT/PATCH)，直接调用 Harvester API，
 *    不经过本地 Inventory 缓存，确保操作的实时性和准确性。
 *    部分实时性要求极高的查询 (如 Available Volumes) 也是直连。
 * ==================================================================================
 */

/**
 * 辅助函数：获取 Cloud 实体
 * 根据 ID 查询 Cloud 配置，若不存在则直接响应 404。
 */
const fetchCloudOr404 = async (id: string, res: Response) => {
  const repo = AppDataSource.getRepository(Cloud);
  const cloud = await repo.findOne({ where: { id } });
  if (!cloud) {
    res.status(404).json({ message: '云资源不存在' });
    return null;
  }
  return cloud;
};

/**
 * 辅助函数：校验 Cloud Provider
 * 确保当前操作的 Cloud 资源类型为 Harvester 或其兼容变种 (Cloudmap)。
 */
const ensureProvider = (cloud: any, provider: string, res: Response, msg: string, next?: any) => {
  const actual = String(cloud?.config?.provider || '')
    .toLowerCase()
    .trim();
  // Allow Harvester and Cloudmap Private/Edge (but not Security/CSM)
  const isHarvesterLike =
    actual === 'harvester' ||
    actual === 'cloudmap' ||
    actual === 'cloudmap.private' ||
    actual === 'cloudmap.edge';

  if (!isHarvesterLike) {
    if (next) {
      next();
      return false;
    }
    res.status(400).json({ message: msg });
    return false;
  }
  return true;
};

export const registerHarvesterRoutes = (router: Router, checkAdminPermission: any) => {
  // ==================================================================================
  // VPCs (Kube-OVN)
  // ==================================================================================
  /**
   * [GET] /:id/resources/vpcs
   * 获取 Kube-OVN VPC 列表
   * 
   * 实体: KubeOvnVpcInventory
   * 策略: Inventory Cache First + Sync Fallback
   * 描述: 返回 Harvester 集群中的 VPC 资源。
   */
  router.get(
    '/:id/resources/vpcs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const repo = AppDataSource.getRepository(KubeOvnVpcInventory);
        const count = await repo.count({ where: { cloudId: id } });
        
        // Sync fallback logic
        if (count === 0 || String(force) === 'true') {
          try {
            await syncKubeOvnVpcs(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync VPCs failed, falling back to empty/stale', e);
            // 如果库里本来就没数据，且同步失败，则必须抛出异常
            if (count === 0) throw e;
          }
        }
        
        const items = await repo.find({ where: { cloudId: id } });
        const list = items.map(i => i.rawData);
        
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询VPC失败', error: error.message });
      }
    },
  );

  // ==================================================================================
  // Subnets (Kube-OVN)
  // ==================================================================================
  /**
   * [GET] /:id/resources/subnets
   * 获取 Kube-OVN Subnet 列表
   * 
   * 实体: KubeOvnSubnetInventory
   * 策略: Inventory Cache First + Sync Fallback
   * 描述: 返回 Harvester 集群中的 Subnet 资源。
   * 过滤: 支持通过 vpcId 参数过滤特定 VPC 下的子网。
   */
  router.get(
    '/:id/resources/subnets',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { vpcId, force } = req.query as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const repo = AppDataSource.getRepository(KubeOvnSubnetInventory);
        const count = await repo.count({ where: { cloudId: id } });
        
        // Sync fallback logic
        if (count === 0 || String(force) === 'true') {
          try {
            await syncKubeOvnSubnets(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync Subnets failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        }
        
        const dbItems = await repo.find({ where: { cloudId: id } });
        let list = dbItems.map(i => i.rawData);
        
        let items = list;
        if (vpcId) {
          items = list.filter((s: any) => String(s?.vpc || '').trim() === String(vpcId).trim());
        }
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询子网失败', error: error.message });
      }
    },
  );

  // ==================================================================================
  // ECS (VirtualMachines)
  // ==================================================================================
  /**
   * [GET] /:id/resources/ecs
   * 获取虚拟机列表 (ECS)
   * 
   * 策略: Direct API (直连模式)
   * 描述: 直接调用 Harvester API 获取 VM 和 VMI 列表，并在内存中聚合状态，确保实时性。
   * (之前的 Inventory Cache 模式已被 Direct 模式取代，以满足实时管理需求)
   */
  router.get(
    '/:id/resources/ecs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        // Direct API Call: Fetch VMs and VMIs in parallel
        const [vmsRaw, vmisRaw] = await Promise.all([
          listKubevirtVMsRaw({
            endpoint: cloud.endpoint,
            token: cloud.secretKey,
            insecure,
          } as any),
          listKubevirtVMIsRaw({
            endpoint: cloud.endpoint,
            token: cloud.secretKey,
            insecure,
          } as any),
        ]);

        // Build VMI map for fast lookup by Namespace/Name
        const vmiMap = new Map<string, any>();
        vmisRaw.forEach((v: any) => {
          if (v?.metadata?.name && v?.metadata?.namespace) {
            vmiMap.set(`${v.metadata.namespace}/${v.metadata.name}`, v);
          }
        });

        // Format Response for Frontend
        // 将 K8s Manifest 转换为前端列表组件所需的扁平对象
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }

        const data = vmsRaw.map((vm: any) => {
          const name = vm?.metadata?.name || '';
          const namespace = vm?.metadata?.namespace || '';
          const uid = vm?.metadata?.uid || '';
          const vmi = vmiMap.get(`${namespace}/${name}`);

          const viewUrl = `${origin}/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachines/${name}`;

          // Status resolution
          const status = vm?.status?.printableStatus || vm?.status?.phase || 'Unknown';
          
          // IP/Mac resolution (Merge VM Status & VMI Status)
          const ips: string[] = [];
          const macs: string[] = [];
          const addIp = (s: any) => {
            const v = String(s || '').trim();
            if (v && !ips.includes(v)) ips.push(v);
          };
          
          // From VM status
          if (vm?.status?.vmIp) addIp(vm.status.vmIp);
          if (Array.isArray(vm?.status?.interfaces)) {
            vm.status.interfaces.forEach((i: any) => {
              addIp(i.ipAddress || i.ip);
              if (i.mac || i.macAddress) macs.push(i.mac || i.macAddress);
            });
          }
          // From VMI status (More real-time)
          if (vmi) {
            if (Array.isArray(vmi.status?.interfaces)) {
              vmi.status.interfaces.forEach((i: any) => {
                if (i.ipAddress || i.ip) addIp(i.ipAddress || i.ip);
                if (i.mac || i.macAddress) macs.push(i.mac || i.macAddress);
              });
            }
          }

          // Node
          const nodeName = vm?.status?.nodeName || vmi?.status?.nodeName || '';

          // Networks (Parse Multus annotations)
          const networksArr: any[] = Array.isArray(vm?.spec?.template?.spec?.networks)
            ? vm?.spec?.template?.spec?.networks
            : [];
          const networks: string[] = networksArr
            .map((n: any) => n?.multus?.networkName || (n?.name ? String(n.name) : 'pod'))
            .filter((s: string) => !!s);

          // CPU/Memory
          const cpu =
            vm?.spec?.template?.spec?.domain?.cpu?.cores ||
            vm?.spec?.template?.spec?.domain?.cpu?.sockets ||
            undefined;
          const memory =
            vm?.spec?.template?.spec?.domain?.resources?.requests?.memory ||
            vm?.spec?.template?.spec?.domain?.memory?.guest ||
            undefined;

          return {
            ...vm,
            links: { view: viewUrl },
            id: uid, // Use K8s UID as ID
            name,
            namespace,
            status,
            // 兼容旧字段
            privateIps: ips,
            extra: {
                namespace,
                nodeName,
                macAddresses: Array.from(new Set(macs)),
                networks,
                vpcName: networks.find(n => n !== 'pod' && n !== 'default'), // simple guess
            },
            cpu,
            memoryGb: memory, // This might need parsing if it's "2Gi" etc. Frontend often handles strings or needs number.
                              // Assuming frontend handles "2Gi" or similar strings for now, or I'll fix later.
            // Include raw VMI if needed
            vmiRaw: vmi,
          };
        });

        const capabilities = {
          isHarvester: true,
          supportsInstanceType: false,
          supportsZone: false,
          supportsVpc: false,
          supportsNetworkFusion: true,
          supportsMultus: true,
        };
        res.json({ message: '查询成功', data, capabilities });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询ECS失败', error: error.message });
      }
    },
  );

  /**
   * [GET] /:id/resources/harvester/vms/:namespace/:name
   * 获取单个虚拟机详情 (Raw JSON)
   * 
   * 策略: Direct API (直连模式)
   * 描述: 直接调用 Harvester API 获取指定 VM 的完整 JSON，用于元数据查看等功能。
   * 支持多路径自动发现 (Candidates Discovery)。
   */
  router.get(
    '/:id/resources/harvester/vms/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, namespace, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const vm = await getHarvesterVM(
          {
            endpoint: cloud.endpoint,
            token: cloud.secretKey,
            insecure,
          } as any,
          namespace,
          name
        );

        res.json({ message: '查询成功', data: vm });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询VM详情失败', error: error.message });
      }
    },
  );

  /**
   * [GET] /:id/resources/ecs/stream
   * ECS Stream API (SSE)
   * 实时推送 VM 状态变更
   * 注意：目前实现仍基于 API 轮询 (Polling)，未来可优化为 Watch 机制。
   */
  router.get(
    '/:id/resources/ecs/stream',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        {
          const pv = String((cloud as any)?.config?.provider || '')
            .toLowerCase()
            .trim();
          if (!(pv === 'harvester' || pv === 'cloudmap' || pv.startsWith('cloudmap')))
            return next();
        }
        const insecure = !!(cloud.config as any)?.ignoreTls;
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();
        let closed = false;
        let prev = new Map<string, any>();
        req.on('close', () => {
          closed = true;
        });
        const send = (event: string, payload: any) => {
          try {
            res.write(`event: ${event}\n`);
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
          } catch {}
        };
        const tick = async () => {
          if (closed) return;
          try {
            const data = await listHarvesterVMsStandard({
              endpoint: cloud.endpoint,
              token: cloud.secretKey || '',
              insecure,
            } as any);
            const items: any[] = Array.isArray(data) ? data : [];
            const cur = new Map<string, any>();
            // prev is the state from LAST tick. We must NOT overwrite it with empty cur before check.
            
            let changeDetected = false;
            const newPrev = new Map<string, any>();

            for (const r of items) {
                const iid = String(r?.InstanceId || r?.id || '');
                if (!iid) continue;
                newPrev.set(iid, r);
                
                const prevItem = prev.get(iid);
                if (!prevItem) {
                    send('vm_created', { item: r });
                    changeDetected = true;
                } else {
                    const prevStatus = String(prevItem?.Status || prevItem?.status || '');
                    const curStatus = String(r?.Status || r?.status || '');
                    if (prevStatus !== curStatus) {
                        send('vm_status', { iid, status: curStatus });
                        changeDetected = true;
                    }
                }
            }
            for (const [iid] of prev.entries()) {
                if (!newPrev.has(iid)) {
                    send('vm_deleted', { iid });
                    changeDetected = true;
                }
            }
            
            // If it's the very first tick (prev is empty), we should send data if we have items.
            if (prev.size === 0 && items.length > 0) {
                changeDetected = true;
            }

            prev = newPrev;
            
            if (changeDetected) {
                 send('vms', { items });
            }
          } catch (e: any) {
            send('error', { message: e?.message || '拉取失败' });
          } finally {
            if (!closed) setTimeout(tick, 3000);
          }
        };
        send('hello', { ok: true });
        tick();
      } catch (error: any) {
        try {
          res.status(500).end();
        } catch {}
      }
    },
  );

  // ==================================================================================
  // VM Operations (Start/Stop/Reboot/Delete)
  // 策略: Direct API Call (直接调用，不走缓存)
  // ==================================================================================
  /**
   * [POST] 启动虚拟机
   */
  router.post(
    '/:id/resources/ecs/:instanceId/start',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        {
          const pv = String((cloud as any)?.config?.provider || '')
            .toLowerCase()
            .trim();
          if (!(pv === 'harvester' || pv === 'cloudmap' || pv.startsWith('cloudmap')))
            return next();
        }
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await harvesterStartVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          instanceId,
        );
        res.json({ message: '启动成功', data });
      } catch (error: any) {
        res.status(500).json({ message: error.message || '启动实例失败', error: error.body || error.message });
      }
    },
  );

  /**
   * [POST] 停止虚拟机
   * @param force 是否强制停止
   */
  router.post(
    '/:id/resources/ecs/:instanceId/stop',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { force } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        {
          const pv = String((cloud as any)?.config?.provider || '')
            .toLowerCase()
            .trim();
          if (!(pv === 'harvester' || pv === 'cloudmap' || pv.startsWith('cloudmap')))
            return next();
        }
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await harvesterStopVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          instanceId,
          !!force,
        );
        res.json({ message: '停止成功', data });
      } catch (error: any) {
        res.status(500).json({ message: error.message || '停止实例失败', error: error.body || error.message });
      }
    },
  );

  /**
   * [POST] 重启虚拟机
   */
  router.post(
    '/:id/resources/ecs/:instanceId/reboot',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { force } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        {
          const pv = String((cloud as any)?.config?.provider || '')
            .toLowerCase()
            .trim();
          if (!(pv === 'harvester' || pv === 'cloudmap' || pv.startsWith('cloudmap')))
            return next();
        }
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await harvesterRebootVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          instanceId,
          !!force,
        );
        res.json({ message: '重启成功', data });
      } catch (error: any) {
        res.status(500).json({ message: error.message || '重启实例失败', error: error.body || error.message });
      }
    },
  );

  /**
   * [POST] 软重启虚拟机
   */
  router.post(
    '/:id/resources/ecs/:instanceId/softreboot',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        {
          const pv = String((cloud as any)?.config?.provider || '')
            .toLowerCase()
            .trim();
          if (!(pv === 'harvester' || pv === 'cloudmap' || pv.startsWith('cloudmap')))
            return next();
        }
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await harvesterSoftRebootVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          instanceId,
        );
        res.json({ message: '软重启成功', data });
      } catch (error: any) {
        res.status(500).json({ message: error.message || '软重启实例失败', error: error.body || error.message });
      }
    },
  );

  /**
   * [POST] 暂停虚拟机
   */
  router.post(
    '/:id/resources/ecs/:instanceId/pause',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        {
          const pv = String((cloud as any)?.config?.provider || '')
            .toLowerCase()
            .trim();
          if (!(pv === 'harvester' || pv === 'cloudmap' || pv.startsWith('cloudmap')))
            return next();
        }
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await harvesterPauseVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          instanceId,
        );
        res.json({ message: '暂停成功', data });
      } catch (error: any) {
        res.status(500).json({ message: error.message || '暂停实例失败', error: error.body || error.message });
      }
    },
  );

  /**
   * [POST] 恢复虚拟机
   */
  router.post(
    '/:id/resources/ecs/:instanceId/unpause',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        {
          const pv = String((cloud as any)?.config?.provider || '')
            .toLowerCase()
            .trim();
          if (!(pv === 'harvester' || pv === 'cloudmap' || pv.startsWith('cloudmap')))
            return next();
        }
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await harvesterUnpauseVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          instanceId,
        );
        res.json({ message: '恢复成功', data });
      } catch (error: any) {
        res.status(500).json({ message: error.message || '恢复实例失败', error: error.body || error.message });
      }
    },
  );

  /**
   * [DELETE] 删除虚拟机
   * @param deleteImage 是否同时删除关联的根镜像 (可选)
   */
  router.delete(
    '/:id/resources/ecs/:instanceId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { deleteImage, deleteVolumes } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        {
          const pv = String((cloud as any)?.config?.provider || '')
            .toLowerCase()
            .trim();
          if (!(pv === 'harvester' || pv === 'cloudmap' || pv.startsWith('cloudmap')))
            return next();
        }
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await harvesterDeleteVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          instanceId,
          String(deleteImage) === 'true',
          String(deleteVolumes) === 'true',
        );
        res.json({ message: '删除成功', data });
      } catch (error: any) {
        res.status(500).json({ message: error.message || '删除实例失败', error: error.body || error.message });
      }
    },
  );

  // ==================================================================================
  // Namespaces (Specific Name)
  // 获取特定命名空间详情 (尝试多个 API 路径兼容不同版本)
  // ==================================================================================
  /**
   * [GET] /:id/resources/harvester/namespaces/:name
   * 获取特定命名空间详情
   * 
   * 策略: Direct API Call (多路径探测)
   * 描述: 尝试多个 K8s API 路径以兼容不同 Harvester/K8s 版本。
   */
  router.get(
    '/:id/resources/harvester/namespaces/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, name } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterNamespaceInventory);
        const item = await repo.findOne({ where: { cloudId: id, name } });
        
        if (!item || String(force) === 'true') {
          try {
            await syncHarvesterNamespaces(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync Namespaces failed, falling back to empty/stale', e);
            if (!item) throw e;
          }
        }
        
        const finalItem = await repo.findOne({ where: { cloudId: id, name } });
        if (!finalItem) {
          return res.status(404).json({ message: '命名空间不存在' });
        }
        
        res.json({ message: '查询成功', data: finalItem.rawData });
      } catch (error: any) {
        res.status(500).json({ message: '查询命名空间详情失败', error: error.message });
      }
    },
  );

  /**
   * [PATCH] 修改命名空间 (Label/Annotation)
   * 
   * 策略: Direct API Call (Merge Patch)
   * 描述: 使用 application/merge-patch+json 内容类型更新 K8s 资源。
   */
  router.patch(
    '/:id/resources/harvester/namespaces/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, name } = req.params;
        const { labels, annotations } = req.body;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源修改')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }
        const candidates = [
          `${origin}/api/v1/namespaces/${name}`,
          `${origin}/v1/core.v1.namespaces/${name}`,
        ];
        const body = {
          metadata: {
            labels: labels && typeof labels === 'object' ? labels : undefined,
            annotations: annotations && typeof annotations === 'object' ? annotations : undefined,
          },
        };
        let json: any = null;
        let lastErr: any = null;
        for (const url of candidates) {
          try {
            json = await requestJson('PATCH', url, cloud.secretKey || '', insecure, body, {
              'Content-Type': 'application/merge-patch+json',
            });
            if (json) break;
          } catch (e: any) {
            lastErr = e;
          }
        }
        if (!json && lastErr) {
          return res.status(500).json({ message: '修改命名空间失败', error: lastErr?.message });
        }
        res.json({ message: '修改成功', data: json });
      } catch (error: any) {
        res.status(500).json({ message: '修改命名空间失败', error: error.message });
      }
    },
  );

  // ==================================================================================
  // NADs (Network Attachment Definitions)
  // ==================================================================================
  /**
   * [GET] /:id/resources/harvester/nads
   * 获取网络附件定义列表
   * 
   * 实体: KubevirtNadInventory
   * 策略: Inventory Cache First + Sync Fallback
   * 描述: 返回 Harvester 集群中的 NAD 资源，用于虚拟机多网卡配置。
   */
  router.get(
    '/:id/resources/harvester/nads',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const repo = AppDataSource.getRepository(KubevirtNadInventory);
        const count = await repo.count({ where: { cloudId: id } });
        
        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterNads(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync NADs failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        }
        
        const items = await repo.find({ where: { cloudId: id } });
        const list = items.map(i => i.rawData);
        
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        res.status(500).json({ message: '查询网络附件定义失败', error: error.message });
      }
    },
  );

  // ==================================================================================
  // Namespaces (List/Create/Delete)
  // ==================================================================================
  /**
   * [GET] /:id/resources/harvester/namespaces
   * 获取命名空间列表
   * 
   * 策略: Direct API Call + DB Enrichment
   * 注意：此接口目前仍使用直接 API 调用 (candidates loop)，未接入 Inventory。
   * 它会额外查询 HarvesterNamespace 本地表，标记哪些是用户创建的 (type='user')。
   */
  router.get(
    '/:id/resources/harvester/namespaces',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }
        const candidates = [
          `${origin}/api/v1/namespaces`,
          `${origin}/v1/core.v1.namespaces`,
          `${origin}/v1/harvester/core.v1.namespaces`,
          `${origin}/k8s/clusters/local/api/v1/namespaces`,
        ];
        let json: any = null;
        let lastErr: any = null;
        for (const url of candidates) {
          try {
            json = await getJsonOnce(url, cloud.secretKey || '', insecure);
            if (json) break;
          } catch (e: any) {
            lastErr = e;
          }
        }
        if (!json && lastErr) throw lastErr;
        let items: any[] = Array.isArray(json?.data)
          ? json?.data
          : Array.isArray(json?.items)
            ? json?.items
            : [];
        
        // Enrich with local DB info
        try {
          const repo = AppDataSource.getRepository(HarvesterNamespace);
          const dbItems = await repo.find({ where: { cloudId: id } });
          const userNamespaces = new Set(dbItems.map(i => i.name));
          
          items = items.map(item => {
             const name = item?.metadata?.name || item?.name;
             const isUser = userNamespaces.has(name);
             return { 
                ...item, 
                type: isUser ? 'user' : 'system',
                links: {
                    view: `${origin}/api/v1/namespaces/${name}`
                }
             };
          });
        } catch (e) {
           console.warn('Failed to fetch HarvesterNamespace records', e);
        }

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询命名空间失败', error: error.message });
      }
    },
  );

  /**
   * [POST] 创建命名空间
   * 
   * 策略: Direct API Call
   */
  router.post(
    '/:id/resources/harvester/namespaces',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { name, labels, annotations } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源创建')) return;
        const nm = String(name || '').trim();
        const ok = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(nm) && nm.length > 0 && nm.length <= 63;
        if (!ok) return res.status(400).json({ message: '非法的命名空间名称（DNS-1123）' });
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }
        const candidates = [
          `${origin}/api/v1/namespaces`,
          `${origin}/v1/core.v1.namespaces`,
          `${origin}/v1/harvester/core.v1.namespaces`,
          `${origin}/k8s/clusters/local/api/v1/namespaces`,
        ];
        const body = {
          apiVersion: 'v1',
          kind: 'Namespace',
          metadata: {
            name: nm,
            labels: labels && typeof labels === 'object' ? labels : undefined,
            annotations: annotations && typeof annotations === 'object' ? annotations : undefined,
          },
        };
        let json: any = null;
        let lastErr: any = null;
        for (const url of candidates) {
          try {
            json = await requestJson('POST', url, cloud.secretKey || '', insecure, body);
            if (json) break;
          } catch (e: any) {
            lastErr = e;
          }
        }
        if (!json && lastErr) {
          const status = Number(lastErr?.status || 0);
          const lower = String(lastErr?.message || '').toLowerCase();
          let msg = '创建命名空间失败';
          if (status === 403 || lower.includes('forbidden')) msg = '创建失败：权限不足（403）';
          else if (status === 409 || lower.includes('already exists')) msg = '创建失败：命名空间已存在（409）';
          else if (status === 422 || lower.includes('invalid')) msg = '创建失败：参数非法（422）';
          return res.status(500).json({ message: msg, error: lastErr?.message });
        }
        res.json({ message: '创建成功', data: json });
      } catch (error: any) {
        res.status(500).json({ message: '创建命名空间失败', error: error.message });
      }
    },
  );

  /**
   * [DELETE] 删除命名空间
   * 
   * 策略: Direct API Call
   */
  router.delete(
    '/:id/resources/harvester/namespaces/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源删除')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }
        const candidates = [
          `${origin}/api/v1/namespaces/${name}`,
          `${origin}/v1/core.v1.namespaces/${name}`,
          `${origin}/v1/harvester/core.v1.namespaces/${name}`,
          `${origin}/k8s/clusters/local/api/v1/namespaces/${name}`,
        ];
        let json: any = null;
        let lastErr: any = null;
        let success = false;
        for (const url of candidates) {
          try {
            json = await requestJson('DELETE', url, cloud.secretKey || '', insecure);
            success = true;
            break; 
          } catch (e: any) {
            lastErr = e;
            // 404 means already deleted
            if (Number(e?.status) === 404) {
                success = true;
                break;
            }
          }
        }
        if (!success && lastErr) {
           return res.status(500).json({ message: '删除命名空间失败', error: lastErr?.message });
        }
        res.json({ message: '删除成功', data: json });
      } catch (error: any) {
        res.status(500).json({ message: '删除命名空间失败', error: error.message });
      }
    },
  );

  // ==================================================================================
  // Volumes (List)
  // ==================================================================================
  /**
   * [GET] /:id/resources/harvester/volumes
   * 获取卷列表 (Volumes/PVCs)
   * 
   * 实体: KubevirtVolumeInventory
   * 策略: Inventory Cache First + Sync Fallback
   * 描述: 返回 Harvester 集群中的 PersistentVolumeClaims。
   * 数据处理: Frontend Response Formatting (name, size, state, attachedTo...)
   */
  router.get(
    '/:id/resources/harvester/volumes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(KubevirtVolumeInventory);
        const count = await repo.count({ where: { cloudId: id } });

        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterVolumes(cloud, insecure);
          } catch (e: any) {
             console.warn('Sync Volumes failed, falling back to empty/stale', e);
             if (count === 0) throw e;
          }
        }

        const items = await repo.find({ where: { cloudId: id } });
        
        // Frontend Response Formatting
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }

        const basic = items.map((item: any) => {
          const v = item.rawData || {};
          const name = v?.metadata?.name || v?.name || item.name || '';
          const size = v?.spec?.size || v?.size || item.capacity || 0;
          const state = v?.status?.state || v?.state || item.phase || 'Unknown';
          const k8s = v?.status?.kubernetesStatus || {};
          const namespace = k8s?.namespace || v?.metadata?.namespace || item.namespace || '';
          const pvcName = k8s?.pvcName || '';
          
          const viewUrl = `${origin}/api/v1/namespaces/${namespace}/persistentvolumeclaims/${name}`;

          const workloads =
            k8s?.workloadsStatus || v?.status?.workloadsStatus || v?.status?.workloadStatus || [];
          const rawNames: string[] = Array.isArray(workloads)
            ? workloads.map((w: any) => String(w?.workloadName || w?.podName || '')).filter(Boolean)
            : [];
          const attachedTo: string[] = Array.from(
            new Set(
              rawNames
                .map((n: string) => {
                  let s = n.trim();
                  if (/^virt-launcher-/.test(s)) {
                    s = s.replace(/^virt-launcher-/, '');
                  }
                  return s;
                })
                .filter(Boolean)
            )
          );
          return {
            ...v, // Spread raw K8s object first
            links: { view: viewUrl },
            name,
            size,
            state,
            namespace,
            pvcName,
            attachedTo,
            raw: v,
          };
        });

        res.json({ message: '查询成功', data: { items: basic } });
      } catch (error: any) {
        res.status(500).json({ message: '查询卷失败', error: error.message });
      }
    },
  );

  // ==================================================================================
  // Available Volumes (For Attachment)
  // 策略: Direct API (需要实时准确性)
  // ==================================================================================
  /**
   * [GET] /:id/resources/harvester/available-volumes
   * 获取可挂载的卷列表
   * 
   * 策略: Direct API Call
   * 描述: 查询当前处于 Unbound 或 Detached 状态，可供虚拟机挂载的卷。
   */
  router.get(
    '/:id/resources/harvester/available-volumes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { namespace } = (req.query || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const items = await listHarvesterAvailableVolumesStandard(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          { namespace },
        );
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: error.message || '查询可用卷失败', error: error.body || error.message });
      }
    },
  );

  // ==================================================================================
  // Storage Classes
  // 策略: Direct API (配置类数据，变动少但直接查更简单)
  // ==================================================================================
  /**
   * [GET] /:id/resources/harvester/storage-classes
   * 获取存储类列表
   * 
   * 策略: Direct API Call
   */
  router.get(
    '/:id/resources/harvester/storage-classes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const items = await listHarvesterStorageClassesStandard({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        } as any);
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: error.message || '查询存储类失败', error: error.body || error.message });
      }
    },
  );

  // ==================================================================================
  // Volume Operations (Attach/Detach/Delete/Snapshot/Export/Clone)
  // ==================================================================================
  /**
   * [POST] 挂载卷到虚拟机
   */
  router.post(
    '/:id/resources/harvester/vms/:instanceId/add-volume',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, instanceId } = req.params as any;
        const { name, bus, pvcNamespace, pvcName } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await harvesterAddVolumeToVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          instanceId,
          { name, bus, pvcNamespace, pvcName },
        );
        res.json({ message: '挂载成功', data });
      } catch (error: any) {
        res.status(500).json({ message: error.message || '挂载卷失败', error: error.body || error.message });
      }
    },
  );

  /**
   * [POST] 挂载卷到虚拟机 (Direct - 指定 Namespace/Name)
   */
  router.post(
    '/:id/resources/harvester/vms/:namespace/:name/add-volume',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params as any;
        const { diskName, bus, pvcNamespace, pvcName, name: bodyName } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await harvesterAddVolumeToVMDirect(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace,
          name,
          { name: bodyName || diskName, bus, pvcNamespace, pvcName },
        );
        res.json({ message: '挂载成功', data });
      } catch (error: any) {
        res.status(500).json({ message: '挂载卷失败', error: error.message });
      }
    },
  );

  /**
   * [POST] 从虚拟机卸载卷
   */
  router.post(
    '/:id/resources/harvester/vms/:instanceId/remove-volume',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, instanceId } = req.params as any;
        const { name } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await harvesterRemoveVolumeFromVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          instanceId,
          { name },
        );
        res.json({ message: '卸载成功', data });
      } catch (error: any) {
        res.status(500).json({ message: '卸载卷失败', error: error.message });
      }
    },
  );

  /**
   * [DELETE] 删除卷 (PVC)
   */
  router.delete(
    '/:id/resources/harvester/volumes/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源删除')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await deleteHarvesterLonghornVolume(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace,
          name,
        );
        res.json({ message: '删除成功', data });
      } catch (error: any) {
        const status = Number(error?.status || 0);
        const body = String(error?.message || '');
        let msg = '删除卷失败';
        const lower = body.toLowerCase();
        if (status === 403 || lower.includes('permissiondenied')) {
          msg =
            '删除失败：权限不足或接口不支持删除（403）。请检查登录账号权限，或通过 Longhorn 卷 CRD 路径执行删除。';
        } else if (status === 404 || lower.includes('not found')) {
          msg = '删除失败：未找到该卷（404）。请确认命名空间与卷名是否正确。';
        } else if (status === 409 || lower.includes('conflict') || lower.includes('in use')) {
          msg = '删除失败：卷正在使用或已挂载（409）。请先卸载后再删除。';
        } else if (lower.includes('method delete not supported')) {
          msg = '删除失败：当前接口不支持删除操作。请使用 Longhorn CRD API 路径删除。';
        }
        res.status(500).json({ message: msg });
      }
    },
  );

  /**
   * [POST] 导出卷为镜像
   */
  router.post(
    '/:id/resources/harvester/volumes/:namespace/:pvcName/export-image',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, pvcName } = req.params as any;
        const { displayName, targetStorageClassName } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await exportImageFromPVC(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace,
          pvcName,
          { displayName, targetStorageClassName },
        );
        res.json({ message: '创建镜像任务成功', data });
      } catch (error: any) {
        const status = Number(error?.status || 0);
        const body = String(error?.message || '');
        let msg = '导出镜像失败';
        const lower = body.toLowerCase();
        if (status === 403 || lower.includes('forbidden')) {
          msg = '失败：权限不足（403）。';
        } else if (status === 404 || lower.includes('not found')) {
          msg = '失败：PVC 未找到（404）。';
        }
        res.status(500).json({ message: msg });
      }
    },
  );

  /**
   * [POST] 创建卷快照
   */
  router.post(
    '/:id/resources/harvester/volumes/:namespace/:pvcName/snapshots',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, pvcName } = req.params as any;
        const { name, snapshotClassName } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await createVolumeSnapshot(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace,
          pvcName,
          { name, snapshotClassName },
        );
        res.json({ message: '创建快照成功', data });
      } catch (error: any) {
        const status = Number(error?.status || 0);
        const body = String(error?.message || '');
        let msg = '创建快照失败';
        const lower = body.toLowerCase();
        if (status === 403 || lower.includes('forbidden')) {
          msg = '失败：权限不足（403）。';
        } else if (status === 404 || lower.includes('not found')) {
          msg = '失败：PVC 未找到（404）。';
        }
        res.status(500).json({ message: msg });
      }
    },
  );

  /**
   * [PUT] 更新卷规格 (扩容/修改配置)
   */
  router.put(
    '/:id/resources/harvester/volumes/:namespace/:pvcName',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, pvcName } = req.params as any;
        const { sizeGi, size, accessModes, volumeMode, storageClassName, annotations, labels } =
          (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await updatePVCSpec(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace,
          pvcName,
          { sizeGi, size, accessModes, volumeMode, storageClassName, annotations, labels },
        );
        res.json({ message: '更新成功', data });
      } catch (error: any) {
        const status = Number(error?.status || 0);
        const body = String(error?.message || '');
        let msg = '更新卷失败';
        const lower = body.toLowerCase();
        if (status === 403 || lower.includes('forbidden')) {
          msg = '失败：权限不足（403）。';
        } else if (status === 404 || lower.includes('not found')) {
          msg = '失败：PVC 未找到（404）。';
        }
        res.status(500).json({ message: msg });
      }
    },
  );

  /**
   * [POST] 克隆卷
   */
  router.post(
    '/:id/resources/harvester/volumes/:namespace/:pvcName/clone',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, pvcName } = req.params as any;
        const {
          targetNamespace,
          newName,
          sizeGi,
          size,
          storageClassName,
          fromSnapshotName,
          accessModes,
          volumeMode,
        } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await clonePVC(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace,
          pvcName,
          {
            targetNamespace,
            newName,
            sizeGi,
            size,
            storageClassName,
            fromSnapshotName,
            accessModes,
            volumeMode,
          },
        );
        res.json({ message: '克隆创建成功', data });
      } catch (error: any) {
        const status = Number(error?.status || 0);
        const body = String(error?.message || '');
        let msg = '克隆卷失败';
        const lower = body.toLowerCase();
        if (status === 403 || lower.includes('forbidden')) {
          msg = '失败：权限不足（403）。';
        } else if (status === 409 || lower.includes('already exists')) {
          msg = '失败：同名PVC已存在（409）。';
        }
        res.status(500).json({ message: msg });
      }
    },
  );

  /**
   * [POST] 创建卷 (PVC)
   */
  router.post(
    '/:id/resources/harvester/volumes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params as any;
        const { namespace, name, sizeGi, size, accessModes, volumeMode, storageClassName } =
          (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        if (!namespace || !name)
          return res.status(400).json({ message: '缺少必要参数：namespace、name' });
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await createHarvesterPVCVolume(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          { namespace, name, sizeGi, size, accessModes, volumeMode, storageClassName },
        );
        res.json({ message: '创建成功', data });
      } catch (error: any) {
        const status = Number(error?.status || 0);
        const body = String(error?.message || '');
        let msg = '创建卷失败';
        const lower = body.toLowerCase();
        if (status === 403 || lower.includes('forbidden')) {
          msg = '创建失败：权限不足（403）。请检查登录账号的集群写权限。';
        } else if (status === 409 || lower.includes('already exists')) {
          msg = '创建失败：同名卷已存在（409）。请更换名称或删除后再试。';
        } else if (status === 404 || lower.includes('not found')) {
          msg = '创建失败：命名空间不存在（404）。请确认命名空间是否正确。';
        }
        res.status(500).json({ message: msg });
      }
    },
  );

  // ==================================================================================
  // Images (List)
  // ==================================================================================
  /**
   * [GET] /:id/resources/harvester/images
   * 获取镜像列表
   * 
   * 实体: HarvesterImageInventory
   * 策略: Inventory Cache First + Sync Fallback
   * 描述: 返回 Harvester 集群中的 VirtualMachineImages。
   */
  router.get(
    '/:id/resources/harvester/images',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterImageInventory);
        const count = await repo.count({ where: { cloudId: id } });

        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterImages(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync Images failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        }

        const items = await repo.find({ where: { cloudId: id } });
        const list = items.map(i => i.rawData);
        
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        res.status(500).json({ message: '查询镜像失败', error: error.message });
      }
    },
  );

  // ==================================================================================
  // Images (Create/Delete/Update)
  // ==================================================================================
  /**
   * [DELETE] 删除镜像
   */
  router.delete(
    '/:id/resources/harvester/images/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源删除')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }
        const url = `${origin}/v1/harvester/harvesterhci.io.virtualmachineimages/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
        await requestJson('DELETE', url, cloud.secretKey || '', insecure, undefined);
        res.json({ message: '删除成功' });
      } catch (error: any) {
        res.status(500).json({ message: '删除镜像失败', error: error.message });
      }
    },
  );

  /**
   * [POST] 创建镜像
   */
  router.post(
    '/:id/resources/harvester/images',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params as any;
        const {
          namespace,
          name,
          displayName,
          sourceType,
          url,
          targetStorageClassName,
          storageClassParameters,
        } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源创建')) return;
        if (!namespace || !(name || displayName))
          return res.status(400).json({ message: '缺少必填参数：namespace、name 或 displayName' });
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }
        const urlPath = `${origin}/apis/harvesterhci.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachineimages`;
        const body = {
          apiVersion: 'harvesterhci.io/v1beta1',
          kind: 'VirtualMachineImage',
          metadata: {
            name: name || undefined,
            generateName: name ? undefined : 'image-',
            namespace,
          },
          spec: {
            displayName: displayName || name || 'image',
            sourceType: sourceType || (url ? 'download' : 'upload'),
            url: url || '',
            targetStorageClassName: targetStorageClassName || 'longhorn',
            storageClassParameters: storageClassParameters || {},
          },
        };
        const json = await requestJson('POST', urlPath, cloud.secretKey || '', insecure, body);
        res.json({ message: '创建成功', data: json });
      } catch (error: any) {
        res.status(500).json({ message: '创建镜像失败', error: error.message });
      }
    },
  );

  /**
   * [PUT] 更新镜像
   */
  router.put(
    '/:id/resources/harvester/images/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params as any;
        const { displayName, retry, targetStorageClassName, storageClassParameters } = (req.body ||
          {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源更新')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }
        const getUrl = `${origin}/apis/harvesterhci.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachineimages/${encodeURIComponent(name)}`;
        const current = await getJsonOnce(getUrl, cloud.secretKey || '', insecure);
        const next = {
          apiVersion: current?.apiVersion || 'harvesterhci.io/v1beta1',
          kind: current?.kind || 'VirtualMachineImage',
          metadata: { ...(current?.metadata || {}), name, namespace },
          spec: {
            ...(current?.spec || {}),
            ...(displayName ? { displayName } : {}),
            ...(typeof retry === 'number' ? { retry } : {}),
            ...(targetStorageClassName ? { targetStorageClassName } : {}),
            ...(storageClassParameters ? { storageClassParameters } : {}),
          },
        };
        const putUrl = getUrl;
        const json = await requestJson('PUT', putUrl, cloud.secretKey || '', insecure, next);
        res.json({ message: '更新成功', data: json });
      } catch (error: any) {
        res.status(500).json({ message: '更新镜像失败', error: error.message });
      }
    },
  );

  // ==================================================================================
  // Nodes (Direct API)
  // ==================================================================================
  /**
   * [GET] /:id/resources/harvester/nodes
   * 获取节点列表
   * 
   * 策略: Direct API Call
   */
  router.get(
    '/:id/resources/harvester/nodes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const itemsRaw = await listHarvesterNodesStandard({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        } as any);
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }
        const items = (Array.isArray(itemsRaw) ? itemsRaw : []).map((n: any) => {
          const name = n?.metadata?.name || n?.name || '';
          const viewUrl = name ? `${origin}/api/v1/nodes/${encodeURIComponent(name)}` : undefined;
          return { ...n, links: viewUrl ? { view: viewUrl } : n?.links };
        });
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询节点失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/nodes/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }
        let clusterId: string | null = null;
        try {
          const clusters = await getJsonOnce(`${origin}/v3/clusters`, cloud.secretKey || '', insecure);
          const arr = Array.isArray(clusters?.data) ? clusters?.data : (Array.isArray(clusters?.items) ? clusters?.items : []);
          const local = arr.find((c: any) => String(c?.id || c?.Id || '').toLowerCase() === 'local');
          const any = arr[0];
          clusterId = String(local?.id || local?.Id || any?.id || any?.Id || '').trim() || null;
        } catch {}
        const candidates = [
          ...(clusterId ? [`${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/api/v1/nodes/${encodeURIComponent(name)}`] : []),
          `${origin}/api/v1/nodes/${encodeURIComponent(name)}`,
          `${origin}/v1/harvester/api/v1/nodes/${encodeURIComponent(name)}`,
          `${origin}/v1/core.v1.nodes/${encodeURIComponent(name)}`
        ];
        let json: any = null;
        let lastErr: any = null;
        for (const url of candidates) {
          try {
            json = await getJsonOnce(url, cloud.secretKey || '', insecure);
            if (json) break;
          } catch (e: any) {
            lastErr = e;
          }
        }
        if (!json && lastErr) throw lastErr;
        res.json({ message: '查询成功', data: json });
      } catch (error: any) {
        res.status(500).json({ message: '查询节点详情失败', error: error.message });
      }
    },
  );

  // ==================================================================================
  // System Pods (Direct API)
  // ==================================================================================
  /**
   * [GET] /:id/resources/harvester/system-pods
   * 获取系统组件 Pod 列表
   * 
   * 策略: Direct API Call
   */
  router.get(
    '/:id/resources/harvester/system-pods',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const items = await listHarvesterSystemPodsStandard({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        } as any);
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询系统组件失败', error: error.message });
      }
    },
  );

  // ==================================================================================
  // GPU Resources
  // ==================================================================================
  /**
   * [GET] /:id/resources/harvester/gpus
   * 获取 GPU 资源列表 (PCI Passthrough / vGPU)
   * 
   * 实体: HarvesterGpuInventory
   * 策略: Inventory Cache First + Sync Fallback
   */
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

        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterGpus(cloud, insecure);
          } catch (e: any) {
             console.warn('Sync GPUs failed, falling back to empty/stale', e);
             if (count === 0) throw e;
          }
        }

        const items = await repo.find({ where: { cloudId: id } });
        const list = items.map(i => i.rawData);

        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        res.status(500).json({ message: '查询GPU资源失败', error: error.message });
      }
    },
  );

  // ==================================================================================
  // USB Resources (Direct API)
  // ==================================================================================
  /**
   * [GET] /:id/resources/harvester/usbs
   * 获取 USB 资源列表
   * 
   * 策略: Direct API Call
   */
  router.get(
    '/:id/resources/harvester/usbs',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const items = await listHarvesterUsbResources({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        } as any);
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询USB资源失败', error: error.message });
      }
    },
  );

  // ==================================================================================
  // Health Check (Direct API)
  // ==================================================================================
  /**
   * [GET] /:id/resources/harvester/health
   * Harvester 健康检查与连通性诊断
   * 
   * 策略: Direct API Call
   */
  router.get(
    '/:id/resources/harvester/health',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const data = await harvesterHealthCheck({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        } as any);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        res.status(500).json({ message: '健康检查失败', error: error.message });
      }
    },
  );

  /**
   * [GET] /:id/resources/harvester/capabilities
   * 获取 Harvester 集群能力（架构、推荐机型）
   */
  router.get(
    '/:id/resources/harvester/capabilities',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const data = await getHarvesterCapabilities({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        } as any);
        
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        res.status(500).json({ message: '获取集群能力失败', error: error.message });
      }
    },
  );
};
