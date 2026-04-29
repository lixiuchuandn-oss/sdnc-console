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

  let netName = String(val);
  let subnetNs = subnet?.metadata?.namespace || subnet?.namespace;
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
    const parts = vv.split('/');
    const name = parts.length > 1 ? parts[1] : parts[0];
    return name === val;
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
  const ref = expectedMultusNadRefForSubnet(subnet, vpc, nadOptions);
  if (!ref) return false;
  return list.some((o) => String(o?.value) === ref);
}
