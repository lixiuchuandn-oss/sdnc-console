/**
 * 扁平子网选择器：已占用子网名（主网卡 + 已有辅助网卡 flat_subnet）。
 */
import {
  buildPrimaryNicFormSlice,
  buildSecondaryNicsFormSlicesFromRecord,
} from "./networkNicsForm";

export function usedFlatSubnetNamesForPicker(
  vmData: any,
  subnets: any[],
): Set<string> {
  const used = new Set<string>();
  try {
    const primaryPatch = buildPrimaryNicFormSlice(vmData, subnets || []);
    const p = primaryPatch?.primaryNic as any;
    if (String(primaryPatch?.netMode || "") === "flat_subnet" && p?.subnet) {
      used.add(String(p.subnet));
    }
    const list = buildSecondaryNicsFormSlicesFromRecord(vmData, subnets || []);
    list.forEach((it: any) => {
      if (String(it?.mode || "") === "flat_subnet" && it?.subnet) {
        used.add(String(it.subnet));
      }
    });
  } catch {
    /* ignore */
  }
  return used;
}
