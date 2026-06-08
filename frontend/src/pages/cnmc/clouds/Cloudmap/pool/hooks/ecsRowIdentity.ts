/** 云主机行与 SSE `vm_status` / `vm_deleted` 可能使用的多种主键（uid、namespace/name 等） */
export function ecsRowIdentityKeys(row: any): string[] {
  const keys = new Set<string>();
  const add = (v: unknown) => {
    const s = String(v ?? '').trim();
    if (s) keys.add(s);
  };
  add(row?.InstanceId);
  add(row?.id);
  add(row?.metadata?.uid);
  if (row?.metadata?.namespace && row?.metadata?.name) {
    add(`${row.metadata.namespace}/${row.metadata.name}`);
  }
  return [...keys];
}

export function indexEcsStatusUpdate(
  buffer: Map<string, any>,
  json: any,
): void {
  const keys = new Set<string>();
  const add = (v: unknown) => {
    const s = String(v ?? '').trim();
    if (s) keys.add(s);
  };
  add(json?.iid);
  add(json?.instanceId);
  add(json?.metadata?.uid);
  if (json?.metadata?.namespace && json?.metadata?.name) {
    add(`${json.metadata.namespace}/${json.metadata.name}`);
  }
  keys.forEach((k) => buffer.set(k, json));
}

export function pickEcsStatusUpdate(
  row: any,
  updates: Map<string, any>,
): any | undefined {
  for (const key of ecsRowIdentityKeys(row)) {
    if (updates.has(key)) return updates.get(key);
  }
  return undefined;
}
