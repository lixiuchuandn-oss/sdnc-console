export type VmAttachRecord = Record<string, unknown> & {
  id?: string;
  InstanceId?: string;
  InstanceName?: string;
  name?: string;
  namespace?: string;
  alias?: string;
  metadata?: { namespace?: string; name?: string; annotations?: Record<string, string> };
  extra?: { namespace?: string; volumeClaims?: string[] };
  Extra?: { Namespace?: string; VolumeMap?: Record<string, string> };
  spec?: {
    template?: {
      spec?: {
        volumes?: Array<{ name?: string; persistentVolumeClaim?: { claimName?: string } }>;
      };
    };
  };
};

export function resolveAttachedDiskName(vm: VmAttachRecord, pvcName: string): string {
  const vmVolumes = Array.isArray(vm?.spec?.template?.spec?.volumes)
    ? vm.spec!.template!.spec!.volumes!
    : [];
  const volEntry = vmVolumes.find((v) => v?.persistentVolumeClaim?.claimName === pvcName);
  const volName = volEntry?.name || '';
  const mappedName = vm.Extra?.VolumeMap?.[pvcName] || '';
  return volName || mappedName || '';
}

export function resolveVmInstanceIds(vm: VmAttachRecord): {
  resolvedId: string;
  iidNameOnly: string;
} {
  const iid = String(vm.InstanceId || '');
  const meta = vm.metadata;
  const ns =
    meta?.namespace ||
    (vm.namespace as string) ||
    vm.extra?.namespace ||
    vm.Extra?.Namespace ||
    '';
  const name = (vm.name as string) || meta?.name || (vm.InstanceName as string) || '';
  const iidNameOnly = iid && iid.includes('/') ? iid.split('/').pop()! : iid || name;
  const resolvedId = iid ? iid : ns && name ? `${ns}/${name}` : iidNameOnly;
  return { resolvedId, iidNameOnly };
}

export function resolveVmRebootTargetId(vm: VmAttachRecord): string {
  const { resolvedId } = resolveVmInstanceIds(vm);
  return resolvedId;
}

export function vmDisplayLabel(vm: VmAttachRecord): string {
  const alias = vm.metadata?.annotations?.['tower.io/alias'];
  const tech = vm.metadata?.name || (vm.name as string) || '';
  return alias ? `${alias}（${tech}）` : tech || '未知实例';
}

export function isVolumeDeleteInUseError(message: string, hasAttachedVm: boolean): boolean {
  if (!hasAttachedVm) return false;
  const raw = String(message || '');
  return (
    raw.includes('删除失败') ||
    raw.includes('Forbidden') ||
    /in use|using|attached|bound|mounted|被使用|引用/i.test(raw)
  );
}

export function countVolumeBatchDeleteSuccess(
  results: PromiseSettledResult<unknown>[],
): { ok: number; fail: number } {
  const ok = results.filter((x) => {
    if (x.status === 'fulfilled') return true;
    const reason = x.reason as { status?: number; message?: string };
    const status = Number(reason?.status || 0);
    const errMsg = String(reason?.message || '').toLowerCase();
    return status === 404 || errMsg.includes('not found') || errMsg.includes('未找到');
  }).length;
  return { ok, fail: Math.max(0, results.length - ok) };
}
