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

// Helper: Convert IP string to number
const ipToLong = (ip: string): number => {
  return (
    ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>>
    0
  );
};

// Helper: Convert CIDR to range [start, end]
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

// Helper: Check if ranges overlap
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
   * 直连查询 Harvester 中的 NetworkAttachmentDefinition 列表。
   * - 通过 Harvester 提供的 /v1/harvester/k8s.cni.cncf.io.network-attachment-definitions 接口获取
   * - 使用 checkTenantAccess 做租户命名空间过滤
   * - 使用 isNamespaceAllowed 校验目标命名空间是否在允许列表中
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
   * 获取单个 NetworkAttachmentDefinition 详情（直连 kube-ovn CRD）
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
   * Subnets (Kube-OVN)
   * ==================================================================================
   * 直连 Kube-OVN Subnet CRD，实现子网的创建 / 更新 / 删除。
   * 注意：
   * - 创建子网前会尝试自动创建对应 NAD（k8s.cni.cncf.io/v1）
   * - provider 字段必须满足 `<nadName>.<nadNamespace>.ovn` 格式
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
          nat,
          allowDhcp,
          disableGatewayCheck,
        } = req.body;

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

        // CIDR Conflict Pre-check
        try {
            const existing = await getJsonOnce(`${origin}/apis/kubeovn.io/v1/subnets`, cloud.secretKey || '', insecure);
            const items: any[] = Array.isArray(existing?.items) ? existing.items : Array.isArray(existing?.data) ? existing.data : [];
            const reqRange = cidrToRange(String(cidrBlock || '').trim());
            if (reqRange) {
            for (const s of items) {
                const c = String(s?.spec?.cidrBlock || s?.spec?.cidr || '').trim();
                const r = cidrToRange(c);
                if (r && rangesOverlap(reqRange, r)) {
                const conflictName = s?.metadata?.name || s?.name;
                if (conflictName) {
                    res.status(422).send(`当前创建的子网和已存在的子网${conflictName}冲突`);
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
        const nadNamespace = 'default';
        const fullProvider = `${nadName}.${nadNamespace}.ovn`;

        const nadUrl = `${origin}/apis/k8s.cni.cncf.io/v1/namespaces/${nadNamespace}/network-attachment-definitions`;
        const nadPayload = {
          apiVersion: 'k8s.cni.cncf.io/v1',
          kind: 'NetworkAttachmentDefinition',
          metadata: {
            name: nadName,
            namespace: nadNamespace,
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
        try {
          await requestJson(
            'POST',
            nadUrl,
            cloud.secretKey || '',
            insecure,
            nadPayload,
          );
          createdNewNad = true;
        } catch (nadError: any) {
          const isConflict =
            nadError?.response?.status === 409 ||
            nadError?.status === 409 ||
            String(nadError?.message || '')
              .toLowerCase()
              .includes('alreadyexists');
          if (!isConflict) {
            console.warn(
              '[CreateSubnet] Warning: Failed to create NAD, but will attempt Subnet creation anyway.',
              nadError.message,
            );
          }
          if (isConflict) createdNewNad = false;
        }

        const payload = {
          apiVersion: 'kubeovn.io/v1',
          kind: 'Subnet',
          metadata: {
            name,
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
            // Rollback NAD if subnet creation failed
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

        // Check for VM usage (NAD)
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

        // Cascade delete NAD (best-effort)
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
   * 直连查询 / 创建 Harvester 负载均衡资源。
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
   * Switch LBRules（负载均衡规则）
   * ==================================================================================
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
   * 直连 kube-ovn.io 相关 CRD，提供 EIP / FIP / SNAT / DNAT 的查询与创建能力。
   */
  router.get(
    '/:id/resources/ovneips',
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

  router.post(
    '/:id/resources/ovneips',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
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

  router.get(
    '/:id/resources/ovnfips',
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

  router.get(
    '/:id/resources/ovnsnatrules',
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

  router.get(
    '/:id/resources/ovndnatrules',
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

