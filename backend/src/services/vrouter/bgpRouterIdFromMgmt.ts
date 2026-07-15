/**
 * 管理口 IPv4 → 公网 BGP router_id 平台意图绑定（不新建 bgp 壳、不下发设备）。
 */

export type BgpRouterIdBindResult = {
  changed: boolean;
  configJson: string;
  reason: 'no_bgp' | 'manual_keep' | 'filled' | 'followed' | 'unchanged' | 'parse_error';
};

function isPublicBgpSegment(seg: unknown): boolean {
  if (!seg || typeof seg !== 'object') return false;
  const vrf = (seg as { vrf?: unknown }).vrf;
  return vrf == null || vrf === '' || vrf === 0 || vrf === '0';
}

function findPublicBgpIndex(bgp: unknown[]): number {
  const idx = bgp.findIndex(isPublicBgpSegment);
  return idx >= 0 ? idx : 0;
}

function readRouterId(seg: unknown): string {
  if (!seg || typeof seg !== 'object') return '';
  return String((seg as { router_id?: unknown }).router_id ?? '').trim();
}

function mirrorPublicRouterIdMeta(cfg: Record<string, unknown>, routerId: string): void {
  const pe = cfg.pe;
  if (pe && typeof pe === 'object' && !Array.isArray(pe)) {
    const peObj = pe as Record<string, unknown>;
    const pub =
      peObj.publicConfig && typeof peObj.publicConfig === 'object' && !Array.isArray(peObj.publicConfig)
        ? ({ ...(peObj.publicConfig as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    const pbg =
      pub.publicBgp && typeof pub.publicBgp === 'object' && !Array.isArray(pub.publicBgp)
        ? ({ ...(pub.publicBgp as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    pbg.routerId = routerId;
    pub.publicBgp = pbg;
    peObj.publicConfig = pub;
    cfg.pe = peObj;
  }

  const ce = cfg.ce;
  if (ce && typeof ce === 'object' && !Array.isArray(ce)) {
    const ceObj = ce as Record<string, unknown>;
    const pub =
      ceObj.publicConfig && typeof ceObj.publicConfig === 'object' && !Array.isArray(ceObj.publicConfig)
        ? ({ ...(ceObj.publicConfig as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    const pbg =
      pub.publicBgp && typeof pub.publicBgp === 'object' && !Array.isArray(pub.publicBgp)
        ? ({ ...(pub.publicBgp as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    pbg.routerId = routerId;
    pub.publicBgp = pbg;
    ceObj.publicConfig = pub;
    cfg.ce = ceObj;
  }
}

/**
 * 若已有公网 bgp 段：router_id 为空则填入；若等于旧管理 IP 则跟随变更；否则保留人工值。
 * 无 bgp 段时不造壳。
 */
export function bindBgpRouterIdFromManagementIp(
  configJson: string | null | undefined,
  managementIp: string,
  previousManagementIp?: string | null,
): BgpRouterIdBindResult {
  const ip = String(managementIp ?? '').trim();
  if (!ip) {
    return { changed: false, configJson: String(configJson ?? '{}'), reason: 'unchanged' };
  }

  let cfg: Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(configJson ?? '{}') || '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { changed: false, configJson: String(configJson ?? '{}'), reason: 'parse_error' };
    }
    cfg = { ...(parsed as Record<string, unknown>) };
  } catch {
    return { changed: false, configJson: String(configJson ?? '{}'), reason: 'parse_error' };
  }

  if (!Array.isArray(cfg.bgp) || cfg.bgp.length === 0) {
    return { changed: false, configJson: JSON.stringify(cfg), reason: 'no_bgp' };
  }

  const bgp = [...(cfg.bgp as unknown[])];
  const idx = findPublicBgpIndex(bgp);
  const seg = bgp[idx];
  if (!seg || typeof seg !== 'object') {
    return { changed: false, configJson: JSON.stringify(cfg), reason: 'no_bgp' };
  }

  const current = readRouterId(seg);
  const prevIp = String(previousManagementIp ?? '').trim();

  let reason: BgpRouterIdBindResult['reason'] = 'unchanged';
  if (!current) {
    reason = 'filled';
  } else if (prevIp && current === prevIp && current !== ip) {
    reason = 'followed';
  } else if (current === ip) {
    return { changed: false, configJson: JSON.stringify(cfg), reason: 'unchanged' };
  } else {
    return { changed: false, configJson: JSON.stringify(cfg), reason: 'manual_keep' };
  }

  const nextSeg = { ...(seg as Record<string, unknown>), router_id: ip };
  bgp[idx] = nextSeg;
  cfg.bgp = bgp;
  mirrorPublicRouterIdMeta(cfg, ip);

  return { changed: true, configJson: JSON.stringify(cfg), reason };
}
