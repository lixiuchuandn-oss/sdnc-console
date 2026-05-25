import type { VolumeView } from './volumesSectionTypes';

export type VolumeSafeRead = ReturnType<typeof createVolumeSafeRead>;

/** 从 PVC 行与 VM 列表安全读字段；`attachedVm` 反查挂载实例 */
export function createVolumeSafeRead(vms: unknown[] | undefined) {
  const list = Array.isArray(vms) ? vms : [];

  return {
    id: (r: unknown) => {
      const row = r as Record<string, unknown> & { metadata?: { name?: string }; name?: string };
      return row?.name || row?.metadata?.name || '';
    },
    name: (r: unknown) => {
      const row = r as Record<string, unknown> & {
        alias?: string;
        name?: string;
        metadata?: { name?: string; annotations?: Record<string, string> };
      };
      return (
        row?.alias ||
        row?.metadata?.annotations?.['tower.io/alias'] ||
        row?.name ||
        row?.metadata?.name ||
        ''
      );
    },
    namespace: (r: unknown) => {
      const row = r as Record<string, unknown> & {
        namespace?: string;
        metadata?: { namespace?: string };
      };
      return row?.namespace || row?.metadata?.namespace || '';
    },
    phase: (r: unknown) => {
      const row = r as Record<string, unknown> & {
        phase?: string;
        status?: { phase?: string; state?: string };
      };
      return row?.phase || row?.status?.phase || row?.status?.state || 'Unknown';
    },
    attachedVm: (r: unknown) => {
      const row = r as Record<string, unknown> & {
        name?: string;
        namespace?: string;
        metadata?: { name?: string; namespace?: string };
      };
      const pvcName = row?.name || row?.metadata?.name || '';
      const pvcNs = row?.namespace || row?.metadata?.namespace || '';

      return list.find((vm: unknown) => {
        const v = vm as Record<string, unknown> & {
          namespace?: string;
          metadata?: { namespace?: string };
          extra?: { namespace?: string; volumeClaims?: string[] };
          Extra?: { Namespace?: string; VolumeClaims?: string[] };
          volumeClaims?: string[];
          spec?: { template?: { spec?: { volumes?: Array<{ persistentVolumeClaim?: { claimName?: string } }> } } };
        };
        const vmNs =
          v.namespace ||
          v.metadata?.namespace ||
          v.extra?.namespace ||
          v.Extra?.Namespace ||
          '';
        if (String(vmNs) !== pvcNs) return false;

        const claims = v.volumeClaims || v.extra?.volumeClaims || v.Extra?.VolumeClaims;
        if (Array.isArray(claims) && claims.includes(pvcName)) return true;

        const volumes = v?.spec?.template?.spec?.volumes;
        if (Array.isArray(volumes)) {
          return volumes.some((vol) => vol?.persistentVolumeClaim?.claimName === pvcName);
        }
        return false;
      });
    },
  };
}

/** 云盘是否作为 VM 系统盘挂载 */
export function checkIsVolumeSystemDisk(r: VolumeView, vm: unknown): boolean {
  if (!vm) return false;

  const pvcName = r.name;
  const v = vm as Record<string, unknown> & {
    spec?: {
      template?: {
        spec?: {
          volumes?: Array<{ name?: string; persistentVolumeClaim?: { claimName?: string } }>;
          domain?: { devices?: { disks?: Array<{ name?: string; bootOrder?: number; cdrom?: boolean }> } };
        };
      };
    };
  };
  const vmVolumes = Array.isArray(v?.spec?.template?.spec?.volumes) ? v.spec!.template!.spec!.volumes! : [];
  const vmDisks = Array.isArray(v?.spec?.template?.spec?.domain?.devices?.disks)
    ? v.spec!.template!.spec!.domain!.devices!.disks!
    : [];
  const volEntry = vmVolumes.find((vol) => vol?.persistentVolumeClaim?.claimName === pvcName);
  const volName = volEntry?.name || '';
  if (!volName) return false;

  const diskEntry = vmDisks.find((d) => d?.name === volName);
  if (!diskEntry || diskEntry.cdrom) return false;

  if (Number(diskEntry.bootOrder) === 1) return true;
  if (volName === 'disk-0') return true;
  if (volName === 'rootdisk') return true;

  const nonCdromDisks = vmDisks.filter((d) => !d.cdrom);
  return nonCdromDisks.length === 1 && nonCdromDisks[0]?.name === volName;
}

export function volumeDisplayLabel(t: VolumeView): string {
  const alias = String(t.alias ?? '').trim();
  return alias || t.name;
}
