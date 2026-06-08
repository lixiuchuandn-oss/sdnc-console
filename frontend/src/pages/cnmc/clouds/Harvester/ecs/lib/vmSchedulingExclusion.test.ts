import {
  applyDeploymentSetExclusive,
  collectVmWizardMetricAutoScheduledConflicts,
  formatMetricAutoScheduledConflictMessage,
  getVmWizardMetricAutoScheduledConflictMessage,
  readVmMetricAutoScheduled,
  resolveExclusiveVmScheduling,
  setMetricAutoScheduledExclusive,
} from './vmSchedulingExclusion';
import type { DeploymentSetLike } from './vmDeploymentSet';

describe('vmSchedulingExclusion', () => {
  it('resolveExclusiveVmScheduling prefers metric over deployment set', () => {
    const set: DeploymentSetLike = {
      id: 'ds-1',
      schedulingPolicy: 'affinity',
      schedulingStrength: 'preferred',
    };
    expect(
      resolveExclusiveVmScheduling('auto', true, set),
    ).toEqual({ writeMetricAnnotation: true, effectiveDeploymentSet: null });
  });

  it('resolveExclusiveVmScheduling applies deployment set when metric off', () => {
    const set: DeploymentSetLike = {
      id: 'ds-1',
      schedulingPolicy: 'none',
      schedulingStrength: 'preferred',
    };
    expect(
      resolveExclusiveVmScheduling('auto', false, set),
    ).toEqual({ writeMetricAnnotation: false, effectiveDeploymentSet: set });
  });

  it('form helpers clear the other field', () => {
    const values = {
      metricAutoScheduled: false,
      deploymentSetId: 'old',
    };
    const form = {
      setFieldsValue: (v: Record<string, unknown>) => Object.assign(values, v),
    };
    setMetricAutoScheduledExclusive(form, true);
    expect(values.metricAutoScheduled).toBe(true);
    expect(values.deploymentSetId).toBeUndefined();

    const nextSet: DeploymentSetLike = {
      id: 'ds-2',
      schedulingPolicy: 'none',
      schedulingStrength: 'preferred',
    };
    applyDeploymentSetExclusive(form, nextSet);
    expect(values.deploymentSetId).toBe('ds-2');
    expect(values.metricAutoScheduled).toBe(false);
  });

  it('collectVmWizardMetricAutoScheduledConflicts detects GPU and passthrough nic', () => {
    expect(
      collectVmWizardMetricAutoScheduledConflicts({
        hostMode: 'auto',
        metricAutoScheduled: true,
        gpuMode: 'passthrough',
        gpuPickKey: 'gpu-1',
      }),
    ).toEqual(['GPU']);
    expect(
      collectVmWizardMetricAutoScheduledConflicts({
        hostMode: 'auto',
        metricAutoScheduled: true,
        netMode: 'passthrough_sriov',
      }),
    ).toEqual(['直通SR-IOV']);
    expect(
      collectVmWizardMetricAutoScheduledConflicts({
        hostMode: 'auto',
        metricAutoScheduled: true,
        usbDevices: ['usb-a'],
      }),
    ).toEqual(['USB设备']);
    expect(
      collectVmWizardMetricAutoScheduledConflicts({
        hostMode: 'auto',
        metricAutoScheduled: false,
        netMode: 'passthrough',
      }),
    ).toEqual([]);
  });

  it('readVmMetricAutoScheduled reads template metadata annotations first', () => {
    expect(
      readVmMetricAutoScheduled({
        spec: {
          template: {
            metadata: {
              annotations: { 'hci.manager.system/auto-scheduled': 'metric' },
            },
          },
        },
      }),
    ).toBe(true);
    expect(
      readVmMetricAutoScheduled({
        metadata: {
          annotations: { 'hci.manager.system/auto-scheduled': 'metric' },
        },
      }),
    ).toBe(true);
  });

  it('formatMetricAutoScheduledConflictMessage joins multiple conflicts', () => {
    expect(
      formatMetricAutoScheduledConflictMessage(['GPU', 'USB设备']),
    ).toBe('GPU、USB设备与参与指标自动调度冲突');
    expect(
      getVmWizardMetricAutoScheduledConflictMessage({
        hostMode: 'auto',
        metricAutoScheduled: true,
        gpuMode: 'vgpu',
        gpuResourceName: 'nvidia.com/gpu',
        netMode: 'passthrough',
      }),
    ).toBe('GPU、直通网卡与参与指标自动调度冲突');
  });
});
