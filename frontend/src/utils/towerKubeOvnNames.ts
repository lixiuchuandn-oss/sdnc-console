/**
 * Kube-OVN 资源在集群中的 metadata.name 仅允许合法 DNS 子域名字符；
 * 部分 CR（如 ProviderNetwork）还有更短长度限制。中文等展示名写入注解。
 */
export const TOWER_IO_ALIES_ANNOTATION = 'tower.io/alies';

/**
 * ProviderNetwork 注解：节点名 → 作为 bond 的**成员物理网卡**（JSON 对象字符串）。
 * 存在且可解析为对象时，表示此物理网络在 HCI 侧按 bond 使用，成员口列表供拓扑与对端展示对齐。
 * 例：`'{"node1":["enp94s0f0"]}'`
 */
export const PROVIDER_NETWORK_ORIGIN_NICS_ANNOTATION = 'hci.manager.system/provider-network-origin-nics';

/** 12 位小写 a-z0-9，作 metadata.name（与现有 ProviderNetwork 策略一致） */
export function generateKubeOvnTwelveCharName(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]).join('');
}
