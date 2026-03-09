import { Router, Response } from 'express';
import { getJsonOnce, requestJson } from '../../../services/clouds/harvester/utils';
import {
  listHarvesterLoadBalancers,
  createHarvesterLoadBalancer,
  listHarvesterLoadBalancerIPPools,
  updateHarvesterSubnet,
} from '../../../services/clouds/harvester/client';
import {
  checkTenantAccess,
  fetchCloudOr404,
  ensureProvider,
  isNamespaceAllowed,
} from './harvester.direct.helpers';
import { licenseService } from '../../../services/LicenseService';

/**
 * ==============================================================================
 * 模块名称: Harvester 网络资源直连路由 (Harvester Direct Network Routes)
 * 文件路径: src/routes/clouds/harvester/harvester.direct.network.routes.ts
 * ==============================================================================
 * 功能描述:
 * 本文件提供 Harvester 网络相关资源的直连管理能力，绕过中间缓存，直接与 Harvester API 交互。
 * 涵盖了基础网络 (NAD/Subnet)、高级网络 (EIP/FIP/NAT)、负载均衡 (LoadBalancer/IPPool) 等
 * 资源的增删改查操作。
 *
 * 核心逻辑:
 * 1. [Direct API Access]: 所有接口均直接请求 Harvester/Kube-OVN 的 API (CRD)，确保数据的
 *    实时性和操作的原子性。
 * 2. [Tenant Isolation]: 严格集成了多租户权限校验 (checkTenantAccess)，确保租户只能访问
 *    授权命名空间下的网络资源。
 * 3. [Subnet Management]: 实现了 Subnet 与 NAD 的联动创建/删除逻辑，并包含 CIDR 冲突检测
 *    和 IP 范围计算等辅助功能。
 * 4. [Error Handling]: 统一捕获 Harvester API 错误并转换为标准 HTTP 响应，包含详细的错误信息。
 *
 * API 列表:
 * - GET    /:id/resources/nads                                     获取 NAD 列表
 * - GET    /:id/resources/harvester/nads/:namespace/:name          获取 NAD 详情
 * - POST   /:id/resources/subnets                                  创建子网 (含 NAD 联动)
 * - PUT    /:id/resources/subnets/:subnetId                        更新子网
 * - DELETE /:id/resources/subnets/:name                            删除子网 (含关联检查)
 * - GET    /:id/resources/harvester-loadbalancers                  获取负载均衡列表
 * - POST   /:id/resources/harvester-loadbalancers                  创建负载均衡
 * - GET    /:id/resources/switch-lbrules                           获取 Switch LB 规则
 * - GET    /:id/resources/ovneips                                  获取 EIP 列表
 * - POST   /:id/resources/ovneips                                  创建 EIP
 * - GET    /:id/resources/ovnfips                                  获取 FIP 列表
 * - GET    /:id/resources/ovnsnatrules                             获取 SNAT 规则
 * - GET    /:id/resources/ovndnatrules                             获取 DNAT 规则
 * - GET    /:id/resources/services                                 获取 Service 列表 (基于 LB)
 * - DELETE /:id/resources/harvester/services/:namespace/:name      删除 Service
 * - GET    /:id/resources/ippools                                  获取 IP Pool 列表
 * - POST   /:id/resources/ippools                                  创建 IP Pool
 * - DELETE /:id/resources/ippools/:name                            删除 IP Pool
 * ==============================================================================
 */

/**
 * 将 IP 字符串转换为长整型数值
 *
 * @description
 * 用于 IP 地址的大小比较和范围计算。
 *
 * @param {string} ip 点分十进制 IP 字符串 (e.g., "192.168.1.1")
 * @returns {number} 对应的整数值
 */
const ipToLong = (ip: string): number => {
  return (
    ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>>
    0
  );
};

/**
 * 将 CIDR 转换为 IP 范围 [start, end]
 *
 * @description
 * 解析 CIDR 格式 (e.g., "192.168.1.0/24") 并计算其起始和结束 IP 的整数值。
 * 用于子网冲突检测。
 *
 * @param {string} cidr CIDR 字符串
 * @returns {[number, number] | null} 成功返回 [start, end] 数组，失败返回 null
 */
const cidrToRange = (cidr: string): [number, number] | null => {
  try {
    const [ip, mask] = cidr.split('/');
    const maskNum = parseInt(mask, 10);
    if (isNaN(maskNum) || maskNum < 0 || maskNum > 32) return null;
    const ipNum = ipToLong(ip);
    const hostBits = 32 - maskNum;
    const start = (ipNum >>> hostBits) << hostBits;
    const end = start + Math.pow(2, hostBits) - 1;
    return [start >>> 0, end >>> 0];
  } catch {
    return null;
  }
};

/**
 * 检查两个 IP 范围是否重叠
 *
 * @description
 * 判断两个闭区间 [start1, end1] 和 [start2, end2] 是否存在交集。
 *
 * @param {[number, number]} r1 范围 1
 * @param {[number, number]} r2 范围 2
 * @returns {boolean} 是否重叠
 */
const rangesOverlap = (
  r1: [number, number],
  r2: [number, number],
): boolean => {
  return Math.max(r1[0], r2[0]) <= Math.min(r1[1], r2[1]);
};

export const registerHarvesterDirectNetworkRoutes = (
  router: Router,
  checkAdminPermission: any,
) => {
  /**
   * ==================================================================================
   * NADs (Network Attachment Definitions)
   * ==================================================================================
   * [GET] /:id/resources/nads
   * 直连查询 Harvester 中的 NetworkAttachmentDefinition 列表。
   *
   * [核心逻辑]:
   * 1. 调用 checkTenantAccess 验证租户权限并获取允许的命名空间。
   * 2. 请求 /v1/harvester/k8s.cni.cncf.io.network-attachment-definitions 获取全量数据。
   * 3. 根据租户命名空间 (tenantNamespace) 对结果进行过滤，确保数据隔离。
   */
  router.get(
    '/:id/resources/nads',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } =
          await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (
          !ensureProvider(
            cloud,
            'harvester',
            res,
            '仅支持 Harvester 资源查询',
            next,
          )
        )
          return;
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
        json = await getJsonOnce(url, cloud.secretKey || '', insecure);

        const rawItems = Array.isArray(json?.data)
          ? json?.data
          : Array.isArray(json?.items)
          ? json?.items
          : [];
        let items = rawItems;
        // [Tenant Filter] 根据租户权限过滤列表
        if (isTenant) {
          if (tenantNamespace) {
            items = items.filter((i: any) =>
              isNamespaceAllowed(tenantNamespace, i.metadata?.namespace),
            );
          } else {
            items = [];
          }
        } else if (tenantNamespace) {
          items = items.filter((i: any) =>
            isNamespaceAllowed(tenantNamespace, i.metadata?.namespace),
          );
        }

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({
          message: '查询网络失败',
          error: error.body || error.message,
        });
      }
    },
  );

  /**
   * [GET] /:id/resources/harvester/nads/:namespace/:name
   * 获取单个 NetworkAttachmentDefinition 详情（直连 kube-ovn CRD）。
   *
   * [权限控制]:
   * - 检查用户是否有权限访问该 Resource Pool。
   * - 检查用户是否有权限访问指定的 Namespace。
   */
  router.get(
    '/:id/resources/harvester/nads/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, namespace, name } = req.params;
        const { allowed, namespace: tenantNamespace } = await checkTenantAccess(
          req,
          id,
        );
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        if (
          tenantNamespace &&
          !isNamespaceAllowed(tenantNamespace, namespace)
        ) {
          return res
            .status(403)
            .json({ message: 'Access denied to this namespace' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (
          !ensureProvider(
            cloud,
            'harvester',
            res,
            '仅支持 Harvester 资源查询',
            next,
          )
        )
          return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }

        const url = `${origin}/apis/k8s.cni.cncf.io/v1/namespaces/${encodeURIComponent(
          namespace,
        )}/network-attachment-definitions/${encodeURIComponent(name)}`;
        const json = await requestJson(
          'GET',
          url,
          cloud.secretKey || '',
          insecure,
        );
        res.json({ message: '查询成功', data: json });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({
          message: '获取网络附件定义详情失败',
          error: error.body || error.message,
        });
      }
    },
  );

  /**
   * ==================================================================================
   * Provider Networks (Kube-OVN)
   * ==================================================================================
   * [GET] /:id/resources/providernetworks
   * 获取 Provider Network 列表。
   */
  router.get(
    '/:id/resources/providernetworks',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        if (!licenseService.hasFeature('network.ovn.vpc')) {
          return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
        }
        const { id } = req.params;
        const { allowed } = await checkTenantAccess(req, id);
        if (!allowed)
          return res.status(403).json({ message: 'Access denied' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester', next)) return;

        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }

        const url = `${origin}/apis/kubeovn.io/v1/provider-networks`;
        const json = await getJsonOnce(url, cloud.secretKey || '', !!(cloud.config as any)?.ignoreTls);
        res.json({ message: '查询成功', data: json });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询 Provider Networks 失败', error: error.message });
      }
    }
  );

  /**
   * [POST] /:id/resources/providernetworks
   * 创建 Provider Network。
   */
  router.post(
    '/:id/resources/providernetworks',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        if (!licenseService.hasFeature('network.ovn.vpc')) {
          return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
        }
        const { id } = req.params;
        const { allowed } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }

        const { name, defaultInterface, customInterfaces, exchangeLinkName } = req.body;
        const payload = {
            apiVersion: 'kubeovn.io/v1',
            kind: 'ProviderNetwork',
            metadata: { name },
            spec: {
                defaultInterface,
                customInterfaces: customInterfaces || [],
                exchangeLinkName: exchangeLinkName || false
            }
        };

        const url = `${origin}/apis/kubeovn.io/v1/provider-networks`;
        const json = await requestJson('POST', url, cloud.secretKey || '', !!(cloud.config as any)?.ignoreTls, payload);
        res.json({ message: '创建成功', data: json });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '创建 Provider Network 失败', error: error.message });
      }
    }
  );

  /**
   * ==================================================================================
   * VLANs (Kube-OVN)
   * ==================================================================================
   * [GET] /:id/resources/vlans
   * 获取 VLAN 列表。
   */
  router.get(
    '/:id/resources/vlans',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        if (!licenseService.hasFeature('network.ovn.vpc')) {
          return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
        }
        const { id } = req.params;
        const { allowed } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied' });


        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;

        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }

        const url = `${origin}/apis/kubeovn.io/v1/vlans`;
        const json = await getJsonOnce(url, cloud.secretKey || '', !!(cloud.config as any)?.ignoreTls);
        res.json({ message: '查询成功', data: json });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询 VLANs 失败', error: error.message });
      }
    }
  );

  /**
   * [POST] /:id/resources/vlans
   * 创建 VLAN。
   */
  router.post(
    '/:id/resources/vlans',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        if (!licenseService.hasFeature('network.ovn.vpc')) {
          return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
        }
        const { id } = req.params;
        const { allowed } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;

        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }

        const { name, id: vlanId, provider } = req.body;
        const payload = {
            apiVersion: 'kubeovn.io/v1',
            kind: 'Vlan',
            metadata: { name },
            spec: {
                id: parseInt(vlanId, 10),
                provider
            }
        };

        const url = `${origin}/apis/kubeovn.io/v1/vlans`;
        const json = await requestJson('POST', url, cloud.secretKey || '', !!(cloud.config as any)?.ignoreTls, payload);
        res.json({ message: '创建成功', data: json });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '创建 VLAN 失败', error: error.message });
      }
    }
  );

  /**
   * ==================================================================================
   * Subnets (Kube-OVN)
   * ==================================================================================
   * [GET] /:id/resources/subnets
   * 获取 Subnet 列表。
   */
  router.get(
    '/:id/resources/subnets',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { allowed } = await checkTenantAccess(req, id);
        if (!allowed) return res.status(403).json({ message: 'Access denied' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;

        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }

        const url = `${origin}/apis/kubeovn.io/v1/subnets`;
        const json = await getJsonOnce(url, cloud.secretKey || '', !!(cloud.config as any)?.ignoreTls);
        
        // [Data Enrichment] 注入 NAD 的 Namespace 信息
        // Kube-OVN Subnet 是 Cluster 级别资源，不包含 Namespace 信息。
        // 但其实际对应的 NAD (NetworkAttachmentDefinition) 是 Namespaced 资源。
        // 为了前端能正确拼接网络名称 (<namespace>/<name>)，我们需要找到每个 Subnet 对应的 NAD。
        try {
            const nadUrl = `${origin}/apis/k8s.cni.cncf.io/v1/network-attachment-definitions`;
            const nads = await getJsonOnce(nadUrl, cloud.secretKey || '', !!(cloud.config as any)?.ignoreTls);
            const nadItems = Array.isArray(nads?.items) ? nads.items : [];
            
            // 构建 NAD 索引: name -> namespace
            const nadMap = new Map<string, string>();
            nadItems.forEach((nad: any) => {
                if (nad?.metadata?.name && nad?.metadata?.namespace) {
                    nadMap.set(nad.metadata.name, nad.metadata.namespace);
                }
            });

            const items = Array.isArray(json?.items) ? json.items : [];
            items.forEach((subnet: any) => {
                const name = subnet?.metadata?.name;
                if (name && nadMap.has(name)) {
                    // 将 NAD 的 Namespace 注入到 Subnet 的 metadata.namespace 字段
                    // 或者使用专用字段 _nadNamespace，这里直接复用 metadata.namespace (因为 Subnet 本身为空)
                    if (!subnet.metadata) subnet.metadata = {};
                    subnet.metadata.namespace = nadMap.get(name);
                }
            });
        } catch (e) {
            console.warn('[Subnets] Failed to enrich NAD namespace info:', e);
        }

        res.json({ message: '查询成功', data: json });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询 Subnets 失败', error: error.message });
      }
    }
  );

  /**
   * [POST] /:id/resources/subnets
   * 直连 Kube-OVN Subnet CRD，实现子网的创建。
   *
   * [业务逻辑]:
   * 1. [Validation]: 校验必填参数 (name, cidrBlock) 及命名规范。
   * 2. [CIDR Check]: 预检查 CIDR 是否与现有子网冲突 (Intersection Check)。
   * 3. [NAD Creation]: 自动创建对应的 NetworkAttachmentDefinition (default namespace)。
   * 4. [Subnet Creation]: 创建 Subnet CRD，关联上述 NAD。
   * 5. [Rollback]: 如果 Subnet 创建失败，尝试回滚删除已创建的 NAD。
   */
  router.post(
    '/:id/resources/subnets',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { allowed } = await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        const {
          name,
          vpc,
          cidrBlock,
          gateway,
          protocol,
          excludeIps,
          provider,
          vlan,
          gatewayType,
          namespaces,
          namespace, // 明确解构 namespace
          nat,
          allowDhcp,
          disableGatewayCheck,
          annotations,
        } = req.body;

        // [Input Validation] 参数校验
        if (!name || !cidrBlock) {
          res
            .status(400)
            .json({ message: '缺少必要参数: name, cidrBlock' });
          return;
        }

        const nameStr = String(name).trim();
        if (/^[0-9]/.test(nameStr) || /^[0-9]+$/.test(nameStr)) {
          res.status(422).send('当前创建的子网名称不能以数字开头或为纯数字');
          return;
        }

        if (excludeIps && Array.isArray(excludeIps)) {
          const valid = excludeIps.every(
            (ip: any) => typeof ip === 'string' && ip.trim().length > 0,
          );
          if (!valid) {
            res
              .status(400)
              .json({ message: 'excludeIps 格式错误，应为非空字符串数组' });
            return;
          }
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (
          !ensureProvider(
            cloud,
            'harvester',
            res,
            '仅支持 Harvester 资源查询',
            next,
          )
        )
          return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }

        // [CIDR Conflict Check] 冲突检测
        try {
            const existing = await getJsonOnce(`${origin}/apis/kubeovn.io/v1/subnets`, cloud.secretKey || '', insecure);
            const items: any[] = Array.isArray(existing?.items) ? existing.items : Array.isArray(existing?.data) ? existing.data : [];
            const reqRange = cidrToRange(String(cidrBlock || '').trim());
            if (reqRange) {
            const targetVpc = vpc || 'ovn-cluster';
            for (const s of items) {
                // [VPC Isolation] Different VPCs can have overlapping CIDRs
                const currentVpc = s?.spec?.vpc || 'ovn-cluster';
                if (currentVpc !== targetVpc) continue;

                const c = String(s?.spec?.cidrBlock || s?.spec?.cidr || '').trim();
                const r = cidrToRange(c);
                if (r && rangesOverlap(reqRange, r)) {
                const conflictName = s?.metadata?.name || s?.name;
                if (conflictName) {
                    res.status(422).send(`当前创建的子网和已存在的子网 ${conflictName} (VPC: ${currentVpc}) 冲突`);
                    return;
                }
                }
            }
            }
        } catch (e) {
            console.warn('[CreateSubnet] CIDR pre-check failed, proceeding anyway:', e);
        }

        const url = `${origin}/apis/kubeovn.io/v1/subnets`;

        const nadName = name;
        // 如果未指定 namespace，则使用 default，但应该从前端传入或从 VPC 推断
        const nadNamespace = namespace || 'default';
        const fullProvider = `${nadName}.${nadNamespace}.ovn`;

        // [Create NAD] 创建关联的 NAD
        // Harvester 版本差异可能导致 API 路径不同 (K8s 原生 vs Rancher 代理)。
        const nadCandidates = [
          `${origin}/apis/k8s.cni.cncf.io/v1/namespaces/${nadNamespace}/network-attachment-definitions`,
          `${origin}/apis/k8s.cni.cncf.io/v1/namespaces/${nadNamespace}/networkattachmentdefinitions`,
          `${origin}/v1/harvester/k8s.cni.cncf.io.network-attachment-definitions`,
          `${origin}/v1/harvester/k8s.cni.cncf.io.networkattachmentdefinitions`,
        ];

        // [Feature] 平台托管标记 (Platform Managed)
        // 添加 tower.io/managed Finalizer 和 tower.io/creator 标签，与虚拟机保持一致
        const nadPayload = {
          apiVersion: 'k8s.cni.cncf.io/v1',
          kind: 'NetworkAttachmentDefinition',
          metadata: {
            name: nadName,
            namespace: nadNamespace,
            finalizers: ['tower.io/managed'],
            labels: {
              'tower.io/creator': 'compute-tower',
            },
          },
          spec: {
            config: JSON.stringify({
              cniVersion: '0.3.1',
              name: nadName,
              type: 'kube-ovn',
              server_socket: '/run/openvswitch/kube-ovn-daemon.sock',
              provider: fullProvider,
            }),
          },
        };

        let createdNewNad = false;
        let nadCreatedOrExists = false;
        let lastNadError: any = null;

        for (const nadUrl of nadCandidates) {
          try {
            await requestJson(
              'POST',
              nadUrl,
              cloud.secretKey || '',
              insecure,
              nadPayload,
            );
            createdNewNad = true;
            nadCreatedOrExists = true;
            break;
          } catch (nadError: any) {
            const status = Number(nadError?.response?.status || nadError?.status || 0);
            const msg = String(nadError?.message || '').toLowerCase();
            const isConflict = status === 409 || msg.includes('alreadyexists');

            if (isConflict) {
              nadCreatedOrExists = true;
              createdNewNad = false;
              break;
            }

            // If 404/405/400/422, try next candidate
            if (status === 404 || status === 405 || status === 400 || status === 422 || msg.includes('404')) {
              lastNadError = nadError;
              continue;
            }

            // Other errors (500, 403, etc), stop and fail
            console.error('[CreateSubnet] Failed to create NAD:', nadError);
            if (!res.headersSent) res.status(500).json({ message: '创建 NAD 失败', error: nadError.message });
            return;
          }
        }

        if (!nadCreatedOrExists) {
            console.error('[CreateSubnet] Failed to create NAD (all paths tried):', lastNadError);
            if (!res.headersSent) res.status(500).json({ message: '创建 NAD 失败 (API 路径未找到)', error: lastNadError?.message });
            return;
        }

        // [Create Subnet] 创建 Subnet CRD
        const payload = {
          apiVersion: 'kubeovn.io/v1',
          kind: 'Subnet',
          metadata: {
            name,
            ...(annotations ? { annotations } : {}),
          },
          spec: {
            vpc,
            cidrBlock,
            gateway,
            protocol: protocol || 'IPv4',
            ...(excludeIps && Array.isArray(excludeIps) ? { excludeIps } : {}),
            ...(namespaces && Array.isArray(namespaces)
              ? { namespaces }
              : {}),
            provider: fullProvider,
            ...(vlan ? { vlan } : {}),
            ...(gatewayType ? { gatewayType } : {}),
            ...(disableGatewayCheck !== undefined
              ? { disableGatewayCheck }
              : {}),
            natOutgoing: nat !== undefined ? nat : false,
            enableDhcp: allowDhcp !== undefined ? allowDhcp : true,
          },
        };

        try {
            const result = await requestJson(
            'POST',
            url,
            cloud.secretKey || '',
            insecure,
            payload,
            );
            res.json({ message: '创建子网成功', data: result });
        } catch (error: any) {
            // [Rollback] 如果子网创建失败，尝试回滚 NAD
            if (createdNewNad) {
                try {
                    const nadDelUrl = `${origin}/apis/k8s.cni.cncf.io/v1/namespaces/${nadNamespace}/network-attachment-definitions/${encodeURIComponent(name)}`;
                    await requestJson('DELETE', nadDelUrl, cloud.secretKey || '', insecure);
                } catch {}
            }

            if (res.headersSent) return;
            console.error('[CreateSubnet] Failed:', error);
            res.status(500).json({
            message: '创建子网失败',
            error: error.message,
            details: error.body || error.response || error.toString(),
            debug_payload: req.body,
            });
        }
      } catch (err: any) {
        if (!res.headersSent) {
          res.status(500).json({
            message: 'Unexpected error',
            error: err.message,
          });
        }
      }
    },
  );

  /**
   * [PUT] /:id/resources/subnets/:subnetId
   * 更新子网配置。
   *
   * [说明]:
   * 调用 updateHarvesterSubnet 辅助函数执行更新操作。
   */
  router.put(
    '/:id/resources/subnets/:subnetId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, subnetId } = req.params;
        const { allowed } = await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (
          !ensureProvider(
            cloud,
            'harvester',
            res,
            'Operation not supported',
            next,
          )
        )
          return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const data = await updateHarvesterSubnet(
          {
            endpoint: cloud.endpoint,
            token: cloud.secretKey || '',
            insecure,
          } as any,
          subnetId,
          req.body,
        );
        res.json({ message: '更新成功', data });
      } catch (error: any) {
        res.status(500).json({
          message: '更新子网失败',
          error: error.body || error.message,
        });
      }
    },
  );

  /**
   * [DELETE] /:id/resources/subnets/:name
   * 删除子网。
   *
   * [业务逻辑]:
   * 1. [Usage Check]: 检查该子网是否正在被虚拟机使用 (通过 VM 的 networks 字段匹配)。
   *    如果被使用，拒绝删除并返回 409 Conflict。
   * 2. [Delete Subnet]: 删除 Subnet CRD。
   * 3. [Cascade Delete]: 尝试级联删除关联的 NAD。
   */
  router.delete(
    '/:id/resources/subnets/:name',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, name } = req.params;
        const { allowed } = await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (
          !ensureProvider(
            cloud,
            'harvester',
            res,
            '仅支持 Harvester 资源查询',
            next,
          )
        )
          return;
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

        // [Usage Check] 检查 VM 占用
        try {
            const ecsList = await getJsonOnce(`${origin}/v1/harvester/kubevirt.io.virtualmachines`, cloud.secretKey || '', insecure);
            const vms: any[] = Array.isArray(ecsList?.items) ? ecsList.items : Array.isArray(ecsList?.data) ? ecsList.data : [];
            const nadNamespace = 'default';
            const targetRef = `${nadNamespace}/${name}`.toLowerCase();
            
            const usingVms = vms
            .map((vm: any) => {
                const networks: any[] = vm?.spec?.template?.spec?.networks || [];
                const nets = networks.map((n: any) => n?.multus?.networkName).filter((n: any) => typeof n === 'string');
                
                const alias = vm?.metadata?.annotations?.['tower.io/alias'] || vm?.metadata?.name;
                const matched = nets.some((n: string) => {
                    const s = String(n || '').toLowerCase();
                    const base = s.includes('@') ? s.split('@')[0] : s;
                    return base === targetRef || base.endsWith(`/${name.toLowerCase()}`);
                });
                return matched ? alias : undefined;
            })
            .filter((x: any) => typeof x === 'string' && x.trim().length > 0);

            if (usingVms.length > 0) {
                res.status(409).send(`不能删除此子网，因为正在被虚拟机使用 ${usingVms.slice(0, 5).join('，')}${usingVms.length > 5 ? ' 等' : ''}`);
                return;
            }
        } catch (checkError) {
            console.warn('[DeleteSubnet] Failed to check VM usage, proceeding anyway:', checkError);
        }

        await requestJson('DELETE', url, cloud.secretKey || '', insecure);

        // [Cascade Delete] 级联删除 NAD
        try {
            const nadNamespace = 'default';
            const nadDelUrl = `${origin}/apis/k8s.cni.cncf.io/v1/namespaces/${nadNamespace}/network-attachment-definitions/${encodeURIComponent(name)}`;
            await requestJson('DELETE', nadDelUrl, cloud.secretKey || '', insecure);
        } catch {}

        res.json({ message: '删除子网成功' });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({
          message: '删除子网失败',
          error: error.body || error.message,
        });
      }
    },
  );

  /**
   * ==================================================================================
   * Harvester Load Balancers (Flat Network)
   * ==================================================================================
   * [GET] /:id/resources/harvester-loadbalancers
   * 直连查询 Harvester 负载均衡资源。
   */
  router.get(
    '/:id/resources/harvester-loadbalancers',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } =
          await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (
          !ensureProvider(
            cloud,
            'harvester',
            res,
            '仅支持 Harvester 资源查询',
            next,
          )
        )
          return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const rawItems = await listHarvesterLoadBalancers({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        });

        let items = rawItems;
        if (isTenant) {
          if (tenantNamespace) {
            items = items.filter((i: any) =>
              isNamespaceAllowed(tenantNamespace, i.metadata?.namespace),
            );
          } else {
            items = [];
          }
        } else if (tenantNamespace) {
          items = items.filter((i: any) =>
            isNamespaceAllowed(tenantNamespace, i.metadata?.namespace),
          );
        }

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({
          message: '查询 Harvester 负载均衡失败',
          error: error.body || error.message,
        });
      }
    },
  );

  /**
   * [POST] /:id/resources/harvester-loadbalancers
   * 创建 Harvester 负载均衡。
   */
  router.post(
    '/:id/resources/harvester-loadbalancers',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace } = await checkTenantAccess(
          req,
          id,
        );
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (
          !ensureProvider(
            cloud,
            'harvester',
            res,
            'Operation not supported',
            next,
          )
        )
          return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const payload = req.body;
        if (tenantNamespace) {
          const allowedNs = tenantNamespace
            .split(',')
            .map((s: string) => s.trim());
          if (!allowedNs.includes(payload.namespace)) {
            return res
              .status(403)
              .json({ message: 'Access denied to this namespace' });
          }
        }

        const result = await createHarvesterLoadBalancer(
          {
            endpoint: cloud.endpoint,
            token: cloud.secretKey || '',
            insecure,
          } as any,
          payload,
        );
        res.json({ message: '创建成功', data: result });
      } catch (error: any) {
        res.status(500).json({
          message: '创建负载均衡失败',
          error: error.body || error.message,
        });
      }
    },
  );

  /**
   * ==================================================================================
   * Switch LBRules (负载均衡规则)
   * ==================================================================================
   * [GET] /:id/resources/switch-lbrules
   * 查询 Kube-OVN SwitchLBRule 列表。
   */
  router.get(
    '/:id/resources/switch-lbrules',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } =
          await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (
          !ensureProvider(
            cloud,
            'harvester',
            res,
            '仅支持 Harvester 资源查询',
            next,
          )
        )
          return;
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
        json = await getJsonOnce(url, cloud.secretKey || '', insecure);

        const rawItems = Array.isArray(json?.items)
          ? json?.items
          : Array.isArray(json?.data)
          ? json?.data
          : [];
        let items = rawItems;
        if (isTenant) {
          if (tenantNamespace) {
            items = items.filter((i: any) =>
              isNamespaceAllowed(tenantNamespace, i.metadata?.namespace),
            );
          } else {
            items = [];
          }
        } else if (tenantNamespace) {
          items = items.filter((i: any) =>
            isNamespaceAllowed(tenantNamespace, i.metadata?.namespace),
          );
        }

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({
          message: '查询负载均衡规则失败',
          error: error.body || error.message,
        });
      }
    },
  );

  /**
   * ==================================================================================
   * OvnEips / OvnFips / OvnSnatRules / OvnDnatRules
   * ==================================================================================
   * 直连 kube-ovn.io 相关 CRD，提供高级网络功能 (EIP, FIP, NAT) 的管理。
   */

  /**
   * [GET] /:id/resources/ovneips
   * 查询 EIP 列表。
   */
  router.get(
    '/:id/resources/ovneips',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        if (!licenseService.hasFeature('network.ovn.vpc')) {
          return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
        }
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } =
          await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (
          !ensureProvider(
            cloud,
            'harvester',
            res,
            '仅支持 Harvester 资源查询',
            next,
          )
        )
          return;
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
          `${origin}/apis/kubeovn.io/v1/ovn-eips`,
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
          throw lastErr || new Error('Failed to fetch OvnEips');
        }

        const rawItems = Array.isArray(json?.items)
          ? json?.items
          : Array.isArray(json?.data)
          ? json?.data
          : [];
        let items = rawItems;
        if (isTenant) {
          if (tenantNamespace) {
            items = items.filter((i: any) =>
              isNamespaceAllowed(tenantNamespace, i.metadata?.namespace),
            );
          } else {
            items = [];
          }
        } else if (tenantNamespace) {
          items = items.filter((i: any) =>
            isNamespaceAllowed(tenantNamespace, i.metadata?.namespace),
          );
        }

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({
          message: '查询EIP失败',
          error: error.body || error.message,
        });
      }
    },
  );

  /**
   * [POST] /:id/resources/ovneips
   * 创建 EIP。
   */
  router.post(
    '/:id/resources/ovneips',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        if (!licenseService.hasFeature('network.ovn.vpc')) {
          return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
        }
        const { id } = req.params;
        const { allowed } = await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        const { name, externalSubnet, v4Ip, type } = req.body;

        if (!name || !externalSubnet) {
          res
            .status(400)
            .json({ message: '缺少必要参数: name, externalSubnet' });
          return;
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (
          !ensureProvider(
            cloud,
            'harvester',
            res,
            '仅支持 Harvester 资源查询',
            next,
          )
        )
          return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }

        const url = `${origin}/apis/kubeovn.io/v1/ovneips`;

        const payload = {
          apiVersion: 'kubeovn.io/v1',
          kind: 'OvnEip',
          metadata: {
            name,
          },
          spec: {
            externalSubnet,
            type: type || 'nat',
            ...(v4Ip ? { v4Ip } : {}),
          },
        };

        let json: any = null;
        try {
          json = await requestJson(
            'POST',
            url,
            cloud.secretKey || '',
            insecure,
            payload,
          );
        } catch (e: any) {
          if (e?.status === 404) {
            const altUrl = `${origin}/apis/kubeovn.io/v1/ovn-eips`;
            json = await requestJson(
              'POST',
              altUrl,
              cloud.secretKey || '',
              insecure,
              payload,
            );
          } else {
            throw e;
          }
        }

        res.json({ message: '创建成功', data: json });
      } catch (error: any) {
        if (res.headersSent) return;
        console.error('Create OvnEip error:', error);

        let details = error.body;
        try {
          if (typeof details === 'string') {
            details = JSON.parse(details);
          }
        } catch {
          // ignore
        }

        res.status(500).json({
          message: '创建EIP失败',
          error: error.message,
          details,
        });
      }
    },
  );

  /**
   * [GET] /:id/resources/ovnfips
   * 查询 FIP 列表。
   */
  router.get(
    '/:id/resources/ovnfips',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        if (!licenseService.hasFeature('network.ovn.vpc')) {
          return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
        }
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } =
          await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (
          !ensureProvider(
            cloud,
            'harvester',
            res,
            '仅支持 Harvester 资源查询',
            next,
          )
        )
          return;
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
          `${origin}/apis/kubeovn.io/v1/ovn-fips`,
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

        const rawItems = Array.isArray(json?.items)
          ? json?.items
          : Array.isArray(json?.data)
          ? json?.data
          : [];
        let items = rawItems;
        if (isTenant) {
          if (tenantNamespace) {
            items = items.filter((i: any) =>
              isNamespaceAllowed(tenantNamespace, i.metadata?.namespace),
            );
          } else {
            items = [];
          }
        } else if (tenantNamespace) {
          items = items.filter((i: any) =>
            isNamespaceAllowed(tenantNamespace, i.metadata?.namespace),
          );
        }

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({
          message: '查询FIP失败',
          error: error.body || error.message,
        });
      }
    },
  );

  /**
   * [GET] /:id/resources/ovnsnatrules
   * 查询 SNAT 规则列表。
   */
  router.get(
    '/:id/resources/ovnsnatrules',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        if (!licenseService.hasFeature('network.ovn.vpc')) {
          return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
        }
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } =
          await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (
          !ensureProvider(
            cloud,
            'harvester',
            res,
            '仅支持 Harvester 资源查询',
            next,
          )
        )
          return;
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
          `${origin}/apis/kubeovn.io/v1/ovn-snat-rules`,
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

        const rawItems = Array.isArray(json?.items)
          ? json?.items
          : Array.isArray(json?.data)
          ? json?.data
          : [];
        let items = rawItems;
        if (isTenant) {
          if (tenantNamespace) {
            items = items.filter((i: any) =>
              isNamespaceAllowed(tenantNamespace, i.metadata?.namespace),
            );
          } else {
            items = [];
          }
        } else if (tenantNamespace) {
          items = items.filter((i: any) =>
            isNamespaceAllowed(tenantNamespace, i.metadata?.namespace),
          );
        }

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({
          message: '查询SNAT规则失败',
          error: error.body || error.message,
        });
      }
    },
  );

  /**
   * [GET] /:id/resources/ovndnatrules
   * 查询 DNAT 规则列表。
   */
  router.get(
    '/:id/resources/ovndnatrules',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        if (!licenseService.hasFeature('network.ovn.vpc')) {
          return res.status(403).json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
        }
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } =
          await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (
          !ensureProvider(
            cloud,
            'harvester',
            res,
            '仅支持 Harvester 资源查询',
            next,
          )
        )
          return;
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
          `${origin}/apis/kubeovn.io/v1/ovn-dnat-rules`,
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

        const rawItems = Array.isArray(json?.items)
          ? json?.items
          : Array.isArray(json?.data)
          ? json?.data
          : [];
        let items = rawItems;
        if (isTenant) {
          if (tenantNamespace) {
            items = items.filter((i: any) =>
              isNamespaceAllowed(tenantNamespace, i.metadata?.namespace),
            );
          } else {
            items = [];
          }
        } else if (tenantNamespace) {
          items = items.filter((i: any) =>
            isNamespaceAllowed(tenantNamespace, i.metadata?.namespace),
          );
        }

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({
          message: '查询DNAT规则失败',
          error: error.body || error.message,
        });
      }
    },
  );

  /**
   * ==================================================================================
   * Services & IP Pools
   * ==================================================================================
   * - Services：基于 Harvester LoadBalancer CRD 的服务列表
   * - IPPools：负载均衡地址池管理（基于 Steve API）
   */

  /**
   * [GET] /:id/resources/services
   * 获取 Service 列表。
   */
  router.get(
    '/:id/resources/services',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } =
          await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (
          !ensureProvider(
            cloud,
            'harvester',
            res,
            '仅支持 Harvester 资源查询',
            next,
          )
        )
          return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const items = await listHarvesterLoadBalancers({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        });

        let filteredItems = items;
        if (isTenant) {
          if (tenantNamespace) {
            filteredItems = items.filter((i: any) =>
              isNamespaceAllowed(tenantNamespace, i.metadata?.namespace),
            );
          } else {
            filteredItems = [];
          }
        } else if (tenantNamespace) {
          filteredItems = items.filter((i: any) =>
            isNamespaceAllowed(tenantNamespace, i.metadata?.namespace),
          );
        }

        res.json({ message: '查询成功', data: { items: filteredItems } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({
          message: '查询Services失败',
          error: error.body || error.message,
        });
      }
    },
  );

  /**
   * [DELETE] /:id/resources/harvester/services/:namespace/:name
   * 删除 Service。
   */
  router.delete(
    '/:id/resources/harvester/services/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, namespace, name } = req.params;
        const { allowed } = await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (
          !ensureProvider(
            cloud,
            'harvester',
            res,
            'Operation not supported',
            next,
          )
        )
          return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        let endpointBase = (cloud.endpoint || '').replace(/\/+$/, '');
        if (!endpointBase.includes('/k8s/clusters/')) {
          endpointBase = endpointBase.replace(/\/v[0-9]+(\/harvester)?$/, '');
        }

        const url = `${endpointBase}/apis/loadbalancer.harvesterhci.io/v1beta1/namespaces/${namespace}/loadbalancers/${name}`;

        console.log(
          `[Service] Deleting LoadBalancer CRD: ${namespace}/${name} | URL: ${url}`,
        );

        try {
          const data = await requestJson(
            'DELETE',
            url,
            cloud.secretKey || '',
            insecure,
          );
          console.log(`[Service] Delete Success:`, name);
          return res.json({ message: '删除成功', data });
        } catch (e: any) {
          console.error(
            `[Service] Delete Failed: ${e.message}`,
            e.body || e,
          );
          const rawError = e.body || e.message || '删除失败';
          res
            .status(e.status || 500)
            .json({ message: '删除失败', error: rawError });
        }
      } catch (error: any) {
        console.error('[Service] Delete failed:', error);
        res.status(500).json({
          message: `删除负载均衡失败 | ${error.body || error.message}`,
          error: error.body,
        });
      }
    },
  );

  /**
   * [GET] /:id/resources/ippools
   * 查询 IP Pool 列表。
   */
  router.get(
    '/:id/resources/ippools',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { allowed, namespace: tenantNamespace, isTenant } =
          await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (
          !ensureProvider(
            cloud,
            'harvester',
            res,
            '仅支持 Harvester 资源查询',
            next,
          )
        )
          return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const items = await listHarvesterLoadBalancerIPPools({
          endpoint: cloud.endpoint,
          token: cloud.secretKey || '',
          insecure,
        });

        let filteredItems = items;
        if (isTenant) {
          if (tenantNamespace) {
            filteredItems = items.filter((i: any) =>
              isNamespaceAllowed(tenantNamespace, i.metadata?.namespace),
            );
          } else {
            filteredItems = [];
          }
        } else if (tenantNamespace) {
          filteredItems = items.filter((i: any) =>
            isNamespaceAllowed(tenantNamespace, i.metadata?.namespace),
          );
        }

        res.json({ message: '查询成功', data: { items: filteredItems } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({
          message: '查询地址池失败',
          error: error.body || error.message,
        });
      }
    },
  );

  /**
   * [POST] /:id/resources/ippools
   * 创建 IP Pool。
   */
  router.post(
    '/:id/resources/ippools',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { allowed } = await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (
          !ensureProvider(
            cloud,
            'harvester',
            res,
            'Operation not supported',
            next,
          )
        )
          return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        let endpointBase = (cloud.endpoint || '').replace(/\/+$/, '');
        if (!endpointBase.includes('/k8s/clusters/')) {
          endpointBase = endpointBase.replace(/\/v[0-9]+(\/harvester)?$/, '');
        }

        const ns = req.body?.metadata?.namespace || 'default';
        console.log(
          `[IPPool] Creating IP Pool in namespace: ${ns} | EndpointBase: ${endpointBase}`,
        );

        const payload: any = {
          type: 'loadbalancer.harvesterhci.io.ippool',
          metadata: {
            name: req.body.metadata?.name,
            annotations: req.body.metadata?.annotations || {},
          },
          spec: {
            selector: {
              network: req.body.spec?.selector?.network,
              scope:
                req.body.spec?.selector?.scope || [
                  { namespace: '*', guestCluster: '' },
                ],
            },
          },
        };

        payload.spec.ranges = [];

        if (req.body.spec?.cidrs && Array.isArray(req.body.spec.cidrs)) {
          payload.spec.ranges = req.body.spec.cidrs.map((cidr: string) => ({
            subnet: cidr,
            type: 'cidr',
          }));
        } else if (req.body.spec?.ranges && Array.isArray(req.body.spec.ranges)) {
          payload.spec.ranges = req.body.spec.ranges.map((r: any) => ({
            rangeStart: r.start,
            rangeEnd: r.end,
            subnet: r.subnet,
            gateway: r.gateway,
            type: 'range',
          }));
        }

        const url = `${endpointBase}/v1/harvester/loadbalancer.harvesterhci.io.ippools`;

        console.log(`[IPPool] Posting to URL: ${url}`);
        console.log(`[IPPool] Payload:`, JSON.stringify(payload, null, 2));

        try {
          const data = await requestJson(
            'POST',
            url,
            cloud.secretKey || '',
            insecure,
            payload,
          );
          console.log(`[IPPool] Success:`, (data as any)?.id);
          return res.json({ message: '创建成功', data });
        } catch (e: any) {
          console.error(
            `[IPPool] Creation Failed: ${e.message}`,
            e.body || e,
          );
          const rawError = e.body || e.message || '创建失败';
          res
            .status(e.status || 500)
            .json({ message: '创建失败', error: rawError });
        }
      } catch (error: any) {
        console.error('[IPPool] Create failed:', error);
        res.status(500).json({
          message: `创建 IP 池失败 | ${error.body || error.message}`,
          error: error.body,
        });
      }
    },
  );

  /**
   * [DELETE] /:id/resources/ippools/:name
   * 删除 IP Pool。
   */
  router.delete(
    '/:id/resources/ippools/:name',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, name } = req.params;
        const { allowed } = await checkTenantAccess(req, id);
        if (!allowed)
          return res
            .status(403)
            .json({ message: 'Access denied to this resource pool' });

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (
          !ensureProvider(
            cloud,
            'harvester',
            res,
            'Operation not supported',
            next,
          )
        )
          return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        let endpointBase = (cloud.endpoint || '').replace(/\/+$/, '');
        if (!endpointBase.includes('/k8s/clusters/')) {
          endpointBase = endpointBase.replace(/\/v[0-9]+(\/harvester)?$/, '');
        }

        const url = `${endpointBase}/v1/harvester/loadbalancer.harvesterhci.io.ippools/${encodeURIComponent(
          name,
        )}`;

        console.log(`[IPPool] Deleting IP Pool: ${name} | URL: ${url}`);

        try {
          const data = await requestJson(
            'DELETE',
            url,
            cloud.secretKey || '',
            insecure,
          );
          console.log(`[IPPool] Delete Success:`, name);
          return res.json({ message: '删除成功', data });
        } catch (e: any) {
          console.error(
            `[IPPool] Delete Failed: ${e.message}`,
            e.body || e,
          );
          const rawError = e.body || e.message || '删除失败';
          res
            .status(e.status || 500)
            .json({ message: '删除失败', error: rawError });
        }
      } catch (error: any) {
        console.error('[IPPool] Delete failed:', error);
        res.status(500).json({
          message: `删除 IP 池失败 | ${error.body || error.message}`,
          error: error.body,
        });
      }
    },
  );
};
