/**
 * Kube-OVN Subnet ↔ Multus NAD 解析（虚拟机创建向导 / 快速创建）。
 *
 * Tower 直连创建路径下 Subnet.spec.provider 与 NAD CNI 的 provider 一致，为 `${subnetName}.${nadNamespace}.ovn`。
 * Subnet CR 常为集群级且无 metadata.namespace；若占位 default 或未解析 metadata，会与真实 NAD(ns/name) 不一致，
 * 「快速创建 / 向导」会误判「网络未就绪」。
 *
 * 与 `ecs/lib/kubeOvnMultusNadRef.ts` 中的同名导出语义对齐；向导步骤引用本文件以便附带 VM Multus netName 解析。
 */

export function resolveKubeOvnSubnetNadNamespace(subnet: any): string | undefined {
  const val = String(subnet?.name ?? subnet?.metadata?.name ?? '').trim();
  if (!val) return undefined;
  const provider = subnet?.spec?.provider ?? subnet?.provider;
  const s = String(provider ?? '').trim();
  if (!s.toLowerCase().endsWith('.ovn')) return undefined;
  const parts = s.split('.');
  if (parts.length < 3) return undefined;
  if (String(parts[parts.length - 1]).toLowerCase() !== 'ovn') return undefined;
  const nadNs = parts[parts.length - 2];
  const nadName = parts.slice(0, -2).join('.');
  if (!nadNs || !nadName || nadName !== val) return undefined;
  return nadNs;
}

/**
 * 子网是否带有 Kube-OVN 逻辑 provider（Tower 创建路径：NAD 与 Subnet 共用 `${name}.${ns}.ovn`）。
 * 租户侧 GET NAD 常按命名空间过滤，kube-ovn NAD 可能在 default 等不可见 ns，不得以「NAD 清单是否含该项」为唯一就绪条件。
 */
export function subnetHasKubeOvnLogicalProviderForNad(subnet: any): boolean {
  return resolveKubeOvnSubnetNadNamespace(subnet) != null;
}

/** 将 Multus value 解析为 NAD 资源名（不含 namespace） */
function multusValueToNadName(v: string): string {
  const vv = String(v || '');
  const p = vv.split('/');
  return p.length > 1 ? p[1] : p[0];
}

/**
 * VM 表单中填入的 Multus networkName（ns/name）；与 StepNetworks flat_subnet onChange、`expectedMultusNadRefForSubnet` 对齐。
 */
export function resolveMultusNetNameForKubeOvnSubnetNic(
  subnet: any | undefined,
  subnetCrName: string,
  nadOptions: { value?: string }[],
): string {
  const val = String(subnetCrName || '').trim();
  if (!val) return '';

  let subnetNs =
    resolveKubeOvnSubnetNadNamespace(subnet) ||
    subnet?.metadata?.namespace ||
    subnet?.namespace;

  if (!subnetNs) {
    const provider = subnet?.provider || subnet?.spec?.provider;
    if (provider) {
      const pp = String(provider).split('.');
      if (pp.length >= 2) subnetNs = pp[pp.length - 2];
    }
  }

  if (subnetNs) {
    return `${subnetNs}/${val}`;
  }
  try {
    const found = (nadOptions || []).find((x: any) => {
      const vv = String(x?.value || '');
      return multusValueToNadName(vv) === val;
    });
    if (found) return String(found.value);
  } catch {
    /* ignore */
  }
  return val;
}

/**
 * 计算 Kube-OVN 子网在 VM Multus 中应引用的 namespace/name，并与 NAD 列表比对，用于子网可创建判断。
 * 与 StepNetworks 中子网 onChange 拼装 netName 逻辑保持一致。
 */
export function expectedMultusNadRefForSubnet(
  subnet: any,
  vpc: string | undefined,
  nadOptions: { value?: string }[],
): string | undefined {
  const val = subnet?.name || subnet?.metadata?.name;
  if (!val) return undefined;
  if (vpc != null && vpc !== '') {
    if (String(subnet?.vpc ?? subnet?.spec?.vpc) !== String(vpc)) return undefined;
  }

  let subnetNs =
    resolveKubeOvnSubnetNadNamespace(subnet) ||
    subnet?.metadata?.namespace ||
    subnet?.namespace;

  if (!subnetNs) {
    const provider = subnet?.provider || subnet?.spec?.provider;
    if (provider) {
      const parts = String(provider).split('.');
      if (parts.length >= 2) subnetNs = parts[parts.length - 2];
    }
  }
  if (subnetNs) {
    return `${subnetNs}/${val}`;
  }
  const found = (nadOptions || []).find((x: any) => {
    const vv = String(x?.value || '');
    return multusValueToNadName(vv) === String(val);
  });
  if (found) return String(found.value);
  return undefined;
}

/**
 * 集群中已存在与子网预期 Multus 引用一致的 NAD（NAD 列表来自 Steve / API 同步，可与子网存在短暂时序差）。
 */
export function isKubeOvnSubnetNadReady(
  subnet: any,
  vpc: string | undefined,
  nadOptions: { value?: string }[],
): boolean {
  const list = Array.isArray(nadOptions) ? nadOptions : [];
  // NAD 列表尚未拉取时无法判断，不拦截（避免子网可选项全部被灰掉）
  if (list.length === 0) return true;

  const val = subnet?.name || subnet?.metadata?.name;
  if (!val) return false;

  if (vpc != null && vpc !== '') {
    if (String(subnet?.vpc ?? subnet?.spec?.vpc) !== String(vpc)) return false;
  }

  // 已能从 spec.provider 解析出与子网 CR 名一致的逻辑交换机名：Multus 引用确定；租户 NAD 列表常不含 default 等 ns 下的 kube-ovn NAD，不得因此判未就绪
  if (subnetHasKubeOvnLogicalProviderForNad(subnet)) {
    return true;
  }

  const ref = expectedMultusNadRefForSubnet(subnet, vpc, nadOptions);
  if (ref && list.some((o) => String(o?.value) === ref)) return true;

  // 精确 ns/name 因清单延迟时：若当前可见清单中同名 NAD 唯一，则视为可挂载
  const sameName = list.filter((o) => multusValueToNadName(String(o?.value || '')) === String(val));
  return sameName.length === 1;
}
