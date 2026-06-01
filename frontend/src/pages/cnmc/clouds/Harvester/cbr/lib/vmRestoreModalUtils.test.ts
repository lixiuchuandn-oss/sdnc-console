import {
  assertVmRestoreReplaceAllowed,
  buildVmRestoreInitialFormValues,
  buildVmRestorePayload,
  isVmAliasConflictInNamespace,
  isVmNameConflictInNamespace,
  resolveVmRestoreResourceContext,
  VM_RESTORE_K8S_NAME_PATTERN,
} from './vmRestoreModalUtils';

describe('vmRestoreModalUtils', () => {
  const backupResource = {
    namespace: 'proj-1',
    name: 'bk-a',
    targetVm: 'vm-src',
    targetVmAlias: '源 VM',
    raw: {
      metadata: { namespace: 'proj-1', name: 'bk-a' },
      spec: { source: { name: 'vm-src' } },
    },
  };

  const vms = [
    {
      metadata: {
        namespace: 'proj-1',
        name: 'vm-src',
        annotations: { 'tower.io/alias': '源 VM' },
      },
      status: { printableStatus: 'Running' },
    },
  ];

  it('resolveVmRestoreResourceContext derives source vm and running state', () => {
    const ctx = resolveVmRestoreResourceContext(backupResource, vms);
    expect(ctx).toMatchObject({
      namespace: 'proj-1',
      sourceName: 'bk-a',
      sourceVmName: 'vm-src',
      sourceVmDisplay: '源 VM (vm-src)',
      isSourceVmExists: true,
      canReplaceSourceVm: true,
      isSourceVmRunning: true,
    });
  });

  it('buildVmRestorePayload sets backup restore fields', () => {
    const ctx = resolveVmRestoreResourceContext(backupResource, vms)!;
    const payload = buildVmRestorePayload({
      values: {
        name: 'restore-task-1',
        newVM: true,
        newVmName: 'vm-new',
        displayName: '新 VM',
        keepMacAddress: true,
      },
      ctx,
      resource: backupResource,
      resourceType: 'backup',
    });

    expect(payload).toMatchObject({
      kind: 'VirtualMachineRestore',
      metadata: {
        name: 'restore-task-1',
        namespace: 'proj-1',
      },
      spec: {
        newVM: true,
        keepMacAddress: true,
        virtualMachineBackupName: 'bk-a',
        target: { name: 'vm-new' },
      },
    });
  });

  it('buildVmRestorePayload uses retain deletionPolicy for snapshot replace', () => {
    const ctx = resolveVmRestoreResourceContext(backupResource, vms)!;
    const payload = buildVmRestorePayload({
      values: { name: 'restore-task-2', newVM: false },
      ctx,
      resource: backupResource,
      resourceType: 'snapshot',
    });

    expect((payload.spec as Record<string, unknown>).deletionPolicy).toBe('retain');
  });

  it('assertVmRestoreReplaceAllowed rejects recycle bin vm', () => {
    const ctx = resolveVmRestoreResourceContext(backupResource, [
      {
        metadata: {
          namespace: 'proj-1',
          name: 'vm-src',
          finalizers: ['tower.io/recycle-bin'],
        },
      },
    ])!;

    expect(() => assertVmRestoreReplaceAllowed(ctx)).toThrow(/回收站/);
  });

  it('detects vm name and alias conflicts', () => {
    expect(isVmNameConflictInNamespace('vm-src', 'proj-1', vms)).toBe(true);
    expect(isVmNameConflictInNamespace('vm-new', 'proj-1', vms)).toBe(false);
    expect(isVmAliasConflictInNamespace('源 VM', 'proj-1', vms)).toBe(true);
  });

  it('buildVmRestoreInitialFormValues suggests restore names', () => {
    const ctx = resolveVmRestoreResourceContext(backupResource, vms)!;
    const values = buildVmRestoreInitialFormValues(ctx);
    expect(values.newVM).toBe(true);
    expect(values.name).toMatch(/^restore-bk-a-/);
    expect(values.newVmName).toMatch(/^restore-vm-src-/);
    expect(values.displayName).toBe('源 VM-恢复');
  });

  it('VM_RESTORE_K8S_NAME_PATTERN validates dns-like names', () => {
    expect(VM_RESTORE_K8S_NAME_PATTERN.test('restore-vm-1')).toBe(true);
    expect(VM_RESTORE_K8S_NAME_PATTERN.test('Bad_Name')).toBe(false);
  });
});
