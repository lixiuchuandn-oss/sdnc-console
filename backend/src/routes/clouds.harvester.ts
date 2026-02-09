import { Router, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Cloud } from '../entities/Cloud';
import { UserSpace } from '../entities/UserSpace';
import { HarvesterNamespace } from '../entities/harvester/HarvesterNamespace';
import { HarvesterNamespaceInventory } from '../entities/harvester/HarvesterNamespaceInventory';
import {
  listHarvesterVMsStandard,
  listHarvesterAvailableVolumesStandard,
  listHarvesterNodesStandard,
  listHarvesterGpuResources,
  listHarvesterUsbResources,
  listHarvesterStorageClassesStandard,
  harvesterHealthCheck,
  getHarvesterCapabilities,
  getHarvesterVM,
  createHarvesterVM,
  listKubeOvnVpcs,
  listKubeOvnSubnets,
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
  deleteHarvesterPVC,
  createHarvesterPVCVolume,
  exportImageFromPVC,
  createVolumeSnapshot,
  updatePVCSpec,
  clonePVC,
  getHarvesterVmVncUrl,
  listKubevirtVMsRaw,
  listKubevirtVMIsRaw,
  listKubevirtVMsRawWithMeta,
  listKubevirtVMIsRawWithMeta,
  createHarvesterScheduleVmBackup,
  updateHarvesterScheduleVmBackup,
  deleteHarvesterScheduleVmBackup,
  createHarvesterVirtualMachineBackup,
  createHarvesterVirtualMachineRestore,
  deleteHarvesterVirtualMachineBackup,
  deleteHarvesterVirtualMachineSnapshot,
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
  syncHarvesterSnapshots,
  syncHarvesterBackups,
  syncHarvesterSshKeys,
  syncHarvesterCloudInits,
  syncHarvesterIngresses,
  syncHarvesterServices,
  syncHarvesterNodes,
  syncHarvesterStorageClasses,
  syncHarvesterUsbResources,
  syncHarvesterTemplates,
  syncHarvesterScheduleVmBackups,
} from '../services/clouds/harvester/syncInventory';
import { KubevirtVolumeInventory } from '../entities/kubevirt/KubevirtVolumeInventory';
import { KubevirtNadInventory } from '../entities/kubevirt/KubevirtNadInventory';
import { KubeOvnVpcInventory } from '../entities/kubeovn/KubeOvnVpcInventory';
import { KubeOvnSubnetInventory } from '../entities/kubeovn/KubeOvnSubnetInventory';
import { HarvesterImageInventory } from '../entities/harvester/HarvesterImageInventory';
import { HarvesterNodeInventory } from '../entities/harvester/HarvesterNodeInventory';
import { HarvesterVmInventory } from '../entities/harvester/HarvesterVmInventory';
import { HarvesterVmiInventory } from '../entities/harvester/HarvesterVmiInventory';
import { KubevirtStorageClassInventory } from '../entities/kubevirt/KubevirtStorageClassInventory';
import { HarvesterGpuInventory } from '../entities/harvester/HarvesterGpuInventory';
import { HarvesterSnapshotInventory } from '../entities/harvester/HarvesterSnapshotInventory';
import { HarvesterBackupInventory } from '../entities/harvester/HarvesterBackupInventory';
import { HarvesterScheduleVmBackupInventory } from '../entities/harvester/HarvesterScheduleVmBackupInventory';
import { HarvesterSshKeyInventory } from '../entities/harvester/HarvesterSshKeyInventory';
import { HarvesterCloudInitInventory } from '../entities/harvester/HarvesterCloudInitInventory';
import { HarvesterTemplateInventory } from '../entities/harvester/HarvesterTemplateInventory';
import { HarvesterUsbInventory } from '../entities/harvester/HarvesterUsbInventory';
import { HarvesterServiceInventory } from '../entities/harvester/HarvesterServiceInventory';
import { KubeOvnIngressInventory } from '../entities/kubeovn/KubeOvnIngressInventory';
import { requestJson, getJsonOnce, watchJsonStream } from '../services/clouds/harvester/utils';

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
 *    - HarvesterVmInventory / HarvesterVmiInventory (ECS)
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
        
        // Tenant Isolation: Filter by UserSpace Namespace
        let whereCondition: any = { cloudId: id };
        let tenantNamespace: string | undefined;
        const isTenantUser = (req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device';
        const isTenantRole = (req.user as any)?.role === 'tenant';
        const isTenant = isTenantUser || isTenantRole;

        if (isTenant) {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const where: any = { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' };
          if ((req.user as any).organizationId) {
             where.organizationId = (req.user as any).organizationId;
          }
          const us = await userSpaceRepo.findOne({ where });
          if (!us) return res.json({ message: '查询成功', data: { items: [] } });
          tenantNamespace = us.namespace;

          // Dynamic Org Namespace
          if ((req.user as any).organizationId) {
             const orgNs = `ns-${(req.user as any).organizationId}`;
             tenantNamespace = tenantNamespace ? `${tenantNamespace},${orgNs}` : orgNs;
          }
        }

        const count = await repo.count({ where: whereCondition });
        
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
        
        const items = await repo.find({ where: whereCondition });
        let list = items.map((i: any) => ({
          ...(i.rawData || {}),
          view: i.view
        }));
        
        if (isTenant && tenantNamespace) {
            list = list.filter((vpc: any) => {
                const allowed = vpc?.spec?.namespaces || [];
                if (!Array.isArray(allowed)) return false;
                // Allow if tenantNamespace is in the list OR 'cloud-public' (case-insensitive) is in the list
                return allowed.includes(tenantNamespace) || 
                       allowed.some((n: string) => String(n).toLowerCase() === 'cloud-public');
            });
        }
        
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
        
        // Tenant Isolation: Filter by UserSpace Namespace
        let whereCondition: any = { cloudId: id };
        let tenantNamespace: string | undefined;
        const isTenantUser = (req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device';
        const isTenantRole = (req.user as any)?.role === 'tenant';
        const isTenant = isTenantUser || isTenantRole;

        if (isTenant) {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const where: any = { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' };
          if ((req.user as any).organizationId) {
             where.organizationId = (req.user as any).organizationId;
          }
          const us = await userSpaceRepo.findOne({ where });
          if (!us) return res.json({ message: '查询成功', data: { items: [] } });
          tenantNamespace = us.namespace;

          // Dynamic Org Namespace
          if ((req.user as any).organizationId) {
             const orgNs = `ns-${(req.user as any).organizationId}`;
             tenantNamespace = tenantNamespace ? `${tenantNamespace},${orgNs}` : orgNs;
          }
        }

        const count = await repo.count({ where: whereCondition });
        
        // Sync fallback logic
        if (count === 0 || String(force) === 'true') {
          try {
            await syncKubeOvnSubnets(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync Subnets failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        }
        
        const dbItems = await repo.find({ where: whereCondition });
        let list = dbItems.map(i => i.rawData);
        
        if (isTenant && tenantNamespace) {
            list = list.filter((subnet: any) => {
                const allowed = subnet?.spec?.namespaces || [];
                return Array.isArray(allowed) && allowed.includes(tenantNamespace);
            });
        }
        
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
   * 策略: Inventory Cache First + Sync Fallback
   * 描述: 优先从本地数据库获取 VM 和 VMI 列表，并在内存中聚合状态。
   * 当数据库为空或强制刷新时，触发后台同步。
   */
  router.get(
    '/:id/resources/ecs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const vmRepo = AppDataSource.getRepository(HarvesterVmInventory);
        const vmiRepo = AppDataSource.getRepository(HarvesterVmiInventory);

        // 系统 Namespace 黑名单定义
        const isSystemNamespace = (ns: string) => {
            if (!ns) return false;
            // 精确匹配
            const exactBlacklist = ['cloud-public', 'ingress-nginx'];
            if (exactBlacklist.includes(ns)) return true;
            
            // 前缀匹配
            // 注意: 'default' 不是系统命名空间
            const prefixBlacklist = ['cattle', 'fleet', 'longhorn', 'kube', 'harvester', 'cluster', 'cluster-fleet', 'local', 'user'];
            return prefixBlacklist.some(p => ns.startsWith(p));
        };

        // Tenant Isolation: Filter by UserSpace Namespace
        let vmWhere: any = { cloudId: id };
        let vmiWhere: any = { cloudId: id };
        
        let validNamespaces: string[] | null = null;
        
        // 统一租户判断逻辑：只要有 tenantId 且非 sase_device 即视为租户
        const isTenantUser = (req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device';
        const isTenantRole = (req.user as any)?.role === 'tenant';
        const isTenant = isTenantUser || isTenantRole;

        if (isTenant) {
          // 租户模式下，默认初始化为空数组，确保如果没有查到权限则什么都看不到
          // 只有查到明确的 UserSpace 且有 namespace 时才填充
          validNamespaces = [];

          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const where: any = { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' };
          if ((req.user as any).organizationId) {
             where.organizationId = (req.user as any).organizationId;
          }
          const userSpace = await userSpaceRepo.findOne({ where });

          // If no UserSpace found for this cloud, user shouldn't see any resources
          if (!userSpace) {
             return res.json({ message: '查询成功', data: [], capabilities: {} });
          } else {
            const nsList: string[] = [];
            if (userSpace.namespace) {
                userSpace.namespace.split(',').forEach(s => nsList.push(s.trim()));
            }
            // Dynamic Org Namespace
            if ((req.user as any).organizationId) {
                nsList.push(`ns-${(req.user as any).organizationId}`);
            }
            
            // 只有当有明确的 namespace 时才更新 validNamespaces
            if (nsList.length > 0) {
                validNamespaces = nsList;
            }
          }
        }

        const count = await vmRepo.count({ where: { cloudId: id } });

        // Sync fallback logic
        if (count === 0 || String(force) === 'true') {
            try {
                await Promise.all([
                    syncKubevirtVms(cloud, insecure),
                    syncKubevirtVmis(cloud, insecure)
                ]);
            } catch (e: any) {
                console.warn('Sync ECS failed, falling back to empty/stale', e);
                if (count === 0) throw e;
            }
        }

        // Fetch from DB
        let vmItems = await vmRepo.find({ where: vmWhere });
        const vmiItems = await vmiRepo.find({ where: vmiWhere });

        let vmisRaw = vmiItems.map(i => i.rawData);

        // Apply namespace filter in memory
        // 1. 租户白名单过滤
        if (validNamespaces) {
            vmItems = vmItems.filter((i) => validNamespaces!.includes(i.namespace));
            vmisRaw = vmisRaw.filter((v: any) => validNamespaces!.includes(v.metadata?.namespace));
        }

        // 2. 系统 Namespace 过滤 (对租户强制，对管理员默认开启但可通过参数关闭)
        // 管理员可以通过 ?includeSystem=true 查看所有资源
        const includeSystem = req.query.includeSystem === 'true';
        if (isTenant || !includeSystem) {
             vmItems = vmItems.filter((i) => !isSystemNamespace(i.namespace));
             vmisRaw = vmisRaw.filter((v: any) => !isSystemNamespace(v.metadata?.namespace));
        }

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

        const data = vmItems.map((item: any) => {
          const vm = item.rawData;
          const name = vm?.metadata?.name || '';
          const namespace = vm?.metadata?.namespace || '';
          const uid = vm?.metadata?.uid || '';
          const vmi = vmiMap.get(`${namespace}/${name}`);

          const viewUrl = item.view || `${origin}/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachines/${name}`;

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

          // Volume Claims (PVCs)
          const volumes = vm?.spec?.template?.spec?.volumes || [];
          const volumeClaims = volumes
            .map((v: any) => v?.persistentVolumeClaim?.claimName)
            .filter((n: string) => !!n);

          const creationTimestamp = vm?.metadata?.creationTimestamp;
          const description = vm?.metadata?.annotations?.description || '';
          const creator = vm?.metadata?.labels?.['harvesterhci.io/creator'] || '';
          const conditions = vm?.status?.conditions || [];

          return {
            ...vm,
            view: viewUrl, // Expose view link at root level for easier access
            links: { view: viewUrl },
            id: uid, // Use K8s UID as ID
            name,
            namespace,
            status,
            description,
            creator,
            conditions,
            createdAt: creationTimestamp,
            ips,
            macAddresses: Array.from(new Set(macs)),
            nodeName,
            networks,
            vpcName: networks.find(n => n !== 'pod' && n !== 'default'),
            volumeClaims,
            cpu,
            memoryGb: memory, // This might need parsing if it's "2Gi" etc. Frontend often handles strings or needs number.
                              // Assuming frontend handles "2Gi" or similar strings for now, or I'll fix later.
            // Include raw VMI if needed
            vmiRaw: vmi,
            vmi: vmi, // Frontend VmSection.tsx expects "vmi" field for status/node resolution
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
   * [GET] /:id/resources/harvester/proxy
   * 通用 Harvester 资源代理
   * 通过 view link (path) 获取资源详情
   */
  router.get(
    '/:id/resources/harvester/proxy',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { path } = req.query;
        if (!path || typeof path !== 'string') {
          return res.status(400).json({ message: 'Missing path parameter' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester', next)) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        let target = '';
        if (path.startsWith('http://') || path.startsWith('https://')) {
             target = path;
        } else {
             // Clean path to ensure it starts with / and doesn't duplicate
             const cleanPath = path.startsWith('/') ? path : `/${path}`;
             target = `${cloud.endpoint.replace(/\/+$/, '')}${cleanPath}`;
        }
        console.log(`[HarvesterProxy] Proxying to: ${target}`);

        const data = await getJsonOnce(target, cloud.secretKey || '', insecure);
        res.json(data);
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: 'Proxy request failed', error: error.message || String(error) });
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

        // Tenant Isolation Check
        if ((req as any).user?.role === 'tenant') {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const where: any = { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' };
          if ((req.user as any).organizationId) {
             where.organizationId = (req.user as any).organizationId;
          }
          const userSpace = await userSpaceRepo.findOne({ where });
          if (!userSpace) return res.status(403).json({ message: '无权访问该云资源' });
          
          const validNamespaces = userSpace.namespace ? userSpace.namespace.split(',').map(s => s.trim()) : [];
          
          // Add Dynamic Org Namespace
          if ((req.user as any).organizationId) {
             validNamespaces.push(`ns-${(req.user as any).organizationId}`);
          }

          if (!validNamespaces.includes(namespace)) {
            return res.status(403).json({ message: '无权访问该命名空间资源' });
          }
        }

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
   * 采用 Watch 机制 (Real-time)
   */
  router.get(
    '/:id/resources/ecs/stream',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        console.log('[SSE] Stream connection attempt:', req.originalUrl);
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
        
        // Ping to keep connection alive
        const pingInterval = setInterval(() => {
            if (closed) {
                clearInterval(pingInterval);
                return;
            }
            try {
                res.write(': ping\n\n');
            } catch {}
        }, 15000); // 15s ping

        const watchers: any[] = [];
        req.on('close', () => {
          closed = true;
          try { clearInterval(pingInterval); } catch {}
          watchers.forEach(w => w.abort());
          console.log('[SSE] Connection closed');
        });

        // Tenant Isolation: Filter by UserSpace Namespace
        let allowedNamespace: string | undefined;
        if ((req as any).user?.role === 'tenant') {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const userSpace = await userSpaceRepo.findOne({
            where: { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' },
          });
          if (!userSpace) {
            allowedNamespace = '__FORBIDDEN__';
          } else if (userSpace.namespace) {
            allowedNamespace = userSpace.namespace;
          }
        }

        const send = (event: string, payload: any) => {
          if (closed) return;
          try {
            res.write(`event: ${event}\n`);
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
          } catch {}
        };

        const vmCache = new Map<string, any>();
        const vmiCache = new Map<string, any>();

        const resolveVMStatus = (vm: any, vmi: any) => {
            if (vm?.metadata?.deletionTimestamp) return 'Terminating';
            if (vmi?.status?.phase === 'Running') return 'Running';
            return vm?.status?.printableStatus || vm?.status?.phase || 'Unknown';
        };

        const sendItem = (key: string, eventType: 'vm_created' | 'vm_status' = 'vm_status') => {
            const vm = vmCache.get(key);
            if (!vm) return;
            const vmi = vmiCache.get(key);
            
            const printableStatus = resolveVMStatus(vm, vmi);
            
            const base = (cloud.endpoint || '').replace(/\/+$/, '');
            let origin = base;
            try {
                const u = new URL(base);
                origin = `${u.protocol}//${u.host}`;
            } catch {
                origin = base.replace(/\/v[0-9].*$/, '');
            }
            const namespace = vm.metadata?.namespace || 'default';
            const name = vm.metadata?.name || '';
            const viewUrl = `${origin}/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachines/${name}`;

            const item = {
                id: vm.metadata?.uid,
                links: { view: viewUrl },
                ...vm,
                vmi,
                status: {
                    ...vm.status,
                    printableStatus
                }
            };

            if (eventType === 'vm_created') {
                send('vm_created', { item });
            } else {
                const status = String(printableStatus);
                const nodeName = vmi?.status?.nodeName || vm.status?.nodeName || '';
                const ips: string[] = [];
                if (vm?.status?.vmIp) ips.push(vm.status.vmIp);
                if (Array.isArray(vm?.status?.interfaces)) {
                    vm.status.interfaces.forEach((i: any) => {
                        if (i.ipAddress) ips.push(i.ipAddress);
                    });
                }
                if (vmi?.status?.interfaces) {
                    vmi.status.interfaces.forEach((i: any) => {
                        if (i.ipAddress) ips.push(i.ipAddress);
                        if (Array.isArray(i.ipAddresses)) ips.push(...i.ipAddresses);
                    });
                }
                
                send('vm_status', { 
                    iid: item.id, 
                    status, 
                    nodeName, 
                    ips: Array.from(new Set(ips)) 
                });
            }
        };

        const init = async () => {
            try {
                const [vmsResult, vmisResult] = await Promise.all([
                    listKubevirtVMsRawWithMeta({
                        endpoint: cloud.endpoint,
                        token: cloud.secretKey || '',
                        insecure,
                    } as any).catch(() => null),
                    listKubevirtVMIsRawWithMeta({
                        endpoint: cloud.endpoint,
                        token: cloud.secretKey || '',
                        insecure,
                    } as any).catch(() => null),
                ]);

                const initialItems: any[] = [];
                const vmsRaw = vmsResult?.items || [];
                const vmisRaw = vmisResult?.items || [];

                if (Array.isArray(vmsRaw)) {
                  vmsRaw.forEach((vm: any) => {
                    if (allowedNamespace) {
                        if (allowedNamespace === '__FORBIDDEN__') return;
                        if (vm.metadata?.namespace !== allowedNamespace) return;
                    }
                    const key = `${vm.metadata?.namespace}/${vm.metadata?.name}`;
                    vmCache.set(key, vm);
                  });
                }
                if (Array.isArray(vmisRaw)) {
                  vmisRaw.forEach((vmi: any) => {
                    if (allowedNamespace) {
                        if (allowedNamespace === '__FORBIDDEN__') return;
                        if (vmi.metadata?.namespace !== allowedNamespace) return;
                    }
                    const key = `${vmi.metadata?.namespace}/${vmi.metadata?.name}`;
                    vmiCache.set(key, vmi);
                  });
                }

                for (const key of vmCache.keys()) {
                  const vm = vmCache.get(key);
                  const vmi = vmiCache.get(key);
                  const printableStatus = resolveVMStatus(vm, vmi);
                  
                  const base = (cloud.endpoint || '').replace(/\/+$/, '');
                  let origin = base;
                  try {
                      const u = new URL(base);
                      origin = `${u.protocol}//${u.host}`;
                  } catch {
                      origin = base.replace(/\/v[0-9].*$/, '');
                  }
                  const namespace = vm.metadata?.namespace || 'default';
                  const name = vm.metadata?.name || '';
                  const viewUrl = `${origin}/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachines/${name}`;

                  initialItems.push({
                    id: vm.metadata?.uid,
                    links: { view: viewUrl },
                    ...vm,
                    vmi,
                    status: { ...vm.status, printableStatus }
                  });
                }
                send('vms', { items: initialItems });

                if (vmsResult?.url) {
                  const vmRv = vmsResult.resourceVersion || '0';
                  const vmUrl = `${vmsResult.url}?watch=true&resourceVersion=${vmRv}`;
                  const w1 = watchJsonStream(vmUrl, cloud.secretKey || '', insecure, (event) => {
                    if (closed) return;
                    const obj = event.object;
                    if (!obj || !obj.metadata) return;
                    
                    if (allowedNamespace) {
                        if (allowedNamespace === '__FORBIDDEN__') return;
                        if (obj.metadata.namespace !== allowedNamespace) return;
                    }

                    const key = `${obj.metadata.namespace}/${obj.metadata.name}`;
                    if (event.type === 'DELETED') {
                      vmCache.delete(key);
                      send('vm_deleted', { iid: obj.metadata.uid });
                    } else {
                      vmCache.set(key, obj);
                      const eventType = event.type === 'ADDED' ? 'vm_created' : 'vm_status';
                      sendItem(key, eventType);
                    }
                  }, (err) => {
                      console.error('VM Watch Error:', err);
                  });
                  watchers.push(w1);
                }

                if (vmisResult?.url) {
                    const vmiRv = vmisResult.resourceVersion || '0';
                    const vmiUrl = `${vmisResult.url}?watch=true&resourceVersion=${vmiRv}`;
                    const w2 = watchJsonStream(vmiUrl, cloud.secretKey || '', insecure, (event) => {
                        if (closed) return;
                        const obj = event.object;
                        if (!obj || !obj.metadata) return;
                         if (allowedNamespace) {
                            if (allowedNamespace === '__FORBIDDEN__') return;
                            if (obj.metadata.namespace !== allowedNamespace) return;
                        }
                        const key = `${obj.metadata.namespace}/${obj.metadata.name}`;
                         if (event.type === 'DELETED') {
                            vmiCache.delete(key);
                            if (vmCache.has(key)) sendItem(key);
                        } else {
                            vmiCache.set(key, obj);
                            if (vmCache.has(key)) sendItem(key);
                        }
                    }, (err) => {
                        console.error('VMI Watch Error:', err);
                    });
                    watchers.push(w2);
                }

            } catch (e: any) {
                console.error('[SSE] Init Error:', e);
                send('error', { message: 'Initialization failed' });
            }
        };

        send('hello', { ok: true });
        init();
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
   * [GET] /:id/resources/ecs/:instanceId/vnc
   * 获取虚拟机 VNC Console URL
   */
  router.get(
    '/:id/resources/ecs/:instanceId/vnc',
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
        const [namespace, name] = instanceId.includes('/')
          ? instanceId.split('/')
          : ['default', instanceId];

        const url = await getHarvesterVmVncUrl(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          namespace,
          name,
        );
        res.json({ message: '获取成功', data: { url } });
      } catch (error: any) {
        res.status(500).json({ message: '获取VNC地址失败', error: error.message });
      }
    },
  );

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
  // VM Actions (Create)
  // ==================================================================================
  /**
   * [POST] /:id/resources/harvester/vms
   * 创建虚拟机 (标准 Harvester API 路径)
   */
  router.post(
    '/:id/resources/harvester/vms',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        // 确定目标命名空间
        // 优先级：Metadata (标准 Manifest) > Root (旧版/查询参数)
        // 严格模式：必须显式指定命名空间，禁止默认回退到 'default'
        const targetNamespace = req.body.metadata?.namespace || req.body.namespace;

        if (!targetNamespace) {
            return res.status(400).json({ message: '参数错误：必须指定 namespace (在 metadata.namespace 或 namespace 字段中)' });
        }

        // 租户检查
        let tenantNamespace: string | undefined;
        const isTenantUser = (req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device';
        const isTenantRole = (req.user as any)?.role === 'tenant';
        const isTenant = isTenantUser || isTenantRole;

        if (isTenant) {
             const p = (req.user as any)?.permissions || [];
             if (!p.includes('clouds.console:write')) return res.status(403).json({ message: 'Permission denied: Requires clouds.console:write' });

             const userSpaceRepo = AppDataSource.getRepository(UserSpace);
             const where: any = { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' };
             if ((req.user as any).organizationId) {
                 where.organizationId = (req.user as any).organizationId;
             }
             const us = await userSpaceRepo.findOne({ where });
             if (!us) return res.status(403).json({ message: 'Access denied to this resource pool' });
             tenantNamespace = us.namespace;

             // 动态组织命名空间
             if ((req.user as any).organizationId) {
                 const orgNs = `ns-${(req.user as any).organizationId}`;
                 tenantNamespace = tenantNamespace ? `${tenantNamespace},${orgNs}` : orgNs;
             }
        }

        if (tenantNamespace) {
            const allowed = tenantNamespace.split(',').map(s => s.trim());
            
            // 如果目标命名空间不被允许，直接拒绝
            if (!allowed.includes(targetNamespace)) {
                return res.status(403).json({ message: `无权访问命名空间 '${targetNamespace}'。允许的范围: ${allowed.join(', ')}` });
            }
        }

        // Payload 准备
        // 1. 确保 metadata.namespace 与 targetNamespace 一致
        // 如果它是类似 Manifest 的对象，必须正确设置 metadata.namespace。
        if (req.body.metadata) {
            req.body.metadata.namespace = targetNamespace;
        }

        // 2. 移除根级别的 'namespace' 以确保 Payload 纯净
        const payload = { ...req.body };
        delete payload.namespace;

        const data = await createHarvesterVM(
            { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
            targetNamespace,
            payload
        );
        res.json({ message: '创建成功', data });
      } catch (error: any) {
          res.status(500).json({ message: '创建实例失败', error: error.body || error.message });
      }
    }
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
        
        // Tenant Isolation: Filter by UserSpace Namespace
        let whereCondition: any = { cloudId: id };
        if ((req as any).user?.role === 'tenant') {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const us = await userSpaceRepo.findOne({
            where: { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' },
          });
          if (!us) return res.json({ message: '查询成功', data: { items: [] } });
          if (us.namespace) {
            whereCondition.namespace = us.namespace;
          }
        }

        const count = await repo.count({ where: whereCondition });
        
        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterNads(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync NADs failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        }
        
        const items = await repo.find({ where: whereCondition });
        const list = items.map((item: any) => {
          const v = item.rawData || {};
          const name = v?.metadata?.name || item.name || '';
          const namespace = v?.metadata?.namespace || item.namespace || '';
          const displayName = v?.spec?.displayName || item.displayName || name;
          const size = v?.status?.size || item.size || 0;
          const progress = v?.status?.progress || item.progress || 0;
          const storageClassName = v?.spec?.storageClassName || item.storageClassName || '';
          
          return {
             ...v,
             name,
             namespace,
             displayName,
             size,
             progress,
             storageClassName,
             raw: v
          };
        });
        
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        res.status(500).json({ message: '查询网络附件定义失败', error: error.message });
      }
    },
  );

  /**
   * [GET] /:id/resources/harvester/nads/:namespace/:name
   * 获取单个网络附件定义 (NAD) 详情
   * 
   * 策略: Direct API Call
   * 描述: 直接从 Harvester API 获取 NAD 的实时详情。
   */
  router.get(
    '/:id/resources/harvester/nads/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, namespace, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        let path = `/apis/k8s.cni.cncf.io/v1/namespaces/${encodeURIComponent(namespace)}/network-attachment-definitions/${encodeURIComponent(name)}`;
        
        // Optimize: Try to find correct path from inventory links if available
        try {
            const repo = AppDataSource.getRepository(KubevirtNadInventory);
            const item = await repo.findOne({ where: { cloudId: id, namespace, name } });
            if (item?.rawData?.links?.view) {
                const urlObj = new URL(item.rawData.links.view);
                path = urlObj.pathname;
            }
        } catch (e) {
            // Ignore inventory lookup errors, fallback to default path
        }

        const data = await requestJson('GET', cloud.endpoint + path, cloud.secretKey || '', insecure);

        res.json(data);
      } catch (error: any) {
        res.status(500).json({ message: '获取网络附件定义详情失败', error: error.message });
      }
    },
  );

  /**
   * [GET] /:id/resources/harvester/volumes/:namespace/:name
   * 获取单个卷 (PVC) 详情
   * 
   * 策略: Direct API Call
   * 描述: 直接从 Harvester API 获取 PVC 的实时详情。
   */
  router.get(
    '/:id/resources/harvester/volumes/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, namespace, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const path = `/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims/${encodeURIComponent(name)}`;
        const data = await requestJson('GET', cloud.endpoint + path, cloud.secretKey || '', insecure);

        res.json(data);
      } catch (error: any) {
        res.status(500).json({ message: '获取卷详情失败', error: error.message });
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
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterNamespaceInventory);
        const count = await repo.count({ where: { cloudId: id } });

        // Sync fallback logic
        if (count === 0 || String(force) === 'true') {
            try {
                await syncHarvesterNamespaces(cloud, insecure);
            } catch (e: any) {
                console.warn('Sync Namespaces failed, falling back to empty/stale', e);
                if (count === 0) throw e;
            }
        }

        const dbItems = await repo.find({ where: { cloudId: id } });
        let items = dbItems.map(i => i.rawData);
        
        // Tenant Isolation: Filter by UserSpace Namespace
        const isTenantUser = (req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device';
        const isTenantRole = (req as any).user?.role === 'tenant';
        if (isTenantUser || isTenantRole) {
          const tenantId = (req as any).user.tenantId;
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          
          // Tenant Isolation Fix (Bug 26): Strict Organization Matching
          // Sub-organizations MUST NOT see parent organization's resources.
          const userOrgId = (req.user as any).organizationId;
          const whereClause: any[] = [];
          
          if (userOrgId) {
             // If user belongs to an organization, ONLY fetch that organization's UserSpace
             whereClause.push({ tenantId, cloudId: id, status: 'active', organizationId: userOrgId });
          } else {
             // If user is root tenant user (no org), fetch root UserSpace (organizationId is null)
             whereClause.push({ tenantId, cloudId: id, status: 'active', organizationId: null });
          }

          const matches = await userSpaceRepo.find({ where: whereClause });
          const us = matches[0]; // Strict match, no fallback

          if (!us) {
            // Even if no UserSpace, strictly no access
            items = [];
          } else {
             // Allow assigned namespace AND cloud-public
             const allowedNs = new Set<string>();
             if (us.namespace) {
                 us.namespace.split(',').forEach(ns => allowedNs.add(ns.trim()));
             }
             allowedNs.add('cloud-public');

             // Dynamic Org Namespace: ns-{organizationId}
             if (userOrgId) {
                 allowedNs.add(`ns-${userOrgId}`);
             }

             items = items.filter((n: any) => {
               const name = n?.metadata?.name || n?.name;
               // Case-insensitive check
               return Array.from(allowedNs).some(allowed => allowed.toLowerCase() === String(name).toLowerCase());
             });
          }
        }

        // Enrich with local DB info
        try {
          const repo = AppDataSource.getRepository(HarvesterNamespace);
          const dbItems = await repo.find({ where: { cloudId: id } });
          const userNamespaces = new Set(dbItems.map(i => i.name));
          
          const base = (cloud.endpoint || '').replace(/\/+$/, '');
          let origin = base;
          try {
            const u = new URL(base);
            origin = `${u.protocol}//${u.host}`;
          } catch {
            origin = base.replace(/\/v[0-9].*$/, '');
          }

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
        // API 路径候选列表 (多版本兼容与 Rancher 集成适配):
        // 1. /api/v1/namespaces: 标准 K8s API 路径 (Standalone Harvester)
        // 2. /v1/harvester/core.v1.namespaces: Rancher 代理模式下的路径
        // 3. /k8s/clusters/local/...: 某些边缘部署场景
        // 使用循环尝试机制，确保在各种网络拓扑和版本下都能成功调用。
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
        
        // Tenant Isolation: Filter by UserSpace Namespace
        let whereCondition: any = { cloudId: id };
        if ((req as any).user?.role === 'tenant') {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const us = await userSpaceRepo.findOne({
            where: { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' },
          });
          if (!us) return res.json({ message: '查询成功', data: { items: [] } });
          if (us.namespace) {
            whereCondition.namespace = us.namespace;
          }
        }

        const count = await repo.count({ where: whereCondition });

        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterVolumes(cloud, insecure);
          } catch (e: any) {
             console.warn('Sync Volumes failed, falling back to empty/stale', e);
             if (count === 0) throw e;
          }
        }

        const items = await repo.find({ where: whereCondition });
        
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
          
          // Robust Size Extraction
          // 1. Status Capacity (Actual bound size)
          // 2. Spec Requests (Requested size)
          // 3. DB Cache
          const size = 
            v?.status?.capacity?.storage || 
            v?.spec?.resources?.requests?.storage || 
            v?.spec?.size || 
            v?.size || 
            item.capacity || 
            0;

          // Robust State Extraction
          // 1. Status Phase (Standard K8s PVC)
          // 2. Status State (Some CRDs)
          // 3. DB Cache
          const state = 
            v?.status?.phase || 
            v?.status?.state || 
            v?.state || 
            item.phase || 
            'Unknown';

          const k8s = v?.status?.kubernetesStatus || {};
          const namespace = k8s?.namespace || v?.metadata?.namespace || item.namespace || '';
          const pvcName = k8s?.pvcName || '';
          
          // Ensure robust fallback for technical fields
          const storageClassName = v?.spec?.storageClassName || item.storageClassName || '';
          const volumeMode = v?.spec?.volumeMode || item.volumeMode || '';
          
          const rawAccessModes = v?.status?.accessModes || v?.spec?.accessModes;
          const accessModes = Array.isArray(rawAccessModes) 
            ? rawAccessModes 
            : (item.accessModes ? String(item.accessModes).split(',') : []);

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
            storageClassName,
            volumeMode,
            accessModes,
            createdAt: v?.metadata?.creationTimestamp,
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
  // 策略: Inventory Cache First + Sync Fallback
  // ==================================================================================
  /**
   * [GET] /:id/resources/harvester/available-volumes
   * 获取可挂载的卷列表
   * 
   * 策略: Inventory Cache First + Sync Fallback
   * 描述: 查询当前处于 Unbound 或 Detached 状态，可供虚拟机挂载的卷。
   * 实现: 复用 KubevirtVolumeInventory (PVCs)，在内存中过滤 Attached 状态。
   */
  router.get(
    '/:id/resources/harvester/available-volumes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { namespace, force } = (req.query || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(KubevirtVolumeInventory);

        // Tenant Isolation: Force namespace filter
        let filterNamespace = namespace;
        if ((req as any).user?.role === 'tenant') {
           const userSpaceRepo = AppDataSource.getRepository(UserSpace);
           const us = await userSpaceRepo.findOne({
             where: { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' },
           });
           if (!us) return res.json({ message: '查询成功', data: { items: [] } });
           if (us.namespace) {
               filterNamespace = us.namespace;
           }
        }

        const count = await repo.count({ where: { cloudId: id } });

        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterVolumes(cloud, insecure);
          } catch (e: any) {
             console.warn('Sync Volumes failed, falling back to empty/stale', e);
             if (count === 0) throw e;
          }
        }

        const where: any = { cloudId: id };
        if (filterNamespace) {
            where.namespace = filterNamespace;
        }
        
        const dbItems = await repo.find({ where });

        // Frontend Response Formatting & Availability Filtering
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }

        const items = dbItems
            .map((item) => {
                const v = item.rawData || {};
                
                const name = v?.metadata?.name || v?.name || item.name || '';
                const ns = v?.metadata?.namespace || v?.namespace || item.namespace || '';
                
                // Robust Size Extraction
                const size = 
                    v?.status?.capacity?.storage || 
                    v?.spec?.resources?.requests?.storage || 
                    v?.spec?.size || 
                    v?.size || 
                    item.capacity || 
                    0;

                // Robust State Extraction
                const state = String(
                    v?.status?.phase || 
                    v?.status?.state || 
                    v?.state || 
                    item.phase || 
                    'Unknown'
                ).toLowerCase();
                
                // Workloads Status check (Harvester specific)
                const workloads = v?.status?.workloadsStatus || v?.status?.workloadStatus || [];
                const inUse = Array.isArray(workloads) && workloads.some(
                    (w: any) => String(w?.state || w?.podStatus || '').toLowerCase() === 'running'
                );
                const attached = state === 'attached' || inUse;
                const pvcName = v?.status?.kubernetesStatus?.pvcName || name;
                
                const viewUrl = `${origin}/api/v1/namespaces/${ns}/persistentvolumeclaims/${name}`;
                
                return {
                    ...v,
                    name,
                    pvcName,
                    namespace: ns,
                    size,
                    state, 
                    attached,
                    links: { view: viewUrl }
                };
            })
            // Filter: Must be Bound (Ready) AND Not Attached
            .filter((x: any) => {
                const isBound = String(x.state).toLowerCase() === 'bound';
                return isBound && !x.attached;
            });

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询可用卷失败', error: error.message });
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
   * 实体: KubevirtStorageClassInventory
   * 策略: Inventory Cache First + Sync Fallback
   */
  router.get(
    '/:id/resources/harvester/storage-classes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(KubevirtStorageClassInventory);
        const count = await repo.count({ where: { cloudId: id } });

        if (count === 0 || String(force) === 'true') {
            try {
                await syncHarvesterStorageClasses(cloud, insecure);
            } catch (e: any) {
                console.warn('Sync StorageClasses failed, falling back to empty/stale', e);
                if (count === 0) throw e;
            }
        }

        const dbItems = await repo.find({ where: { cloudId: id } });
        const items = dbItems.map(i => i.rawData);
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
        const data = await deleteHarvesterPVC(
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
        // 执行克隆操作
        // Harvester/Longhorn 支持通过 CSI (Container Storage Interface) 进行卷克隆。
        // 如果是跨命名空间克隆，或者底层存储不支持直接克隆，可能需要先创建快照 (Snapshot) 再恢复。
        // 这里调用 clonePVC 封装了这些复杂性。
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
          { namespace, name, sizeGi: sizeGi || size, accessModes, volumeMode, storageClassName },
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
        
        // Tenant Isolation: Filter by UserSpace Namespace
        let whereCondition: any = { cloudId: id };
        const isTenantUser = (req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device';
        const isTenantRole = (req as any).user?.role === 'tenant';

        if (isTenantUser || isTenantRole) {
          const tenantId = (req as any).user.tenantId;
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          // Query: tenantId AND cloudId AND (organizationId = userOrgId OR organizationId IS NULL)
          const matches = await userSpaceRepo.find({
             where: [
                { tenantId, cloudId: id, status: 'active', organizationId: (req.user as any).organizationId },
                { tenantId, cloudId: id, status: 'active', organizationId: null }
             ]
          });
          const us = matches.find(m => m.organizationId === (req.user as any).organizationId) || matches[0];

          if (!us) return res.json({ message: '查询成功', data: { items: [] } });
          
          // Construct whereCondition for TypeORM (array of conditions for OR)
          // We want: (cloudId=id AND namespace=us.namespace) OR (cloudId=id AND namespace='cloud-public')
          // But wait, TypeORM 'where' in find is already handled by 'whereCondition' variable?
          // No, 'whereCondition' was defined above as { cloudId: id }.
          // We need to override it.
          
          if (us.namespace) {
             whereCondition = [
                { cloudId: id, namespace: us.namespace },
                { cloudId: id, namespace: 'cloud-public' }, // Assuming 'cloud-public' is the exact name in DB
                { cloudId: id, namespace: 'Cloud-Public' }  // Add variant just in case
             ];
          } else {
             // Only public if no private namespace
             whereCondition = [
                { cloudId: id, namespace: 'cloud-public' },
                { cloudId: id, namespace: 'Cloud-Public' }
             ];
          }
        }

        const count = await repo.count({ where: whereCondition });

        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterImages(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync Images failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        }

        const items = await repo.find({ where: whereCondition });
        const list = items.map(i => {
           const r = i.rawData || {};
           const name = r.metadata?.name || i.name || '';
           const namespace = r.metadata?.namespace || i.namespace || '';
           const displayName = r.spec?.displayName || i.displayName || name;
           const size = r.status?.size || i.size || 0;
           const progress = r.status?.progress || i.progress || 0;
           const conditions = r.status?.conditions || [];
           // Infer state from conditions: Imported=True -> Active
           let state = 'Unknown';
           const imported = conditions.find((c: any) => c.type === 'Imported');
           if (imported?.status === 'True') state = 'Active';
           else if (imported?.status === 'False') state = 'Failed';
           else if (progress < 100) state = 'Downloading';
           
           const createdAt = r.metadata?.creationTimestamp;
           
           return {
               ...r,
               id: r.metadata?.uid || i.uid,
               name, // Internal K8s name
               namespace,
               displayName, // User friendly name
               size,
               progress,
               state,
               createdAt,
               conditions
           };
        });
        
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
   * [GET] /:id/resources/harvester/images/:namespace/:name
   * 获取特定镜像详情
   */
  router.get(
    '/:id/resources/harvester/images/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;
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
        
        // Try v1beta1 first as it is the standard version
        const url = `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/virtualmachineimages/${encodeURIComponent(name)}`;
        let json: any = null;
        try {
            json = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
        } catch (e) {
            // Fallback to v1 if v1beta1 fails
            const urlV1 = `${origin}/apis/harvesterhci.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachineimages/${encodeURIComponent(name)}`;
            json = await getJsonOnce(urlV1, cloud.secretKey || '', insecure, true);
        }
        
        res.json({ message: '查询成功', data: json });
      } catch (error: any) {
        res.status(500).json({ message: '查询镜像详情失败', error: error.message });
      }
    },
  );


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
            // 显示名称，若未提供则使用 name
            displayName: displayName || name || 'image',
            // 来源类型 (Source Type):
            // - 'download': Harvester 控制面自动从 url 下载镜像文件 (支持 http/https/s3)。
            // - 'upload': 创建后，前端需发起额外的上传请求将文件推送到 minio/backing-image-manager。
            sourceType: sourceType || (url ? 'download' : 'upload'),
            url: url || '',
            // 目标存储类，默认为 'longhorn'
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
  // Nodes (Inventory Cache)
  // ==================================================================================
  /**
   * [GET] /:id/resources/harvester/nodes
   * 获取节点列表
   * 
   * 策略: Inventory Cache First + Sync Fallback
   */
  router.get(
    '/:id/resources/harvester/nodes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterNodeInventory);
        const count = await repo.count({ where: { cloudId: id } });

        if (count === 0 || String(force) === 'true') {
            try {
                await syncHarvesterNodes(cloud, insecure);
            } catch (e: any) {
                console.warn('Sync Nodes failed, falling back to empty/stale', e);
                if (count === 0) throw e;
            }
        }

        const dbItems = await repo.find({ where: { cloudId: id } });

        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }

        const items = dbItems.map((item: any) => {
            const n = item.rawData || {};
            const name = n?.metadata?.name || n?.name || item.name || '';
            const viewUrl = name ? `${origin}/api/v1/nodes/${encodeURIComponent(name)}` : undefined;
            return { 
                ...n, 
                links: viewUrl ? { view: viewUrl } : n?.links,
                // Ensure critical fields are present from DB columns if missing in rawData (shouldn't happen but safe)
                name,
                status: item.status,
                nodeInfo: item.nodeInfo,
                kernelVersion: item.kernelVersion,
                osImage: item.osImage,
                containerRuntimeVersion: item.containerRuntimeVersion,
                kubeletVersion: item.kubeletVersion,
                kubeProxyVersion: item.kubeProxyVersion,
                operatingSystem: item.operatingSystem,
                architecture: item.architecture,
                view: item.view
            };
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
          const clusters = await getJsonOnce(`${origin}/v3/clusters`, cloud.secretKey || '', insecure, true);
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
            json = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
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
  // Services (K8s Services)
  // ==================================================================================
  /**
   * [GET] /:id/resources/harvester/services
   * 获取 Kubernetes Service 列表
   * 
   * 实体: HarvesterServiceInventory
   * 策略: Inventory Cache First + Sync Fallback
   */
  router.get(
    '/:id/resources/harvester/services',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const repo = AppDataSource.getRepository(HarvesterServiceInventory);
        const whereCondition: any = { cloudId: id };
        
        // Tenant Isolation
        if ((req as any).user?.role === 'tenant') {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const us = await userSpaceRepo.findOne({
             where: { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' }
          });
          if (!us) return res.json({ message: '查询成功', data: { items: [] } });
          // If needed, filter by namespace in memory later, or rely on Sync to only fetch allowed?
          // Inventory stores all. We should filter by allowed namespaces.
          // For simplicity, we filter the rawData list.
        }

        const count = await repo.count({ where: whereCondition });
        
        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterServices(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync Services failed, falling back', e);
            if (count === 0) throw e;
          }
        }
        
        const items = await repo.find({ where: whereCondition });
        let list = items.map(i => i.rawData);

        // Filter by Tenant Namespace
        if ((req as any).user?.role === 'tenant') {
           const userSpaceRepo = AppDataSource.getRepository(UserSpace);
           const us = await userSpaceRepo.findOne({
             where: { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' }
           });
           if (us?.namespace) {
             const allowed = us.namespace.split(',').map(s => s.trim());
             list = list.filter((svc: any) => allowed.includes(svc?.metadata?.namespace));
           }
        }

        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询服务失败', error: error.message });
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

        if (count === 0 || String(force) === 'true') {
            try {
                await syncHarvesterUsbResources(cloud, insecure);
            } catch (e: any) {
                console.warn('Sync USBs failed, falling back to empty/stale', e);
                if (count === 0) throw e;
            }
        }

        const dbItems = await repo.find({ where: { cloudId: id } });
        // Restore to original structure if needed. 
        // listHarvesterUsbResources returns { resourceName, name, vendorId, productId, raw }
        // Our Inventory stores these fields directly.
        // We can just return them.
        const items = dbItems.map(i => ({
            resourceName: i.resourceName,
            name: i.name,
            description: i.description,
            vendorId: i.vendorId,
            productId: i.productId,
            raw: i.rawData,
            // Assuming USBs don't have standard k8s links like 'view' unless we construct them
        }));

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

  // ==================================================================================
  // Snapshots (Inventory Cache First)
  // ==================================================================================
  router.get(
    '/:id/resources/harvester/snapshots',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterSnapshotInventory);
        
        let whereCondition: any = { cloudId: id };
        const isTenant = (req.user as any)?.role === 'tenant' || ((req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device');
        if (isTenant) {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const us = await userSpaceRepo.findOne({
            where: { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' },
          });
          if (!us) return res.json({ message: '查询成功', data: { items: [] } });
          if (us.namespace) whereCondition.namespace = us.namespace;
        }

        const count = await repo.count({ where: whereCondition });
        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterSnapshots(cloud, insecure);
          } catch (e: any) {
             console.warn('Sync Snapshots failed, falling back to empty/stale', e);
             if (count === 0) throw e;
          }
        }

        const items = await repo.find({ where: whereCondition });
        const list = items.map(i => i.rawData);
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        res.status(500).json({ message: '查询快照失败', error: error.message });
      }
    },
  );

  router.delete(
    '/:id/resources/harvester/snapshots/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        await deleteHarvesterVirtualMachineSnapshot(
          {
            endpoint: cloud.endpoint,
            token: cloud.secretKey,
            insecure,
          } as any,
          namespace,
          name
        );
        
        // Sync immediately
        try {
          await syncHarvesterSnapshots(cloud, insecure);
        } catch (e) {
           console.warn('Sync Snapshots after delete failed', e);
        }

        res.json({ message: '删除成功' });
      } catch (error: any) {
        res.status(500).json({ message: '删除快照失败', error: error.message });
      }
    },
  );

  // ==================================================================================
  // Backups (Inventory Cache First)
  // ==================================================================================
  router.get(
    '/:id/resources/harvester/backups',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterBackupInventory);
        
        let whereCondition: any = { cloudId: id };
        const isTenant = (req.user as any)?.role === 'tenant' || ((req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device');
        if (isTenant) {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const us = await userSpaceRepo.findOne({
            where: { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' },
          });
          if (!us) return res.json({ message: '查询成功', data: { items: [] } });
          if (us.namespace) whereCondition.namespace = us.namespace;
        }

        const count = await repo.count({ where: whereCondition });
        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterBackups(cloud, insecure);
          } catch (e: any) {
             console.warn('Sync Backups failed, falling back to empty/stale', e);
             if (count === 0) throw e;
          }
        }

        const items = await repo.find({ where: whereCondition });
        const list = items.map(i => i.rawData);
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        res.status(500).json({ message: '查询备份失败', error: error.message });
      }
    },
  );

  // ==================================================================================
  // Schedule VM Backups (Inventory Cache First)
  // ==================================================================================
  router.get(
    '/:id/resources/harvester/schedulevmbackups',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterScheduleVmBackupInventory);
        
        let whereCondition: any = { cloudId: id };
        const isTenant = (req.user as any)?.role === 'tenant' || ((req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device');
        if (isTenant) {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const us = await userSpaceRepo.findOne({
            where: { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' },
          });
          if (!us) return res.json({ message: '查询成功', data: { items: [] } });
          if (us.namespace) whereCondition.namespace = us.namespace;
        }

        const count = await repo.count({ where: whereCondition });
        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterScheduleVmBackups(cloud, insecure);
          } catch (e: any) {
             console.warn('Sync ScheduleVmBackups failed, falling back to empty/stale', e);
             if (count === 0) throw e;
          }
        }

        const items = await repo.find({ where: whereCondition });
        const list = items.map(i => i.rawData);
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        res.status(500).json({ message: '查询定时备份失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/schedulevmbackups',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const payload = req.body; // Expects { namespace, name, vmName, cron, retain, suspend }
        
        await createHarvesterScheduleVmBackup(
          {
            endpoint: cloud.endpoint,
            token: cloud.secretKey,
            insecure,
          } as any,
          payload.namespace,
          payload
        );
        
        // Sync immediately after creation to update cache
        try {
          await syncHarvesterScheduleVmBackups(cloud, insecure);
        } catch (e) {
           console.warn('Sync after create failed', e);
        }

        res.json({ message: '创建定时备份成功' });
      } catch (error: any) {
        res.status(500).json({ message: '创建定时备份失败', error: error.body || error.message });
      }
    },
  );

  router.patch(
    '/:id/resources/harvester/schedulevmbackups/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const payload = req.body; // Expects update fields
        
        await updateHarvesterScheduleVmBackup(
          {
            endpoint: cloud.endpoint,
            token: cloud.secretKey,
            insecure,
          } as any,
          namespace,
          name,
          payload
        );
        
        // Sync immediately after update to update cache
        try {
          await syncHarvesterScheduleVmBackups(cloud, insecure);
        } catch (e) {
           console.warn('Sync after update failed', e);
        }

        res.json({ message: '更新定时备份成功' });
      } catch (error: any) {
        res.status(500).json({ message: '更新定时备份失败', error: error.body || error.message });
      }
    },
  );

  router.put(
    '/:id/resources/harvester/schedulevmbackups/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const payload = req.body; // Expects update fields
        
        await updateHarvesterScheduleVmBackup(
          {
            endpoint: cloud.endpoint,
            token: cloud.secretKey,
            insecure,
          } as any,
          namespace,
          name,
          payload
        );
        
        // Sync immediately after update to update cache
        try {
          await syncHarvesterScheduleVmBackups(cloud, insecure);
        } catch (e) {
           console.warn('Sync after update failed', e);
        }

        res.json({ message: '更新定时备份成功' });
      } catch (error: any) {
        res.status(500).json({ message: '更新定时备份失败', error: error.body || error.message });
      }
    },
  );

  router.delete(
    '/:id/resources/harvester/schedulevmbackups/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        await deleteHarvesterScheduleVmBackup(
          {
            endpoint: cloud.endpoint,
            token: cloud.secretKey,
            insecure,
          } as any,
          namespace,
          name
        );
        
        // Sync immediately after delete to update cache
        try {
          await syncHarvesterScheduleVmBackups(cloud, insecure);
        } catch (e) {
           console.warn('Sync after delete failed', e);
        }

        res.json({ message: '删除定时备份成功' });
      } catch (error: any) {
        res.status(500).json({ message: '删除定时备份失败', error: error.body || error.message });
      }
    },
  );

  // Create VM Backup/Snapshot
  router.post(
    '/:id/resources/harvester/virtualmachinebackups/:namespace',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const { name, vmName, type, alias } = req.body;
        if (!name || !vmName || !type) {
            return res.status(400).json({ message: 'Missing required fields: name, vmName, type' });
        }
        if (type !== 'backup' && type !== 'snapshot') {
            return res.status(400).json({ message: 'Invalid type: must be "backup" or "snapshot"' });
        }

        const result = await createHarvesterVirtualMachineBackup(
          { endpoint: cloud.endpoint, token: cloud.secretKey, insecure } as any,
          namespace,
          { name, vmName, type, alias }
        );

        // Sync immediately to update cache
        try {
           await syncHarvesterBackups(cloud, insecure);
        } catch (e) {
            console.warn('Sync after create failed', e);
        }

        res.json({ message: '创建成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '创建失败', error: error.body || error.message });
      }
    },
  );

  // Delete VM Backup/Snapshot
  router.delete(
    '/:id/resources/harvester/backups/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const result = await deleteHarvesterVirtualMachineBackup(
          { endpoint: cloud.endpoint, token: cloud.secretKey, insecure } as any,
          namespace,
          name
        );

        // Sync immediately to update cache
        try {
           await syncHarvesterBackups(cloud, insecure);
        } catch (e) {
            console.warn('Sync after delete failed', e);
        }

        res.json({ message: '删除成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '删除失败', error: error.body || error.message });
      }
    },
  );

  // Create VM Restore
  router.post(
    '/:id/resources/harvester/virtualmachinerestores/:namespace',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const result = await createHarvesterVirtualMachineRestore(
          { endpoint: cloud.endpoint, token: cloud.secretKey, insecure } as any,
          namespace,
          req.body
        );

        res.json({ message: '创建恢复任务成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '创建恢复任务失败', error: error.body || error.message });
      }
    },
  );

  // ==================================================================================
  // SSH Keys (Inventory Cache First)
  // ==================================================================================
  router.get(
    '/:id/resources/harvester/sshkeys',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterSshKeyInventory);
        
        let whereCondition: any = { cloudId: id };
        const isTenant = (req.user as any)?.role === 'tenant' || ((req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device');
        if (isTenant) {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const us = await userSpaceRepo.findOne({
            where: { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' },
          });
          if (!us) return res.json({ message: '查询成功', data: { items: [] } });
          if (us.namespace) whereCondition.namespace = us.namespace;
        }

        const count = await repo.count({ where: whereCondition });
        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterSshKeys(cloud, insecure);
          } catch (e: any) {
             console.warn('Sync SSH Keys failed, falling back to empty/stale', e);
             if (count === 0) throw e;
          }
        }

        const items = await repo.find({ where: whereCondition });
        const list = items.map(i => i.rawData);
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        res.status(500).json({ message: '查询SSH密钥失败', error: error.message });
      }
    },
  );

  // ==================================================================================
  // Cloud Inits (Inventory Cache First)
  // ==================================================================================
  router.get(
    '/:id/resources/harvester/cloud-inits',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterCloudInitInventory);
        
        let whereCondition: any = { cloudId: id };
        const isTenant = (req.user as any)?.role === 'tenant' || ((req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device');
        if (isTenant) {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const us = await userSpaceRepo.findOne({
            where: { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' },
          });
          if (!us) return res.json({ message: '查询成功', data: { items: [] } });
          if (us.namespace) whereCondition.namespace = us.namespace;
        }

        const count = await repo.count({ where: whereCondition });
        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterCloudInits(cloud, insecure);
          } catch (e: any) {
             console.warn('Sync Cloud Inits failed, falling back to empty/stale', e);
             if (count === 0) throw e;
          }
        }

        const items = await repo.find({ where: whereCondition });
        const list = items.map(i => i.rawData);
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        res.status(500).json({ message: '查询Cloud Init模板失败', error: error.message });
      }
    },
  );

  // ==================================================================================
  // Ingresses (Inventory Cache First)
  // ==================================================================================
  router.get(
    '/:id/resources/harvester/ingresses',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(KubeOvnIngressInventory);
        
        let whereCondition: any = { cloudId: id };
        const isTenant = (req.user as any)?.role === 'tenant' || ((req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device');
        if (isTenant) {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const us = await userSpaceRepo.findOne({
            where: { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' },
          });
          if (!us) return res.json({ message: '查询成功', data: { items: [] } });
          if (us.namespace) whereCondition.namespace = us.namespace;
        }

        const count = await repo.count({ where: whereCondition });
        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterIngresses(cloud, insecure);
          } catch (e: any) {
             console.warn('Sync Ingresses failed, falling back to empty/stale', e);
             if (count === 0) throw e;
          }
        }

        const items = await repo.find({ where: whereCondition });
        const list = items.map(i => i.rawData);
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        res.status(500).json({ message: '查询路由(Ingress)失败', error: error.message });
      }
    },
  );

  // ==================================================================================
  // Templates (VM Templates)
  // ==================================================================================
  /**
   * [GET] /:id/resources/harvester/templates
   * 获取虚拟机模板列表
   * 
   * 实体: HarvesterTemplateInventory
   * 策略: Inventory Cache First + Sync Fallback
   * 描述: 返回 Harvester 集群中的 VirtualMachineTemplates。
   */
  router.get(
    '/:id/resources/harvester/templates',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const repo = AppDataSource.getRepository(HarvesterTemplateInventory);
        
        // Tenant Isolation: Filter by UserSpace Namespace
        let whereCondition: any = { cloudId: id };
        const isTenantUser = (req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device';
        const isTenantRole = (req.user as any)?.role === 'tenant';
        const isTenant = isTenantUser || isTenantRole;

        if (isTenant) {
          const tenantId = (req as any).user.tenantId;
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          // Query: tenantId AND cloudId AND (organizationId = userOrgId OR organizationId IS NULL)
          const matches = await userSpaceRepo.find({
             where: [
                { tenantId, cloudId: id, status: 'active', organizationId: (req.user as any).organizationId },
                { tenantId, cloudId: id, status: 'active', organizationId: null }
             ]
          });
          const us = matches.find(m => m.organizationId === (req.user as any).organizationId) || matches[0];

          if (!us) return res.json({ message: '查询成功', data: { items: [] } });
          
          if (us.namespace) {
             whereCondition = [
                { cloudId: id, namespace: us.namespace },
                { cloudId: id, namespace: 'cloud-public' },
                { cloudId: id, namespace: 'harvester-public' }
             ];
          } else {
             whereCondition = [
                { cloudId: id, namespace: 'cloud-public' },
                { cloudId: id, namespace: 'harvester-public' }
             ];
          }
        }

        const count = await repo.count({ where: whereCondition });
        
        // Sync fallback logic
        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterTemplates(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync Templates failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        }
        
        const items = await repo.find({ where: whereCondition });
        const list = items.map(i => i.rawData);
        
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询模板失败', error: error.message });
      }
    },
  );
};