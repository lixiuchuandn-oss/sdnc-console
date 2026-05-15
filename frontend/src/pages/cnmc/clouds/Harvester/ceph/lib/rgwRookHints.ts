/**
 * Rook CephObjectStore / CephObjectStoreUser → RGW S3 网关 Endpoint 推导与 Secret 引用解析（字段宽松，适配多版本 Rook）。
 */

function trimStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** 将主机或 URL 规范为带协议的字符串（供 S3 Client 使用） */
export function normalizeHttpUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  if (t.startsWith('http://') || t.startsWith('https://')) return t;
  return `https://${t}`;
}

/**
 * 从 CephObjectStore CR 推导候选 Endpoint（集群内 Service DNS + status.info 等）。
 * 外部 Ingress / NodePort 仍需运维核对或手改。
 */
export function suggestedRgwHttpsEndpoints(store: any): string[] {
  const urls = new Set<string>();
  const ns = trimStr(store?.metadata?.namespace);
  const nm = trimStr(store?.metadata?.name);
  if (ns && nm) {
    urls.add(`https://rook-ceph-rgw-${nm}.${ns}.svc:443`);
    urls.add(`http://rook-ceph-rgw-${nm}.${ns}.svc:80`);
  }
  const info = store?.status?.info;
  if (info && typeof info === 'object') {
    const candidates = [
      (info as any).endpoint,
      (info as any).externalEndpoint,
      (info as any).rgwEndpoint,
      (info as any).dnsName,
      (info as any).host,
    ];
    for (const c of candidates) {
      const s = trimStr(c);
      if (s) urls.add(normalizeHttpUrl(s));
    }
  }
  const cep = store?.status?.endpoints;
  if (Array.isArray(cep)) {
    for (const x of cep) {
      const s = trimStr(typeof x === 'string' ? x : (x as any)?.url ?? (x as any)?.host);
      if (s) urls.add(normalizeHttpUrl(s));
    }
  }
  return [...urls];
}

export function objectStoreEndpointSelectOptions(stores: any[]): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const seen = new Set<string>();
  for (const s of stores) {
    const ns = trimStr(s?.metadata?.namespace);
    const nm = trimStr(s?.metadata?.name);
    for (const url of suggestedRgwHttpsEndpoints(s)) {
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push({ label: `${ns}/${nm} · ${url}`, value: url });
    }
  }
  return out;
}

/** CephObjectStoreUser → 关联 Secret（命名空间一般为 CR 所在 ns） */
export function objectStoreUserSecretRef(user: any): { namespace: string; name: string } | null {
  const ns = trimStr(user?.metadata?.namespace);
  const secretName =
    trimStr(user?.status?.info?.secretName) ||
    trimStr(user?.status?.secretName) ||
    trimStr(user?.spec?.secretName);
  if (!ns || !secretName) return null;
  return { namespace: ns, name: secretName };
}

/** 展示用短文案：优先 spec.displayName，否则回落 CR 名 */
export function objectStoreUserPrimaryLabel(user: any): string {
  const dn = trimStr(user?.spec?.displayName);
  if (dn) return dn;
  const ns = trimStr(user?.metadata?.namespace);
  const nm = trimStr(user?.metadata?.name);
  return ns && nm ? `${ns}/${nm}` : nm || ns || '—';
}

/** RGW 用户 CR 的 `spec.store` + 命名空间 → Tower 网关配置的 Map 键（与 CephObjectStore 的 namespace/name 对齐） */
export function objectStoreUserGatewayStoreKey(user: any): string | null {
  const ns = trimStr(user?.metadata?.namespace);
  const store = trimStr(user?.spec?.store);
  if (!ns || !store) return null;
  return `${ns}/${store}`;
}

export function objectStoreUserSelectOptions(users: any[]): { label: string; value: string; raw: any }[] {
  return users.map((u) => {
    const ns = trimStr(u?.metadata?.namespace);
    const nm = trimStr(u?.metadata?.name);
    const store = trimStr(u?.spec?.store) || '—';
    const ref = objectStoreUserSecretRef(u);
    const suffix = ref ? '' : ' · 无 Secret 引用';
    const primary = objectStoreUserPrimaryLabel(u);
    const hasDisplayName = Boolean(trimStr(u?.spec?.displayName));
    const tail = `${ns}/${nm} · store: ${store}`;
    const label = hasDisplayName ? `${primary}（${tail}）${suffix}` : `${primary}${suffix}`;
    return {
      label,
      value: `${ns}/${nm}`,
      raw: u,
    };
  });
}
