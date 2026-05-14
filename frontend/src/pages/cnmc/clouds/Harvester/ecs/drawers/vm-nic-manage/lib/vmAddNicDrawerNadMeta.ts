/**
 * 添加网卡抽屉：NAD 列表解析为下拉项。
 */

export type VmAddNicNadInfo = {
  label: string;
  value: string;
  _type: string;
};

export function buildVmAddNicNadInfos(nads: any[]): VmAddNicNadInfo[] {
  return (nads || []).map((n: any) => {
    let type = "";
    let vlan: any;
    try {
      const cfg = JSON.parse(n?.spec?.config || "{}");
      type = cfg?.type || "";
      vlan = cfg?.vlan;
    } catch {
      /* ignore */
    }
    const id = n?.metadata?.name || "-";
    const alias = n?.metadata?.annotations?.["tower.io/alias"] || "";
    const labelBase = alias && alias !== id ? `${alias} (${id})` : id;
    const tag = type || "-";
    const label = vlan
      ? `${labelBase} (VLAN ${vlan}) · ${tag}`
      : `${labelBase} · ${tag}`;
    const value = `${n.metadata.namespace}/${n.metadata.name}`;
    return { label, value, _type: String(type).toLowerCase() };
  });
}

export function nadOptionsFlatFromInfos(nadInfos: VmAddNicNadInfo[]) {
  return nadInfos
    .filter((x) => !String(x._type || "").includes("ovn"))
    .map((x) => ({ label: x.label, value: x.value }));
}

/**
 * 直通类 NAD：SR-IOV / macvtap / macvlan（与 VmCreateWizard StepNetworks 直通下拉一致）。
 * `_type` 缺失时回退用 label 关键字，避免 NAD 未标 type 时选不到。
 */
export function nadOptionsPassthroughFromInfos(nadInfos: VmAddNicNadInfo[]) {
  return nadInfos
    .filter((x) => {
      const t = String(x._type || "").toLowerCase();
      if (t) return t === "sriov" || t === "macvtap" || t === "macvlan";
      const lbl = String(x.label || "").toLowerCase();
      return (
        lbl.includes("sriov") ||
        lbl.includes("macvtap") ||
        lbl.includes("macvlan")
      );
    })
    .map((x) => ({ label: x.label, value: x.value }));
}

export function passthroughKubevirtIfaceTypeFromNad(
  nadOpt: VmAddNicNadInfo | undefined,
): "sriov" | "macvtap" {
  const t = String(nadOpt?._type || "").toLowerCase();
  if (t === "sriov") return "sriov";
  if (t === "macvtap" || t === "macvlan") return "macvtap";
  return "sriov";
}
