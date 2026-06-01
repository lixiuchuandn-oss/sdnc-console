/** 解析 HSM GET /v1/hms/device/profiles 响应为下拉选项 */

export type HmsDeviceProfileOption = { value: string; label: string };

const PROFILE_METADATA_KEYS = new Set([
  'api_version',
  'apiVersion',
  'configured',
  'data',
  'items',
  'message',
  'needsSwitchName',
  'profile_list',
  'profiles',
  'profilesUnavailable',
  'raw',
  'sourcePath',
]);

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
    return out;
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

  for (const [key, value] of Object.entries(root)) {
    if (PROFILE_METADATA_KEYS.has(key)) continue;
    if (typeof value === 'string') {
      push(key, value);
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const item = value as Record<string, unknown>;
      push(
        item.value ?? item.id ?? item.key ?? item.profile ?? item.name ?? key,
        item.label ?? item.displayName ?? item.display_name ?? item.name ?? key,
      );
      continue;
    }
    push(key);
  }

  return out;
}
