import { createEmptyContainer } from '../containerDefaults';
import {
  validateContainerImages,
  validateDuplicateContainerNames,
  validateVolumesHaveMounts,
  validateWorkloadEditorRefs,
} from './validateWorkloadFormSubmit';
import { resolveEditKindFromMetadataName, workloadTypeFromK8sKind } from './workloadSubmitUtils';

describe('workloadSubmitUtils', () => {
  it('maps K8s kind to workload type', () => {
    expect(workloadTypeFromK8sKind('StatefulSet')).toBe('statefulset');
    expect(workloadTypeFromK8sKind('DaemonSet')).toBe('daemonset');
    expect(workloadTypeFromK8sKind('Deployment')).toBe('deployment');
  });

  it('resolves edit kind from Tower resource id prefix', () => {
    expect(resolveEditKindFromMetadataName('id-sts-abc')).toBe('statefulset');
    expect(resolveEditKindFromMetadataName('id-ds-abc')).toBe('daemonset');
    expect(resolveEditKindFromMetadataName('id-dep-abc')).toBe('deployment');
    expect(resolveEditKindFromMetadataName('other')).toBeNull();
  });
});

describe('validateWorkloadFormSubmit', () => {
  it('flags missing container image with step navigation', () => {
    const containers = [
      { ...createEmptyContainer('a'), image: 'nginx' },
      { ...createEmptyContainer('b'), image: '' },
    ];
    const failure = validateContainerImages(containers);
    expect(failure).toMatchObject({
      severity: 'error',
      action: { type: 'set_step_and_container', step: 1, containerIndex: 1 },
    });
  });

  it('flags duplicate container names', () => {
    const containers = [
      { ...createEmptyContainer('dup'), image: 'a' },
      { ...createEmptyContainer('dup'), image: 'b' },
    ];
    const failure = validateDuplicateContainerNames(containers);
    expect(failure?.message).toContain('容器名称重复');
    expect(failure?.action).toEqual({ type: 'set_step', step: 1 });
  });

  it('warns when volumes exist without mounts', () => {
    const failure = validateVolumesHaveMounts({
      volumes: [{ name: 'data', type: 'emptyDir' }],
      volumeMounts: [],
    } as never);
    expect(failure?.severity).toBe('warning');
    expect(failure?.action).toEqual({ type: 'set_step', step: 3 });
  });

  it('navigates to advanced step on editor errors', () => {
    const failure = validateWorkloadEditorRefs({ nodeAffinity: true });
    expect(failure?.action).toEqual({ type: 'set_step', step: 4 });
  });
});
