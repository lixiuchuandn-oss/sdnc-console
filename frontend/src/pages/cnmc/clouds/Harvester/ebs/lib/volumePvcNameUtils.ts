/** 与 VolumeCreateModal / 快照恢复一致的 PVC metadata.name 生成规则 */
export function generateVolumePvcName(): string {
  let suffix = Math.random().toString(36).substring(2);
  while (suffix.length < 11) suffix += Math.random().toString(36).substring(2);
  return `id-vol-${suffix.substring(0, 11)}`;
}
