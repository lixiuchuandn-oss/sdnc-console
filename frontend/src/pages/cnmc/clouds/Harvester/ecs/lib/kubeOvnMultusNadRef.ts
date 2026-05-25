/**
 * 给「虚拟机要连 Kube-OVN 子网」用的两个小工具（和界面无关，就是算名字、查在不在）。
 *
 * 打个比方：子网像「房间号」，虚拟机真正插网线要插到墙上的「插座」；在集群里这个插座叫 NAD。
 * 我们要先算出「这个房间该插哪个插座的名字」，再去看集群里这个插座有没有已经建好。
 *
 * - expectedMultusNadRefForSubnet：算「插座全名」长什么样（一般是 命名空间/名字）。
 * - isKubeOvnSubnetNadReady：在传进来的 NAD 列表里找，这个插座是不是已经有了。
 *   列表如果是空的，先不拦你（避免一进来全灰掉），有列表再严格比对。
 */

/**
 * 根据一条子网，算出虚拟机 Multus 里应该写的那条 NAD 引用（namespace/name 这种字符串）。
 * 算不出来就返回 undefined（例如子网和当前选的 VPC 对不上）。
 */
export function expectedMultusNadRefForSubnet(
  subnet: any,
  vpc: string | undefined,
  nadOptions: { value?: string }[],
): string | undefined {
  const val = subnet?.name || subnet?.metadata?.name;
  if (!val) return undefined;
  if (vpc != null && vpc !== "") {
    if (String(subnet?.vpc ?? subnet?.spec?.vpc) !== String(vpc)) return undefined;
  }

  let subnetNs = subnet?.metadata?.namespace || subnet?.namespace;
  if (!subnetNs) {
    const provider = subnet?.provider || subnet?.spec?.provider;
    if (provider) {
      const parts = String(provider).split(".");
      if (parts.length >= 2) subnetNs = parts[parts.length - 2];
    }
  }
  if (subnetNs) {
    return `${subnetNs}/${val}`;
  }
  const found = (nadOptions || []).find((x: any) => {
    const vv = String(x?.value || "");
    const parts = vv.split("/");
    const name = parts.length > 1 ? parts[1] : parts[0];
    return name === val;
  });
  if (found) return String(found.value);
  return undefined;
}

/**
 * 问一句：这条子网对应的 NAD，在「当前拿到的 NAD 列表」里是不是已经有了？
 * 有了算 true，没有算 false；列表还没加载（空数组）时先当 true，不挡你操作。
 */
export function isKubeOvnSubnetNadReady(
  subnet: any,
  vpc: string | undefined,
  nadOptions: { value?: string }[],
): boolean {
  const list = Array.isArray(nadOptions) ? nadOptions : [];
  if (list.length === 0) return true;
  const ref = expectedMultusNadRefForSubnet(subnet, vpc, nadOptions);
  if (!ref) return false;
  return list.some((o) => String(o?.value) === ref);
}
