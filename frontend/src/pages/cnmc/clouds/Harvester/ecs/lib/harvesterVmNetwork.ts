/** 全部 multus 网络中，Kube-OVN 扁平子网（tower.io/subnet-type=flat）是否重复使用 */
export function hasDuplicateFlatSubnetsInNetworks(
  networks: any[],
  subnetInventory: any[],
): boolean {
  const names: string[] = [];
  for (const n of networks || []) {
    const nn = n?.multus?.networkName;
    if (!nn) continue;
    const raw = String(nn);
    const name = raw.includes("/") ? raw.split("/").pop() || "" : raw;
    if (!name) continue;
    const s = subnetInventory.find((x: any) => x?.metadata?.name === name);
    const t = String(
      s?.metadata?.annotations?.["tower.io/subnet-type"] || "",
    )
      .trim()
      .toLowerCase();
    if (t === "flat") names.push(name);
  }
  return new Set(names).size !== names.length;
}

/**
 * 为辅网卡分配 nic-N 名称：从 nic-1、nic-2… 中取最小可用编号，保证不与主网卡名冲突。
 * Harvester 等底座常把第一块网卡命名为 nic-1，若仍固定辅卡为 nic-1 会与主卡重名。
 */
export function allocateSecondaryNicNames(
  primaryIfaceName: string,
  count: number,
): string[] {
  const used = new Set<string>();
  if (primaryIfaceName) used.add(primaryIfaceName);
  const out: string[] = [];
  let n = 1;
  for (let i = 0; i < count; i++) {
    while (used.has(`nic-${n}`)) n++;
    const name = `nic-${n}`;
    used.add(name);
    out.push(name);
    n++;
  }
  return out;
}

/**
 * 从 VM 的 `networks[].multus.networkName` 解析出 NAD 引用，与 `nadList` 比对，
 * 返回集群中不存在的 `namespace/name` 列表（用于提交前拦截无效网络）。
 */
export function getMissingNadsFromNetworks(
  networks: any[],
  vmNamespace: string,
  nadList: any[],
) {
  const list = Array.isArray(nadList) ? nadList : [];
  const getNs = (x: any) => x?.metadata?.namespace || x?.namespace || "";
  const getName = (x: any) => x?.metadata?.name || x?.name || "";
  const hasNad = (ns: string, name: string) =>
    list.some(
      (x: any) =>
        String(getNs(x)) === String(ns) && String(getName(x)) === String(name),
    );

  return (Array.isArray(networks) ? networks : [])
    .map((n: any) => n?.multus?.networkName)
    .filter(Boolean)
    .map((raw: any) => String(raw))
    .map((s: string) => (s.includes("@") ? s.split("@")[0] : s))
    .map((s: string) => {
      const parts = s.split("/");
      if (parts.length > 1) return { namespace: parts[0], name: parts[1] };
      const shortName = parts[0];
      const matched = list.filter(
        (x: any) => String(getName(x)) === String(shortName),
      );
      if (matched.length === 1)
        return { namespace: getNs(matched[0]), name: shortName };
      return { namespace: vmNamespace, name: shortName };
    })
    .filter((ref: any) => ref?.name && ref?.namespace)
    .filter((ref: any) => !hasNad(ref.namespace, ref.name))
    .map((ref: any) => `${ref.namespace}/${ref.name}`);
}
