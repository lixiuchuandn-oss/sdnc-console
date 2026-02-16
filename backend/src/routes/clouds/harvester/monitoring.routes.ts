import { Router, Response } from 'express';
import { AppDataSource } from '../../../config/database';
import { Cloud } from '../../../entities/Cloud';
import { PrometheusRulesGroup } from '../../../entities/monitoring/PrometheusRulesGroupEntity';
import { UserSpace } from '../../../entities/UserSpace';
import { getJsonOnce, requestJson } from '../../../services/clouds/harvester/utils';

function normalizeOrigin(endpoint: string): string {
  try {
    const u = new URL(endpoint);
    return `${u.protocol}//${u.host}`;
  } catch {
    return String(endpoint || '')
      .replace(/\/+$/, '')
      .replace(/\/v[0-9].*$/, '');
  }
}

async function getCloudAndConn(
  id: string,
  res: Response,
): Promise<{
  cloud: Cloud;
  origin: string;
  token: string;
  insecure: boolean;
} | null> {
  const repo = AppDataSource.getRepository(Cloud);
  const cloud = await repo.findOne({ where: { id } });
  if (!cloud) {
    res.status(404).json({ message: '云资源不存在' });
    return null;
  }
  const provider = String((cloud as any)?.config?.provider || '').toLowerCase();
  const isHarvesterLike = [
    'harvester',
    'cloudmap',
    'cloudmap.private',
    'cloudmap.edge',
  ].includes(provider);
  if (!isHarvesterLike) {
    res
      .status(400)
      .json({ message: '仅支持 Harvester/Cloudmap 资源池的监控概览' });
    return null;
  }
  const origin = normalizeOrigin(cloud.endpoint || '');
  const token =
    cloud.secretKey ||
    (cloud as any).config?.token ||
    (cloud as any).config?.apiToken ||
    '';
  const insecure = !!(
    (cloud as any).config?.ignoreTls ??
    (cloud as any).config?.insecure
  );
  if (!token) {
    res.status(400).json({ message: '资源池未配置访问凭证' });
    return null;
  }
  return { cloud, origin, token, insecure };
}

async function getTenantAccess(
  req: any,
  cloudId: string,
): Promise<{ allowed: boolean; namespaces: string[]; isAdmin: boolean }> {
  const isTenantUser =
    (req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device';
  const isTenantRole = req.user?.role === 'tenant';
  const isTenant = !!(isTenantUser || isTenantRole);
  if (!isTenant) return { allowed: true, namespaces: [], isAdmin: true };

  const userSpaceRepo = AppDataSource.getRepository(UserSpace);
  const userOrgId = (req.user as any)?.organizationId;
  const whereClause: any[] = [];
  if (userOrgId) {
    whereClause.push({
      tenantId: (req.user as any).tenantId,
      cloudId,
      status: 'active',
      organizationId: userOrgId,
    });
  } else {
    whereClause.push({
      tenantId: (req.user as any).tenantId,
      cloudId,
      status: 'active',
      organizationId: null,
    });
  }
  const matches = await userSpaceRepo.find({
    where: whereClause,
    select: ['namespace'],
  });
  const uniqueNamespaces = new Set<string>();
  matches.forEach((m) => {
    if (m.namespace) {
      m.namespace.split(',').forEach((ns) => {
        const trimmed = ns.trim();
        if (trimmed) uniqueNamespaces.add(trimmed);
      });
    }
  });
  if (uniqueNamespaces.size === 0)
    return { allowed: false, namespaces: [], isAdmin: false };
  return {
    allowed: true,
    namespaces: Array.from(uniqueNamespaces),
    isAdmin: false,
  };
}

const PAGESIZE = 'pagesize=100000';
const EXCLUDE = 'exclude=metadata.managedFields';
const ALERTMANAGER_PATH =
  'api/v1/namespaces/cattle-monitoring-system/services/http:rancher-monitoring-alertmanager:9093/proxy/api/v2/alerts';
const PROMETHEUSRULES_PATH =
  'v1/harvester/monitoring.coreos.com.prometheusrules';
const PROMETHEUSRULES_EXCLUDE =
  'exclude=metadata.managedFields&exclude=metadata.ownerReferences&exclude=metadata.relationships&exclude=metadata.fields&exclude=metadata.state&labelSelector=app.kubernetes.io/rule-type=custom-rules';
const ALERTMANAGERCONFIG_BASE =
  'v1/harvester/monitoring.coreos.com.alertmanagerconfigs';
const PROMETHEUSRULE_VM =
  'v1/harvester/monitoring.coreos.com.prometheusrules/cattle-monitoring-system/virtual-machine-custom-rules';

export function registerMonitoringRoutes(
  router: Router,
  _checkAdminPermission: any,
) {
  router.get(
    '/:id/monitoring/storage-nodes',
    async (req: any, res: Response) => {
      try {
        const conn = await getCloudAndConn(req.params.id, res);
        if (!conn) return;
        const url = `${conn.origin}/v1/harvester/longhorn.io.nodes?${PAGESIZE}&${EXCLUDE}`;
        const data = await getJsonOnce(url, conn.token, conn.insecure, true);
        res.json(data);
      } catch (e: any) {
        const status = (e as any).status || 500;
        res
          .status(status)
          .json({ message: e?.message || '请求存储节点失败' });
      }
    },
  );

  router.get(
    '/:id/monitoring/node-resources',
    async (req: any, res: Response) => {
      try {
        const conn = await getCloudAndConn(req.params.id, res);
        if (!conn) return;
        const url = `${conn.origin}/v1/harvester/nodes?${PAGESIZE}&${EXCLUDE}`;
        const data = await getJsonOnce(url, conn.token, conn.insecure, true);
        res.json(data);
      } catch (e: any) {
        const status = (e as any).status || 500;
        res
          .status(status)
          .json({ message: e?.message || '请求节点资源失败' });
      }
    },
  );

  router.get(
    '/:id/monitoring/node-metrics',
    async (req: any, res: Response) => {
      try {
        const conn = await getCloudAndConn(req.params.id, res);
        if (!conn) return;
        const url = `${conn.origin}/v1/harvester/metrics.k8s.io.nodes?${PAGESIZE}&${EXCLUDE}`;
        const data = await getJsonOnce(url, conn.token, conn.insecure, true);
        res.json(data);
      } catch (e: any) {
        const status = (e as any).status || 500;
        res
          .status(status)
          .json({ message: e?.message || '请求节点监控失败' });
      }
    },
  );

  router.get(
    '/:id/monitoring/virtualmachineinstances',
    async (req: any, res: Response) => {
      try {
        const conn = await getCloudAndConn(req.params.id, res);
        if (!conn) return;
        const url = `${conn.origin}/v1/harvester/kubevirt.io.virtualmachineinstances?${PAGESIZE}&${EXCLUDE}`;
        const data = await getJsonOnce(url, conn.token, conn.insecure, true);
        res.json(data);
      } catch (e: any) {
        const status = (e as any).status || 500;
        res
          .status(status)
          .json({ message: e?.message || '请求虚拟机实例失败' });
      }
    },
  );

  router.get(
    '/:id/monitoring/blockdevices',
    async (req: any, res: Response) => {
      try {
        const conn = await getCloudAndConn(req.params.id, res);
        if (!conn) return;
        const url = `${conn.origin}/v1/harvester/harvesterhci.io.blockdevices?${PAGESIZE}&${EXCLUDE}`;
        const data = await getJsonOnce(url, conn.token, conn.insecure, true);
        res.json(data);
      } catch (e: any) {
        const status = (e as any).status || 500;
        res
          .status(status)
          .json({ message: e?.message || '请求块设备失败' });
      }
    },
  );

  router.get(
    '/:id/monitoring/alerts-rules',
    async (req: any, res: Response) => {
      try {
        const cloudId = req.params.id;
        const datasource = String(
          req.query?.datasource ?? 'prometheus',
        )
          .trim()
          .toLowerCase();
        if (datasource && datasource !== 'prometheus') {
          return res.status(400).json({
            message: '暂不支持的数据源，当前仅支持 prometheus',
          });
        }
        const tenant = await getTenantAccess(req, cloudId);
        if (!tenant.allowed) {
          return res.status(403).json({
            message: '您没有该资源池的访问权限',
          });
        }
        const conn = await getCloudAndConn(cloudId, res);
        if (!conn) return;

        const query = new URLSearchParams();
        query.set('silenced', 'false');
        query.set('inhibited', 'false');
        query.set(
          'receiver',
          'cattle-monitoring-system/default-alertmanager-config/message-receiver',
        );
        const url = `${conn.origin}/${ALERTMANAGER_PATH}?${query.toString()}`;
        const raw = await getJsonOnce(
          url,
          conn.token,
          conn.insecure,
          true,
        );
        let list: any[] = Array.isArray(raw) ? raw : raw?.data ?? [];

        if (!tenant.isAdmin && tenant.namespaces.length > 0) {
          const allowedSet = new Set(tenant.namespaces);
          list = list.filter((item: any) =>
            allowedSet.has(
              String(item?.labels?.namespace ?? '').trim(),
            ),
          );
        }
        const namespaceParam = String(
          (req.query?.namespace ?? req.query?.filter ?? '') as any,
        ).trim();
        if (namespaceParam) {
          const allowedNs = new Set(
            namespaceParam
              .split(/[,，\s]+/)
              .map((s: string) => s.trim())
              .filter(Boolean),
          );
          if (allowedNs.size > 0) {
            list = list.filter((item: any) => {
              const ns = String(item?.labels?.namespace ?? '').trim();
              return allowedNs.has(ns);
            });
          }
        }

        const page = Math.max(
          1,
          parseInt(String(req.query?.page), 10) || 1,
        );
        const pageSize = Math.min(
          100,
          Math.max(
            1,
            parseInt(String(req.query?.pageSize), 10) || 10,
          ),
        );
        const total = list.length;
        const hasPagination =
          req.query?.page !== undefined ||
          req.query?.pageSize !== undefined;
        if (hasPagination) {
          const start = (page - 1) * pageSize;
          list = list.slice(start, start + pageSize);
          res.json({ data: list, total });
        } else {
          res.json(list);
        }
      } catch (e: any) {
        const status = (e as any).status || 500;
        res.status(status).json({
          message: e?.message || '请求告警列表失败',
        });
      }
    },
  );

  router.get(
    '/:id/monitoring/alertmanager/alerts',
    async (req: any, res: Response) => {
      try {
        const conn = await getCloudAndConn(req.params.id, res);
        if (!conn) return;
        const url = `${conn.origin}/${ALERTMANAGER_PATH}`;
        const data = await getJsonOnce(url, conn.token, conn.insecure, true);
        res.json(data);
      } catch (e: any) {
        const status = (e as any).status || 500;
        res
          .status(status)
          .json({ message: e?.message || '请求 Alertmanager 告警失败' });
      }
    },
  );

  router.get(
    '/:id/monitoring/prometheusrules',
    async (req: any, res: Response) => {
      try {
        const cloudId = req.params.id;
        const datasource = String(
          req.query?.datasource ?? '',
        )
          .trim()
          .toLowerCase();
        if (datasource !== 'prometheus') {
          return res.status(400).json({
            message: '此接口仅支持 datasource=prometheus',
          });
        }
        const tenant = await getTenantAccess(req, cloudId);
        if (!tenant.allowed) {
          return res.status(403).json({
            message: '您没有该资源池的访问权限',
          });
        }
        const conn = await getCloudAndConn(cloudId, res);
        if (!conn) return;

        const url = `${conn.origin}/${PROMETHEUSRULES_PATH}?limit=-1&${PROMETHEUSRULES_EXCLUDE}`;
        const raw = await getJsonOnce(
          url,
          conn.token,
          conn.insecure,
          true,
        );
        let data: any[] = Array.isArray((raw as any)?.data)
          ? (raw as any).data
          : [];

        if (!tenant.isAdmin && tenant.namespaces.length > 0) {
          const allowedSet = new Set(tenant.namespaces);
          data = data.filter((item: any) =>
            allowedSet.has(
              String(item?.metadata?.namespace ?? '').trim(),
            ),
          );
        }

        const rulesGroupMap: Record<string, string> = {};
        const rules: Array<{
          datasource: string;
          groupName: string;
          groupAliasName: string;
          namespace?: string;
          name: string;
          aliasName: string;
          expression: string;
          interval: string;
          severity: string;
        }> = [];

        for (const item of data) {
          const meta = item?.metadata ?? {};
          const groupName = String(meta.name ?? '').trim();
          const groupAliasName = String(
            meta.annotations?.['cloudhci.io/rule-name'] ?? '',
          ).trim();
          const namespace = meta.namespace
            ? String(meta.namespace).trim()
            : undefined;
          if (groupName) {
            rulesGroupMap[groupName] = groupAliasName || groupName;
          }

          const groups = item?.spec?.groups ?? [];
          for (const grp of groups) {
            const ruleList = grp?.rules ?? [];
            for (const r of ruleList) {
              if (!r?.alert) continue;
              rules.push({
                datasource: 'prometheus',
                groupName,
                groupAliasName: groupAliasName || groupName,
                namespace,
                name: String(r.alert),
                aliasName: String(
                  r.annotations?.summary ?? r.alert,
                ),
                expression: String(r.expr ?? ''),
                interval: String(r.for ?? ''),
                severity: String(r.labels?.severity ?? ''),
              });
            }
          }
        }

        try {
          const repo = AppDataSource.getRepository(PrometheusRulesGroup);
          let row = await repo.findOne({ where: { cloudId } });
          if (row) {
            row.data = JSON.stringify(rulesGroupMap);
            await repo.save(row);
          } else {
            await repo.save(
              repo.create({
                cloudId,
                data: JSON.stringify(rulesGroupMap),
              }),
            );
          }
        } catch (dbErr: any) {
          console.warn(
            '[monitoring] prometheus-rules cache save failed:',
            dbErr?.message,
          );
        }

        res.json({ rules });
      } catch (e: any) {
        const status = (e as any).status || 500;
        res.status(status).json({
          message: e?.message || '请求 Prometheus 规则失败',
        });
      }
    },
  );

  router.get(
    '/:id/monitoring/prometheusrules-groups',
    async (req: any, res: Response) => {
      try {
        const cloudId = req.params.id;
        const datasource = String(req.query?.datasource ?? '')
          .trim()
          .toLowerCase();
        if (datasource !== 'prometheus') {
          return res
            .status(400)
            .json({ message: '此接口仅支持 datasource=prometheus' });
        }
        const tenant = await getTenantAccess(req, cloudId);
        if (!tenant.allowed)
          return res
            .status(403)
            .json({ message: '您没有该资源池的访问权限' });

        const repo = AppDataSource.getRepository(PrometheusRulesGroup);
        const row = await repo.findOne({ where: { cloudId } });
        const rulesGroupMap: Record<string, string> = row?.data
          ? JSON.parse(row.data)
          : {};
        res.json({ rulesGroupMap });
      } catch (e: any) {
        const status = (e as any).status || 500;
        res
          .status(status)
          .json({ message: e?.message || '获取告警分组失败' });
      }
    },
  );

  router.get(
    '/:id/monitoring/allowed-namespaces',
    async (req: any, res: Response) => {
      try {
        const tenant = await getTenantAccess(req, req.params.id);
        if (!tenant.allowed) {
          return res
            .status(403)
            .json({ message: '您没有该资源池的访问权限' });
        }
        res.json({
          isAdmin: tenant.isAdmin,
          namespaces: tenant.namespaces,
        });
      } catch (e: any) {
        const status = (e as any).status || 500;
        res
          .status(status)
          .json({ message: e?.message || '获取可访问命名空间失败' });
      }
    },
  );

  router.get(
    '/:id/monitoring/prometheusrules/vm-custom-rules',
    async (req: any, res: Response) => {
      try {
        const conn = await getCloudAndConn(req.params.id, res);
        if (!conn) return;
        const exclude =
          'exclude=metadata.managedFields&exclude=metadata.ownerReferences&exclude=metadata.relationships&exclude=metadata.fields&exclude=metadata.state&exclude=metadata.labels&exclude=metadata.annotations';
        const data = await getJsonOnce(
          `${conn.origin}/${PROMETHEUSRULE_VM}?limit=-1&${exclude}`,
          conn.token,
          conn.insecure,
          true,
        );
        res.json(data);
      } catch (e: any) {
        const status = (e as any).status || 500;
        res.status(status).json({
          message: e?.message || '请求虚拟机告警规则失败',
        });
      }
    },
  );

  router.get(
    '/:id/monitoring/alertmanagerconfigs',
    async (req: any, res: Response) => {
      try {
        const cloudId = req.params.id;
        const tenant = await getTenantAccess(req, cloudId);
        if (!tenant.allowed) {
          return res.status(403).json({
            message: '您没有该资源池的访问权限',
          });
        }
        const conn = await getCloudAndConn(cloudId, res);
        if (!conn) return;
        const url = `${conn.origin}/${ALERTMANAGERCONFIG_BASE}?pagesize=100000&exclude=metadata.managedFields`;
        const raw = await getJsonOnce(
          url,
          conn.token,
          conn.insecure,
          true,
        );
        let list: any[] = Array.isArray(raw?.data)
          ? raw.data
          : Array.isArray(raw)
          ? raw
          : [];
        if (!tenant.isAdmin && tenant.namespaces.length > 0) {
          const allowedSet = new Set(tenant.namespaces);
          list = list.filter((item: any) => {
            const ns = (
              item?.metadata?.namespace ?? item?.namespace ?? ''
            )
              .toString()
              .trim();
            return allowedSet.has(ns);
          });
        }
        res.json(
          raw?.data !== undefined ? { ...raw, data: list } : list,
        );
      } catch (e: any) {
        const status = (e as any).status || 500;
        res.status(status).json({
          message: e?.message || '请求告警外发配置列表失败',
        });
      }
    },
  );

  router.get(
    '/:id/monitoring/alertmanagerconfigs/:namespace/:name',
    async (req: any, res: Response) => {
      try {
        const cloudId = req.params.id;
        const { namespace, name } = req.params;
        const tenant = await getTenantAccess(req, cloudId);
        if (!tenant.allowed) {
          return res.status(403).json({
            message: '您没有该资源池的访问权限',
          });
        }
        if (
          !tenant.isAdmin &&
          tenant.namespaces.length > 0 &&
          !tenant.namespaces.includes(namespace)
        ) {
          return res.status(403).json({
            message: '无权访问该命名空间下的配置',
          });
        }
        const conn = await getCloudAndConn(cloudId, res);
        if (!conn) return;
        const path = `${ALERTMANAGERCONFIG_BASE}/${encodeURIComponent(
          namespace,
        )}/${encodeURIComponent(name)}`;
        const data = await getJsonOnce(
          `${conn.origin}/${path}`,
          conn.token,
          conn.insecure,
          true,
        );
        res.json(data);
      } catch (e: any) {
        const status = (e as any).status || 500;
        res.status(status).json({
          message: e?.message || '请求配置详情失败',
        });
      }
    },
  );

  router.post(
    '/:id/monitoring/alertmanagerconfigs',
    async (req: any, res: Response) => {
      try {
        const cloudId = req.params.id;
        const tenant = await getTenantAccess(req, cloudId);
        if (!tenant.allowed) {
          return res.status(403).json({
            message: '您没有该资源池的访问权限',
          });
        }
        const body = req.body || {};
        const ns = (body?.metadata?.namespace ?? '')
          .toString()
          .trim();
        if (
          !tenant.isAdmin &&
          tenant.namespaces.length > 0 &&
          !tenant.namespaces.includes(ns)
        ) {
          return res.status(403).json({
            message: '仅能在您有权限的命名空间下创建配置',
          });
        }
        const conn = await getCloudAndConn(cloudId, res);
        if (!conn) return;
        const data = await requestJson(
          'POST',
          `${conn.origin}/${ALERTMANAGERCONFIG_BASE}`,
          conn.token,
          conn.insecure,
          body,
        );
        res.status(201).json(data);
      } catch (e: any) {
        const status = (e as any).status || 500;
        res.status(500).json({
          message: e?.message || '创建告警外发配置失败',
        });
      }
    },
  );

  router.put(
    '/:id/monitoring/alertmanagerconfigs/:namespace/:name',
    async (req: any, res: Response) => {
      try {
        const cloudId = req.params.id;
        const { namespace, name } = req.params;
        const tenant = await getTenantAccess(req, cloudId);
        if (!tenant.allowed) {
          return res.status(403).json({
            message: '您没有该资源池的访问权限',
          });
        }
        if (
          !tenant.isAdmin &&
          tenant.namespaces.length > 0 &&
          !tenant.namespaces.includes(namespace)
        ) {
          return res.status(403).json({
            message: '无权修改该命名空间下的配置',
          });
        }
        const conn = await getCloudAndConn(cloudId, res);
        if (!conn) return;
        const path = `${ALERTMANAGERCONFIG_BASE}/${encodeURIComponent(
          namespace,
        )}/${encodeURIComponent(name)}`;
        const data = await requestJson(
          'PUT',
          `${conn.origin}/${path}`,
          conn.token,
          conn.insecure,
          req.body,
        );
        res.json(data);
      } catch (e: any) {
        const status = (e as any).status || 500;
        res.status(status).json({
          message: e?.message || '更新告警外发配置失败',
        });
      }
    },
  );

  router.delete(
    '/:id/monitoring/alertmanagerconfigs/:namespace/:name',
    async (req: any, res: Response) => {
      try {
        const cloudId = req.params.id;
        const { namespace, name } = req.params;
        const tenant = await getTenantAccess(req, cloudId);
        if (!tenant.allowed) {
          return res.status(403).json({
            message: '您没有该资源池的访问权限',
          });
        }
        if (
          !tenant.isAdmin &&
          tenant.namespaces.length > 0 &&
          !tenant.namespaces.includes(namespace)
        ) {
          return res.status(403).json({
            message: '无权删除该命名空间下的配置',
          });
        }
        const conn = await getCloudAndConn(cloudId, res);
        if (!conn) return;
        const path = `${ALERTMANAGERCONFIG_BASE}/${encodeURIComponent(
          namespace,
        )}/${encodeURIComponent(name)}`;
        const data = await requestJson(
          'DELETE',
          `${conn.origin}/${path}`,
          conn.token,
          conn.insecure,
        );
        res.json(data);
      } catch (e: any) {
        const status = (e as any).status || 500;
        res.status(status).json({
          message: e?.message || '删除告警外发配置失败',
        });
      }
    },
  );
}

