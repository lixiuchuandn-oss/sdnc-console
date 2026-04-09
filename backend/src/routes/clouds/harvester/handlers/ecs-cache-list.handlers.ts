/**
 * Harvester ECS (虚拟机) Handlers
 * 
 * 从 harvester.cache.vm.routes.ts 中提取的 ECS 相关业务逻辑
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { HarvesterVmInventory } from '../../../../entities/harvester/HarvesterVmInventory';
import { HarvesterVmiInventory } from '../../../../entities/harvester/HarvesterVmiInventory';
import { UserSpace } from '../../../../entities/UserSpace';
import { syncKubevirtVms, syncKubevirtVmis } from '../../../../services/clouds/harvester/inventory';
import {
  getPublicScenarioNamespaceNames,
  mergePublicScenarioNamespacesFromQuery,
} from '../../../../services/clouds/harvester/publicNamespaces';
import { getJsonOnce } from '../../../../services/clouds/harvester/utils';

/**
 * 检查克隆目标 VM 所用 PVC 是否全部 Bound，用于克隆任务结束状态判断。
 * @returns true 表示全部 Bound（克隆卷已就绪），false 表示有未 Bound 或请求失败
 */
async function checkClonePvcsBound(
  origin: string,
  token: string,
  insecure: boolean,
  namespace: string,
  claimNames: string[],
): Promise<boolean> {
  if (!namespace || !Array.isArray(claimNames) || claimNames.length === 0) return true;
  try {
    const results = await Promise.all(
      claimNames.map(async (name) => {
        try {
          const url = `${origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims/${encodeURIComponent(name)}`;
          const pvc = await getJsonOnce(url, token, insecure, true);
          const phase = String(pvc?.status?.phase || '').toLowerCase();
          return phase === 'bound';
        } catch {
          return false;
        }
      }),
    );
    return results.every(Boolean);
  } catch {
    return false;
  }
}

/**
 * GET /:id/resources/ecs - 获取虚拟机列表
 */
export async function harvesterEcsListHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id } = req.params;
    const { force } = req.query;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const vmRepo = AppDataSource.getRepository(HarvesterVmInventory);
    const vmiRepo = AppDataSource.getRepository(HarvesterVmiInventory);

    const isSystemNamespace = (ns: string) => {
      if (!ns) return false;
      const exactBlacklist = ['ingress-nginx'];
      if (exactBlacklist.includes(ns)) return true;
      const prefixBlacklist = [
        'cattle',
        'fleet',
        'longhorn',
        'kube',
        'harvester',
        'cluster',
        'cluster-fleet',
        'local',
        'user',
      ];
      return prefixBlacklist.some((p) => ns.startsWith(p));
    };

    let vmWhere: any = { cloudId: id };
    let vmiWhere: any = { cloudId: id };
    let validNamespaces: string[] | null = null;

    const reqAny = req as any;
    const isTenantUser = reqAny.user?.tenantId && reqAny.user?.role !== 'sase_device';
    const isTenantRole = reqAny.user?.role === 'tenant';
    const isTenant = isTenantUser || isTenantRole;

    if (isTenant) {
      validNamespaces = [];
      const userSpaceRepo = AppDataSource.getRepository(UserSpace);
      const userOrgId = reqAny.user?.organizationId;
      const whereClause: any[] = [];

      // [UserSpace Query] 查询当前用户所属组织的 UserSpace 记录（组织隔离）
      // 组织级用户：只查询 organizationId = userOrgId 的记录
      // 租户级用户（无 organizationId）：查询 organizationId = null 的记录
      if (userOrgId) {
        whereClause.push({
          tenantId: reqAny.user.tenantId,
          cloudId: id,
          status: 'active',
          organizationId: userOrgId, // 严格限制：只查询当前组织的 UserSpace
        });
      } else {
        whereClause.push({
          tenantId: reqAny.user.tenantId,
          cloudId: id,
          status: 'active',
          organizationId: null, // 租户级用户：查询租户级的 UserSpace
        });
      }

      const matches = await userSpaceRepo.find({ where: whereClause });

      if (!matches || matches.length === 0) {
        return res.json({ message: '查询成功', data: [], capabilities: {} });
      }

      // [Namespace Aggregation] 聚合同一组织内所有 UserSpace 记录的命名空间
      // 注意：不会跨组织聚合，因为查询条件已限制 organizationId
      const uniqueNamespaces = new Set<string>();
      matches.forEach((m) => {
        if (m.namespace) {
          m.namespace.split(',').forEach((ns) => {
            const trimmed = ns.trim();
            if (trimmed) uniqueNamespaces.add(trimmed);
          });
        }
      });

      // Auto-Fix: Ensure organization namespace is included
      if (userOrgId) {
        const orgNs = `ns-${userOrgId}`;
        if (!uniqueNamespaces.has(orgNs)) {
          uniqueNamespaces.add(orgNs);
          // Update the first matching UserSpace record
          const firstMatch = matches.find(m => m.organizationId === userOrgId) || matches[0];
          if (firstMatch) {
            const nsList = Array.from(uniqueNamespaces);
            firstMatch.namespace = nsList.join(',');
            try {
              await userSpaceRepo.save(firstMatch);
            } catch (e) {
              console.warn('Failed to auto-update UserSpace namespace', e);
            }
          }
        }
      }

      if (mergePublicScenarioNamespacesFromQuery(req)) {
        (await getPublicScenarioNamespaceNames(id)).forEach((n) => uniqueNamespaces.add(n));
      }

      if (uniqueNamespaces.size > 0) {
        validNamespaces = Array.from(uniqueNamespaces);
      }
    }

    const count = await vmRepo.count({ where: { cloudId: id } });

    if (count === 0 || String(force) === 'true') {
      try {
        await Promise.all([syncKubevirtVms(cloud, insecure), syncKubevirtVmis(cloud, insecure)]);
      } catch (e: any) {
        console.warn('Sync ECS failed, falling back to empty/stale', e);
        if (count === 0) throw e;
      }
    }

    let vmItems = await vmRepo.find({ where: vmWhere });
    const vmiItems = await vmiRepo.find({ where: vmiWhere });
    let vmisRaw = vmiItems.map((i) => i.rawData);

    if (validNamespaces) {
      vmItems = vmItems.filter((i) => validNamespaces!.includes(i.namespace));
      vmisRaw = vmisRaw.filter((v: any) => validNamespaces!.includes(v.metadata?.namespace));
    }

    const includeSystem = req.query.includeSystem === 'true';
    if (isTenant || !includeSystem) {
      vmItems = vmItems.filter((i) => !isSystemNamespace(i.namespace));
      vmisRaw = vmisRaw.filter((v: any) => !isSystemNamespace(v.metadata?.namespace));
    }

    const vmiMap = new Map<string, any>();
    vmisRaw.forEach((v: any) => {
      if (v?.metadata?.name && v?.metadata?.namespace) {
        vmiMap.set(`${v.metadata.namespace}/${v.metadata.name}`, v);
      }
    });

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

      const viewUrl =
        item.view || `${origin}/apis/kubevirt.io/v1/namespaces/${namespace}/virtualmachines/${name}`;

      const status = vm?.status?.printableStatus || vm?.status?.phase || 'Unknown';

      const ips: string[] = [];
      const macs: string[] = [];
      const addIp = (s: any) => {
        const v = String(s || '').trim();
        if (v && !ips.includes(v)) ips.push(v);
      };

      if (vm?.status?.vmIp) addIp(vm.status.vmIp);
      if (Array.isArray(vm?.status?.interfaces)) {
        vm.status.interfaces.forEach((i: any) => {
          addIp(i.ipAddress || i.ip);
          if (i.mac || i.macAddress) macs.push(i.mac || i.macAddress);
        });
      }
      if (vmi) {
        if (Array.isArray(vmi.status?.interfaces)) {
          vmi.status.interfaces.forEach((i: any) => {
            if (i.ipAddress || i.ip) addIp(i.ipAddress || i.ip);
            if (i.mac || i.macAddress) macs.push(i.mac || i.macAddress);
          });
        }
      }

      const nodeName = vm?.status?.nodeName || vmi?.status?.nodeName || '';

      const networksArr: any[] = Array.isArray(vm?.spec?.template?.spec?.networks)
        ? vm?.spec?.template?.spec?.networks
        : [];
      const networks: string[] = networksArr
        .map((n: any) => n?.multus?.networkName || (n?.name ? String(n.name) : 'pod'))
        .filter((s: string) => !!s);

      const cpu =
        vm?.spec?.template?.spec?.domain?.cpu?.cores ||
        vm?.spec?.template?.spec?.domain?.cpu?.sockets ||
        undefined;
      const memory =
        vm?.spec?.template?.spec?.domain?.resources?.requests?.memory ||
        vm?.spec?.template?.spec?.domain?.memory?.guest ||
        undefined;

      const volumes = vm?.spec?.template?.spec?.volumes || [];
      const volumeClaims = volumes
        .map((v: any) => v?.persistentVolumeClaim?.claimName)
        .filter((n: string) => !!n);

      const creationTimestamp = vm?.metadata?.creationTimestamp;
      const description = vm?.metadata?.annotations?.description || '';
      const creator = vm?.metadata?.labels?.['harvesterhci.io/creator'] || '';
      const conditions = vm?.status?.conditions || [];

      const mergedAnnotations = {
        ...(vm?.metadata?.annotations || {}),
        ...(item.annotations || {}),
      };

      return {
        ...vm,
        metadata: {
          ...(vm?.metadata || {}),
          annotations: mergedAnnotations,
        },
        view: viewUrl,
        links: { view: viewUrl },
        id: uid,
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
        vpcName: networks.find((n) => n !== 'pod' && n !== 'default'),
        volumeClaims,
        cpu,
        memoryGb: memory,
        vmiRaw: vmi,
        vmi: vmi,
      };
    });

    // 克隆任务状态：对带 tower.io/cloneTask 且 cloneType=standard 的 VM 查询其 PVC 是否全部 Bound
    await Promise.all(
      data.map(async (row: any) => {
        const cloneAnno = row?.metadata?.annotations?.['tower.io/cloneTask'];
        if (!cloneAnno) return;
        let isStandardClone = false;
        try {
          const info = JSON.parse(cloneAnno);
          isStandardClone = info?.cloneType === 'standard';
        } catch {
          return;
        }
        if (!isStandardClone) return;
        const ns = row.namespace || '';
        const claims: string[] = Array.isArray(row.volumeClaims) ? row.volumeClaims : [];
        if (claims.length === 0) {
          row.clonePvcsReady = true;
          return;
        }
        row.clonePvcsReady = await checkClonePvcsBound(
          origin,
          cloud.secretKey || '',
          insecure,
          ns,
          claims,
        );
      }),
    );

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
}
