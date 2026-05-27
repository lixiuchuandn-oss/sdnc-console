import { isHarvesterCephVmBackup } from '../../../../../../utils/harvesterUtils';
import { isVmInRecycleBin } from '../../ecs/lib/vmSectionUtils';

export type VmRestoreFormValues = {
  name: string;
  newVM: boolean;
  newVmName?: string;
  displayName?: string;
  keepMacAddress?: boolean;
  deletionPolicy?: string;
};

export type VmRestoreResourceContext = {
  raw: Record<string, unknown>;
  namespace: string;
  sourceName: string;
  sourceVmName: string;
  sourceVmObj: Record<string, unknown> | null;
  sourceVmAlias: string;
  sourceVmDisplay: string;
  isSourceVmExists: boolean;
  isSourceVmInRecycleBin: boolean;
  canReplaceSourceVm: boolean;
  isSourceVmRunning: boolean;
};

export function resolveVmRestoreResourceContext(
  resource: unknown,
  vms?: unknown[],
): VmRestoreResourceContext | null {
  if (!resource) return null;

  const rec = resource as Record<string, unknown>;
  const raw = ((rec.rawData || rec.raw || resource) as Record<string, unknown>) || {};
  const meta = (raw.metadata || {}) as Record<string, unknown>;
  const spec = (raw.spec || {}) as Record<string, unknown> & {
    source?: { name?: string };
    sourceVm?: string;
  };

  const namespace = String(meta.namespace || rec.namespace || '');
  const sourceName = String(meta.name || rec.name || '');

  const fromSpec = spec.source?.name || spec.sourceVm;
  const fromCompat = rec.targetVm;
  const sourceVmNameRaw = fromSpec || fromCompat || '';
  const sourceVmName =
    sourceVmNameRaw && String(sourceVmNameRaw) !== '-' ? String(sourceVmNameRaw) : '';

  const sourceVmObj =
    vms && namespace && sourceVmName
      ? ((vms as any[]).find((vm) => {
          const vmNs = vm?.metadata?.namespace || vm?.namespace || '';
          const vmName = vm?.metadata?.name || vm?.name || '';
          return String(vmNs) === String(namespace) && String(vmName) === String(sourceVmName);
        }) as Record<string, unknown> | undefined) || null
      : null;

  const fromRecord = rec.targetVmAlias;
  const fromVm =
    (sourceVmObj?.metadata as Record<string, unknown> | undefined)?.annotations &&
    ((sourceVmObj?.metadata as any)?.annotations?.['tower.io/alias'] || sourceVmObj?.alias);
  const sourceVmAlias =
    fromRecord && fromRecord !== '-'
      ? String(fromRecord)
      : fromVm
        ? String(fromVm)
        : sourceVmName || '-';

  const sourceVmDisplay =
    !sourceVmName
      ? '-'
      : !sourceVmAlias || sourceVmAlias === '-' || sourceVmAlias === sourceVmName
        ? sourceVmName
        : `${sourceVmAlias} (${sourceVmName})`;

  const isSourceVmExists = !!sourceVmObj;
  const isSourceVmInRecycleBin = isVmInRecycleBin(sourceVmObj);
  const canReplaceSourceVm = isSourceVmExists && !isSourceVmInRecycleBin;

  const status =
    (sourceVmObj?.status as Record<string, unknown> | undefined)?.printableStatus ||
    (sourceVmObj?.status as Record<string, unknown> | undefined)?.phase ||
    sourceVmObj?.status ||
    '';
  const s = String(status).toLowerCase();
  const isSourceVmRunning = s === 'running' || s === 'starting';

  return {
    raw,
    namespace,
    sourceName,
    sourceVmName,
    sourceVmObj,
    sourceVmAlias,
    sourceVmDisplay,
    isSourceVmExists,
    isSourceVmInRecycleBin,
    canReplaceSourceVm,
    isSourceVmRunning,
  };
}

export function buildVmRestoreInitialFormValues(ctx: VmRestoreResourceContext): VmRestoreFormValues & {
  deletionPolicy: string;
} {
  const base = ctx.sourceVmName || ctx.sourceName || 'vm';
  const suggestedNewVmName = `restore-${base}-${Math.floor(Date.now() / 1000)}`;
  const defaultDisplayName =
    ctx.sourceVmAlias &&
    ctx.sourceVmAlias !== '-' &&
    ctx.sourceVmAlias !== ctx.sourceVmName
      ? `${ctx.sourceVmAlias}-恢复`
      : '';

  return {
    name: `restore-${ctx.sourceName}-${Math.floor(Date.now() / 1000)}`,
    newVM: true,
    deletionPolicy: 'retain',
    newVmName: suggestedNewVmName,
    displayName: defaultDisplayName,
    keepMacAddress: false,
  };
}

export function buildVmRestorePayload(params: {
  values: VmRestoreFormValues;
  ctx: VmRestoreResourceContext;
  resource: unknown;
  resourceType: 'backup' | 'snapshot';
}): Record<string, unknown> {
  const { values, ctx, resource, resourceType } = params;
  const { namespace, sourceName, sourceVmName, sourceVmDisplay } = ctx;
  const targetName = values.newVM === false ? sourceVmName : values.newVmName;
  if (!targetName) throw new Error('目标虚拟机名称为空');

  const targetDisplayLabel =
    values.newVM === true
      ? String(values.displayName ?? '').trim() ||
        String(values.newVmName ?? '').trim() ||
        targetName
      : sourceVmDisplay;

  const payload: Record<string, unknown> = {
    apiVersion: 'harvesterhci.io/v1beta1',
    kind: 'VirtualMachineRestore',
    metadata: {
      name: values.name,
      namespace,
      annotations: {
        'tower.io/description': 'Created via Compute Tower',
        'tower.io/restoreTask': 'true',
        'tower.io/restoreMode': values.newVM ? 'new' : 'replace',
        'tower.io/restoreSource': `${namespace}/${sourceName}`,
        'tower.io/restoreTarget': `${namespace}/${targetName}`,
        ...(sourceVmDisplay && sourceVmDisplay !== '-'
          ? { 'tower.io/restoreSourceVmAlias': sourceVmDisplay }
          : {}),
        ...(targetDisplayLabel && targetDisplayLabel !== '-'
          ? { 'tower.io/restoreTargetDisplayName': targetDisplayLabel }
          : {}),
      },
    },
    spec: {
      target: {
        apiGroup: 'kubevirt.io',
        kind: 'VirtualMachine',
        name: targetName,
      },
      virtualMachineBackupName: sourceName,
      virtualMachineBackupNamespace: namespace,
    },
  };

  const spec = payload.spec as Record<string, unknown>;
  if (values.newVM === false) spec.deletionPolicy = 'retain';

  if (resourceType === 'snapshot') {
    if (values.newVM === false) {
      spec.deletionPolicy = 'retain';
    } else {
      spec.newVM = true;
    }
  } else {
    if (values.newVM !== undefined) spec.newVM = values.newVM;
    if (values.keepMacAddress !== undefined) spec.keepMacAddress = values.keepMacAddress;
  }

  if (isHarvesterCephVmBackup(resource)) {
    (payload.metadata as Record<string, unknown>).annotations = {
      ...((payload.metadata as Record<string, unknown>).annotations as object),
      'tower.io/backupBackend': 'ceph',
    };
  }

  return payload;
}

export function assertVmRestoreReplaceAllowed(ctx: VmRestoreResourceContext): void {
  if (!ctx.isSourceVmExists) throw new Error('源虚拟机不存在，无法执行替换');
  if (ctx.isSourceVmInRecycleBin) {
    throw new Error(
      '源虚拟机在回收站中，不允许替换虚拟机，请选择新建虚拟机或先将虚拟机移出回收站',
    );
  }
}

export function isVmNameConflictInNamespace(
  name: string,
  namespace: string,
  vms: unknown[] | undefined,
): boolean {
  return (vms || []).some((vm: any) => {
    const vmNs = vm?.metadata?.namespace || vm?.namespace || '';
    const vmName = vm?.metadata?.name || vm?.name || '';
    return String(vmNs) === String(namespace) && String(vmName) === String(name);
  });
}

export function isVmAliasConflictInNamespace(
  alias: string,
  namespace: string,
  vms: unknown[] | undefined,
): boolean {
  const s = String(alias).trim();
  if (!s) return false;
  return (vms || []).some((vm: any) => {
    const vmNs = vm?.metadata?.namespace || vm?.namespace || '';
    const a = String(vm?.metadata?.annotations?.['tower.io/alias'] || '').trim();
    return String(vmNs) === String(namespace) && a === s;
  });
}

export const VM_RESTORE_K8S_NAME_PATTERN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
