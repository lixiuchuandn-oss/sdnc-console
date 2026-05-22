import { Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { KubeOvnSubnetInventory } from '../../../../entities/kubeovn/KubeOvnSubnetInventory';
import { KubevirtNadInventory } from '../../../../entities/kubevirt/KubevirtNadInventory';
import { getJsonOnce, requestJson } from '../../../../services/clouds/harvester/utils';
import { updateHarvesterSubnet, listKubeOvnEips } from '../../../../services/clouds/harvester/client';
import { syncKubeOvnSubnets } from '../../../../services/clouds/harvester/inventory';
import { deleteKubeOvnClusterCr, getOriginFromEndpoint } from './ovn-direct-eip-fip-nat.handlers';
import {
  checkTenantAccess,
  fetchCloudOr404,
  ensureProvider,
  findVmDisplayNamesUsingMultusNetwork,
  resolveHarvesterK8sApiBase,
} from '../harvester.direct.helpers';
import { parseKubeOvnAclRulesInput } from '../../../../services/clouds/harvester/kubeOvnAclRules';
import {
  formatTowerNamespacesAnnotation,
  isUnderlayVpcName,
  denyOvnVpcLicense,
  isVpcBusinessKubeOvnSubnetCr,
  isVpcBusinessKubeOvnSubnetIntent,
  KUBE_OVN_FLAT_VPC,
  KUBE_OVN_PUBLIC_VPC,
  listNamespacesFromVpcObject,
  TOWER_IO_NAMESPACES_ANNOTATION,
  TOWER_IO_OVN_NETWORK_SCOPE_ANNOTATION,
  type OvnNetworkScope,
} from '../../../../services/clouds/harvester/kubeOvnNetworkScope';
import {
  OVN_INTERNAL_ROUTE_CIDR_ANNOTATION,
  eipsReferencingSubnetExcludingLrp,
  hasAnyUnderlayEipReferencingPublicOvnSubnet,
  isPublicSubnetOnOvnCluster,
  ovnInternalRouteCidrFromSubnet,
  removeOvnInternalForPublicSubnet,
  upsertOvnInternalForPublicSubnet,
} from './ovnInternalPublicSubnetSync';
import { findVmIpv4OnFlatSubnet } from '../../../../services/clouds/harvester/kubeOvnSecurityGroupAclPush';
import {
  ipv4ToUint32,
  ipv4CidrToUint32Range,
  ipv4Uint32RangesOverlap,
} from '../../../../utils/ipv4Cidr';

const TOWER_EIP_ALIAS_ANNOTATION = 'tower.io/alias';

function kubeOvnEipPublicDisplayLabels(blocking: any[]): string[] {
  return blocking
    .map((e) => {
      const ann = (e?.metadata?.annotations || {}) as Record<string, string>;
      const alias = String(ann[TOWER_EIP_ALIAS_ANNOTATION] ?? '').trim();
      const name = String(e?.metadata?.name ?? e?.name ?? '').trim();
      return alias || name;
    })
    .filter(Boolean);
}

/**
 * =============================================================================
 * Kube-OVN Subnet 直连（创建/列表/更新/删除）
 * =============================================================================
 *
 * ---------------------------------------------------------------------------
 * 子网创建流程（harvesterSubnetDirectCreateHandler）— 顺序与要点
 * ---------------------------------------------------------------------------
 *
 * 1) 入口与前置条件
 *    - HTTP：POST /api/clouds/:id/resources/subnets（路由经 Harvester 直连注册表指向本 handler）。
 *    - 校验：租户/用户对资源池有权限（checkTenantAccess）；云存在且 provider 为 harvester（ensureProvider）。
 *
 * 2) 请求体解析与合法性
 *    - 必填：name（子网 CR 名，须符合 K8s DNS1123 子域名规则）、cidrBlock。
 *    - 主要可选：vpc、gateway、protocol、excludeIps、vlan、namespace（NAD/逻辑 provider 命名空间，默认 default）、
 *      annotations（含 tower.io/subnet-type）、provider（物理 ProviderNetwork 展示名，写入注解 tower.io/provider-network）、
 *      nat / natOutgoing、allowDhcp、acls、allowEWTraffic、finalizers 等。
 *
 * 3) 推导目标 VPC（targetVpc）
 *    - 若请求体显式传 vpc，则始终使用请求值（覆盖默认）。
 *    - 否则按 annotations['tower.io/subnet-type'] 与是否带 vlan 取默认（见代码 defaultVpcForNew）：
 *        · flat：已选 vlan → ovn-cluster；无 vlan → ovn-internal。
 *        · public：固定默认 ovn-cluster（内置 ovn-cluster，与 EIP/南北向等一致）；创建公共子网时请求体应带 tower.io/subnet-type=public。
 *        · vpc：未传 vpc 时代码兜底亦为 ovn-cluster，创建业务 VPC 子网时须由前端传 spec.vpc（业务 VPC 名）。
 *        · 未标注 subnet-type 或其它非 flat 值：默认 ovn-cluster。
 *
 * 4) 同 VPC 网段冲突预检（可选失败）
 *    - 拉取集群现有 kubeovn.io/v1 Subnet 列表，在同一 targetVpc 下用 CIDR 区间判断是否重叠；重叠则 422，不继续创建。
 *    - IPv4 CIDR 解析与区间重叠：`src/utils/ipv4Cidr.ts`（ipv4CidrToUint32Range / ipv4Uint32RangesOverlap）。
 *
 * 5) 合并 Tower 注解（mergedAnnotations）
 *    - 拷贝请求体 annotations 中非空键值。
 *    - 若 subnet-type 为 flat 或 public 且传了 provider，写入 tower.io/provider-network。
 *    - 若 subnet-type 为 flat：按 hasVlan 写入 tower.io/subnet-type-flat-underlay 或 -flat-overlay（互斥）。
 *
 * 6) 逻辑交换机名（与 NAD / Subnet 共用）
 *    - logicalProvider = `${name}.${namespace||default}.ovn`（三段式，Kube-OVN 逻辑 provider 名）。
 *    - Subnet.spec.provider 与此一致；NAD 的 CNI config.provider 也必须为此字符串，不能填物理网络名。
 *
 * 7) 先创建 NAD，再创建 Subnet（顺序固定）
 *    - 原因：Harvester/Kube-OVN 侧常要求 VM 附加网络时 NAD 已存在；子网与同名 NAD 一一对应（同名、同 namespace）。
 *    - NAD POST：按候选 URL 列表依次尝试（标准 apiserver / Steve 等路径），直到成功或穷尽。
 *    - NAD metadata：
 *        · finalizers: tower.io/managed；
 *        · labels：至少 tower.io/creator=compute-tower；
 *        · 须带 network.harvesterhci.io/type=OverlayNetwork：Harvester subnet 准入校验（harvester-network-webhook
 *          checkIfValidNad）要求与 Subnet 绑定的 NAD 该标签必须为 OverlayNetwork；缺省、L2VlanNetwork 或其它值会导致
 *          「network type of nad is not kubeovn instead …」。VLAN/underlay 由 Subnet.spec.vlan 等表达，不通过该标签区分。
 *    - NAD spec.config：JSON 字符串，内为 CNI：type=kube-ovn，provider=logicalProvider，server_socket 等。
 *
 * 8) 创建 Subnet CR
 *    - POST apis/kubeovn.io/v1/subnets，body 含 metadata.name、mergedAnnotations、spec（vpc=targetVpc、cidrBlock、gateway、
 *      provider=logicalProvider、vlan/natOutgoing/enableDHCP/acls 等）。
 *
 * 9) Tower 侧入库
 *    - 成功返回后写入 KubeOvnSubnetInventory（异步失败仅打日志，不推翻集群已创建资源）。
 *
 *10) 失败与回滚
 *    - 若 Subnet POST 失败，且本轮曾新创建 NAD（createdNewNad），则尝试按候选路径 DELETE 同名 NAD，避免留下孤立 NAD。
 *
 * ---------------------------------------------------------------------------
 * 子网类型（注解 tower.io/subnet-type）与产品含义 — 简表
 * ---------------------------------------------------------------------------
 *  · flat：扁平子网；underlay/overlay 由 flat-underlay / flat-overlay 注解与 spec.vlan 共同约定（见上合并逻辑）。
 *  · public：公共子网，默认挂 ovn-cluster，多用于 EIP/NAT 等南北向。
 *  · vpc：业务 VPC 内子网，spec.vpc 为用户 VPC 名。
 *
 * ---------------------------------------------------------------------------
 * 更新 / 删除（路径参数约定）
 * ---------------------------------------------------------------------------
 * PUT|PATCH|DELETE 均使用同一路径片段名：`/:name`
 * - `name` 表示集群中 `kubeovn.io/v1/subnets` 资源的 `metadata.name`（DNS 子域名风格），不是 metadata.uid。
 * =============================================================================
 */

// =============================================================================
// 本子网直连专用：Harvester VirtualMachine 列表、扁平子网排除 IP 校验（复用 utils/ipv4Cidr）
// =============================================================================

/** Steve 聚合路径，与同仓库其它 Harvester 直连一致 */
const HARVEST_KUBEVIRT_VM_LIST_PATH = '/v1/harvester/kubevirt.io.virtualmachines';

/**
 * 拉取 VirtualMachine 列表（响应字段为 `items` 或 `data`）。
 * @param silent 传入 getJsonOnce，降低失败时的日志噪声
 */
async function listHarvestKubevirtVirtualMachines(
  apiBase: string,
  token: string,
  insecure: boolean,
  silent = false,
): Promise<any[]> {
  const json = await getJsonOnce(
    `${apiBase}${HARVEST_KUBEVIRT_VM_LIST_PATH}`,
    token,
    insecure,
    silent,
  );
  if (Array.isArray(json?.items)) return json.items;
  if (Array.isArray(json?.data)) return json.data;
  return [];
}

/** multus.networkName 常用 `default/<subnetName>` 小写，与 findVmDisplayNamesUsingMultusNetwork 约定一致 */
function multusDefaultSubnetRefLower(subnetName: string): string {
  return `default/${String(subnetName).trim()}`.toLowerCase();
}

/** 该 VM 是否通过 multus 挂载与 Subnet CR 同名的 NAD */
function vmUsesMultusSubnet(vm: any, subnetName: string): boolean {
  const name = String(subnetName ?? '').trim();
  if (!name) return false;
  const ref = multusDefaultSubnetRefLower(name);
  return findVmDisplayNamesUsingMultusNetwork([vm], ref, name.toLowerCase()).length > 0;
}

type FlatExcludeFailBody = Record<string, unknown>;

/**
 * 扁平子网更新：校验 excludeIps（数组类型、去重、单行 IPv4 与 CIDR；含 `..` 的区间写法交集群）。
 */
function validateFlatSubnetExcludeIpsPayload(
  rawExclude: unknown,
  currentSubnet: any,
  body: Record<string, unknown>,
):
  | { ok: true; excludeList: string[]; effectiveCidr: string }
  | { ok: false; status: number; body: FlatExcludeFailBody } {
  if (!Array.isArray(rawExclude)) {
    return {
      ok: false,
      status: 400,
      body: { message: 'excludeIps 须为字符串数组', code: 'EXCLUDE_IPS_INVALID_TYPE' },
    };
  }
  const excludeList = rawExclude
    .map((x: unknown) => String(x ?? '').trim())
    .filter((s: string) => s.length > 0);
  const seenLower = new Set<string>();
  const dupSamples: string[] = [];
  for (const ip of excludeList) {
    const k = ip.toLowerCase();
    if (seenLower.has(k)) dupSamples.push(ip);
    seenLower.add(k);
  }
  if (dupSamples.length > 0) {
    const uniq = [...new Set(dupSamples)];
    return {
      ok: false,
      status: 400,
      body: {
        message: `排除 IP 存在重复：${uniq.join('、')}`,
        code: 'EXCLUDE_IP_DUPLICATE',
      },
    };
  }
  const curCidr = String(
    currentSubnet?.spec?.cidrBlock ?? currentSubnet?.spec?.cidr ?? '',
  ).trim();
  const nextCidr = Object.prototype.hasOwnProperty.call(body, 'cidrBlock')
    ? String((body as any).cidrBlock ?? '').trim()
    : Object.prototype.hasOwnProperty.call(body, 'cidr')
      ? String((body as any).cidr ?? '').trim()
      : curCidr;
  const effectiveCidr = nextCidr || curCidr;
  if (!effectiveCidr) {
    return {
      ok: false,
      status: 400,
      body: { message: '无法校验排除 IP：子网 CIDR 为空', code: 'SUBNET_CIDR_EMPTY' },
    };
  }
  const cidrRange = ipv4CidrToUint32Range(effectiveCidr);
  if (!cidrRange) {
    return {
      ok: false,
      status: 400,
      body: {
        message: `无法校验排除 IP：子网 CIDR「${effectiveCidr}」无效`,
        code: 'SUBNET_CIDR_INVALID',
      },
    };
  }
  const ipv4Re = /^\d{1,3}(\.\d{1,3}){3}$/;
  for (const item of excludeList) {
    if (item.includes('..')) continue;
    if (!ipv4Re.test(item)) {
      return {
        ok: false,
        status: 400,
        body: {
          message: `排除 IP「${item}」不是合法的 IPv4 地址（若使用区间写法请包含 .. 并由集群校验）`,
          code: 'EXCLUDE_IP_INVALID',
        },
      };
    }
    const n = ipv4ToUint32(item);
    if (n < cidrRange[0] || n > cidrRange[1]) {
      return {
        ok: false,
        status: 400,
        body: {
          message: `排除 IP「${item}」不在子网 CIDR「${effectiveCidr}」范围内`,
          code: 'EXCLUDE_IP_OUT_OF_CIDR',
        },
      };
    }
  }
  return { ok: true, excludeList, effectiveCidr };
}

/**
 * 排除列表与「已挂该子网且已有运行 IP」的虚拟机是否冲突（需已持有 VM 列表）。
 */
async function findExcludeIpConflictWithRunningVmOnSubnet(
  apiBase: string,
  token: string,
  insecure: boolean,
  subnetName: string,
  excludeList: string[],
  vms: any[],
): Promise<{ ip: string; vmAlias: string } | null> {
  const enc = encodeURIComponent;
  const sn = String(subnetName).trim();
  const excludeLower = new Set(excludeList.map((x) => x.toLowerCase()));
  for (const vm of vms) {
    if (!vmUsesMultusSubnet(vm, sn)) continue;
    const vn = String(vm?.metadata?.name ?? '').trim();
    const ns = String(vm?.metadata?.namespace ?? 'default').trim() || 'default';
    if (!vn) continue;
    let vmi: any = null;
    try {
      vmi = await getJsonOnce(
        `${apiBase}/apis/kubevirt.io/v1/namespaces/${enc(ns)}/virtualmachineinstances/${enc(vn)}`,
        token,
        insecure,
        true,
      );
    } catch {
      vmi = null;
    }
    const ipOnNet = findVmIpv4OnFlatSubnet(vm, sn, vmi);
    if (!ipOnNet || !excludeLower.has(ipOnNet.toLowerCase())) continue;
    const alias = String(
      vm?.metadata?.annotations?.['tower.io/alias'] ?? vm?.metadata?.name ?? vn,
    ).trim();
    return { ip: ipOnNet, vmAlias: alias };
  }
  return null;
}

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

// =============================================================================
// HTTP 处理器：子网列表（GET）、创建（POST）
// =============================================================================

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
        vlan: item.rawData?.spec?.vlan || '',
        provider: item.rawData?.spec?.provider || '',
        excludeIps: item.rawData?.spec?.excludeIps || [],
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
      private: subnetPrivate,
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
    const subnetTypeForVpc = String(annotations?.['tower.io/subnet-type'] || '')
      .trim()
      .toLowerCase();
    const hasVlan = vlan !== undefined && vlan !== null && String(vlan).trim() !== '';
    const defaultVpcForNew =
      subnetTypeForVpc === 'flat'
        ? hasVlan
          ? KUBE_OVN_PUBLIC_VPC
          : KUBE_OVN_FLAT_VPC
        : KUBE_OVN_PUBLIC_VPC;
    const targetVpc = vpc || defaultVpcForNew;

    if (
      isVpcBusinessKubeOvnSubnetIntent(subnetTypeForVpc, targetVpc) &&
      denyOvnVpcLicense(res)
    ) {
      return;
    }

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
      const reqRange = ipv4CidrToUint32Range(String(cidrBlock || '').trim());
      if (reqRange) {
        for (const s of items) {
          const currentVpc = s?.spec?.vpc || KUBE_OVN_PUBLIC_VPC;
          if (currentVpc !== targetVpc) continue;
          const c = String(s?.spec?.cidrBlock || s?.spec?.cidr || '').trim();
          const r = ipv4CidrToUint32Range(c);
          if (r && ipv4Uint32RangesOverlap(reqRange, r)) {
            const conflictName = s?.metadata?.name || s?.name;
            if (conflictName) {
              const conflictAlias = String(s?.metadata?.annotations?.['tower.io/alias'] ?? '').trim();
              const conflictShown =
                conflictAlias && conflictAlias !== conflictName
                  ? `${conflictAlias}（${conflictName}）`
                  : String(conflictName);
              res.status(422).json({
                message: `网段冲突：新子网的 CIDR 与已有子网「${conflictShown}」的网段重叠。请改用不重叠的网段，或调整已有子网。`,
                code: 'SUBNET_CIDR_CONFLICT',
                conflictSubnet: conflictName,
                conflictSubnetAlias: conflictAlias || undefined,
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
    let nadNamespace = namespace || 'default';
    /** 创建子网时若需从目标 VPC 推导业务命名空间，复用同一 GET 结果写 tower.io/namespaces */
    let vpcObjCached: any = null;
    if (subnetTypeForVpc === 'vpc' && targetVpc) {
      try {
        const vpcUrl = `${apiBase}/apis/kubeovn.io/v1/vpcs/${encodeURIComponent(String(targetVpc).trim())}`;
        vpcObjCached = await getJsonOnce(vpcUrl, cloud.secretKey || '', insecure);
        const namespacesRaw = vpcObjCached?.spec?.namespaces || vpcObjCached?.namespaces || [];
        if (Array.isArray(namespacesRaw) && namespacesRaw.length > 0) {
          const firstNs = String(namespacesRaw[0]).trim();
          if (firstNs) nadNamespace = firstNs;
        }
      } catch (e: any) {
        console.warn(
          `[CreateSubnet] Failed to fetch VPC ${targetVpc} to determine NAD namespace:`,
          e?.message || e,
        );
      }
    }
    const nadNsEncoded = encodeURIComponent(nadNamespace);
    /**
     * Subnet.spec.provider 与 NAD CNI config.provider 一致：Kube-OVN 逻辑交换机名为 name.namespace.ovn。
     * 部分 Harvester 版本曾对 VPC 子网文档化 external-nad.<ns>.ovn，但 admission webhook 会对该串报
     * invalid provider name external-nad …；与集群侧一致统一使用子网 CR 名参与拼接。
     * 表单里的「Provider Network」是物理资源名，不能写入 spec.provider；仅记入注解供展示/运维。
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
    if (subnetTypeAnn === 'flat') {
      if (hasVlan) {
        mergedAnnotations['tower.io/subnet-type-flat-underlay'] = 'true';
        delete mergedAnnotations['tower.io/subnet-type-flat-overlay'];
      } else {
        mergedAnnotations['tower.io/subnet-type-flat-overlay'] = 'true';
        delete mergedAnnotations['tower.io/subnet-type-flat-underlay'];
      }
    }
    if (subnetTypeAnn === 'public' && targetVpc === KUBE_OVN_PUBLIC_VPC) {
      const cidrStr = String(cidrBlock || '').trim();
      if (!ipv4CidrToUint32Range(cidrStr)) {
        if (!res.headersSent) {
          res.status(400).json({ message: '公共子网 CIDR 无效，无法同步 ovn-internal', code: 'INVALID_SUBNET_CIDR' });
        }
        return;
      }
      const routeAnnRaw = String(mergedAnnotations[OVN_INTERNAL_ROUTE_CIDR_ANNOTATION] ?? '').trim();
      const routeCidr = routeAnnRaw || '0.0.0.0/0';
      if (!ipv4CidrToUint32Range(routeCidr)) {
        if (!res.headersSent) {
          res.status(400).json({
            message: '可访问范围（ovn-internal 路由目的网段）CIDR 无效',
            code: 'INVALID_PUBLIC_ACCESS_ROUTE_CIDR',
          });
        }
        return;
      }
      mergedAnnotations[OVN_INTERNAL_ROUTE_CIDR_ANNOTATION] = routeCidr;
    }
    {
      let towerNsCsv = '';
      if (namespaces && Array.isArray(namespaces) && namespaces.length > 0) {
        towerNsCsv = formatTowerNamespacesAnnotation(namespaces);
      } else if (targetVpc) {
        let v = vpcObjCached;
        if (!v) {
          try {
            const vpcUrl = `${apiBase}/apis/kubeovn.io/v1/vpcs/${encodeURIComponent(String(targetVpc).trim())}`;
            v = await getJsonOnce(vpcUrl, cloud.secretKey || '', insecure);
          } catch {
            v = null;
          }
        }
        towerNsCsv = formatTowerNamespacesAnnotation(listNamespacesFromVpcObject(v));
      }
      if (towerNsCsv) mergedAnnotations[TOWER_IO_NAMESPACES_ANNOTATION] = towerNsCsv;
    }
    {
      const subnetOvnScope: OvnNetworkScope =
        subnetTypeAnn === 'vpc' &&
        String(targetVpc).trim() !== '' &&
        !isUnderlayVpcName(targetVpc)
          ? 'vpc'
          : 'underlay';
      mergedAnnotations[TOWER_IO_OVN_NETWORK_SCOPE_ANNOTATION] = subnetOvnScope;
    }
    const nadCandidates = [
      `${apiBase}/apis/k8s.cni.cncf.io/v1/namespaces/${nadNsEncoded}/network-attachment-definitions`,
      `${apiBase}/apis/k8s.cni.cncf.io/v1/namespaces/${nadNsEncoded}/networkattachmentdefinitions`,
      `${apiBase}/v1/harvester/k8s.cni.cncf.io.network-attachment-definitions`,
      `${apiBase}/v1/harvester/k8s.cni.cncf.io.networkattachmentdefinitions`,
      `${apiBase}/v1/k8s.cni.cncf.io.networkattachmentdefinitions`,
      `${apiBase}/v1/cni.cncf.io.networkattachmentdefinitions`,
    ];

    /** Harvester subnet 准入要求 NAD 须带 network.harvesterhci.io/type=OverlayNetwork（见 harvester-network-controller subnet validator） */
    const nadLabels: Record<string, string> = {
      'tower.io/creator': 'compute-tower',
      'network.harvesterhci.io/type': 'OverlayNetwork',
    };

    const nadMetadata = {
      name: nadName,
      namespace: nadNamespace,
      finalizers: ['tower.io/managed'],
      labels: nadLabels,
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
        const bodyObj = nadError?.body;
        let k8sReason =
          typeof bodyObj === 'object' && bodyObj !== null && 'reason' in bodyObj
            ? String((bodyObj as { reason?: string }).reason || '').toLowerCase()
            : '';
        if (!k8sReason && detail && detail.trim().startsWith('{')) {
          try {
            k8sReason = String(JSON.parse(detail).reason || '').toLowerCase();
          } catch {
            /* ignore */
          }
        }
        const isConflict = status === 409 || msgLower.includes('alreadyexists');
        /**
         * 并发或连点：第二次 POST NAD 会得到 409 + reason=AlreadyExists；K8s message 可能同时含
         * "being deleted" 与 "already exists"，若先走「正在删除」会误 return。AlreadyExists 一律视为 NAD 已存在。
         */
        if (isConflict && k8sReason === 'alreadyexists') {
          nadCreatedOrExists = true;
          createdNewNad = false;
          break;
        }
        const nadBeingDeleted =
          (detailLower.includes('being deleted') ||
            detailLower.includes('foregrounddeletion') ||
            detailLower.includes('terminating')) &&
          k8sReason !== 'alreadyexists';
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
        if (!res.headersSent) {
          const errMsg = detail ? `${msg} (详情: ${detail})` : msg;
          res.status(500).json({ message: '创建 NAD 失败', error: errMsg });
        }
        return;
      }
    }

    if (!nadCreatedOrExists) {
      if (!res.headersSent) {
        const lastErrDetail = formatNadErrDetail(lastNadError);
        const lastErrMsg = lastErrDetail
          ? `${lastNadError?.message} (详情: ${lastErrDetail})`
          : lastNadError?.message;
        res.status(500).json({
          message: '创建 NAD 失败 (API 路径未找到或内部错误)',
          error: lastErrMsg,
          debug: {
            apiBase,
            triedUrls: nadCandidates,
            lastStatus: lastNadError?.status,
            lastBodyPreview: lastErrDetail || undefined,
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
          : true;

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
        vpc: targetVpc,
        cidrBlock,
        gateway,
        protocol: protocol || 'IPv4',
        ...(excludeIps && Array.isArray(excludeIps) ? { excludeIps } : {}),
        ...(namespaces && Array.isArray(namespaces) ? { namespaces } : {}),
        provider: logicalProvider,
        ...(vlan ? { vlan } : {}),
        ...(gatewayType ? { gatewayType } : {}),
        ...(disableGatewayCheck !== undefined ? { disableGatewayCheck } : {}),
        ...(subnetPrivate !== undefined ? { private: !!subnetPrivate } : {}),
        natOutgoing: natOutgoingVal,
        enableDHCP: allowDhcp !== undefined ? allowDhcp : true,
        ...(specAcls !== undefined ? { acls: specAcls } : {}),
        ...(Object.prototype.hasOwnProperty.call(req.body, 'allowEWTraffic')
          ? { allowEWTraffic: !!req.body.allowEWTraffic }
          : {}),
      },
    };

    const rollbackNewNad = async () => {
      if (!createdNewNad) return;
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
    };

    try {
      const result = await requestJson('POST', url, cloud.secretKey || '', insecure, payload);
      if (result && result.metadata) {
        /** ovn-internal 的 extraExternalSubnets/staticRoutes 改在扁平域创建 EIP（underlay）时写入，参见 ovn-direct-eip-fip-nat.handlers.ts */
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
      await rollbackNewNad();
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

// =============================================================================
// 子网更新：VLAN 规范化与「是否改动 CIDR/网关/VLAN」判断（仅 harvesterSubnetDirectUpdateHandler）
// =============================================================================

/** 与 VLAN 等字段比较时统一为字符串，避免 100 与 "100" 被误判为变更 */
function normalizeVlanForSubnetCompare(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (v === '') return '';
  return String(v).trim();
}

/**
 * 判断更新请求在合并到当前 spec 后，是否改变扁平子网的 CIDR、网关或 VLAN（仅对请求体中存在的键与当前值比较）。
 */
function wouldChangeFlatSubnetCidrGatewayVlan(
  current: any,
  body: Record<string, unknown>,
): boolean {
  const curCidr = String(
    current?.spec?.cidrBlock ?? current?.spec?.cidr ?? '',
  ).trim();
  const curGw = String(current?.spec?.gateway ?? '').trim();
  const curVlan = normalizeVlanForSubnetCompare(current?.spec?.vlan);

  const nextCidr = Object.prototype.hasOwnProperty.call(body, 'cidrBlock')
    ? String((body as any).cidrBlock ?? '').trim()
    : Object.prototype.hasOwnProperty.call(body, 'cidr')
    ? String((body as any).cidr ?? '').trim()
    : curCidr;
  const nextGw = Object.prototype.hasOwnProperty.call(body, 'gateway')
    ? String((body as any).gateway ?? '').trim()
    : curGw;
  const nextVlan = Object.prototype.hasOwnProperty.call(body, 'vlan')
    ? normalizeVlanForSubnetCompare((body as any).vlan)
    : curVlan;

  return nextCidr !== curCidr || nextGw !== curGw || nextVlan !== curVlan;
}

// =============================================================================
// HTTP 处理器：子网更新（PUT/PATCH）、删除（DELETE）
// =============================================================================

export async function harvesterSubnetDirectUpdateHandler(
  req: any,
  res: Response,
  next: any,
) {
  try {
    const { id, name } = req.params;
    const subnetName = String(name ?? '').trim();
    if (!subnetName) {
      res.status(400).json({
        message: '缺少路径参数 name（Kube-OVN Subnet 的 metadata.name）',
        code: 'SUBNET_NAME_REQUIRED',
      });
      return;
    }
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed)
      return res.status(403).json({ message: 'Access denied to this resource pool' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported', next)) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const body = req.body && typeof req.body === 'object' ? { ...req.body } : {};
    const apiBase = resolveHarvesterK8sApiBase(cloud.endpoint || '');
    const currentSubnet = await getJsonOnce(
      `${apiBase}/apis/kubeovn.io/v1/subnets/${encodeURIComponent(subnetName)}`,
      cloud.secretKey || '',
      insecure,
    );
    const prevGateway = String(currentSubnet?.spec?.gateway ?? '').trim();

    if (isVpcBusinessKubeOvnSubnetCr(currentSubnet) && denyOvnVpcLicense(res)) {
      return;
    }

    // 校验 EIP：仅非 lrp 类型占用时禁止修改网段相关字段
    try {
      const eips = await listKubeOvnEips({ endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any);
      const blocking = eipsReferencingSubnetExcludingLrp(eips, subnetName);
      if (blocking.length > 0) {
        const names = blocking.map((e) => e?.metadata?.name || e?.name).filter(Boolean);
        const labels = kubeOvnEipPublicDisplayLabels(blocking);
        return res.status(409).json({
          message: `子网正被公网 IP ${labels.join('、')} 使用，无法修改或清空其网段信息。`,
          code: 'SUBNET_IN_USE_BY_EIPS',
          eips: names,
        });
      }
    } catch (e) {
      console.warn('[UpdateSubnet] EIP usage check failed:', e);
    }

    if (Object.prototype.hasOwnProperty.call(body, 'acls')) {
      const aclResult = parseKubeOvnAclRulesInput(body.acls, 'acls');
      if (!aclResult.ok) {
        res.status(400).json({ message: aclResult.message });
        return;
      }
      body.acls = aclResult.value;
    }

    const currentAnn = (currentSubnet?.metadata?.annotations || {}) as Record<string, string>;
    const typeBefore = String(currentAnn['tower.io/subnet-type'] ?? '').trim().toLowerCase();
    const vpcBefore = String(currentSubnet?.spec?.vpc ?? '').trim();
    if (typeBefore === 'public' && vpcBefore === KUBE_OVN_PUBLIC_VPC) {
      const blockedSpecKeys = ['cidrBlock', 'cidr', 'gateway', 'vlan', 'excludeIps'];
      for (const k of blockedSpecKeys) {
        if (Object.prototype.hasOwnProperty.call(body, k)) {
          return res.status(400).json({
            message:
              '公共子网仅允许修改展示名称（别名）等注解；如需调整网段、网关、VLAN、排除 IP，请删除后重建。',
            code: 'PUBLIC_SUBNET_SPEC_READONLY',
          });
        }
      }
    }

    // 扁平子网：同一轮更新内最多拉取一次 VM 列表，供「改 CIDR/网关/VLAN」与「排除 IP」两道校验共用
    const flatChangingCidrGwVlan =
      typeBefore === 'flat' && wouldChangeFlatSubnetCidrGatewayVlan(currentSubnet, body);
    const flatUpdatingExclude =
      typeBefore === 'flat' && Object.prototype.hasOwnProperty.call(body, 'excludeIps');

    let updateHandlerVmsCache: any[] | null = null;
    const loadVmsForFlatSubnetUpdate = async (): Promise<any[]> => {
      if (updateHandlerVmsCache) return updateHandlerVmsCache;
      try {
        updateHandlerVmsCache = await listHarvestKubevirtVirtualMachines(
          apiBase,
          cloud.secretKey || '',
          insecure,
          true,
        );
      } catch (e) {
        console.warn('[UpdateSubnet] 拉取 VirtualMachine 列表失败:', e);
        updateHandlerVmsCache = [];
      }
      return updateHandlerVmsCache;
    };

    // 扁平子网：仍有虚拟机引用 multus 该子网时，禁止修改 CIDR、网关、VLAN
    if (flatChangingCidrGwVlan) {
      try {
        const vms = await loadVmsForFlatSubnetUpdate();
        const multusRef = multusDefaultSubnetRefLower(subnetName);
        const usingVms = findVmDisplayNamesUsingMultusNetwork(
          vms,
          multusRef,
          subnetName.toLowerCase(),
        );
        if (usingVms.length > 0) {
          const list = usingVms.slice(0, 20).join('、');
          const more = usingVms.length > 20 ? ' 等' : '';
          return res.status(409).json({
            message: `该子网被虚拟机（${list}${more}）使用，无法修改CIDR、网关或 VLAN。`,
            code: 'FLAT_SUBNET_IN_USE_BY_VM',
            vms: usingVms,
          });
        }
      } catch (e) {
        console.warn('[UpdateSubnet] Flat subnet VM usage check failed:', e);
      }
    }

    // 扁平子网：排除 IP 校验（结构/重复/CIDR）及与运行中虚拟机地址冲突
    if (flatUpdatingExclude) {
      const exVal = validateFlatSubnetExcludeIpsPayload(
        (body as any).excludeIps,
        currentSubnet,
        body,
      );
      if (!exVal.ok) {
        res.status(exVal.status).json(exVal.body);
        return;
      }
      const { excludeList } = exVal;
      try {
        const vms = await loadVmsForFlatSubnetUpdate();
        const conflict = await findExcludeIpConflictWithRunningVmOnSubnet(
          apiBase,
          cloud.secretKey || '',
          insecure,
          subnetName,
          excludeList,
          vms,
        );
        if (conflict) {
          return res.status(409).json({
            message: `排除 IP「${conflict.ip}」正被虚拟机（${conflict.vmAlias}）使用，无法将其加入排除列表。`,
            code: 'EXCLUDE_IP_IN_USE_BY_VM',
            ip: conflict.ip,
            vm: conflict.vmAlias,
          });
        }
      } catch (e) {
        console.warn('[UpdateSubnet] Flat subnet excludeIPs VM check failed:', e);
      }
    }

    const data = await updateHarvesterSubnet(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      subnetName,
      body,
    );

    {
      const annAfter = data?.metadata?.annotations || {};
      const typeAfter = String(annAfter['tower.io/subnet-type'] ?? '').trim().toLowerCase();
      const vpcAfter = String(data?.spec?.vpc ?? '').trim();
      if (typeAfter === 'public' && vpcAfter === KUBE_OVN_PUBLIC_VPC) {
        const prevRc = ovnInternalRouteCidrFromSubnet(currentSubnet);
        const newRc = ovnInternalRouteCidrFromSubnet(data);
        const newGw = String(data?.spec?.gateway ?? '').trim();
        const routeChanged = prevGateway !== newGw || prevRc !== newRc;
        await upsertOvnInternalForPublicSubnet({
          harvesterParams: { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
          subnetName,
          gateway: newGw,
          routeCidr: newRc,
          prevGateway: routeChanged ? prevGateway : undefined,
          prevRouteCidr: routeChanged ? prevRc : undefined,
        });
      }
    }

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
    const origin = getOriginFromEndpoint(cloud.endpoint || '');

    const url = `${apiBase}/apis/kubeovn.io/v1/subnets/${encodeURIComponent(name)}`;

    let subnetBefore: any = null;
    try {
      subnetBefore = await getJsonOnce(url, cloud.secretKey || '', insecure);
    } catch (e: any) {
      const st = Number(e?.status ?? 0);
      if (st === 404) {
        res.status(404).json({ message: '子网不存在' });
        return;
      }
      if (!res.headersSent) {
        res.status(500).json({
          message: '读取子网失败',
          error: e?.message || String(e),
        });
      }
      return;
    }
    if (!subnetBefore?.metadata) {
      res.status(404).json({ message: '子网不存在' });
      return;
    }

    if (isVpcBusinessKubeOvnSubnetCr(subnetBefore) && denyOvnVpcLicense(res)) {
      return;
    }

    if (name === 'external') {
      res.status(409).json({
        message: '内置子网 external 由集群维护，不可删除',
        code: 'SUBNET_BUILTIN_READ_ONLY',
      });
      return;
    }

    try {
      const vms = await listHarvestKubevirtVirtualMachines(
        apiBase,
        cloud.secretKey || '',
        insecure,
      );
      const targetRef = multusDefaultSubnetRefLower(String(name));
      const usingVms = findVmDisplayNamesUsingMultusNetwork(
        vms,
        targetRef,
        String(name).toLowerCase(),
      );

      if (usingVms.length > 0) {
        res.status(409).json({
          message: `不能删除此子网，因为正在被虚拟机使用：${usingVms.slice(0, 5).join('，')}${
            usingVms.length > 5 ? ' 等' : ''
          }`,
          code: 'SUBNET_IN_USE_BY_VM',
          vms: usingVms,
        });
        return;
      }
    } catch (checkError) {
      console.warn('[DeleteSubnet] Failed to check VM usage, proceeding anyway:', checkError);
    }

    // 校验 EIP：仅非 lrp 占用时禁止删除
    let snapshotEips: any[] = [];
    let lrpEipsToDelete: any[] = [];
    try {
      snapshotEips = await listKubeOvnEips({ endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any);
      const blocking = eipsReferencingSubnetExcludingLrp(snapshotEips, name);
      if (blocking.length > 0) {
        const names = blocking.map((e) => e?.metadata?.name || e?.name).filter(Boolean);
        const labels = kubeOvnEipPublicDisplayLabels(blocking);
        return res.status(409).json({
          message: `子网正被公网 IP ${labels.join('、')} 使用，无法删除。`,
          code: 'SUBNET_IN_USE_BY_EIPS',
          eips: names,
        });
      }
      // 收集需要删除的 LRP EIP（这些是系统自动创建的，删除子网时应一并清理）
      lrpEipsToDelete = (Array.isArray(snapshotEips) ? snapshotEips : []).filter((eip) => {
        const sub = eip?.spec?.externalSubnet || eip?.externalSubnet;
        if (String(sub || '').trim() !== name) return false;
        const t = String(eip?.spec?.type ?? eip?.type ?? '').trim().toLowerCase();
        return t === 'lrp';
      });
    } catch (e) {
      console.warn('[DeleteSubnet] EIP usage check failed:', e);
    }

    // 删除公共子网时，自动清理关联的 LRP EIP
    if (lrpEipsToDelete.length > 0 && isPublicSubnetOnOvnCluster(subnetBefore)) {
      for (const lrpEip of lrpEipsToDelete) {
        const eipName = String(lrpEip?.metadata?.name || lrpEip?.name || '').trim();
        if (eipName) {
          try {
            await deleteKubeOvnClusterCr(origin, cloud.secretKey || '', insecure, 'ovneips', 'ovn-eips', eipName);
            console.info('[DeleteSubnet] Deleted LRP EIP:', eipName);
          } catch (delErr) {
            console.warn('[DeleteSubnet] Failed to delete LRP EIP:', eipName, delErr);
          }
        }
      }
    }

    if (isPublicSubnetOnOvnCluster(subnetBefore)) {
      try {
        const hp = { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any;
        const stillHas = await hasAnyUnderlayEipReferencingPublicOvnSubnet(hp, snapshotEips);
        await removeOvnInternalForPublicSubnet({
          harvesterParams: hp,
          subnetName: name,
          gateway: String(subnetBefore.spec?.gateway ?? '').trim(),
          routeCidr: ovnInternalRouteCidrFromSubnet(subnetBefore),
          setEnableExternal: stillHas ? undefined : false,
        });
      } catch (ovnErr: any) {
        return res.status(500).json({
          message: '从 ovn-internal 移除公共子网失败',
          error: ovnErr?.message || String(ovnErr),
          code: 'OVN_INTERNAL_SYNC_FAILED',
        });
      }
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
      const typeBefore = String(
        subnetBefore?.metadata?.annotations?.['tower.io/subnet-type'] ?? '',
      )
        .trim()
        .toLowerCase();
      let nadNs = 'default';
      if (typeBefore === 'vpc' && subnetBefore?.spec?.vpc) {
        try {
          const vpcUrl = `${apiBase}/apis/kubeovn.io/v1/vpcs/${encodeURIComponent(String(subnetBefore.spec.vpc).trim())}`;
          const vpcObj = await getJsonOnce(vpcUrl, cloud.secretKey || '', insecure);
          const namespacesRaw = vpcObj?.spec?.namespaces || vpcObj?.namespaces || [];
          if (Array.isArray(namespacesRaw) && namespacesRaw.length > 0) {
            const firstNs = String(namespacesRaw[0]).trim();
            if (firstNs) nadNs = firstNs;
          }
        } catch (e: any) {
          console.warn(
            `[DeleteSubnet] Failed to fetch VPC ${subnetBefore.spec.vpc} for NAD namespace:`,
            e?.message || e,
          );
        }
      } else if (
        subnetBefore?.spec?.namespaces &&
        Array.isArray(subnetBefore.spec.namespaces) &&
        subnetBefore.spec.namespaces.length > 0
      ) {
        nadNs = String(subnetBefore.spec.namespaces[0]).trim() || 'default';
      }
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
