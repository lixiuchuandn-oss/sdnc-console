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
  lanInventoryId?: string;
  hubVrfMode?: string | null;
  tunnelName?: string;
};

export type HubLanInventoryRef = {
  id?: string;
  ifName: string;
  vrf?: number | null;
};

const normIf = (raw: unknown) => String(raw ?? '').trim().toLowerCase();

/** portRegistry 与 LAN inventory 行对齐（lanInventoryId 优先；legacy 无 id 时回退 ifName） */
export const portRegistryLanMatchesInventoryItem = (
  entry: HubPortRegistryLanRef,
  item: HubLanInventoryRef,
): boolean => {
  const entryLanId = String(entry.lanInventoryId ?? '').trim();
  const itemId = String(item.id ?? '').trim();
  if (entryLanId && itemId) return entryLanId === itemId;
  if (entryLanId) return false;
  if (itemId) {
    return !!(entry.lanIf && normIf(entry.lanIf) === normIf(item.ifName));
  }
  return !!(entry.lanIf && normIf(entry.lanIf) === normIf(item.ifName));
};

/** 按 portRegistry 判定 Hub LAN 占用态（P5c 统一选项标签） */
export const classifyHubLanOption = (
  itemOrIfName: HubLanInventoryRef | string,
  portRegistry: HubPortRegistryLanRef[] | undefined | null,
): { state: HubLanOptionState; tunnelNames: string[] } => {
  const item: HubLanInventoryRef =
    typeof itemOrIfName === 'string' ? { ifName: itemOrIfName } : itemOrIfName;
  const key = normIf(item.ifName);
  if (!key) return { state: 'idle', tunnelNames: [] };
  const hits = (portRegistry ?? []).filter((e) => portRegistryLanMatchesInventoryItem(e, item));
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
  ceA?: string | null;
  ceB?: string | null;
  hubBindings?: { lanIf?: string; lanInventoryId?: string } | null;
};

/** 从 peHubStatus 同步提取 REUSE 锚点（LAN + Hub CE；无需等待 fetchSrv6Tunnel） */
export const pickHubReuseAnchorPreviewFromStatus = (
  hubPeSlot: HubPeSlot,
  tunnels: HubTunnelStatusForAnchorPreview[] | undefined | null,
): (Omit<
  Pick<HubReuseAnchor, 'hubLanIf' | 'hubLanInventoryId' | 'hubPeInnerIf' | 'hubCeUuid' | 'sourceTunnelId'>,
  'hubCeUuid'
> & { hubCeUuid?: string }) | null => {
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
  const ceSlot = hubCeSlotForPeSlot(hubPeSlot);
  const hubCeUuid = String(ceSlot === 'ceA' ? t.ceA : t.ceB ?? '').trim();
  return {
    hubLanIf,
    hubLanInventoryId: t.hubBindings?.lanInventoryId,
    hubPeInnerIf: hubLanIf,
    ...(hubCeUuid ? { hubCeUuid } : {}),
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
    const id = String(input.hubLanInventoryId ?? '').trim();
    const byIf = input.lanOptions.find((o) => normIf(o.ifName) === normIf(ifName));
    return {
      state: classifyHubLanOption(
        { id: byIf?.value || id || undefined, ifName },
        input.portRegistry,
      ).state,
      desynced: true,
    };
  }
  const id = String(input.hubLanInventoryId ?? '').trim();
  if (id) {
    const hit = input.lanOptions.find((o) => o.value === id);
    if (hit?.lanState) return { state: hit.lanState, desynced: false };
  }
  if (ifName) {
    const byIf = input.lanOptions.find((o) => normIf(o.ifName) === normIf(ifName));
    return {
      state: classifyHubLanOption({ id: byIf?.value, ifName }, input.portRegistry).state,
      desynced: false,
    };
  }
  return { state: 'idle', desynced: false };
};

export type HubCustomerSideIntent = 'unset' | 'inherit_reuse' | 'explicit_dedicated';

export type ResolveHubCustomerSideIntentInput = {
  isFirstHubTunnel: boolean;
  hasReuseAnchor: boolean;
  hubLanInventoryId?: string;
  hubLanIf?: string;
  selectedLanState?: HubLanOptionState;
  anchorLanInventoryId?: string;
  anchorLanIf?: string;
  hubCeUuid?: string;
  anchorCeUuid?: string;
  /** 用户已手动改选 Hub 客户侧（LAN/CE） */
  customerSideTouched?: boolean;
  /** inventoryId 与 ifName 失步 */
  hubLanDesynced?: boolean;
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
  /** 用户意图（显式独立专网优先于默认继承） */
  customerSideIntent?: HubCustomerSideIntent;
};

/** P5c：由 Hub 内网口选项态隐式推导 hubVrfMode */
export const deriveHubVrfMode = (input: DeriveHubVrfModeInput): HubVrfMode => {
  if (input.customerSideIntent === 'explicit_dedicated') {
    return 'DEDICATED_VRF';
  }
  if (
    input.customerSideIntent === 'inherit_reuse' ||
    input.inheritReuseAnchor ||
    input.matchesReuseAnchorLan
  ) {
    return 'REUSE_VRF';
  }
  if (input.selectedLanState === 'reuse_reusable' && input.matchesReuseAnchorLan) {
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

/** 当前 Hub LAN 选择是否与 REUSE 锚点 LAN 一致（inventoryId 优先；同物理口不同 VRF 不算匹配） */
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
  if (selId && anchorId) {
    if (selId !== anchorId) return false;
    if (anchorIf && selIf) return selIf === anchorIf;
    return true;
  }
  if (selId || anchorId) return false;
  return !!(anchorIf && selIf && selIf === anchorIf);
};

/**
 * 解析 Hub 客户侧用户意图（优先于默认继承）：
 * - explicit_dedicated：显式选了非锚点空闲 LAN 和/或 非锚点 CE
 * - inherit_reuse：锚点 LAN+CE 对齐，或尚未配置客户侧时默认继承
 */
export const resolveHubCustomerSideIntent = (
  input: ResolveHubCustomerSideIntentInput,
): HubCustomerSideIntent => {
  if (input.isFirstHubTunnel || !input.hasReuseAnchor) return 'unset';

  const anchorLanMatch = matchesHubReuseAnchorLan({
    hubLanInventoryId: input.hubLanInventoryId,
    hubLanIf: input.hubLanIf,
    anchorLanInventoryId: input.anchorLanInventoryId,
    anchorLanIf: input.anchorLanIf,
  });
  const ceDiffers = hubCeDiffersFromAnchor(input.hubCeUuid, input.anchorCeUuid);
  const selId = String(input.hubLanInventoryId ?? '').trim();
  const selIf = normIf(input.hubLanIf);
  const hasLanSelection = !!(selId || selIf);
  const anchorCeKnown = !!String(input.anchorCeUuid ?? '').trim();

  if (input.hubLanDesynced && hasLanSelection && !anchorLanMatch) {
    return 'explicit_dedicated';
  }

  if (ceDiffers) return 'explicit_dedicated';
  if (hasLanSelection && input.selectedLanState === 'idle' && !anchorLanMatch) {
    return 'explicit_dedicated';
  }
  if (input.customerSideTouched && hasLanSelection && !anchorLanMatch) {
    return 'explicit_dedicated';
  }
  // 用户已改 Hub CE，但锚点 CE 尚未从 preview/fetch 到位：保守判独立专网
  if (
    input.customerSideTouched &&
    String(input.hubCeUuid ?? '').trim() &&
    !anchorCeKnown
  ) {
    return 'explicit_dedicated';
  }

  if (anchorLanMatch && !ceDiffers) return 'inherit_reuse';
  if (input.selectedLanState === 'reuse_reusable' && anchorLanMatch) return 'inherit_reuse';
  if (!hasLanSelection && !input.customerSideTouched) return 'inherit_reuse';

  return 'unset';
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
  customerSideTouched?: boolean;
}): boolean =>
  resolveHubCustomerSideIntent({
    isFirstHubTunnel: input.isFirstHubTunnel,
    hasReuseAnchor: input.hasReuseAnchor,
    hubLanInventoryId: input.hubLanInventoryId,
    hubLanIf: input.hubLanIf,
    selectedLanState: input.selectedLanState,
    anchorLanInventoryId: input.anchorLanInventoryId,
    anchorLanIf: input.anchorLanIf,
    hubCeUuid: input.hubCeUuid,
    anchorCeUuid: input.anchorCeUuid,
    customerSideTouched: input.customerSideTouched,
    hubLanDesynced: input.hubLanDesynced,
  }) === 'inherit_reuse';
