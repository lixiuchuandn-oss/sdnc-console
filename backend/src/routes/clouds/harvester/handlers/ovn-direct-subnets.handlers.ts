import { Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { KubeOvnSubnetInventory } from '../../../../entities/kubeovn/KubeOvnSubnetInventory';
import { KubevirtNadInventory } from '../../../../entities/kubevirt/KubevirtNadInventory';
import { getJsonOnce, requestJson } from '../../../../services/clouds/harvester/utils';
import { updateHarvesterSubnet } from '../../../../services/clouds/harvester/client';
import { syncKubeOvnSubnets } from '../../../../services/clouds/harvester/inventory';
import {
  checkTenantAccess,
  fetchCloudOr404,
  ensureProvider,
  resolveHarvesterK8sApiBase,
} from '../harvester.direct.helpers';
import { parseKubeOvnAclRulesInput } from '../../../../services/clouds/harvester/kubeOvnAclRules';

/**
 * =============================================================================
 * Kube-OVN Subnet 直连（创建/列表/更新/删除）与「网络类型」说明
 * =============================================================================
 *
 * 【NAD 网络】NetworkAttachmentDefinition
 *   - 非本子网 CR 本身；创建子网时顺带 POST NAD，供 VM Multus 选择。
 *   - CNI type=kube-ovn 时，config.provider 须为「子网名.命名空间.ovn」，与 Subnet.spec.provider 一致（逻辑交换机名）。
 *   - Harvester webhook 要求上述三段式，不能把物理 ProviderNetwork 名塞进 NAD CNI provider。
 *
 * 【扁平子网】metadata.annotations['tower.io/subnet-type']=flat
 *   - 默认 VPC（常为 ovn-cluster）下的 underlay 子网；用户选的 ProviderNetwork 写入注解 tower.io/provider-network。
 *
 * 【公共子网】annotations['tower.io/subnet-type']=public
 *   - 仍在默认 VPC 下；产品侧多用于 EIP/NAT 等，创建时通常 natOutgoing=true（由前端传参）。
 *
 * 【VPC 子网】annotations['tower.io/subnet-type']=vpc
 *   - spec.vpc 为用户业务 VPC；与扁平/公共子网区分，不在本 handler 单独分支，靠请求体 vpc + 注解区分。
 *
 * =============================================================================
 */

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

/** Kubernetes metadata.name / DNS1123 子域名（小写），与 apiserver 校验一致 */
const K8S_METADATA_NAME_MAX = 253;
const isK8sMetadataName = (s: string): boolean => {
  if (!s || s.length > K8S_METADATA_NAME_MAX) return false;
  return /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/.test(s);
};

/** 与 VM / NAD 删除逻辑一致：创建时写入的 tower.io/managed 若无 controller 摘除，DELETE 会长期 Terminating */
const TOWER_MANAGED_FINALIZER = 'tower.io/managed';

/** 对标准 K8s apiserver URL（/apis/...）GET 后 JSON Patch 移除所有 tower.io/managed */
async function removeTowerManagedFinalizerFromResourceUrl(
  resourceUrl: string,
  token: string,
  insecure: boolean,
  logPrefix = '[DeleteSubnet]',
): Promise<void> {
  if (!resourceUrl.includes('/apis/')) return;
  try {
    const obj = await getJsonOnce(resourceUrl, token, insecure);
    const finalizers: string[] = Array.isArray(obj?.metadata?.finalizers)
      ? obj.metadata.finalizers
      : [];
    const indicesToRemove = finalizers
      .map((f: string, i: number) => (f === TOWER_MANAGED_FINALIZER ? i : -1))
      .filter((i: number) => i >= 0)
      .sort((a: number, b: number) => b - a);
    if (indicesToRemove.length === 0) return;
    const patchOps = indicesToRemove.map((index: number) => ({
      op: 'remove' as const,
      path: `/metadata/finalizers/${index}`,
    }));
    await requestJson('PATCH', resourceUrl, token, insecure, patchOps, {
      'Content-Type': 'application/json-patch+json',
    });
  } catch (e: any) {
    const st = Number(e?.status ?? 0);
    if (st === 404) return;
    console.warn(`${logPrefix} 移除 tower.io/managed 失败（仍将尝试 DELETE）:`, resourceUrl, e?.message || e);
  }
}

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
        v4AvailableIPs: item.availableIps,
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
      natOutgoing,
      allowDhcp,
      disableGatewayCheck,
      annotations,
      provider: providerFromBody,
      finalizers: finalizersFromBody,
    } = req.body;

    if (!name || !cidrBlock) {
      res.status(400).json({ message: '缺少必要参数: name, cidrBlock' });
      return;
    }
    const nameStr = String(name).trim();
    if (!isK8sMetadataName(nameStr)) {
      res.status(422).json({
        message:
          '子网名称须符合 Kubernetes 命名规则：仅小写英文字母、数字、连字符或点号，需以字母或数字开头和结尾（例如 flat-net-1）。不能使用中文或空格。',
        code: 'SUBNET_NAME_INVALID',
      });
      return;
    }
    if (excludeIps && Array.isArray(excludeIps)) {
      const valid = excludeIps.every((ip: any) => typeof ip === 'string' && ip.trim().length > 0);
      if (!valid) {
        res.status(400).json({ message: 'excludeIps 格式错误，应为非空字符串数组' });
        return;
      }
    }

    let specAcls: any[] | undefined;
    if (Object.prototype.hasOwnProperty.call(req.body, 'acls')) {
      const aclResult = parseKubeOvnAclRulesInput(req.body.acls, 'acls');
      if (!aclResult.ok) {
        res.status(400).json({ message: aclResult.message });
        return;
      }
      specAcls = aclResult.value;
    }

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const rawEndpoint = String(cloud.endpoint || '').trim();
    const apiBase = resolveHarvesterK8sApiBase(rawEndpoint);

    try {
      const subnetListUrl = `${apiBase}/apis/kubeovn.io/v1/subnets`;
      const existing = await getJsonOnce(
        subnetListUrl,
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
              res.status(422).json({
                message: `网段冲突：新子网的 CIDR 与同 VPC 内已有子网「${conflictName}」的网段重叠（VPC: ${currentVpc}）。请改用不重叠的网段，或调整已有子网。`,
                code: 'SUBNET_CIDR_CONFLICT',
                conflictSubnet: conflictName,
                vpc: currentVpc,
              });
              return;
            }
          }
        }
      }
    } catch (e) {
      console.warn('[CreateSubnet] CIDR pre-check failed, proceeding anyway:', e);
    }

    const url = `${apiBase}/apis/kubeovn.io/v1/subnets`;
    const nadName = name;
    const nadNamespace = namespace || 'default';
    const nadNsEncoded = encodeURIComponent(nadNamespace);
    /**
     * 与 VPC 子网创建一致：spec.provider 与 NAD CNI 均使用逻辑交换机名 name.namespace.ovn。
     * 表单里的「Provider Network」是物理资源名，不能写入 spec.provider（会导致与 NAD 不一致及 Harvester 校验失败）；
     * 仅记入注解供展示/运维。
     */
    const logicalProvider = `${nadName}.${nadNamespace}.ovn`;
    /** 注解 tower.io/subnet-type：flat→扁平子网，public→公共子网，vpc→VPC 子网（与前端产品名一致） */
    const subnetTypeAnn = String(annotations?.['tower.io/subnet-type'] || '').trim().toLowerCase();
    const isUnderlayFlatOrPublic = subnetTypeAnn === 'flat' || subnetTypeAnn === 'public';
    const providerNetworkHint =
      typeof providerFromBody === 'string' && providerFromBody.trim().length > 0
        ? providerFromBody.trim()
        : '';
    const mergedAnnotations: Record<string, string> = {};
    if (annotations && typeof annotations === 'object') {
      for (const key of Object.keys(annotations)) {
        const v = (annotations as Record<string, unknown>)[key];
        if (v != null && String(v).length > 0) mergedAnnotations[key] = String(v);
      }
    }
    if (isUnderlayFlatOrPublic && providerNetworkHint) {
      mergedAnnotations['tower.io/provider-network'] = providerNetworkHint;
    }
    const nadCandidates = [
      `${apiBase}/apis/k8s.cni.cncf.io/v1/namespaces/${nadNsEncoded}/network-attachment-definitions`,
      `${apiBase}/apis/k8s.cni.cncf.io/v1/namespaces/${nadNsEncoded}/networkattachmentdefinitions`,
      `${apiBase}/v1/harvester/k8s.cni.cncf.io.network-attachment-definitions`,
      `${apiBase}/v1/harvester/k8s.cni.cncf.io.networkattachmentdefinitions`,
      `${apiBase}/v1/k8s.cni.cncf.io.networkattachmentdefinitions`,
      `${apiBase}/v1/cni.cncf.io.networkattachmentdefinitions`,
    ];

    const nadMetadata = {
      name: nadName,
      namespace: nadNamespace,
      finalizers: ['tower.io/managed'],
      labels: { 'tower.io/creator': 'compute-tower' },
    };
    const cniConfigObj = {
      cniVersion: '0.3.1',
      name: nadName,
      type: 'kube-ovn',
      server_socket: '/run/openvswitch/kube-ovn-daemon.sock',
      provider: logicalProvider,
    };
    const cniConfigJson = JSON.stringify(cniConfigObj);

    /** 原生 K8s API 要求 apiVersion+kind；Steve（/v1/harvester 等）要求 type */
    const buildNadPayloadForUrl = (targetUrl: string) => {
      if (targetUrl.includes('/apis/k8s.cni.cncf.io/')) {
        return {
          apiVersion: 'k8s.cni.cncf.io/v1',
          kind: 'NetworkAttachmentDefinition',
          metadata: nadMetadata,
          spec: { config: cniConfigJson },
        };
      }
      return {
        type: 'k8s.cni.cncf.io.networkattachmentdefinition',
        metadata: nadMetadata,
        spec: { config: cniConfigJson },
      };
    };

    let createdNewNad = false;
    let nadCreatedOrExists = false;
    let lastNadError: any = null;

    const formatNadErrDetail = (e: any): string => {
      try {
        const b = e?.body;
        if (b == null) return '';
        if (typeof b === 'string') return b.length > 800 ? `${b.slice(0, 800)}…` : b;
        return JSON.stringify(b).length > 800
          ? `${JSON.stringify(b).slice(0, 800)}…`
          : JSON.stringify(b);
      } catch {
        return '';
      }
    };

    for (let i = 0; i < nadCandidates.length; i++) {
      const nadUrl = nadCandidates[i];
      const nadPayload = buildNadPayloadForUrl(nadUrl);
      try {
        await requestJson('POST', nadUrl, cloud.secretKey || '', insecure, nadPayload);
        createdNewNad = true;
        nadCreatedOrExists = true;
        break;
      } catch (nadError: any) {
        const status = Number(nadError?.response?.status ?? nadError?.status ?? 0);
        const msg = String(nadError?.message || '');
        const msgLower = msg.toLowerCase();
        const detail = formatNadErrDetail(nadError);
        const detailLower = (detail || '').toLowerCase();
        const nadBeingDeleted =
          detailLower.includes('being deleted') ||
          detailLower.includes('foregrounddeletion') ||
          detailLower.includes('terminating');
        const isConflict = status === 409 || msgLower.includes('alreadyexists');
        if (isConflict && nadBeingDeleted) {
          if (!res.headersSent) {
            res.status(409).json({
              message:
                '同名网络附件定义（NAD）正在集群中删除，请等待删除完成后再创建，或更换子网名称。',
              error: detail || msg,
            });
          }
          return;
        }
        if (isConflict) {
          nadCreatedOrExists = true;
          createdNewNad = false;
          break;
        }
        // 422：请求已到正确 API，属于业务/字段校验，不应再换路径重试
        if (status === 422) {
          if (!res.headersSent) {
            res.status(422).json({
              message: '创建 NAD 未通过集群校验',
              error: detail || msg,
            });
          }
          return;
        }
        if (status === 404 || status === 405 || msgLower.includes('404')) {
          lastNadError = nadError;
          continue;
        }
        // 400：多为当前路径与请求体不匹配；换 URL 重试。若已是最后一条仍失败会走汇总错误。
        if (status === 400) {
          lastNadError = nadError;
          continue;
        }
        if (!res.headersSent) res.status(500).json({ message: '创建 NAD 失败', error: nadError.message });
        return;
      }
    }

    if (!nadCreatedOrExists) {
      if (!res.headersSent) {
        res.status(500).json({
          message: '创建 NAD 失败 (API 路径未找到)',
          error: lastNadError?.message,
          debug: {
            apiBase,
            triedUrls: nadCandidates,
            lastStatus: lastNadError?.status,
            lastBodyPreview: formatNadErrDetail(lastNadError) || undefined,
          },
        });
      }
      return;
    }

    const natOutgoingVal =
      natOutgoing !== undefined
        ? natOutgoing
        : nat !== undefined
          ? nat
          : false;

    const payload = {
      apiVersion: 'kubeovn.io/v1',
      kind: 'Subnet',
      metadata: {
        name,
        ...(Object.keys(mergedAnnotations).length > 0 ? { annotations: mergedAnnotations } : {}),
        ...(Array.isArray(finalizersFromBody) && finalizersFromBody.length
          ? { finalizers: finalizersFromBody }
          : {}),
      },
      spec: {
        vpc,
        cidrBlock,
        gateway,
        protocol: protocol || 'IPv4',
        ...(excludeIps && Array.isArray(excludeIps) ? { excludeIps } : {}),
        ...(namespaces && Array.isArray(namespaces) ? { namespaces } : {}),
        provider: logicalProvider,
        ...(vlan ? { vlan } : {}),
        ...(gatewayType ? { gatewayType } : {}),
        ...(disableGatewayCheck !== undefined ? { disableGatewayCheck } : {}),
        natOutgoing: natOutgoingVal,
        enableDhcp: allowDhcp !== undefined ? allowDhcp : true,
        ...(specAcls !== undefined ? { acls: specAcls } : {}),
        ...(Object.prototype.hasOwnProperty.call(req.body, 'allowEWTraffic')
          ? { allowEWTraffic: !!req.body.allowEWTraffic }
          : {}),
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
            availableIps: (() => {
              const raw =
                result.status?.v4AvailableIPs ??
                  result.status?.v4availableIPs ??
                  result.status?.availableIPs ??
                  result.status?.availableIps;
              if (raw === undefined || raw === null) return undefined;
              const n = Number(raw);
              return Number.isFinite(n) ? Math.round(n) : undefined;
            })(),
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
        const encNs = encodeURIComponent(nadNamespace);
        const encName = encodeURIComponent(name);
        const rollbackNadUrls = [
          `${apiBase}/apis/k8s.cni.cncf.io/v1/namespaces/${encNs}/network-attachment-definitions/${encName}`,
          `${apiBase}/apis/k8s.cni.cncf.io/v1/namespaces/${encNs}/networkattachmentdefinitions/${encName}`,
          `${apiBase}/v1/harvester/k8s.cni.cncf.io.network-attachment-definitions/${nadNamespace}/${encName}`,
          `${apiBase}/v1/harvester/k8s.cni.cncf.io.networkattachmentdefinitions/${nadNamespace}/${encName}`,
        ];
        for (const nadDelUrl of rollbackNadUrls) {
          try {
            await requestJson('DELETE', nadDelUrl, cloud.secretKey || '', insecure);
            break;
          } catch {}
        }
      }
      if (res.headersSent) return;
      const subSt = Number(error?.status ?? 0);
      const subDetail = error?.body ?? error?.response ?? error?.toString?.();
      if (subSt >= 400 && subSt < 500) {
        res.status(subSt).json({
          message: '创建子网失败',
          error: error.message,
          details: subDetail,
        });
        return;
      }
      res.status(500).json({
        message: '创建子网失败',
        error: error.message,
        details: subDetail,
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

    const body = req.body && typeof req.body === 'object' ? { ...req.body } : {};
    if (Object.prototype.hasOwnProperty.call(body, 'acls')) {
      const aclResult = parseKubeOvnAclRulesInput(body.acls, 'acls');
      if (!aclResult.ok) {
        res.status(400).json({ message: aclResult.message });
        return;
      }
      body.acls = aclResult.value;
    }

    const data = await updateHarvesterSubnet(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      subnetId,
      body,
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

    const apiBase = resolveHarvesterK8sApiBase(cloud.endpoint || '');

    const url = `${apiBase}/apis/kubeovn.io/v1/subnets/${encodeURIComponent(name)}`;

    try {
      const ecsList = await getJsonOnce(
        `${apiBase}/v1/harvester/kubevirt.io.virtualmachines`,
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

    await removeTowerManagedFinalizerFromResourceUrl(url, cloud.secretKey || '', insecure);

    try {
      await requestJson('DELETE', url, cloud.secretKey || '', insecure);
    } catch (delErr: any) {
      const st = Number(delErr?.status ?? 0);
      if (st !== 404) throw delErr;
      // 幂等：集群中已不存在（可能已删、或摘 finalizer 后即时回收）
      console.info('[DeleteSubnet] Subnet DELETE 返回 404，视为已删除:', name);
    }

    try {
      const subnetRepo = AppDataSource.getRepository(KubeOvnSubnetInventory);
      await subnetRepo.delete({ cloudId: id, name });
    } catch (invErr) {
      console.warn('[DeleteSubnet] Failed to remove subnet inventory cache row:', invErr);
    }

    try {
      const encName = encodeURIComponent(name);
      const nadNs = 'default';
      const encNs = encodeURIComponent(nadNs);
      const nadDeleteUrls = [
        `${apiBase}/apis/k8s.cni.cncf.io/v1/namespaces/${encNs}/network-attachment-definitions/${encName}`,
        `${apiBase}/apis/k8s.cni.cncf.io/v1/namespaces/${encNs}/networkattachmentdefinitions/${encName}`,
        `${apiBase}/v1/harvester/k8s.cni.cncf.io.network-attachment-definitions/${nadNs}/${encName}`,
        `${apiBase}/v1/harvester/k8s.cni.cncf.io.networkattachmentdefinitions/${nadNs}/${encName}`,
      ];
      let nadDeleted = false;
      for (const nadDelUrl of nadDeleteUrls) {
        try {
          await removeTowerManagedFinalizerFromResourceUrl(
            nadDelUrl,
            cloud.secretKey || '',
            insecure,
            '[DeleteSubnet/NAD]',
          );
          await requestJson('DELETE', nadDelUrl, cloud.secretKey || '', insecure);
          nadDeleted = true;
          break;
        } catch {}
      }
      if (nadDeleted) {
        try {
          const nadRepo = AppDataSource.getRepository(KubevirtNadInventory);
          await nadRepo.delete({ cloudId: id, name, namespace: nadNs });
        } catch (nadInvErr) {
          console.warn('[DeleteSubnet] Failed to remove NAD inventory cache row:', nadInvErr);
        }
      }
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
