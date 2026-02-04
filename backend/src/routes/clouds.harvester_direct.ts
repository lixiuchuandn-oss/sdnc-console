import { Router, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Cloud } from '../entities/Cloud';
import { UserSpace } from '../entities/UserSpace';
import { HarvesterNamespaceInventory } from '../entities/harvester/HarvesterNamespaceInventory';
import { syncHarvesterNamespaces } from '../services/clouds/harvester/syncInventory';
import {
  listHarvesterVMsStandard,
  listHarvesterAvailableVolumesStandard,
  listKubevirtVMsRaw,
  listKubevirtVMIsRaw,
  listKubevirtVMsRawWithMeta,
  listKubevirtVMIsRawWithMeta,
  harvesterStartVM,
  harvesterStopVM,
  harvesterRebootVM,
  harvesterSoftRebootVM,
  harvesterPauseVM,
  harvesterUnpauseVM,
  harvesterDeleteVM,
  listKubeOvnVpcs,
  listKubeOvnSubnets,
  listHarvesterVolumesStandard,
  listHarvesterImagesStandard,
  listHarvesterNodesStandard,
  listHarvesterSystemPodsStandard,
  listHarvesterGpuResources,
  listHarvesterUsbResources,
  listHarvesterStorageClassesStandard,
  createHarvesterNamespace,
  deleteHarvesterNamespace,
  getHarvesterNamespaceRaw,
  createHarvesterPVCVolume,
  listHarvesterPVCRaw,
  listHarvesterImagesRaw,
  createVolumeSnapshot,
  exportImageFromPVC,
  clonePVC,
  updatePVCSpec,
  createHarvesterVM,
  updateHarvesterVMSpec,
  getHarvesterVmVncUrl,
  harvesterAddVolumeToVM,
  harvesterRemoveVolumeFromVM,
  getHarvesterCapabilities,
} from '../services/clouds/harvester/client';
import { listHarvesterLoadBalancers } from '../services/clouds/harvester/network';
import { getJsonOnce, requestJson, watchJsonStream } from '../services/clouds/harvester/utils';

// Define local interfaces for type safety
interface KubeEvent {
  type: 'ADDED' | 'MODIFIED' | 'DELETED' | 'ERROR';
  object: any;
}

const isNamespaceAllowed = (allowedNamespacesStr: string | undefined, targetNamespace: string | undefined): boolean => {
    if (!allowedNamespacesStr) return false;
    if (!targetNamespace) return false;
    const allowed = allowedNamespacesStr.split(',').map(s => s.trim().toLowerCase());
    return allowed.includes(targetNamespace.toLowerCase());
};

/**
 * ==================================================================================
 * Harvester Cloud Resource Routes (Direct Connection Mode)
 * ==================================================================================
 * Re-implementation of Harvester routes using a pure "Direct API" strategy.
 * This bypasses the local Inventory database for read operations, ensuring
 * real-time data consistency with the Harvester cluster.
 * 
 * Design:
 * - Read Operations: Proxy requests to Harvester API -> Format -> Response
 * - Write Operations: Proxy requests to Harvester API -> Response
 * - No dependency on *Inventory entities.
 */

const checkTenantAccess = async (req: any, cloudId: string): Promise<{ allowed: boolean; namespace?: string; isTenant?: boolean }> => {
    // Check if user is a tenant user (excluding device roles)
    const isTenantUser = (req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device';
    const isTenantRole = req.user?.role === 'tenant';
    const isTenant = !!(isTenantUser || isTenantRole);

    if (!isTenant) return { allowed: true, isTenant: false };

    // Fetch allowed namespaces from UserSpace (Tenant + Organization scope)
    const userSpaceRepo = AppDataSource.getRepository(UserSpace);
    const matches = await userSpaceRepo.find({
        where: [
            { tenantId: (req.user as any).tenantId, cloudId, status: 'active', organizationId: (req.user as any).organizationId },
            { tenantId: (req.user as any).tenantId, cloudId, status: 'active', organizationId: null }
        ],
        select: ['namespace']
    });
    
    const uniqueNamespaces = new Set<string>();
    matches.forEach(m => {
        if (m.namespace) {
            m.namespace.split(',').forEach(ns => {
                const trimmed = ns.trim();
                if (trimmed) uniqueNamespaces.add(trimmed);
            });
        }
    });
    
    const finalNamespace = Array.from(uniqueNamespaces).join(',');

    if (uniqueNamespaces.size === 0) return { allowed: false, isTenant: true };
    return { allowed: true, namespace: finalNamespace, isTenant: true };
};

const resolveTenantVmId = async (
  tenantNamespace: string | undefined, 
  instanceId: string, 
  cloud: any,
  isTenant: boolean = false
): Promise<{ resolvedId: string, error?: { status: number, message: string } }> => {
    // If tenant but no namespace, deny access
    if (isTenant && !tenantNamespace) {
        return { resolvedId: '', error: { status: 403, message: 'Access denied: Tenant has no assigned namespace' } };
    }

    // If not a tenant (no namespace restriction), just return as is (but careful if it lacks namespace)
    if (!tenantNamespace) return { resolvedId: instanceId };
    
    // If ID is already namespaced "namespace/name"
    if (instanceId.includes('/') || instanceId.includes(':')) {
        const [ns] = instanceId.split(/[/:/]/);
        const validNamespaces = tenantNamespace ? tenantNamespace.split(',').map(s => s.trim()) : [];
        if (!validNamespaces.includes(ns)) return { resolvedId: '', error: { status: 403, message: 'Access denied to VM in other namespace' } };
        return { resolvedId: instanceId };
    }
    
    // If ID is just a name or UID, we need to resolve it or force namespace
    // Since we are tenant restricted, we can assume the VM MUST be in tenantNamespace.
    // However, Harvester API usually expects "namespace/name". 
    // If instanceId is a name, we prepend namespace.
    // If instanceId is a UID, we might need to find it, but usually frontend sends namespace/name or just name.
    
    // Optimistic approach: Assume instanceId is the NAME if it has no slashes
    // Use the first assigned namespace as default
    const primaryNs = tenantNamespace ? tenantNamespace.split(',')[0].trim() : '';
    return { resolvedId: `${primaryNs}/${instanceId}` };
};

const fetchCloudOr404 = async (id: string, res: Response) => {
  const repo = AppDataSource.getRepository(Cloud);
  const cloud = await repo.findOne({ where: { id } });
  if (!cloud) {
    res.status(404).json({ message: '云资源不存在' });
    return null;
  }
  return cloud;
};

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

// Helper to resolve VM status
const resolveVMStatus = (vm: any, vmi: any): string => {
  let status = 'Unknown';

  // 1. Priority: Harvester/KubeVirt printableStatus (Rich status: Starting, Stopping, Migrating...)
  if (vm?.status?.printableStatus) {
      status = vm.status.printableStatus;
  }
  
  // 2. Fallback: VMI Phase
  else if (vmi?.status?.phase) {
      status = vmi.status.phase;
  }
  
  // 3. Fallback: Spec
  else if (vm?.spec?.running === false || vm?.spec?.runStrategy === 'Halted') {
      status = 'Stopped';
  }
  
  else if (vm?.spec?.running === true || vm?.spec?.runStrategy === 'Always' || vm?.spec?.runStrategy === 'RerunOnFailure') {
      // If supposed to be running but no VMI and no printableStatus -> likely Starting
      status = 'Starting'; 
  }

  // 4. Manual Translations (User defined)
  if (status.toLowerCase() === 'errorunschedulable') {
      return '待调度';
  }
  if (status.toLowerCase() === 'terminating') {
      return '删除中';
  }

  return status;
};

export const registerHarvesterDirectRoutes = (router: Router, checkAdminPermission: any) => {
  // DEBUG: Check tenant access for a cloud
  router.get(
    '/:id/debug-access',
    async (req: any, res: Response) => {
        try {
            const { id } = req.params;
            const access = await checkTenantAccess(req, id);
            res.json({
                user: {
                    id: req.user?.id,
                    username: req.user?.username,
                    role: req.user?.role,
                    tenantId: req.user?.tenantId,
                    organizationId: req.user?.organizationId
                },
                access,
                query: {
                    cloudId: id
                }
            });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    }
  );

  // ==================================================================================
  // Capabilities
  // ==================================================================================
  router.get(
    '/:id/resources/harvester/capabilities',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { allowed } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;

        const data = await getHarvesterCapabilities({
            endpoint: cloud.endpoint,
            token: cloud.secretKey || '',
            insecure: !!(cloud.config as any)?.ignoreTls,
        });
        
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询Capabilities失败', error: error.body || error.message });
      }
    },
  );

  // ==================================================================================
  // VPCs (Kube-OVN)
  // ==================================================================================
  router.get(
    '/:id/resources/vpcs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        console.log('[SSE] Request received:', req.originalUrl);
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const items = await listKubeOvnVpcs({
            endpoint: cloud.endpoint,
            token: cloud.secretKey || '',
            insecure
        });
        
        // Add namespace filtering for tenant users
        let filteredItems = items;
        if (isTenant) {
            filteredItems = tenantNamespace 
                ? items.filter((item: any) => {
                    // Check if VPC is bound to tenant namespace via spec.namespaces
                    const allowedNamespaces = item.spec?.namespaces || [];
                    const validNamespaces = tenantNamespace.split(',').map(s => s.trim());
                    // Also check if VPC is default (if policy allows) or specifically assigned
                    return Array.isArray(allowedNamespaces) && allowedNamespaces.some(ns => validNamespaces.includes(ns));
                })
                : [];
        } else if (tenantNamespace) {
            filteredItems = items.filter((item: any) => {
                 const allowedNamespaces = item.spec?.namespaces || [];
                 const validNamespaces = tenantNamespace.split(',').map(s => s.trim());
                 return Array.isArray(allowedNamespaces) && allowedNamespaces.some(ns => validNamespaces.includes(ns));
            });
        }

        res.json({ message: '查询成功', data: { items: filteredItems } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询VPC失败', error: error.body || error.message });
      }
    },
  );

  // ==================================================================================
  // Subnets (Kube-OVN)
  // ==================================================================================
  router.get(
    '/:id/resources/subnets',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        console.log('[SSE] Stream connection attempt:', req.originalUrl);
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

        const { vpcId } = req.query as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
            const u = new URL(base);
            origin = `${u.protocol}//${u.host}`;
        } catch {
            origin = base.replace(/\/v[0-9].*$/, '');
        }
        const url = `${origin}/apis/kubeovn.io/v1/subnets`;
        
        let json: any = null;
        try {
            json = await getJsonOnce(url, cloud.secretKey || '', insecure);
        } catch(e) {
            throw e;
        }

        const allItems = Array.isArray(json?.items) ? json?.items : (Array.isArray(json?.data) ? json?.data : []);

        let items = allItems;
        if (vpcId) {
          items = allItems.filter((s: any) => {
             const specVpc = s?.spec?.vpc || '';
             const metadataVpc = s?.metadata?.labels?.['kube-ovn/vpc'];
             return (specVpc === vpcId) || (metadataVpc === vpcId);
          });
        }

        // Add namespace filtering for tenant users
        if (isTenant) {
            if (tenantNamespace) {
                items = items.filter((item: any) => {
                    // Subnets are cluster-scoped but bound to namespaces via spec.namespaces
                    const allowedNamespaces = item.spec?.namespaces || [];
                    const validNamespaces = tenantNamespace.split(',').map(s => s.trim());
                    return Array.isArray(allowedNamespaces) && allowedNamespaces.some(ns => validNamespaces.includes(ns));
                });
            } else {
                items = [];
            }
        } else if (tenantNamespace) {
            items = items.filter((item: any) => {
                const allowedNamespaces = item.spec?.namespaces || [];
                const validNamespaces = tenantNamespace.split(',').map(s => s.trim());
                return Array.isArray(allowedNamespaces) && allowedNamespaces.some(ns => validNamespaces.includes(ns));
            });
        }
        
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询子网失败', error: error.body || error.message });
      }
    },
  );

  router.post(
    '/:id/resources/subnets',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { allowed } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

        const { name, vpc, cidrBlock, gateway, protocol, excludeIps, provider, vlan, gatewayType, namespaces, nat, allowDhcp, disableGatewayCheck } = req.body;

        if (!name || !cidrBlock) {
            res.status(400).json({ message: '缺少必要参数: name, cidrBlock' });
            return;
        }

        if (excludeIps && Array.isArray(excludeIps)) {
            const valid = excludeIps.every((ip: any) => typeof ip === 'string' && ip.trim().length > 0);
            if (!valid) {
                 res.status(400).json({ message: 'excludeIps 格式错误，应为非空字符串数组' });
                 return;
            }
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
            const u = new URL(base);
            origin = `${u.protocol}//${u.host}`;
        } catch {
            origin = base.replace(/\/v[0-9].*$/, '');
        }

        const url = `${origin}/apis/kubeovn.io/v1/subnets`;

        // ----------------------------------------------------------------------
        // Step 1: Ensure NetworkAttachmentDefinition (NAD) exists
        // Harvester requires a NAD for every Subnet, and the provider string
        // must follow the format: <NAD_NAME>.<NAD_NAMESPACE>.ovn
        // ----------------------------------------------------------------------
        const nadName = name;
        const nadNamespace = 'default'; // Default namespace for NADs
        const fullProvider = `${nadName}.${nadNamespace}.ovn`;
        
        const nadUrl = `${origin}/apis/k8s.cni.cncf.io/v1/namespaces/${nadNamespace}/network-attachment-definitions`;
        const nadPayload = {
            apiVersion: "k8s.cni.cncf.io/v1",
            kind: "NetworkAttachmentDefinition",
            metadata: {
                name: nadName,
                namespace: nadNamespace
            },
            spec: {
                config: JSON.stringify({
                    cniVersion: "0.3.1",
                    name: nadName,
                    type: "kube-ovn",
                    server_socket: "/run/openvswitch/kube-ovn-daemon.sock",
                    provider: fullProvider
                })
            }
        };

        try {
            // Try to create NAD first. Ignore if it already exists (409).
            await requestJson('POST', nadUrl, cloud.secretKey || '', insecure, nadPayload);
        } catch (nadError: any) {
            // If error is NOT "AlreadyExists" (409), log it but proceed (or throw?)
            // Usually we proceed and let Subnet creation fail if NAD is truly missing/broken.
            const isConflict = nadError?.response?.status === 409 || nadError?.status === 409 || (nadError?.message || '').includes('AlreadyExists');
            if (!isConflict) {
                 console.warn('[CreateSubnet] Warning: Failed to create NAD, but will attempt Subnet creation anyway.', nadError.message);
            }
        }

        // ----------------------------------------------------------------------
        // Step 2: Create Subnet
        // ----------------------------------------------------------------------
        const payload = {
            apiVersion: 'kubeovn.io/v1',
            kind: 'Subnet',
            metadata: {
                name: name
            },
            spec: {
                vpc: vpc,
                cidrBlock,
                gateway,
                protocol: protocol || 'IPv4',
                ...(excludeIps && Array.isArray(excludeIps) ? { excludeIps } : {}),
                ...(namespaces && Array.isArray(namespaces) ? { namespaces } : {}),
                provider: fullProvider, // Use the strict 3-part provider format
                ...(vlan ? { vlan } : {}),
                ...(gatewayType ? { gatewayType } : {}),
                ...(disableGatewayCheck !== undefined ? { disableGatewayCheck } : {}),
                natOutgoing: nat !== undefined ? nat : false,
                enableDhcp: allowDhcp !== undefined ? allowDhcp : true
            }
        };

        const result = await requestJson('POST', url, cloud.secretKey || '', insecure, payload);
        res.json({ message: '创建子网成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        console.error('[CreateSubnet] Failed:', error);
        res.status(500).json({ 
            message: '创建子网失败', 
            error: error.message,
            details: error.body || error.response || error.toString(),
            debug_payload: req.body // DEBUG: Return received payload to frontend
        });
      }
    },
  );

  router.delete(
    '/:id/resources/subnets/:name',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, name } = req.params;
        const { allowed } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
            const u = new URL(base);
            origin = `${u.protocol}//${u.host}`;
        } catch {
            origin = base.replace(/\/v[0-9].*$/, '');
        }

        const url = `${origin}/apis/kubeovn.io/v1/subnets/${name}`;
        
        await requestJson('DELETE', url, cloud.secretKey || '', insecure);
        res.json({ message: '删除子网成功' });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '删除子网失败', error: error.body || error.message });
      }
    },
  );

  // ==================================================================================
  // PersistentVolumeClaims (PVC)
  // ==================================================================================
  router.get(
    '/:id/resources/pvcs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        let items = await listHarvesterPVCRaw({
            endpoint: cloud.endpoint,
            token: cloud.secretKey || '',
            insecure
        } as any);

        if (isTenant) {
            if (tenantNamespace) {
                items = items.filter((i: any) => isNamespaceAllowed(tenantNamespace, i.metadata?.namespace));
            } else {
                items = [];
            }
        } else if (tenantNamespace) {
            items = items.filter((i: any) => isNamespaceAllowed(tenantNamespace, i.metadata?.namespace));
        }
        
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询PVC失败', error: error.body || error.message });
      }
    },
  );

  // ==================================================================================
  // VM Images (Raw)
  // ==================================================================================
  router.get(
    '/:id/resources/images',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

        const { namespace } = req.query as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        // If tenant has no namespace, return empty list immediately
        if (isTenant && !tenantNamespace) {
             return res.json({ message: '查询成功', data: { items: [] } });
        }

        let itemsRaw: any[] = [];

        if (isTenant && tenantNamespace) {
             console.log(`[Images] Tenant request detected. Merged Namespace: ${tenantNamespace}`);
             // Tenant: Fetch only allowed namespaces (e.g. "ns1,cloud-public")
             // This avoids listing all images at cluster scope which might fail or be slow
             const namespaces = tenantNamespace.split(',').map(s => s.trim()).filter(Boolean);
             const uniqueNamespaces = Array.from(new Set(namespaces)); // Deduplicate
             console.log(`[Images] Concurrent fetching for namespaces:`, uniqueNamespaces);
             
             const results = await Promise.all(uniqueNamespaces.map(ns => 
                 listHarvesterImagesRaw({
                    endpoint: cloud.endpoint,
                    token: cloud.secretKey || '',
                    insecure,
                    namespace: ns
                 } as any).then(res => {
                    console.log(`[Images] Fetched ${res.length} images from namespace: ${ns}`);
                    return res;
                 }).catch(err => {
                     console.warn(`Failed to list images in namespace ${ns}:`, err.message);
                     return [];
                 })
             ));
             itemsRaw = results.flat();
             console.log(`[Images] Total raw items before filtering: ${itemsRaw.length}`);
        } else {
             // Admin: Fetch all or specific namespace from query
             itemsRaw = await listHarvesterImagesRaw({
                endpoint: cloud.endpoint,
                token: cloud.secretKey || '',
                insecure,
                namespace: (namespace as string) || ''
             } as any);
        }

        let items = itemsRaw;
        if (isTenant) {
             // Secondary filter to ensure safety (though we fetched specifically)
             if (tenantNamespace) {
                 items = items.filter((i: any) => {
                    const ok = isNamespaceAllowed(tenantNamespace, i.metadata?.namespace);
                    if (!ok) console.log(`[Images] Filtered out item: ${i.metadata?.name} in namespace ${i.metadata?.namespace}`);
                    return ok;
                 });
             }
        } else if (tenantNamespace) {
             items = items.filter((i: any) => isNamespaceAllowed(tenantNamespace, i.metadata?.namespace));
        } else if (namespace) {
             // If query param namespace is provided (admin only or filtered above)
             items = items.filter((i: any) => i.metadata?.namespace === namespace);
        }
        
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询镜像失败', error: error.body || error.message });
      }
    },
  );

  // ==================================================================================
  // NADs (Network Attachment Definitions)
  // ==================================================================================
  router.get(
    '/:id/resources/nads',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
            const u = new URL(base);
            origin = `${u.protocol}//${u.host}`;
        } catch {
            origin = base.replace(/\/v[0-9].*$/, '');
        }
        const url = `${origin}/v1/harvester/k8s.cni.cncf.io.network-attachment-definitions`;
        
        let json: any = null;
        try {
            json = await getJsonOnce(url, cloud.secretKey || '', insecure);
        } catch(e) {
            throw e;
        }

        const rawItems = Array.isArray(json?.data) ? json?.data : (Array.isArray(json?.items) ? json?.items : []);
        let items = rawItems;
        if (isTenant) {
            if (tenantNamespace) {
                items = items.filter((i: any) => isNamespaceAllowed(tenantNamespace, i.metadata?.namespace));
            } else {
                items = [];
            }
        } else if (tenantNamespace) {
            items = items.filter((i: any) => isNamespaceAllowed(tenantNamespace, i.metadata?.namespace));
        }
        
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询网络失败', error: error.body || error.message });
      }
    },
  );

  // ==================================================================================
  // Harvester Load Balancers (Flat Network)
  // ==================================================================================
  router.get(
    '/:id/resources/harvester-loadbalancers',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const rawItems = await listHarvesterLoadBalancers({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        });

        let items = rawItems;
        if (isTenant) {
            if (tenantNamespace) {
                items = items.filter((i: any) => isNamespaceAllowed(tenantNamespace, i.metadata?.namespace));
            } else {
                items = [];
            }
        } else if (tenantNamespace) {
            items = items.filter((i: any) => isNamespaceAllowed(tenantNamespace, i.metadata?.namespace));
        }
        
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询 Harvester 负载均衡失败', error: error.body || error.message });
      }
    },
  );

  // ==================================================================================
  // Switch LBRules (Load Balancer)
  // ==================================================================================
  router.get(
    '/:id/resources/switch-lbrules',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
            const u = new URL(base);
            origin = `${u.protocol}//${u.host}`;
        } catch {
            origin = base.replace(/\/v[0-9].*$/, '');
        }
        const url = `${origin}/apis/kubeovn.io/v1/switch-lbrules`;
        
        let json: any = null;
        try {
            json = await getJsonOnce(url, cloud.secretKey || '', insecure);
        } catch(e) {
            throw e;
        }

        const rawItems = Array.isArray(json?.items) ? json?.items : (Array.isArray(json?.data) ? json?.data : []);
        let items = rawItems;
        if (isTenant) {
            if (tenantNamespace) {
                items = items.filter((i: any) => isNamespaceAllowed(tenantNamespace, i.metadata?.namespace));
            } else {
                items = [];
            }
        } else if (tenantNamespace) {
            items = items.filter((i: any) => isNamespaceAllowed(tenantNamespace, i.metadata?.namespace));
        }
        
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询负载均衡规则失败', error: error.body || error.message });
      }
    },
  );

  // ==================================================================================
  // OvnEips (Elastic IP)
  // ==================================================================================
  router.get(
    '/:id/resources/ovneips',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
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
            `${origin}/apis/kubeovn.io/v1/ovneips`,
            `${origin}/apis/kubeovn.io/v1/ovn-eips`
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

        if (!json) {
            const s = Number((lastErr as any)?.status || 0);
            const m = String((lastErr as any)?.message || '').toLowerCase();
            // If 404 or Not Found, it means the CRD might not exist or no resources, return empty list gracefully
            if (s === 404 || m.includes('not found')) {
                res.json({ message: '查询成功', data: { items: [] } });
                return;
            }
            throw lastErr || new Error('Failed to fetch OvnEips');
        }

        const rawItems = Array.isArray(json?.items) ? json?.items : (Array.isArray(json?.data) ? json?.data : []);
        let items = rawItems;
        if (isTenant) {
            if (tenantNamespace) {
                items = items.filter((i: any) => isNamespaceAllowed(tenantNamespace, i.metadata?.namespace));
            } else {
                items = [];
            }
        } else if (tenantNamespace) {
            items = items.filter((i: any) => isNamespaceAllowed(tenantNamespace, i.metadata?.namespace));
        }
        
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询EIP失败', error: error.body || error.message });
      }
    },
  );

  router.post(
    '/:id/resources/ovneips',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { allowed } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

        const { name, externalSubnet, v4Ip, type } = req.body;

        if (!name || !externalSubnet) {
            res.status(400).json({ message: '缺少必要参数: name, externalSubnet' });
            return;
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
            const u = new URL(base);
            origin = `${u.protocol}//${u.host}`;
        } catch {
            origin = base.replace(/\/v[0-9].*$/, '');
        }

        // Try to find the correct API path first (although for creation we might need to be specific or try one)
        // Usually POST to the plural endpoint. We can try `ovneips` first.
        const url = `${origin}/apis/kubeovn.io/v1/ovneips`;

        const payload = {
            apiVersion: 'kubeovn.io/v1',
            kind: 'OvnEip',
            metadata: {
                name: name
            },
            spec: {
                externalSubnet: externalSubnet,
                type: type || 'nat',
                ...(v4Ip ? { v4Ip } : {})
            }
        };
        
        let json: any = null;
        try {
            json = await requestJson('POST', url, cloud.secretKey || '', insecure, payload);
        } catch(e: any) {
            // If 404, maybe try the other path? 
            // Writing retry logic for POST is a bit risky if it's not idempotent, but 404 usually means endpoint not found.
            if (e?.status === 404) {
                 const altUrl = `${origin}/apis/kubeovn.io/v1/ovn-eips`;
                 json = await requestJson('POST', altUrl, cloud.secretKey || '', insecure, payload);
            } else {
                throw e;
            }
        }
        
        res.json({ message: '创建成功', data: json });
      } catch (error: any) {
        if (res.headersSent) return;
        console.error('Create OvnEip error:', error);
        
        // Try to parse the error body if it's a JSON string
        let details = error.body;
        try {
            if (typeof details === 'string') {
                details = JSON.parse(details);
            }
        } catch (e) {
            // ignore parse error
        }

        res.status(500).json({ 
            message: '创建EIP失败', 
            error: error.message,
            details: details 
        });
      }
    },
  );

  // ==================================================================================
  // OvnFips (Floating IP)
  // ==================================================================================
  router.get(
    '/:id/resources/ovnfips',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
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
            `${origin}/apis/kubeovn.io/v1/ovnfips`,
            `${origin}/apis/kubeovn.io/v1/ovn-fips`
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

        if (!json) {
            const s = Number((lastErr as any)?.status || 0);
            const m = String((lastErr as any)?.message || '').toLowerCase();
            if (s === 404 || m.includes('not found')) {
                res.json({ message: '查询成功', data: { items: [] } });
                return;
            }
            throw lastErr || new Error('Failed to fetch OvnFips');
        }

        const rawItems = Array.isArray(json?.items) ? json?.items : (Array.isArray(json?.data) ? json?.data : []);
        let items = rawItems;
        if (isTenant) {
            if (tenantNamespace) {
                items = items.filter((i: any) => isNamespaceAllowed(tenantNamespace, i.metadata?.namespace));
            } else {
                items = [];
            }
        } else if (tenantNamespace) {
            items = items.filter((i: any) => isNamespaceAllowed(tenantNamespace, i.metadata?.namespace));
        }
        
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询FIP失败', error: error.body || error.message });
      }
    },
  );

  // ==================================================================================
  // OvnSnatRules (SNAT)
  // ==================================================================================
  router.get(
    '/:id/resources/ovnsnatrules',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
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
            `${origin}/apis/kubeovn.io/v1/ovnsnatrules`,
            `${origin}/apis/kubeovn.io/v1/ovn-snat-rules`
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

        if (!json) {
            const s = Number((lastErr as any)?.status || 0);
            const m = String((lastErr as any)?.message || '').toLowerCase();
            if (s === 404 || m.includes('not found')) {
                res.json({ message: '查询成功', data: { items: [] } });
                return;
            }
            throw lastErr || new Error('Failed to fetch OvnSnatRules');
        }

        const rawItems = Array.isArray(json?.items) ? json?.items : (Array.isArray(json?.data) ? json?.data : []);
        let items = rawItems;
        if (isTenant) {
            if (tenantNamespace) {
                items = items.filter((i: any) => isNamespaceAllowed(tenantNamespace, i.metadata?.namespace));
            } else {
                items = [];
            }
        } else if (tenantNamespace) {
            items = items.filter((i: any) => isNamespaceAllowed(tenantNamespace, i.metadata?.namespace));
        }
        
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询SNAT规则失败', error: error.body || error.message });
      }
    },
  );

  // ==================================================================================
  // OvnDnatRules (DNAT)
  // ==================================================================================
  router.get(
    '/:id/resources/ovndnatrules',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
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
            `${origin}/apis/kubeovn.io/v1/ovndnatrules`,
            `${origin}/apis/kubeovn.io/v1/ovn-dnat-rules`
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

        if (!json) {
            const s = Number((lastErr as any)?.status || 0);
            const m = String((lastErr as any)?.message || '').toLowerCase();
            if (s === 404 || m.includes('not found')) {
                res.json({ message: '查询成功', data: { items: [] } });
                return;
            }
            throw lastErr || new Error('Failed to fetch OvnDnatRules');
        }

        const rawItems = Array.isArray(json?.items) ? json?.items : (Array.isArray(json?.data) ? json?.data : []);
        let items = rawItems;
        if (isTenant) {
            if (tenantNamespace) {
                items = items.filter((i: any) => isNamespaceAllowed(tenantNamespace, i.metadata?.namespace));
            } else {
                items = [];
            }
        } else if (tenantNamespace) {
            items = items.filter((i: any) => isNamespaceAllowed(tenantNamespace, i.metadata?.namespace));
        }
        
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询DNAT规则失败', error: error.body || error.message });
      }
    },
  );

  // ==================================================================================
  // ECS (VirtualMachines)
  // ==================================================================================
  router.get(
    '/:id/resources/ecs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const [vmsRaw, vmisRaw] = await Promise.all([
          listKubevirtVMsRaw({
            endpoint: cloud.endpoint,
            token: cloud.secretKey,
            insecure,
          } as any).catch(err => {
            console.warn('[HarvesterDirect] VMs fetch failed:', err.message);
            return [];
          }),
          listKubevirtVMIsRaw({
            endpoint: cloud.endpoint,
            token: cloud.secretKey,
            insecure,
          } as any).catch(err => {
            console.warn('[HarvesterDirect] VMIs fetch failed:', err.message);
            return [];
          }),
        ]);

        // Map VMIs for O(1) lookup
        const vmiMap = new Map<string, any>();
        if (Array.isArray(vmisRaw)) {
          vmisRaw.forEach((v: any) => {
            if (v?.metadata?.name && v?.metadata?.namespace) {
              // Namespace Filtering for VMIs
              if (isTenant) {
                 if (tenantNamespace) {
                    if (!isNamespaceAllowed(tenantNamespace, v.metadata.namespace)) return;
                 } else {
                    return; // Tenant without namespace sees nothing
                 }
              } else if (tenantNamespace && !isNamespaceAllowed(tenantNamespace, v.metadata.namespace)) {
                 return;
              }
              vmiMap.set(`${v.metadata.namespace}/${v.metadata.name}`, v);
            }
          });
        }

        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
            const u = new URL(base);
            origin = `${u.protocol}//${u.host}`;
        } catch {
            origin = base.replace(/\/v[0-9].*$/, '');
        }

        let items = (Array.isArray(vmsRaw) ? vmsRaw : []);
        if (isTenant) {
            if (tenantNamespace) {
                items = items.filter((vm: any) => isNamespaceAllowed(tenantNamespace, vm.metadata?.namespace));
            } else {
                items = [];
            }
        } else if (tenantNamespace) {
            items = items.filter((vm: any) => isNamespaceAllowed(tenantNamespace, vm.metadata?.namespace));
        }
        
        items = items.map((vm: any) => {
          const vmi = vmiMap.get(`${vm.metadata?.namespace}/${vm.metadata?.name}`);
          
          const namespace = vm.metadata?.namespace || 'default';
          const name = vm.metadata?.name || '';
          const viewUrl = `${origin}/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachines/${name}`;

          // Use centralized status resolution
          if (!vm.status) vm.status = {};
          vm.status.printableStatus = resolveVMStatus(vm, vmi);

          // Return raw VM data combined with VMI data
          // Ensure we have a unique ID for the frontend table
          return {
            id: vm.metadata?.uid, // specific for frontend key
            links: { view: viewUrl },
            ...vm,
            vmi // Attach the raw VMI object as a field
          };
        });

        const capabilities = {
          isHarvester: true,
          supportsInstanceType: false,
          supportsZone: false,
          supportsVpc: true, // Harvester supports VPC via Kube-OVN
          supportsNetworkFusion: true,
          supportsMultus: true,
          supportsVnc: true,
        };

        res.json({ 
          message: '查询成功', 
          data: items,
          capabilities 
        });

      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询ECS失败', error: error.body || error.message });
      }
    },
  );

  /**
   * [GET] /:id/resources/ecs/stream
   * ECS Stream API (SSE)
   * Real-time VM status push via polling
   */
  router.get(
    '/:id/resources/ecs/stream',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        console.log('[SSE] Stream connection attempt:', req.originalUrl);
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();
        
        let closed = false;

        // Keep-alive ping (Moved to top to prevent timeout during initial fetch)
        const pingInterval = setInterval(() => {
            if (closed) {
                clearInterval(pingInterval);
                return;
            }
            try {
                res.write(': ping\n\n');
            } catch {}
        }, 3000);

        let activeWatchers: any[] = [];
        req.on('close', () => {
          closed = true;
          try { clearInterval(pingInterval); } catch {}
          activeWatchers.forEach(w => w.abort());
          console.log('[SSE] Connection closed');
        });
        
        // Cache for VM and VMI objects: key = `${namespace}/${name}`
        const vmCache = new Map<string, any>();
        const vmiCache = new Map<string, any>();
        
        // Send helper
        const send = (event: string, payload: any) => {
          if (closed) return;
          try {
            res.write(`event: ${event}\n`);
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
          } catch {}
        };

        // Helper to construct and send VM item based on cache
        const sendItem = (key: string, eventType: 'vm_created' | 'vm_status' = 'vm_status') => {
           const vm = vmCache.get(key);
           if (!vm) return; // If VM is gone, we handle it in DELETED event
           
           const vmi = vmiCache.get(key);
           
           // Use centralized status resolution
           if (!vm.status) vm.status = {};
           vm.status.printableStatus = resolveVMStatus(vm, vmi);

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
                _rv: `${vm.metadata?.resourceVersion || ''}|${vmi?.metadata?.resourceVersion || ''}`
           };
           
           if (eventType === 'vm_created') {
               send('vm_created', { item });
           } else {
               const status = String(item.status?.printableStatus || item.status?.phase || '');
               const nodeName = item.vmi?.status?.nodeName || item.status?.nodeName || '';
               const ips: string[] = [];
               if (item.vmi?.status?.interfaces) {
                 item.vmi.status.interfaces.forEach((i: any) => {
                   if (i.ipAddress) ips.push(i.ipAddress);
                   if (Array.isArray(i.ipAddresses)) ips.push(...i.ipAddresses);
                 });
               }
               send('vm_status', { iid: item.id, status, nodeName, ips: Array.from(new Set(ips)) });
           }
        };

        // Initialize with full list first (to populate cache and send initial list)
        // Then start watching.
        
        const init = async () => {
             // 1. Get Initial List with Meta (ResourceVersion & Correct URL)
            const [vmsResult, vmisResult] = await Promise.all([
              listKubevirtVMsRawWithMeta({
                endpoint: cloud.endpoint,
                token: cloud.secretKey,
                insecure,
              } as any).catch(() => null),
              listKubevirtVMIsRawWithMeta({
                endpoint: cloud.endpoint,
                token: cloud.secretKey,
                insecure,
              } as any).catch(() => null),
            ]);
            
            const initialItems: any[] = [];
            const vmsRaw = vmsResult?.items || [];
            const vmisRaw = vmisResult?.items || [];
            
            // Log initial fetch results for debug
            console.log(`[SSE] Initial fetch: ${vmsRaw.length} VMs, ${vmisRaw.length} VMIs. VM RV: ${vmsResult?.resourceVersion}, VMI RV: ${vmisResult?.resourceVersion}`);

            if (Array.isArray(vmsRaw)) {
                vmsRaw.forEach((vm: any) => {
                    if (isTenant) {
                        if (!isNamespaceAllowed(tenantNamespace, vm.metadata?.namespace)) return;
                    } else if (tenantNamespace && !isNamespaceAllowed(tenantNamespace, vm.metadata?.namespace)) return;

                    const key = `${vm.metadata?.namespace}/${vm.metadata?.name}`;
                    vmCache.set(key, vm);
                });
            }
            if (Array.isArray(vmisRaw)) {
                vmisRaw.forEach((vmi: any) => {
                    if (isTenant) {
                        if (!isNamespaceAllowed(tenantNamespace, vmi.metadata?.namespace)) return;
                    } else if (tenantNamespace && !isNamespaceAllowed(tenantNamespace, vmi.metadata?.namespace)) return;

                    const key = `${vmi.metadata?.namespace}/${vmi.metadata?.name}`;
                    vmiCache.set(key, vmi);
                });
            }

            // Send initial full list
            for (const key of vmCache.keys()) {
                 const vm = vmCache.get(key);
                 const vmi = vmiCache.get(key);
                 // ... (logic to build item, same as sendItem but returns it)
                 // Use centralized status resolution
                 if (!vm.status) vm.status = {};
                 vm.status.printableStatus = resolveVMStatus(vm, vmi);
                 const base = (cloud.endpoint || '').replace(/\/+$/, '');
                 let origin = base;
                 try {
                     const u = new URL(base);
                     origin = `${u.protocol}//${u.host}`;
                 } catch { origin = base.replace(/\/v[0-9].*$/, ''); }
                 const namespace = vm.metadata?.namespace || 'default';
                 const name = vm.metadata?.name || '';
                 const viewUrl = `${origin}/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachines/${name}`;
                 
                 initialItems.push({
                    id: vm.metadata?.uid, 
                    links: { view: viewUrl },
                    ...vm,
                    vmi,
                    _rv: `${vm.metadata?.resourceVersion || ''}|${vmi?.metadata?.resourceVersion || ''}`
                 });
            }
            send('vms', { items: initialItems });

            // 2. Start Watching
            const watchers: any[] = [];
            
            // Watch VMs
            if (vmsResult?.url) {
                const vmRv = vmsResult.resourceVersion || '0';
                // Ensure URL has no query params yet (it shouldn't from our helper)
                const vmUrl = `${vmsResult.url}?watch=true&resourceVersion=${vmRv}`;
                console.log(`[SSE] Starting VM watch on: ${vmUrl}`);
                
                const w1 = watchJsonStream(vmUrl, cloud.secretKey || '', insecure, (event) => {
                  if (closed) return;
                  console.log(`[SSE] VM Event: ${event.type} ${event.object?.metadata?.name}`);
                  const obj = event.object;
                  if (!obj || !obj.metadata) return;
                  if (isTenant) {
                      if (!isNamespaceAllowed(tenantNamespace, obj.metadata.namespace)) return;
                  } else if (tenantNamespace && !isNamespaceAllowed(tenantNamespace, obj.metadata.namespace)) return;
                  const key = `${obj.metadata.namespace}/${obj.metadata.name}`;
                  
                  if (event.type === 'DELETED') {
                      vmCache.delete(key);
                      send('vm_deleted', { iid: obj.metadata.uid });
                  } else {
                      vmCache.set(key, obj);
                      // Send vm_created event if it's a new VM (ADDED event)
                      // Otherwise send vm_status update (MODIFIED event)
                      const eventType = event.type === 'ADDED' ? 'vm_created' : 'vm_status';
                      sendItem(key, eventType);
                  }
                }, (err) => {
                  console.error('VM Watch Error:', err);
                  // Close SSE connection to force client reconnect
                  try { if (!res.writableEnded) res.end(); } catch {}
                });
                watchers.push(w1);
            } else {
                console.error('[SSE] Failed to determine VM Watch URL');
            }

            // Watch VMIs
            if (vmisResult?.url) {
                const vmiRv = vmisResult.resourceVersion || '0';
                const vmiUrl = `${vmisResult.url}?watch=true&resourceVersion=${vmiRv}`;
                console.log(`[SSE] Starting VMI watch on: ${vmiUrl}`);

                const w2 = watchJsonStream(vmiUrl, cloud.secretKey || '', insecure, (event) => {
                  if (closed) return;
                  console.log(`[SSE] VMI Event: ${event.type} ${event.object?.metadata?.name}`);
                  const obj = event.object;
                  if (!obj || !obj.metadata) return;
                  if (isTenant) {
                      if (!isNamespaceAllowed(tenantNamespace, obj.metadata.namespace)) return;
                  } else if (tenantNamespace && !isNamespaceAllowed(tenantNamespace, obj.metadata.namespace)) return;
                  const key = `${obj.metadata.namespace}/${obj.metadata.name}`;
                  
                  if (event.type === 'DELETED') {
                      vmiCache.delete(key);
                      if (vmCache.has(key)) {
                          sendItem(key);
                      }
                  } else {
                      vmiCache.set(key, obj);
                      if (vmCache.has(key)) {
                          sendItem(key);
                      }
                  }
                }, (err) => {
                  console.error('VMI Watch Error:', err);
                  // Close SSE connection to force client reconnect
                  try { if (!res.writableEnded) res.end(); } catch {}
                });
                watchers.push(w2);
            } else {
                console.error('[SSE] Failed to determine VMI Watch URL');
            }

            return watchers;
        };

        activeWatchers = await init();

      } catch (error: any) {
        try {
          console.error('[SSE] Main Error:', error);
          if (!res.headersSent) {
             res.status(500).json({ message: 'Stream error', error: error.message });
          } else {
             res.end();
          }
        } catch {}
      }
    },
  );

  // ==================================================================================
  // VM Operations (Start/Stop/Reboot/Delete/Update/VNC)
  // ==================================================================================
  
  router.post(
    '/:id/resources/ecs/:instanceId/start',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next)) return;
        
        const { resolvedId, error } = await resolveTenantVmId(tenantNamespace, instanceId, cloud);
        if (error) return res.status(error.status).json({ message: error.message });

        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const data = await harvesterStartVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          resolvedId,
        );
        res.json({ message: '启动成功', data });
      } catch (error: any) {
        res.status(500).json({ message: error.message || '启动实例失败', error: error.body || error.message });
      }
    },
  );

  router.post(
    '/:id/resources/ecs/:instanceId/stop',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { force } = (req.body || {}) as any;
        const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next)) return;
        
        const { resolvedId, error } = await resolveTenantVmId(tenantNamespace, instanceId, cloud);
        if (error) return res.status(error.status).json({ message: error.message });

        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const data = await harvesterStopVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          resolvedId,
          !!force,
        );
        res.json({ message: '停止成功', data });
      } catch (error: any) {
        res.status(500).json({ message: error.message || '停止实例失败', error: error.body || error.message });
      }
    },
  );

  router.post(
    '/:id/resources/ecs/:instanceId/reboot',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { force } = (req.body || {}) as any;
        const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next)) return;
        
        const { resolvedId, error } = await resolveTenantVmId(tenantNamespace, instanceId, cloud);
        if (error) return res.status(error.status).json({ message: error.message });

        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const data = await harvesterRebootVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          resolvedId,
          !!force,
        );
        res.json({ message: '重启成功', data });
      } catch (error: any) {
        res.status(500).json({ message: error.message || '重启实例失败', error: error.body || error.message });
      }
    },
  );

  router.post(
    '/:id/resources/ecs/:instanceId/softreboot',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next)) return;
        
        const { resolvedId, error } = await resolveTenantVmId(tenantNamespace, instanceId, cloud);
        if (error) return res.status(error.status).json({ message: error.message });

        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const data = await harvesterSoftRebootVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          resolvedId,
        );
        res.json({ message: '软重启成功', data });
      } catch (error: any) {
        res.status(500).json({ message: error.message || '软重启实例失败', error: error.body || error.message });
      }
    },
  );

  router.post(
    '/:id/resources/ecs/:instanceId/pause',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next)) return;
        
        const { resolvedId, error } = await resolveTenantVmId(tenantNamespace, instanceId, cloud);
        if (error) return res.status(error.status).json({ message: error.message });

        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const data = await harvesterPauseVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          resolvedId,
        );
        res.json({ message: '暂停成功', data });
      } catch (error: any) {
        res.status(500).json({ message: error.message || '暂停实例失败', error: error.body || error.message });
      }
    },
  );

  router.post(
    '/:id/resources/ecs/:instanceId/unpause',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next)) return;
        
        const { resolvedId, error } = await resolveTenantVmId(tenantNamespace, instanceId, cloud);
        if (error) return res.status(error.status).json({ message: error.message });

        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const data = await harvesterUnpauseVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          resolvedId,
        );
        res.json({ message: '恢复成功', data });
      } catch (error: any) {
        res.status(500).json({ message: error.message || '恢复实例失败', error: error.body || error.message });
      }
    },
  );

  router.delete(
    '/:id/resources/ecs/:instanceId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, instanceId } = req.params;
        const { deleteImage } = req.query;
        const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next)) return;
        
        const { resolvedId, error } = await resolveTenantVmId(tenantNamespace, instanceId, cloud);
        if (error) return res.status(error.status).json({ message: error.message });

        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const data = await harvesterDeleteVM(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          resolvedId,
          String(deleteImage) === 'true',
        );
        res.json({ message: '删除成功', data });
      } catch (error: any) {
        res.status(500).json({ message: error.message || '删除实例失败', error: error.body || error.message });
      }
    },
  );

  router.post(
    '/:id/resources/ecs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
        try {
            const { id } = req.params;
            const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
            if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

            const cloud = await fetchCloudOr404(id, res);
            if (!cloud) return;
            if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next)) return;
            const insecure = !!(cloud.config as any)?.ignoreTls;
            
            if (tenantNamespace) {
                const allowed = tenantNamespace.split(',').map(s => s.trim());
                
                if (req.body.namespace) {
                    if (!allowed.includes(req.body.namespace)) {
                        return res.status(403).json({ message: 'Access denied to this namespace' });
                    }
                } else {
                    // Default to first allowed namespace
                    req.body.namespace = allowed[0];
                }
            }

            const { namespace, ...payload } = req.body;
            
            const data = await createHarvesterVM(
                { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
                namespace || 'default',
                payload
            );
            res.json({ message: '创建成功', data });
        } catch (error: any) {
            res.status(500).json({ message: '创建实例失败', error: error.body || error.message });
        }
    }
  );

  router.put(
    '/:id/resources/ecs/:instanceId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
        try {
            const { id, instanceId } = req.params;
            const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
            if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

            const cloud = await fetchCloudOr404(id, res);
            if (!cloud) return;
            if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next)) return;
            const insecure = !!(cloud.config as any)?.ignoreTls;
            
            if (tenantNamespace) {
                const allowed = tenantNamespace.split(',').map(s => s.trim());
                if (req.body.namespace) {
                    if (!allowed.includes(req.body.namespace)) {
                        return res.status(403).json({ message: 'Access denied to this namespace' });
                    }
                } else {
                    // Try to infer from instanceId if possible
                    if (instanceId.includes('/')) {
                        const [ns] = instanceId.split('/');
                        if (allowed.includes(ns)) {
                            req.body.namespace = ns;
                        } else {
                            req.body.namespace = allowed[0];
                        }
                    } else {
                        req.body.namespace = allowed[0];
                    }
                }
            }

            const { namespace, ...spec } = req.body;
            
            // Validate instanceId ownership if strictly enforcing
            // If instanceId is just name, and we force namespace, it targets that namespace/name.
            // If instanceId is ns/name, we should validate it matches.
            if (tenantNamespace && instanceId.includes('/')) {
                const [ns] = instanceId.split('/');
                if (!isNamespaceAllowed(tenantNamespace, ns)) return res.status(403).json({ message: 'Access denied to VM in other namespace' });
            }

            // Clean instanceId if it has namespace prefix, because updateHarvesterVMSpec usually takes name + namespace arg
            const cleanName = instanceId.includes('/') ? instanceId.split('/')[1] : instanceId;

            const data = await updateHarvesterVMSpec(
                { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
                namespace || 'default',
                cleanName,
                spec
            );
            res.json({ message: '更新成功', data });
        } catch (error: any) {
            res.status(500).json({ message: '更新实例失败', error: error.body || error.message });
        }
    }
  );

  router.get(
    '/:id/resources/ecs/:instanceId/vnc-url',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
        try {
            const { id, instanceId } = req.params;
            const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
            if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

            const cloud = await fetchCloudOr404(id, res);
            if (!cloud) return;
            if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next)) return;
            const insecure = !!(cloud.config as any)?.ignoreTls;
            
            if (tenantNamespace) {
                req.query.namespace = tenantNamespace;
            }

            const { namespace } = req.query;
            
            const cleanName = instanceId.includes('/') ? instanceId.split('/')[1] : instanceId;

            const url = await getHarvesterVmVncUrl(
                { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
                String(namespace || 'default'),
                cleanName
            );
            res.json({ message: '获取成功', data: { url } });
        } catch (error: any) {
            res.status(500).json({ message: '获取VNC地址失败', error: error.body || error.message });
        }
    }
  );

  router.post(
    '/:id/resources/ecs/:instanceId/add-volume',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
        try {
            const { id, instanceId } = req.params;
            const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
            if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

            const cloud = await fetchCloudOr404(id, res);
            if (!cloud) return;
            if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next)) return;
            const insecure = !!(cloud.config as any)?.ignoreTls;
            
            const { resolvedId, error } = await resolveTenantVmId(tenantNamespace, instanceId, cloud);
            if (error) return res.status(error.status).json({ message: error.message });

            const data = await harvesterAddVolumeToVM(
                { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
                resolvedId,
                req.body
            );
            res.json({ message: '挂载成功', data });
        } catch (error: any) {
            res.status(500).json({ message: '挂载卷失败', error: error.body || error.message });
        }
    }
  );

  router.post(
    '/:id/resources/ecs/:instanceId/remove-volume',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
        try {
            const { id, instanceId } = req.params;
            const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
            if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

            const cloud = await fetchCloudOr404(id, res);
            if (!cloud) return;
            if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next)) return;
            const insecure = !!(cloud.config as any)?.ignoreTls;
            
            const { resolvedId, error } = await resolveTenantVmId(tenantNamespace, instanceId, cloud);
            if (error) return res.status(error.status).json({ message: error.message });

            const data = await harvesterRemoveVolumeFromVM(
                { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
                resolvedId,
                req.body
            );
            res.json({ message: '卸载成功', data });
        } catch (error: any) {
            res.status(500).json({ message: '卸载卷失败', error: error.body || error.message });
        }
    }
  );

  // ==================================================================================
  // Volume & Storage Operations
  // ==================================================================================
  router.get(
    '/:id/resources/harvester/volumes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const items = await listHarvesterVolumesStandard({
            endpoint: cloud.endpoint,
            token: cloud.secretKey || '',
            insecure
        } as any);

        // Frontend Response Formatting
        let filteredItems = items;
        if (isTenant) {
            filteredItems = tenantNamespace
                ? items.filter((v: any) => isNamespaceAllowed(tenantNamespace, v?.metadata?.namespace))
                : [];
        } else if (tenantNamespace) {
            filteredItems = items.filter((v: any) => isNamespaceAllowed(tenantNamespace, v?.metadata?.namespace));
        }

        const basic = filteredItems
          .map((v: any) => {
          const name = v?.metadata?.name || v?.name || '';
          const size = v?.spec?.size || v?.size || 0;
          const state = v?.status?.state || v?.state || 'Unknown';
          const k8s = v?.status?.kubernetesStatus || {};
          const namespace = k8s?.namespace || v?.metadata?.namespace || '';
          const pvcName = k8s?.pvcName || '';
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
                .filter(Boolean),
            ),
          );

          return {
            id: v?.id || v?.metadata?.uid || name,
            links: v?.links,
            name,
            size,
            state,
            namespace,
            pvcName,
            attachedTo,
            attached: attachedTo.length > 0,
            lastAttachedBy: k8s?.lastPVCRefAt || '',
            created: v?.metadata?.creationTimestamp || '',
            rawData: v,
          };
        });

        res.json({ message: '查询成功', data: { items: basic } });
      } catch (error: any) {
        res.status(500).json({ message: '查询卷列表失败', error: error.body || error.message });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/volumes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        if (tenantNamespace) {
            const allowed = tenantNamespace.split(',').map(s => s.trim());
            if (req.body.namespace) {
                if (!allowed.includes(req.body.namespace)) {
                    return res.status(403).json({ message: 'Access denied to this namespace' });
                }
            } else {
                req.body.namespace = allowed[0];
            }
        } else if (tenantNamespace) {
            req.body.namespace = tenantNamespace;
        }

        const data = await createHarvesterPVCVolume(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          req.body
        );
        res.json({ message: '创建成功', data });
      } catch (error: any) {
        res.status(500).json({ message: '创建卷失败', error: error.body || error.message });
      }
    }
  );

  router.delete(
    '/:id/resources/harvester/volumes/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, name } = req.params;
        const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

        const { namespace } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
            const u = new URL(base);
            origin = `${u.protocol}//${u.host}`;
        } catch {
            origin = base.replace(/\/v[0-9].*$/, '');
        }
        
        let targetNamespace = namespace ? String(namespace) : 'default';
        if (tenantNamespace) {
             const allowed = tenantNamespace.split(',').map(s => s.trim());
             if (namespace) {
                 if (!allowed.includes(String(namespace))) {
                      return res.status(403).json({ message: 'Access denied to this namespace' });
                 }
             } else {
                 targetNamespace = allowed[0];
             }
        }
        const ns = String(targetNamespace);
        
        const url = `${origin}/api/v1/namespaces/${ns}/persistentvolumeclaims/${name}`;
        await requestJson('DELETE', url, cloud.secretKey || '', insecure);
        
        res.json({ message: '删除成功' });
      } catch (error: any) {
        res.status(500).json({ message: '删除卷失败', error: error.body || error.message });
      }
    }
  );

  router.post(
    '/:id/resources/harvester/volumes/snapshot',
    checkAdminPermission,
    async (req: any, res: Response) => {
        try {
            const { id } = req.params;
            const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
            if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

            const cloud = await fetchCloudOr404(id, res);
            if (!cloud) return;
            if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported')) return;
            const insecure = !!(cloud.config as any)?.ignoreTls;
            
            if (tenantNamespace) {
                const allowed = tenantNamespace.split(',').map(s => s.trim());
                if (req.body.namespace) {
                    if (!allowed.includes(req.body.namespace)) {
                        return res.status(403).json({ message: 'Access denied to this namespace' });
                    }
                } else {
                    req.body.namespace = allowed[0];
                }
            }

            const { namespace, pvcName, ...opts } = req.body;
            const data = await createVolumeSnapshot(
                { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
                namespace,
                pvcName,
                opts
            );
            res.json({ message: '创建快照成功', data });
        } catch (error: any) {
            res.status(500).json({ message: '创建快照失败', error: error.body || error.message });
        }
    }
  );

  router.post(
    '/:id/resources/harvester/volumes/export-image',
    checkAdminPermission,
    async (req: any, res: Response) => {
        try {
            const { id } = req.params;
            const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
            if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

            const cloud = await fetchCloudOr404(id, res);
            if (!cloud) return;
            if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported')) return;
            const insecure = !!(cloud.config as any)?.ignoreTls;
            
            if (tenantNamespace) {
                const allowed = tenantNamespace.split(',').map(s => s.trim());
                if (req.body.namespace) {
                    if (!allowed.includes(req.body.namespace)) {
                        return res.status(403).json({ message: 'Access denied to this namespace' });
                    }
                } else {
                    req.body.namespace = allowed[0];
                }
            }

            const { namespace, pvcName, ...opts } = req.body;
            const data = await exportImageFromPVC(
                { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
                namespace,
                pvcName,
                opts
            );
            res.json({ message: '导出镜像成功', data });
        } catch (error: any) {
            res.status(500).json({ message: '导出镜像失败', error: error.body || error.message });
        }
    }
  );

  router.post(
    '/:id/resources/harvester/volumes/clone',
    checkAdminPermission,
    async (req: any, res: Response) => {
        try {
            const { id } = req.params;
            const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
            if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

            const cloud = await fetchCloudOr404(id, res);
            if (!cloud) return;
            if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported')) return;
            const insecure = !!(cloud.config as any)?.ignoreTls;
            
            if (tenantNamespace) {
                const allowed = tenantNamespace.split(',').map(s => s.trim());
                if (req.body.namespace) {
                    if (!allowed.includes(req.body.namespace)) {
                        return res.status(403).json({ message: 'Access denied to this namespace' });
                    }
                } else {
                    req.body.namespace = allowed[0];
                }
            }

            const { namespace, pvcName, ...payload } = req.body;
            const data = await clonePVC(
                { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
                namespace,
                pvcName,
                payload
            );
            res.json({ message: '克隆卷成功', data });
        } catch (error: any) {
            res.status(500).json({ message: '克隆卷失败', error: error.body || error.message });
        }
    }
  );

  router.put(
    '/:id/resources/harvester/volumes/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
        try {
            const { id, name } = req.params;
            const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
            if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

            const cloud = await fetchCloudOr404(id, res);
            if (!cloud) return;
            if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported')) return;
            const insecure = !!(cloud.config as any)?.ignoreTls;
            
            if (tenantNamespace) {
                const allowed = tenantNamespace.split(',').map(s => s.trim());
                if (req.body.namespace) {
                    if (!allowed.includes(req.body.namespace)) {
                        return res.status(403).json({ message: 'Access denied to this namespace' });
                    }
                } else {
                    req.body.namespace = allowed[0];
                }
            }

            const { namespace } = req.body; // pvcName comes from params 'name'
            const data = await updatePVCSpec(
                { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
                namespace || 'default',
                name,
                req.body
            );
            res.json({ message: '更新卷成功', data });
        } catch (error: any) {
            res.status(500).json({ message: '更新卷失败', error: error.body || error.message });
        }
    }
  );

  router.get(
    '/:id/resources/harvester/storage-classes',
    checkAdminPermission,
    async (req: any, res: Response) => {
        try {
            const { id } = req.params;
            const { allowed } = await checkTenantAccess(req, id);
            if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

            const cloud = await fetchCloudOr404(id, res);
            if (!cloud) return;
            if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
            const insecure = !!(cloud.config as any)?.ignoreTls;
            
            const items = await listHarvesterStorageClassesStandard({
                endpoint: cloud.endpoint,
                token: cloud.secretKey || '',
                insecure
            } as any);
            res.json({ message: '查询成功', data: { items } });
        } catch (error: any) {
            res.status(500).json({ message: '查询存储类失败', error: error.body || error.message });
        }
    }
  );

  // ==================================================================================
  // Namespace Operations
  // ==================================================================================
  router.get(
    '/:id/resources/harvester/namespaces',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

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
        
        // If tenant, we don't need to fetch full list if we know the namespace.
        // But the frontend might expect a list format.
        // We can just construct a single item list if we want to save bandwidth, 
        // OR we can fetch list and filter. 
        // Given tenants might not have "list namespaces" permission at cluster level, 
        // trying to list all namespaces might fail with 403 from K8s API if RBAC is tight.
        // However, we are using admin credentials (cloud.secretKey) to talk to Harvester.
        // So we will get the full list. We MUST filter it before returning.

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
        
        let items: any[] = (Array.isArray(json?.data)
          ? json?.data
          : Array.isArray(json?.items)
            ? json?.items
            : []
        ).map((ns: any) => ({
             ...ns,
             links: {
                 view: `${origin}/api/v1/namespaces/${ns?.metadata?.name || ns?.name || ''}`
             }
        }));

        console.log('[Namespaces] Raw items count:', items.length);

        if (isTenant) {
             const allowedNs = new Set<string>();
             if (tenantNamespace) {
                 tenantNamespace.split(',').forEach(ns => allowedNs.add(ns.trim()));
             }

             items = items.filter((ns: any) => {
                 const name = ns.metadata?.name || ns.name;
                 // Case-insensitive check
                 return Array.from(allowedNs).some(allowed => allowed.toLowerCase() === String(name).toLowerCase());
             });
        } else if (tenantNamespace) {
            // Non-tenant role but somehow restricted? (Should not happen based on checkTenantAccess logic)
            items = items.filter((ns: any) => isNamespaceAllowed(tenantNamespace, ns.metadata?.name || ns.name));
        }
        
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询命名空间失败', error: error.body || error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/namespaces/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, name } = req.params;
        const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });
        
        const validNamespaces = tenantNamespace ? tenantNamespace.split(',').map(s => s.trim()) : [];
        
        if (tenantNamespace && !validNamespaces.includes(name)) {
             return res.status(403).json({ message: 'Access denied to this namespace' });
        }

        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterNamespaceInventory);
        
        const shouldFetch = String(force) === 'true' || !(await repo.findOne({ where: { cloudId: id, name } }));

        if (shouldFetch) {
          try {
            const raw = await getHarvesterNamespaceRaw(
              { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
              name
            );

            if (raw) {
               const existing = await repo.findOne({ where: { cloudId: id, name } });
               if (existing) {
                  existing.labels = raw.metadata?.labels;
                  existing.annotations = raw.metadata?.annotations;
                  existing.rawData = raw;
                  await repo.save(existing);
               } else {
                  await repo.save({
                      cloudId: id,
                      name: raw.metadata?.name,
                      labels: raw.metadata?.labels,
                      annotations: raw.metadata?.annotations,
                      rawData: raw
                  });
               }
            }
          } catch (e: any) {
            console.warn('Fetch single namespace failed, falling back to sync', e);
            try {
              await syncHarvesterNamespaces(cloud, insecure);
            } catch (ex) {
               // ignore
            }
          }
        }
        
        const finalItem = await repo.findOne({ where: { cloudId: id, name } });
        if (!finalItem) {
          return res.status(404).json({ message: '命名空间不存在' });
        }
        
        res.json({ message: '查询成功', data: finalItem.rawData });
      } catch (error: any) {
        res.status(500).json({ message: '查询命名空间详情失败', error: error.body || error.message });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/namespaces',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { name } = req.body;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const data = await createHarvesterNamespace(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          name
        );
        res.json({ message: '创建成功', data });
      } catch (error: any) {
        res.status(500).json({ message: '创建命名空间失败', error: error.body || error.message });
      }
    }
  );

  router.delete(
    '/:id/resources/harvester/namespaces/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const data = await deleteHarvesterNamespace(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          name
        );
        res.json({ message: '删除成功', data });
      } catch (error: any) {
        res.status(500).json({ message: '删除命名空间失败', error: error.body || error.message });
      }
    }
  );

  // ==================================================================================
  // Images (List)
  // ==================================================================================
  router.get(
    '/:id/resources/harvester/images',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const items = await listHarvesterImagesStandard({
            endpoint: cloud.endpoint,
            token: cloud.secretKey || '',
            insecure
        } as any);

        // Add namespace filtering for tenant users
        let filteredItems = items;
        if (isTenant) {
            filteredItems = tenantNamespace
                ? items.filter((item: any) => isNamespaceAllowed(tenantNamespace, item.metadata?.namespace))
                : [];
        } else if (tenantNamespace) {
            filteredItems = items.filter((item: any) => isNamespaceAllowed(tenantNamespace, item.metadata?.namespace));
        }

        res.json({ message: '查询成功', data: { items: filteredItems } });
      } catch (error: any) {
        res.status(500).json({ message: '查询镜像失败', error: error.body || error.message });
      }
    },
  );
  
  // ==================================================================================
  // Nodes & System Pods
  // ==================================================================================
  router.get(
    '/:id/resources/harvester/nodes',
    checkAdminPermission,
    async (req: any, res: Response) => {
        try {
            const { id } = req.params;
            const { allowed } = await checkTenantAccess(req, id);
            if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

            const cloud = await fetchCloudOr404(id, res);
            if (!cloud) return;
            if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
            const insecure = !!(cloud.config as any)?.ignoreTls;
            
            const items = await listHarvesterNodesStandard({
                endpoint: cloud.endpoint,
                token: cloud.secretKey || '',
                insecure
            } as any);
            res.json({ message: '查询成功', data: { items } });
        } catch (error: any) {
        res.status(500).json({ message: '查询节点失败', error: error.body || error.message });
      }
    }
  );

  router.get(
    '/:id/resources/harvester/nodes/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, name } = req.params;
        const { allowed } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

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
          `${origin}/k8s/clusters/local/api/v1/nodes/${encodeURIComponent(name)}`,
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
        res.status(500).json({ message: '查询节点详情失败', error: error.body || error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/system-pods',
    checkAdminPermission,
    async (req: any, res: Response) => {
        try {
            const { id } = req.params;
            const { allowed } = await checkTenantAccess(req, id);
            if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

            const cloud = await fetchCloudOr404(id, res);
            if (!cloud) return;
            if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
            const insecure = !!(cloud.config as any)?.ignoreTls;
            
            const items = await listHarvesterSystemPodsStandard({
                endpoint: cloud.endpoint,
                token: cloud.secretKey || '',
                insecure
            } as any);
            res.json({ message: '查询成功', data: { items } });
        } catch (error: any) {
        res.status(500).json({ message: '查询系统Pods失败', error: error.body || error.message });
      }
    }
  );

  // ==================================================================================
  // GPU / USB
  // ==================================================================================
  router.get(
    '/:id/resources/harvester/gpu',
    checkAdminPermission,
    async (req: any, res: Response) => {
        try {
            const { id } = req.params;
            const { allowed } = await checkTenantAccess(req, id);
            if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

            const cloud = await fetchCloudOr404(id, res);
            if (!cloud) return;
            if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
            const insecure = !!(cloud.config as any)?.ignoreTls;
            
            const items = await listHarvesterGpuResources({
                endpoint: cloud.endpoint,
                token: cloud.secretKey || '',
                insecure
            } as any);
            res.json({ message: '查询成功', data: { items } });
        } catch (error: any) {
        res.status(500).json({ message: '查询GPU资源失败', error: error.body || error.message });
      }
    }
  );

  router.get(
    '/:id/resources/harvester/usb',
    checkAdminPermission,
    async (req: any, res: Response) => {
        try {
            const { id } = req.params;
            const { allowed } = await checkTenantAccess(req, id);
            if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

            const cloud = await fetchCloudOr404(id, res);
            if (!cloud) return;
            if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
            const insecure = !!(cloud.config as any)?.ignoreTls;
            
            const items = await listHarvesterUsbResources({
                endpoint: cloud.endpoint,
                token: cloud.secretKey || '',
                insecure
            } as any);
            res.json({ message: '查询成功', data: { items } });
        } catch (error: any) {
        res.status(500).json({ message: '查询USB资源失败', error: error.body || error.message });
      }
    }
  );

  // ==================================================================================
  // Available Volumes (For VM Creation - Existing PVC)
  // ==================================================================================
  router.get(
    '/:id/resources/harvester/available-volumes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });
        
        if (isTenant && !tenantNamespace) {
             return res.json({ message: '查询成功', data: { items: [] } });
        }

        const { namespace } = (req.query || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        
        const itemsRaw = await listHarvesterAvailableVolumesStandard(
          { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          { namespace: '' },
        );

        let items = itemsRaw;
        if (isTenant) {
             if (tenantNamespace) {
                 items = items.filter((i: any) => isNamespaceAllowed(tenantNamespace, i.namespace));
             } else {
                 items = [];
             }
        } else if (tenantNamespace) {
             items = items.filter((i: any) => isNamespaceAllowed(tenantNamespace, i.namespace));
        } else if (namespace) {
             items = items.filter((i: any) => i.namespace === namespace);
        }
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询可用卷失败', error: error.body || error.message });
      }
    }
  );

};
