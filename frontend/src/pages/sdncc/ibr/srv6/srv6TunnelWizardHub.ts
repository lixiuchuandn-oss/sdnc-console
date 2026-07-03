/** P3/P5 · Hub–Spoke 隧道向导纯逻辑（可单测） */

export type HubPeSlot = 'peA' | 'peB';
export type HubCeSlot = 'ceA' | 'ceB';
export type HubVrfMode = 'REUSE_VRF' | 'DEDICATED_VRF';
export type HubLanOptionState = 'idle' | 'reuse_reusable' | 'dedicated_occupied';

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

export type HubPortRegistryLanRef = {
  lanIf?: string;
  hubVrfMode?: string | null;
  tunnelName?: string;
};

const normIf = (raw: unknown) => String(raw ?? '').trim().toLowerCase();

/** 按 portRegistry 判定 Hub LAN 占用态（P5c 统一选项标签） */
export const classifyHubLanOption = (
  ifName: string,
  portRegistry: HubPortRegistryLanRef[] | undefined | null,
): { state: HubLanOptionState; tunnelNames: string[] } => {
  const key = normIf(ifName);
  if (!key) return { state: 'idle', tunnelNames: [] };
  const hits = (portRegistry ?? []).filter((e) => e.lanIf && normIf(e.lanIf) === key);
  const dedicated = hits.filter((e) => e.hubVrfMode === 'DEDICATED_VRF');
  if (dedicated.length) {
    return {
      state: 'dedicated_occupied',
      tunnelNames: dedicated.map((e) => String(e.tunnelName ?? '').trim()).filter(Boolean),
    };
  }
  const reuse = hits.filter((e) => e.hubVrfMode === 'REUSE_VRF');
  if (reuse.length) {
    return {
      state: 'reuse_reusable',
      tunnelNames: reuse.map((e) => String(e.tunnelName ?? '').trim()).filter(Boolean),
    };
  }
  return { state: 'idle', tunnelNames: [] };
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

export type HubTunnelStatusForAnchorPreview = HubTunnelRefForReuse & {
  peAInnerIf?: string | null;
  peBInnerIf?: string | null;
  hubBindings?: { lanIf?: string; lanInventoryId?: string } | null;
};

/** 从 peHubStatus 同步提取 REUSE 锚点 LAN（无需等待 fetchSrv6Tunnel） */
export const pickHubReuseAnchorPreviewFromStatus = (
  hubPeSlot: HubPeSlot,
  tunnels: HubTunnelStatusForAnchorPreview[] | undefined | null,
): Pick<HubReuseAnchor, 'hubLanIf' | 'hubLanInventoryId' | 'hubPeInnerIf' | 'sourceTunnelId'> | null => {
  const ref = findFirstReuseVrfTunnelRef(tunnels);
  if (!ref?.tunnelId || !Array.isArray(tunnels)) return null;
  const t = tunnels.find((x) => x.tunnelId === ref.tunnelId);
  if (!t) return null;
  const innerField = hubPeInnerIfField(hubPeSlot);
  const innerIf = String(
    (innerField === 'peAInnerIf' ? t.peAInnerIf : t.peBInnerIf) ?? '',
  ).trim();
  const hubLanIf = String(t.hubBindings?.lanIf ?? innerIf).trim();
  if (!hubLanIf) return null;
  return {
    hubLanIf,
    hubLanInventoryId: t.hubBindings?.lanInventoryId,
    hubPeInnerIf: hubLanIf,
    sourceTunnelId: ref.tunnelId,
  };
};

export type HubLanOptionRow = {
  value: string;
  ifName: string;
  lanState?: HubLanOptionState;
};

/** 根因 1：hubLanInventoryId 与 hubLanIf 是否指向不同接口 */
export const detectHubLanSelectionDesync = (input: {
  hubLanInventoryId?: string;
  hubLanIf?: string;
  lanOptions: HubLanOptionRow[];
}): boolean => {
  const id = String(input.hubLanInventoryId ?? '').trim();
  const ifName = String(input.hubLanIf ?? '').trim();
  if (!id || !ifName) return false;
  const hit = input.lanOptions.find((o) => o.value === id);
  if (!hit?.ifName) return false;
  return normIf(hit.ifName) !== normIf(ifName);
};

/**
 * 解析 Hub LAN 占用态：id/if 失步时以 hubLanIf 为准（根因 1）。
 */
export const resolveSelectedHubLanState = (input: {
  hubLanInventoryId?: string;
  hubLanIf?: string;
  lanOptions: HubLanOptionRow[];
  portRegistry?: HubPortRegistryLanRef[] | null;
}): { state: HubLanOptionState; desynced: boolean } => {
  const ifName = String(input.hubLanIf ?? '').trim();
  const desynced = detectHubLanSelectionDesync({
    hubLanInventoryId: input.hubLanInventoryId,
    hubLanIf: ifName,
    lanOptions: input.lanOptions,
  });
  if (desynced && ifName) {
    return { state: classifyHubLanOption(ifName, input.portRegistry).state, desynced: true };
  }
  const id = String(input.hubLanInventoryId ?? '').trim();
  if (id) {
    const hit = input.lanOptions.find((o) => o.value === id);
    if (hit?.lanState) return { state: hit.lanState, desynced: false };
  }
  if (ifName) {
    return { state: classifyHubLanOption(ifName, input.portRegistry).state, desynced: false };
  }
  return { state: 'idle', desynced: false };
};

export type DeriveHubVrfModeInput = {
  isFirstHubTunnel: boolean;
  hasReuseAnchorOnHub: boolean;
  selectedLanState: HubLanOptionState;
  /** 后续隧道默认继承锚点（LAN/CE 只读、未改选其它空闲 LAN） */
  inheritReuseAnchor?: boolean;
  /** 根因 1：inventoryId 与 ifName 失步 */
  hubLanDesynced?: boolean;
  /** 根因 3：Hub CE 已改选为非锚点 CE */
  hubCeDiffersFromAnchor?: boolean;
  /** 当前 LAN 选择与 Hub 上 REUSE 锚点一致（ifName / inventoryId） */
  matchesReuseAnchorLan?: boolean;
};

/** P5c：由 Hub 内网口选项态隐式推导 hubVrfMode */
export const deriveHubVrfMode = (input: DeriveHubVrfModeInput): HubVrfMode => {
  if (input.selectedLanState === 'reuse_reusable' || input.inheritReuseAnchor) {
    return 'REUSE_VRF';
  }
  if (input.hubCeDiffersFromAnchor) {
    return 'DEDICATED_VRF';
  }
  if (input.selectedLanState === 'idle') {
    // 首条 Hub 隧道选空闲 LAN 建锚点
    if (input.isFirstHubTunnel) return 'REUSE_VRF';
    // 后续隧道显式选回锚点 LAN（portRegistry 未及时标 reuse 时仍 REUSE）
    if (
      input.hasReuseAnchorOnHub &&
      input.matchesReuseAnchorLan &&
      !input.hubCeDiffersFromAnchor
    ) {
      return 'REUSE_VRF';
    }
    return 'DEDICATED_VRF';
  }
  return 'DEDICATED_VRF';
};

export type ValidateHubTunnelFormInput = {
  hubVrfMode: HubVrfMode;
  hubWanInventoryId?: string;
  hubWanIf?: string;
  hubLanInventoryId?: string;
  hubLanIf?: string;
  isFirstHubTunnel: boolean;
  hasWanInventoryOptions: boolean;
  hasLanInventoryOptions: boolean;
  reuseAnchor?: HubReuseAnchor | null;
  inheritReuseAnchor?: boolean;
  selectedLanState?: HubLanOptionState;
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

  if (input.hubVrfMode === 'DEDICATED_VRF') {
    if (!input.hasLanInventoryOptions) {
      return { ok: false, message: hubInventoryBlockMessage('lan') };
    }
    if (!String(input.hubLanInventoryId ?? '').trim() && !String(input.hubLanIf ?? '').trim()) {
      return { ok: false, message: '请选择 Hub 内网口（独立专网须使用空闲 LAN）' };
    }
    if (input.selectedLanState === 'dedicated_occupied') {
      return { ok: false, message: '所选 Hub 内网口已被独立专网隧道占用' };
    }
    return { ok: true };
  }

  if (input.inheritReuseAnchor) {
    if (!input.reuseAnchor?.hubLanIf || !input.reuseAnchor?.hubCeUuid) {
      return {
        ok: false,
        message: '未能继承首条隧道的 Hub 客户侧配置，请确认 Hub 上已有共用客户侧隧道',
      };
    }
    return { ok: true };
  }

  if (!input.hasLanInventoryOptions) {
    return { ok: false, message: hubInventoryBlockMessage('lan') };
  }
  const hasLanSelection =
    !!String(input.hubLanInventoryId ?? '').trim() || !!String(input.hubLanIf ?? '').trim();
  if (!hasLanSelection) {
    return {
      ok: false,
      message: input.isFirstHubTunnel ? '首条 Hub 隧道须选择 Hub 内网口' : '请选择 Hub 内网口',
    };
  }
  if (input.selectedLanState === 'dedicated_occupied') {
    return { ok: false, message: '所选 Hub 内网口已被独立专网隧道占用' };
  }
  return { ok: true };
};

/** Hub LAN 选中后同步 inventoryId / peInnerIf / hubLanIf */
export const hubLanSelectionPatch = (
  hubPeSlot: HubPeSlot,
  ifName: string,
  inventoryId?: string,
): Partial<Record<'hubLanIf' | 'hubLanInventoryId' | 'peAInnerIf' | 'peBInnerIf', string>> => {
  const lan = String(ifName ?? '').trim();
  if (!lan) return {};
  const innerField = hubPeInnerIfField(hubPeSlot);
  const patch: Partial<Record<'hubLanIf' | 'hubLanInventoryId' | 'peAInnerIf' | 'peBInnerIf', string>> = {
    hubLanIf: lan,
    [innerField]: lan,
  };
  const invId = String(inventoryId ?? '').trim();
  if (invId) patch.hubLanInventoryId = invId;
  return patch;
};

/** 清空 Hub 内网口选择及同步的 peInnerIf */
export const hubLanSelectionClear = (
  hubPeSlot: HubPeSlot,
): Partial<
  Record<'hubLanIf' | 'hubLanInventoryId' | 'peAInnerIf' | 'peBInnerIf', undefined>
> => {
  const innerField = hubPeInnerIfField(hubPeSlot);
  return {
    hubLanIf: undefined,
    hubLanInventoryId: undefined,
    [innerField]: undefined,
  };
};

/** Hub CE 是否与锚点 CE 不同 */
export const hubCeDiffersFromAnchor = (
  selectedCeUuid: unknown,
  anchorCeUuid: unknown,
): boolean => {
  const sel = String(selectedCeUuid ?? '').trim();
  const anchor = String(anchorCeUuid ?? '').trim();
  return !!sel && !!anchor && sel !== anchor;
};

/** 当前 Hub LAN 选择是否与 REUSE 锚点 LAN 一致（inventoryId 或 ifName） */
export const matchesHubReuseAnchorLan = (input: {
  hubLanInventoryId?: string;
  hubLanIf?: string;
  anchorLanInventoryId?: string;
  anchorLanIf?: string;
}): boolean => {
  const selId = String(input.hubLanInventoryId ?? '').trim();
  const selIf = normIf(input.hubLanIf);
  const anchorId = String(input.anchorLanInventoryId ?? '').trim();
  const anchorIf = normIf(input.anchorLanIf);
  if (anchorId && selId && selId === anchorId) {
    if (anchorIf && selIf) return selIf === anchorIf;
    return true;
  }
  return !!(anchorIf && selIf && selIf === anchorIf);
};

/** 后续 REUSE 默认路径：未显式改选其它空闲 LAN / CE 时继承锚点 */
export const shouldInheritReuseAnchor = (input: {
  isFirstHubTunnel: boolean;
  hasReuseAnchor: boolean;
  hubLanInventoryId?: string;
  hubLanIf?: string;
  anchorLanInventoryId?: string;
  anchorLanIf?: string;
  selectedLanState?: HubLanOptionState;
  hubCeUuid?: string;
  anchorCeUuid?: string;
  hubLanDesynced?: boolean;
}): boolean => {
  if (input.isFirstHubTunnel || !input.hasReuseAnchor) return false;
  const anchorLanMatch = matchesHubReuseAnchorLan({
    hubLanInventoryId: input.hubLanInventoryId,
    hubLanIf: input.hubLanIf,
    anchorLanInventoryId: input.anchorLanInventoryId,
    anchorLanIf: input.anchorLanIf,
  });
  if (input.hubLanDesynced && !anchorLanMatch) return false;
  if (hubCeDiffersFromAnchor(input.hubCeUuid, input.anchorCeUuid)) return false;
  if (input.selectedLanState === 'idle') {
    // 显式选回锚点 LAN；或未选 LAN 时默认继承（第二条 REUSE 隧道）
    if (anchorLanMatch) return true;
    const selId = String(input.hubLanInventoryId ?? '').trim();
    const selIf = normIf(input.hubLanIf);
    if (!selId && !selIf) return true;
    return false;
  }
  if (input.selectedLanState === 'reuse_reusable') return true;
  if (
    matchesHubReuseAnchorLan({
      hubLanInventoryId: input.hubLanInventoryId,
      hubLanIf: input.hubLanIf,
      anchorLanInventoryId: input.anchorLanInventoryId,
      anchorLanIf: input.anchorLanIf,
    })
  ) {
    return true;
  }
  const selId = String(input.hubLanInventoryId ?? '').trim();
  const selIf = normIf(input.hubLanIf);
  const anchorId = String(input.anchorLanInventoryId ?? '').trim();
  const anchorIf = normIf(input.anchorLanIf);
  if (anchorId && selId && selId === anchorId) {
    if (anchorIf && selIf) return selIf === anchorIf;
    return true;
  }
  if (anchorIf && selIf) return selIf === anchorIf;
  return !selId && !selIf;
};
