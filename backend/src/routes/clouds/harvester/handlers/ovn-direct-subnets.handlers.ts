import { Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { KubeOvnSubnetInventory } from '../../../../entities/kubeovn/KubeOvnSubnetInventory';
import { KubevirtNadInventory } from '../../../../entities/kubevirt/KubevirtNadInventory';
import { getJsonOnce, requestJson } from '../../../../services/clouds/harvester/utils';
import { updateHarvesterSubnet } from '../../../../services/clouds/harvester/client';
import { syncKubeOvnSubnets } from '../../../../services/clouds/harvester/inventory';
import { checkTenantAccess, fetchCloudOr404, ensureProvider } from '../harvester.direct.helpers';

const ipToLong = (ip: string): number =>
  ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;

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

const rangesOverlap = (r1: [number, number], r2: [number, number]): boolean =>
  Math.max(r1[0], r2[0]) <= Math.min(r1[1], r2[1]);

export async function harvesterSubnetDirectListHandler(
  req: any,
  res: Response,
) {
  try {
    const { id } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;

    const { force, skipSync } = req.query;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const repo = AppDataSource.getRepository(KubeOvnSubnetInventory);
    const count = await repo.count({ where: { cloudId: id } });

    const shouldSync =
      count === 0 || (String(force) === 'true' && String(skipSync) !== 'true');
    if (shouldSync) {
      await syncKubeOvnSubnets(cloud, insecure);
    } else if (String(skipSync) === 'true') {
      console.log('[Subnet-Refresh] 跳过全量同步（创建后刷新），直接查询数据库');
    }

    const dbItems = await repo.find({ where: { cloudId: id } });
    const items = dbItems.map((item) => item.rawData || {
      metadata: {
        name: item.name,
        uid: item.uid,
        labels: item.labels,
        annotations: item.annotations,
      },
      spec: {
        vpc: item.vpc,
        cidrBlock: item.cidr,
        gateway: item.gateway,
        protocol: item.protocol,
      },
      status: {
        availableIPs: item.availableIps,
      },
    });

    try {
      const nadRepo = AppDataSource.getRepository(KubevirtNadInventory);
      const nads = await nadRepo.find({ where: { cloudId: id } });
      const nadMap = new Map<string, string>();
      nads.forEach((nad: any) => {
        const name = nad.name || nad.rawData?.metadata?.name;
        const namespace = nad.namespace || nad.rawData?.metadata?.namespace;
        if (name && namespace) nadMap.set(name, namespace);
      });
      items.forEach((subnet: any) => {
        const name = subnet?.metadata?.name;
        if (name && nadMap.has(name)) {
          if (!subnet.metadata) subnet.metadata = {};
          subnet.metadata.namespace = nadMap.get(name);
        }
      });
    } catch (e) {
      console.warn('[Subnets] Failed to enrich NAD namespace info:', e);
    }

    res.json({ message: '查询成功', data: { items } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询 Subnets 失败', error: error.message });
  }
}

export async function harvesterSubnetDirectCreateHandler(
  req: any,
  res: Response,
  next: any,
) {
  try {
    const { id } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed)
      return res.status(403).json({ message: 'Access denied to this resource pool' });

    const {
      name,
      vpc,
      cidrBlock,
      gateway,
      protocol,
      excludeIps,
      vlan,
      gatewayType,
      namespaces,
      namespace,
      nat,
      allowDhcp,
      disableGatewayCheck,
      annotations,
    } = req.body;

    if (!name || !cidrBlock) {
      res.status(400).json({ message: '缺少必要参数: name, cidrBlock' });
      return;
    }
    const nameStr = String(name).trim();
    if (/^[0-9]/.test(nameStr) || /^[0-9]+$/.test(nameStr)) {
      res.status(422).send('当前创建的子网名称不能以数字开头或为纯数字');
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

    try {
      const existing = await getJsonOnce(
        `${origin}/apis/kubeovn.io/v1/subnets`,
        cloud.secretKey || '',
        insecure,
      );
      const items: any[] = Array.isArray(existing?.items)
        ? existing.items
        : Array.isArray(existing?.data)
        ? existing.data
        : [];
      const reqRange = cidrToRange(String(cidrBlock || '').trim());
      if (reqRange) {
        const targetVpc = vpc || 'ovn-cluster';
        for (const s of items) {
          const currentVpc = s?.spec?.vpc || 'ovn-cluster';
          if (currentVpc !== targetVpc) continue;
          const c = String(s?.spec?.cidrBlock || s?.spec?.cidr || '').trim();
          const r = cidrToRange(c);
          if (r && rangesOverlap(reqRange, r)) {
            const conflictName = s?.metadata?.name || s?.name;
            if (conflictName) {
              res
                .status(422)
                .send(`当前创建的子网和已存在的子网 ${conflictName} (VPC: ${currentVpc}) 冲突`);
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
    const nadNamespace = namespace || 'default';
    const fullProvider = `${nadName}.${nadNamespace}.ovn`;
    const nadCandidates = [
      `${origin}/apis/k8s.cni.cncf.io/v1/namespaces/${nadNamespace}/network-attachment-definitions`,
      `${origin}/apis/k8s.cni.cncf.io/v1/namespaces/${nadNamespace}/networkattachmentdefinitions`,
      `${origin}/v1/harvester/k8s.cni.cncf.io.network-attachment-definitions`,
      `${origin}/v1/harvester/k8s.cni.cncf.io.networkattachmentdefinitions`,
    ];

    const nadPayload = {
      apiVersion: 'k8s.cni.cncf.io/v1',
      kind: 'NetworkAttachmentDefinition',
      metadata: {
        name: nadName,
        namespace: nadNamespace,
        finalizers: ['tower.io/managed'],
        labels: { 'tower.io/creator': 'compute-tower' },
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
        await requestJson('POST', nadUrl, cloud.secretKey || '', insecure, nadPayload);
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
        if (status === 404 || status === 405 || status === 400 || status === 422 || msg.includes('404')) {
          lastNadError = nadError;
          continue;
        }
        if (!res.headersSent) res.status(500).json({ message: '创建 NAD 失败', error: nadError.message });
        return;
      }
    }

    if (!nadCreatedOrExists) {
      if (!res.headersSent) {
        res.status(500).json({ message: '创建 NAD 失败 (API 路径未找到)', error: lastNadError?.message });
      }
      return;
    }

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
        ...(namespaces && Array.isArray(namespaces) ? { namespaces } : {}),
        provider: fullProvider,
        ...(vlan ? { vlan } : {}),
        ...(gatewayType ? { gatewayType } : {}),
        ...(disableGatewayCheck !== undefined ? { disableGatewayCheck } : {}),
        natOutgoing: nat !== undefined ? nat : false,
        enableDhcp: allowDhcp !== undefined ? allowDhcp : true,
      },
    };

    try {
      const result = await requestJson('POST', url, cloud.secretKey || '', insecure, payload);
      if (result && result.metadata) {
        try {
          const repo = AppDataSource.getRepository(KubeOvnSubnetInventory);
          const entity = repo.create({
            cloudId: cloud.id,
            uid: result.metadata?.uid || '',
            name: result.metadata?.name || '',
            namespace: result.metadata?.namespace,
            vpc: result.spec?.vpc,
            cidr: result.spec?.cidrBlock || result.spec?.cidr,
            gateway: result.spec?.gateway,
            protocol: result.spec?.protocol,
            availableIps:
              Number(result.status?.availableIPs ?? result.status?.availableIps ?? 0) ||
              undefined,
            labels: result.metadata?.labels,
            annotations: result.metadata?.annotations,
            rawData: result,
          });
          await repo.save(entity);
        } catch (e: any) {
          console.error('[Subnet-Create] 入库失败:', e?.message || e);
        }
      }
      res.json({ message: '创建子网成功', data: result });
    } catch (error: any) {
      if (createdNewNad) {
        try {
          const nadDelUrl = `${origin}/apis/k8s.cni.cncf.io/v1/namespaces/${nadNamespace}/network-attachment-definitions/${encodeURIComponent(name)}`;
          await requestJson('DELETE', nadDelUrl, cloud.secretKey || '', insecure);
        } catch {}
      }
      if (res.headersSent) return;
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
}

export async function harvesterSubnetDirectUpdateHandler(
  req: any,
  res: Response,
  next: any,
) {
  try {
    const { id, subnetId } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed)
      return res.status(403).json({ message: 'Access denied to this resource pool' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next)) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const data = await updateHarvesterSubnet(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
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
}

export async function harvesterSubnetDirectDeleteHandler(
  req: any,
  res: Response,
  next: any,
) {
  try {
    const { id, name } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed)
      return res.status(403).json({ message: 'Access denied to this resource pool' });

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

    try {
      const ecsList = await getJsonOnce(
        `${origin}/v1/harvester/kubevirt.io.virtualmachines`,
        cloud.secretKey || '',
        insecure,
      );
      const vms: any[] = Array.isArray(ecsList?.items)
        ? ecsList.items
        : Array.isArray(ecsList?.data)
        ? ecsList.data
        : [];
      const targetRef = `default/${name}`.toLowerCase();
      const usingVms = vms
        .map((vm: any) => {
          const networks: any[] = vm?.spec?.template?.spec?.networks || [];
          const nets = networks
            .map((n: any) => n?.multus?.networkName)
            .filter((n: any) => typeof n === 'string');
          const alias = vm?.metadata?.annotations?.['tower.io/alias'] || vm?.metadata?.name;
          const matched = nets.some((n: string) => {
            const s = String(n || '').toLowerCase();
            const baseName = s.includes('@') ? s.split('@')[0] : s;
            return baseName === targetRef || baseName.endsWith(`/${name.toLowerCase()}`);
          });
          return matched ? alias : undefined;
        })
        .filter((x: any) => typeof x === 'string' && x.trim().length > 0);

      if (usingVms.length > 0) {
        res
          .status(409)
          .send(
            `不能删除此子网，因为正在被虚拟机使用 ${usingVms.slice(0, 5).join('，')}${usingVms.length > 5 ? ' 等' : ''}`,
          );
        return;
      }
    } catch (checkError) {
      console.warn('[DeleteSubnet] Failed to check VM usage, proceeding anyway:', checkError);
    }

    await requestJson('DELETE', url, cloud.secretKey || '', insecure);

    try {
      const nadDelUrl = `${origin}/apis/k8s.cni.cncf.io/v1/namespaces/default/network-attachment-definitions/${encodeURIComponent(name)}`;
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
}
