/** P3 · Hub–Spoke 隧道向导纯逻辑（可单测） */

export type HubPeSlot = 'peA' | 'peB';
export type HubCeSlot = 'ceA' | 'ceB';

export const hubCeSlotForPeSlot = (hubPeSlot: HubPeSlot): HubCeSlot =>
  hubPeSlot === 'peA' ? 'ceA' : 'ceB';

export const hubPeInnerIfField = (hubPeSlot: HubPeSlot): 'peAInnerIf' | 'peBInnerIf' =>
  hubPeSlot === 'peA' ? 'peAInnerIf' : 'peBInnerIf';

export const isFirstHubTunnel = (aliveTunnelCount: number): boolean => aliveTunnelCount === 0;

export type HubInventoryBlockKind = 'wan' | 'lan';

export const hubInventoryBlockMessage = (kind: HubInventoryBlockKind): string =>
  kind === 'wan'
    ? '尚未配置 Hub 公网口。请先在「HUB_PE 角色配置向导」完成 WAN 并保存基线。'
    : '尚未配置 Hub 内网口。请先在「HUB_PE 角色配置向导」完成 LAN 并保存基线。';

export type HubReuseAnchor = {
  hubLanIf: string;
  hubLanInventoryId?: string;
  hubPeInnerIf: string;
  hubCeUuid: string;
  sourceTunnelId?: string;
  sourceTunnelName?: string;
};

export type HubTunnelRecordForAnchor = {
  id?: string;
  name?: string;
  ceA?: string | null;
  ceB?: string | null;
  peAInnerIf?: string | null;
  peBInnerIf?: string | null;
  hubBindings?: { lanIf?: string; lanInventoryId?: string } | null;
};

/** 从首条存活隧道提取 REUSE 锚点（Hub LAN / Hub CE / Hub 内网口） */
export const pickHubReuseAnchorFromTunnel = (
  hubPeSlot: HubPeSlot,
  tunnel: HubTunnelRecordForAnchor,
): HubReuseAnchor | null => {
  const innerField = hubPeInnerIfField(hubPeSlot);
  const innerIf = String(
    (innerField === 'peAInnerIf' ? tunnel.peAInnerIf : tunnel.peBInnerIf) ?? '',
  ).trim();
  const hubLanIf = String(tunnel.hubBindings?.lanIf ?? innerIf).trim();
  if (!hubLanIf) return null;

  const ceSlot = hubCeSlotForPeSlot(hubPeSlot);
  const hubCeUuid = String(ceSlot === 'ceA' ? tunnel.ceA : tunnel.ceB ?? '').trim();
  if (!hubCeUuid) return null;

  return {
    hubLanIf,
    hubLanInventoryId: tunnel.hubBindings?.lanInventoryId,
    hubPeInnerIf: hubLanIf,
    hubCeUuid,
    sourceTunnelId: tunnel.id,
    sourceTunnelName: tunnel.name,
  };
};

export type HubTunnelRefForReuse = {
  tunnelId: string;
  hubVrfMode?: string | null;
};

/** 与后端 findReuseVrfReferenceTunnel 对齐：取首条 REUSE_VRF 隧道（跳过 DEDICATED） */
export const findFirstReuseVrfTunnelRef = (
  tunnels: HubTunnelRefForReuse[] | undefined | null,
): HubTunnelRefForReuse | null => {
  if (!Array.isArray(tunnels)) return null;
  const seen = new Set<string>();
  for (const t of tunnels) {
    const id = String(t?.tunnelId ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (t.hubVrfMode === 'REUSE_VRF') return t;
  }
  return null;
};

export type ValidateHubTunnelFormInput = {
  hubCustomerSide?: string;
  hubWanInventoryId?: string;
  hubWanIf?: string;
  hubLanInventoryId?: string;
  hubLanIf?: string;
  isFirstHubTunnel: boolean;
  hasWanInventoryOptions: boolean;
  hasLanInventoryOptions: boolean;
  reuseAnchor?: HubReuseAnchor | null;
};

export const validateHubTunnelInventory = (
  input: ValidateHubTunnelFormInput,
): { ok: true } | { ok: false; message: string } => {
  if (!input.hasWanInventoryOptions) {
    return { ok: false, message: hubInventoryBlockMessage('wan') };
  }
  if (!String(input.hubWanInventoryId ?? '').trim() && !String(input.hubWanIf ?? '').trim()) {
    return { ok: false, message: '请选择 Hub 公网出口' };
  }

  const dedicated = input.hubCustomerSide === 'dedicated';

  if (dedicated) {
    if (!input.hasLanInventoryOptions) {
      return { ok: false, message: hubInventoryBlockMessage('lan') };
    }
    if (!String(input.hubLanInventoryId ?? '').trim() && !String(input.hubLanIf ?? '').trim()) {
      return { ok: false, message: '独立客户侧须选择 Hub 内网口' };
    }
    return { ok: true };
  }

  if (input.isFirstHubTunnel) {
    if (!input.hasLanInventoryOptions) {
      return { ok: false, message: hubInventoryBlockMessage('lan') };
    }
    if (!String(input.hubLanInventoryId ?? '').trim() && !String(input.hubLanIf ?? '').trim()) {
      return { ok: false, message: '首条共用客户侧隧道须选择 Hub 客户侧 LAN' };
    }
    return { ok: true };
  }

  if (!input.reuseAnchor?.hubLanIf || !input.reuseAnchor?.hubCeUuid) {
    return {
      ok: false,
      message: '未能继承首条隧道的 Hub 客户侧配置，请确认 Hub 上已有共用客户侧隧道',
    };
  }
  return { ok: true };
};

/** 首条 REUSE：Hub LAN 选中后同步 Hub 槽位 peInnerIf */
export const hubLanSelectionPatch = (
  hubPeSlot: HubPeSlot,
  ifName: string,
): Partial<Record<'hubLanIf' | 'peAInnerIf' | 'peBInnerIf', string>> => {
  const lan = String(ifName ?? '').trim();
  if (!lan) return {};
  const innerField = hubPeInnerIfField(hubPeSlot);
  return { hubLanIf: lan, [innerField]: lan };
};
