/**
 * 角色向导：被 SRv6 隧道引用时的锁定 / 回填规则（纯函数，供 PE/CE 向导与单测共用）。
 */

const text = (v: unknown): string => String(v ?? '').trim();

/** 锁定校验用的 WAN 行：Hub 用多 WAN inventory；Spoke 只有单 WAN（wanDev） */
export const wanRowsForLockCheck = (
  isHubPe: boolean,
  hubWanInventory: Array<{ ifName?: unknown }> | undefined,
  wanDev: unknown,
): Array<{ ifName: string }> => {
  if (isHubPe) return (hubWanInventory || []).map((r) => ({ ifName: text(r?.ifName) }));
  const dev = text(wanDev);
  return dev ? [{ ifName: dev }] : [];
};

/**
 * LAN 行 BGP 字段（VRF/ASN/Router-ID/RD/RT）是否锁定。
 * 同 VRF 共用 BGP 参数：VRF 被隧道引用即锁；Spoke 被引用时全锁。LAN 口/IP 另按绑定判断。
 */
export const isLanVrfBgpLocked = (
  tunnelReferenced: boolean,
  isHubPe: boolean,
  vrf: unknown,
  lockedVrfs: Set<string>,
): boolean => {
  if (!tunnelReferenced) return false;
  if (!isHubPe) return true;
  const v = text(vrf);
  return Boolean(v) && lockedVrfs.has(v);
};

/** Hub 公网 BGP ASN：被隧道引用即锁（与 Spoke 一致） */
export const isHubPublicAsnLocked = (tunnelReferenced: boolean): boolean => tunnelReferenced;

/** 设备回读找不到接口时是否清空地址：锁定的字段不清空 */
export const shouldClearIpOnMissingIface = (force: boolean, locked: boolean): boolean => force && !locked;

/**
 * 锁定的 IPv4：仅当前为空时用设备主地址回填，已有值不覆盖。
 * 返回需要写入的值；undefined 表示不动。
 */
export const lockedIpv4Fill = (current: unknown, deviceV4: unknown): string | undefined => {
  if (text(current)) return undefined;
  const v = text(deviceV4);
  return v || undefined;
};

/** 接口名比较：忽略所有空白与大小写（GigabitEthernet 0/7/0 == GigabitEthernet0/7/0） */
export const normalizeIfaceNameLoose = (s: unknown): string => text(s).replace(/\s+/g, '').toLowerCase();
