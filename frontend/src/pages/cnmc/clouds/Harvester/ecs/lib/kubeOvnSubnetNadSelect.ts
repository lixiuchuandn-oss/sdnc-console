/**
 * 给页面上的「子网下拉框」用的：把每条子网变成 Ant Design Select 需要的一行数据。
 *
 * 为啥要单独写：有时子网已经在列表里了，但集群里对应的 NAD 还没同步过来，这时让用户硬选会踩坑。
 * 所以：NAD 还没对上时，把这一行变灰（不能选）；如果用户本来就已经选中了这条子网，就保留可选，
 * 并在文字里提示「还没就绪，等等或刷新」。
 *
 * 和上面 kubeOvnMultusNadRef.ts 的关系：这里负责「怎么显示」，那里负责「算名字、查在不在」。
 *
 * subnetKey：从子网对象里取出「当选项 value 用的那个短名字」。
 * kubeOvnSubnetNadOption：把一条子网变成 { 显示文字, 选项值, 能不能点 }。
 */
import { isKubeOvnSubnetNadReady } from "./kubeOvnMultusNadRef";

/** 子网在表单里当 value 用的名字（metadata.name 或 name），也用来和别的网卡去重。 */
export function subnetKey(s: any): string {
  return String(s?.metadata?.name || s?.name || "");
}

/**
 * 把一条子网变成下拉框里的一行：显示什么字、value 是什么、能不能点。
 * vpcIdForNad 要和算「NAD 在不在」时用到的 VPC 一致（普通 VPC 或扁平子网用的 flat 那个）。
 */
export function kubeOvnSubnetNadOption(
  x: any,
  nadOptions: any[],
  vpcIdForNad: string,
  currentName: any,
  buildLabel: (x: any) => string,
) {
  const ready = isKubeOvnSubnetNadReady(x, vpcIdForNad, nadOptions);
  const isCurrent = currentName != null && String(x?.name) === String(currentName);
  const base = buildLabel(x);
  let label = base;
  if (!ready) {
    label = isCurrent
      ? `${base}（子网网络未就绪，请稍候重试或刷新后创建）`
      : `${base}（网络未就绪）`;
  }
  return { label, value: x?.name, disabled: !ready && !isCurrent };
}
