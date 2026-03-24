/**
 * Kube-OVN 资源在集群中的 metadata.name 仅允许合法 DNS 子域名字符；
 * 部分 CR（如 ProviderNetwork）还有更短长度限制。中文等展示名写入注解。
 */
export const TOWER_IO_ALIES_ANNOTATION = 'tower.io/alies';

/** 12 位小写 a-z0-9，作 metadata.name（与现有 ProviderNetwork 策略一致） */
export function generateKubeOvnTwelveCharName(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]).join('');
}
