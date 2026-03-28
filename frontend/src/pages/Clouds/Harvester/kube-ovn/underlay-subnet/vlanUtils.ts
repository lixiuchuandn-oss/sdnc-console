/** 默认选中 VLAN：按 spec.id 数值最小（部署侧通常预置 id=0 等） */
export function defaultVlanCrNameByMinVlanId(vlans: any[]): string | undefined {
  if (!Array.isArray(vlans) || vlans.length === 0) return undefined;
  const scored = vlans
    .map((v) => ({
      name: String(v?.metadata?.name ?? '').trim(),
      id: Number(v?.spec?.id),
    }))
    .filter((x) => x.name);
  if (scored.length === 0) return undefined;
  scored.sort((a, b) => {
    const ai = Number.isFinite(a.id) ? a.id : Number.POSITIVE_INFINITY;
    const bi = Number.isFinite(b.id) ? b.id : Number.POSITIVE_INFINITY;
    if (ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name);
  });
  return scored[0].name;
}
