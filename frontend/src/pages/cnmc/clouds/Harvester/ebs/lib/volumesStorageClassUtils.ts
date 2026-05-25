import { isClusterDefaultStorageClass, isSystemStorageClass } from 'utils/harvesterUtils';

export type StorageClassOption = { value: string; label: string };

export function buildStorageClassSelectOptions(storageClasses: unknown[]): StorageClassOption[] {
  return (storageClasses || [])
    .map((item: unknown) => {
      const row = item as { metadata?: { name?: string }; name?: string };
      const n = row?.metadata?.name || row?.name;
      if (!n || isSystemStorageClass(n)) return null;
      const isDef = isClusterDefaultStorageClass(item);
      return { value: n, label: isDef ? `${n}（默认）` : n };
    })
    .filter(Boolean) as StorageClassOption[];
}

export function pickExportTargetStorageClass(
  storageClasses: unknown[],
  defaultStorageClassName?: string,
): string | undefined {
  const scNames = (storageClasses || [])
    .map((s: unknown) => {
      const row = s as { metadata?: { name?: string }; name?: string };
      return row?.metadata?.name || row?.name;
    })
    .filter(Boolean) as string[];
  return (
    defaultStorageClassName ||
    scNames.find((n) => n.toLowerCase() === 'longhorn') ||
    scNames.find((n) => n.toLowerCase().includes('longhorn')) ||
    scNames[0]
  );
}

export function generateVolumeSnapshotAlias(volumeName: string): string {
  const suffix = Math.random().toString(36).substring(2, 7);
  return `${volumeName}-snap-${suffix}`;
}
