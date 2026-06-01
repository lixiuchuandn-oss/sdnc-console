/** 解析 HSM GET /v1/hms/device/profiles 响应为下拉选项 */

export type HmsDeviceProfileOption = { value: string; label: string };

export function parseHmsDeviceProfilesPayload(data: unknown): HmsDeviceProfileOption[] {
  if (data == null) return [];
  const seen = new Set<string>();
  const out: HmsDeviceProfileOption[] = [];

  const push = (value: unknown, label?: unknown) => {
    const v = String(value ?? '').trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    const l = String(label ?? v).trim() || v;
    out.push({ value: v, label: l });
  };

  if (typeof data === 'string') {
    push(data);
    return out;
  }

  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === 'string') {
        push(item);
        continue;
      }
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      push(
        o.name ?? o.id ?? o.key ?? o.profile ?? o.value,
        o.label ?? o.displayName ?? o.display_name ?? o.name ?? o.id,
      );
    }
    return out.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
  }

  if (typeof data !== 'object') return out;

  const root = data as Record<string, unknown>;
  const nested = [root.profiles, root.items, root.profile_list, root.data];
  for (const block of nested) {
    if (block == null) continue;
    if (Array.isArray(block) || typeof block === 'object') {
      const parsed = parseHmsDeviceProfilesPayload(block);
      if (parsed.length > 0) return parsed;
    }
  }

  return out.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
}
